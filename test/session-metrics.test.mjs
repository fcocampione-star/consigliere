/**
 * test/session-metrics.test.mjs — `session-metrics.mjs` (raíz-only).
 *
 * Todo offline y determinista: los exports son fixtures JSON construidos aquí
 * como strings y NO se invoca el binario `opencode` real (ni red). Lo que se
 * ejercita es el contrato del CLI: extracción tolerante, códigos de salida y
 * paridad raíz↔templates del script.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, cleanup, eq, includes, runAll, suite, test, tmpdir } from './harness.mjs';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, '.opencode', 'scripts', 'session-metrics.mjs');
const MIRROR = join(ROOT, 'templates', '.opencode', 'scripts', 'session-metrics.mjs');

// Un `ADVISOR_OPENCODE` que NO existe: si el CLI llegara a spawnear, el spawn
// daría ENOENT y el exit sería 3 (dependencia), nunca 1 (uso).
const BIN_AUSENTE = join(ROOT, '.advisor', 'tmp', 'opencode-inexistente');
const SIN_BINARIO = { ADVISOR_OPENCODE: BIN_AUSENTE };

function ejecutar(args, env = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, out: res.stdout || '', err: res.stderr || '' };
}

/** Escribe un export en un tmpdir y devuelve `{file, limpiar}`. */
function fixture(text) {
  const dir = tmpdir('session-metrics');
  const file = join(dir, 'export.json');
  writeFileSync(file, text);
  return { file, limpiar: () => cleanup(dir) };
}

/** Binario opencode falso (posix) que imprime SIEMPRE `payload` por stdout. */
function fakeBin(payload) {
  const dir = tmpdir('session-metrics');
  const file = join(dir, 'payload.json');
  writeFileSync(file, payload);
  const bin = join(dir, 'opencode-falso.sh');
  writeFileSync(bin, `#!/bin/sh\ncat "${file}"\n`);
  chmodSync(bin, 0o755);
  return { bin, limpiar: () => cleanup(dir) };
}

// ── Fixtures (formas reales toleradas por el parser) ────────────────────────

// v1: `messages[].info` + `parts[]`, delegación `type: 'tool'`/`tool-invocation`.
// Prompts: "abc" (3 B), "hola mundo" (10 B) y "ñ" (2 B, fuerza UTF-8).
const V1_CON_TOKENS = JSON.stringify({
  info: { id: 'ses_abcdefghijklmnop', title: 'Fixture v1' },
  messages: [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'hola' }] },
    {
      info: { role: 'assistant', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1000, write: 20 } } },
      parts: [{ type: 'tool', tool: 'task', state: { input: { subagent_type: 'explore', prompt: 'abc' } } }],
    },
    {
      info: { role: 'assistant', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1000, write: 20 } } },
      parts: [
        { type: 'tool-invocation', tool: 'read', state: { input: { filePath: 'x' } } },
        { type: 'tool-invocation', tool: 'task', state: { input: { agent: 'planner', prompt: 'hola mundo' } } },
      ],
    },
    {
      info: { role: 'assistant', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1000, write: 20 } } },
      parts: [{ type: 'tool_call', tool: 'task', input: { subagent: 'builder', prompt: 'ñ' } }],
    },
  ],
});

// Mismo export sin ningún `tokens`: el usage NO existe y no debe fingirse 0.
const V1_SIN_TOKENS = JSON.stringify({
  info: { id: 'ses_sintokens0000', title: 'Sin usage' },
  messages: [
    { info: { role: 'user' }, parts: [] },
    { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'task', state: { input: { subagent_type: 'builder', prompt: 'ab' } } }] },
  ],
});

// v2: mensajes planos (`type`/`content`/`tokens` en el propio mensaje) y
// delegaciones con `name: 'subagent'`.
const V2_CON_TOKENS = JSON.stringify({
  info: { id: 'ses_v2v2v2v2v2v2', title: 'Fixture v2' },
  messages: [
    { type: 'user', content: [] },
    {
      type: 'assistant',
      agent: 'advisor',
      tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 4, write: 2 } },
      content: [{ type: 'tool', name: 'subagent', state: { input: { agent: 'critic', prompt: 'xyz' } } }],
    },
  ],
});

// v2 sin usage por mensaje pero con `info.tokens` de sesión (fuente real de v2).
const V2_TOKENS_DE_SESION = JSON.stringify({
  info: { id: 'ses_v2sessions000', title: 'Solo sesión', tokens: { input: 50, output: 5, reasoning: 2, cache: { read: 30, write: 1 } } },
  messages: [{ type: 'user', content: [] }, { type: 'assistant', content: [] }],
});

// ── Suite ───────────────────────────────────────────────────────────────────

suite('session-metrics');

test('3 delegaciones: conteo por agente, bytes y totales', () => {
  const f = fixture(V1_CON_TOKENS);
  try {
    const r = ejecutar(['--from', f.file, '--json']);
    eq(r.status, 0, `--from válido debe salir 0: ${r.err}`);
    const j = JSON.parse(r.out);
    eq(j.schema, 1, 'schema');
    eq(j.delegations, { explore: 1, planner: 1, builder: 1 }, 'una delegación por agente');
    eq(j.prompts, { bytesByAgent: { explore: 3, planner: 10, builder: 2 }, totalBytes: 15 }, 'bytes UTF-8 por agente');
    eq(j.iterations, { total: 3, pairs: { 'explore->planner': 1, 'planner->builder': 1 } }, 'pares en orden de aparición');
    eq(j.tokens, {
      available: true,
      source: 'messages',
      input: 300,
      output: 30,
      reasoning: 15,
      cache: { read: 3000, write: 60 },
      total: 3405,
    }, 'tokens sumados de los mensajes');
    eq(j.messages, 4, 'mensajes leídos');
    eq(j.session, { id: 'ses_abcdefghijklmnop', title: 'Fixture v1' }, 'sesión del export');
  } finally {
    f.limpiar();
  }
});

test('sin tokens en el export: available false y exit 0', () => {
  const f = fixture(V1_SIN_TOKENS);
  try {
    const r = ejecutar(['--from', f.file, '--json']);
    eq(r.status, 0, `un export sin usage no es un error: ${r.err}`);
    const j = JSON.parse(r.out);
    eq(j.tokens, { available: false }, 'sin usage no se finge con ceros');
    const texto = ejecutar(['--from', f.file]);
    eq(texto.status, 0, 'salida de texto exit 0');
    includes(texto.out, 'tokens: N/A', 'la tabla avisa de la ausencia de usage');
  } finally {
    f.limpiar();
  }
});

test('--session con id inválido: exit 1 sin spawnear el binario', () => {
  const r = ejecutar(['--session', 'ses_short'], SIN_BINARIO);
  eq(r.status, 1, `id inválido = error de uso, no de dependencia: ${r.out}${r.err}`);
  includes(r.err, 'id de sesion invalido', 'el mensaje explica el id inválido');
});

test('--from inexistente: exit 1', () => {
  const dir = tmpdir('session-metrics');
  try {
    const r = ejecutar(['--from', join(dir, 'no-existe.json')]);
    eq(r.status, 1, `archivo ausente = uso/entrada inválida: ${r.err}`);
    includes(r.err, 'no se pudo leer', 'el mensaje nombra la lectura fallida');
  } finally {
    cleanup(dir);
  }
});

test('JSON malformado: exit 5 (parcial)', () => {
  const f = fixture('{"info": {"id": "ses_x"}, "messages": [');
  try {
    const r = ejecutar(['--from', f.file]);
    eq(r.status, 5, `export truncado = parcial: ${r.err}`);
    includes(r.err, 'no es JSON valido', 'el mensaje nombra el JSON inválido');
  } finally {
    f.limpiar();
  }
});

test('--from con JSON sin forma de export: exit 5 (parcial)', () => {
  const f = fixture('{"oops":1}');
  try {
    const r = ejecutar(['--from', f.file]);
    eq(r.status, 5, `un JSON sin forma de export no se acepta: ${r.out}${r.err}`);
    includes(r.err, 'no tiene forma de export', 'el mensaje explica que no es un export');
    assert(!r.out.includes('(sin delegaciones)'), 'no se reporta una tabla vacía como si el export fuera válido');
  } finally {
    f.limpiar();
  }
});

test('--session sin binario: exit 3 (dependencia)', () => {
  const r = ejecutar(['--session', 'ses_abcdefghijklmnop'], SIN_BINARIO);
  eq(r.status, 3, `binario ausente = dependencia: ${r.out}${r.err}`);
  includes(r.err, 'no se pudo ejecutar', 'el mensaje nombra el binario que no arrancó');
});

test('binario con un JSON que no parece un export: exit 5 (parcial)', () => {
  if (process.platform === 'win32') return; // el fake es un .sh posix
  const f = fakeBin('{"oops":1}');
  try {
    const r = ejecutar(['--session', 'ses_abcdefghijklmnop'], { ADVISOR_OPENCODE: f.bin });
    eq(r.status, 5, `un JSON sin forma de export no se acepta: ${r.out}${r.err}`);
    includes(r.err, 'no parece un export', 'el mensaje explica que no es un export');
    assert(!r.out.includes('sin delegaciones'), 'no se reporta una tabla vacía como si el export fuera válido');
  } finally {
    f.limpiar();
  }
});

test('binario con un export v2 válido: exit 0 y mide la delegación', () => {
  if (process.platform === 'win32') return; // el fake es un .sh posix
  const f = fakeBin(V2_CON_TOKENS);
  try {
    const r = ejecutar(['--session', 'ses_abcdefghijklmnop', '--json'], { ADVISOR_OPENCODE: f.bin });
    eq(r.status, 0, `un export v2 válido sigue funcionando: ${r.err}`);
    const j = JSON.parse(r.out);
    eq(j.delegations, { critic: 1 }, 'la delegación v2 del binario se mide');
    eq(j.tokens.total, 17, 'tokens del mensaje plano');
  } finally {
    f.limpiar();
  }
});

test('--json es parseable y schema 1; analyze funciona como alias', () => {
  const f = fixture(V1_CON_TOKENS);
  try {
    const r = ejecutar(['analyze', '--from', f.file, '--json']);
    eq(r.status, 0, `analyze --from debe salir 0: ${r.err}`);
    const j = JSON.parse(r.out);
    eq(j.schema, 1, 'schema del contrato');
    eq(j.source, { kind: 'file', ref: f.file }, 'la fuente se declara en la salida');
    for (const key of ['delegations', 'iterations', 'prompts', 'tokens', 'messages']) {
      assert(key in j, `la salida JSON debe traer "${key}"`);
    }
  } finally {
    f.limpiar();
  }
});

test('export v2: name subagent, content y tokens por mensaje', () => {
  const f = fixture(V2_CON_TOKENS);
  try {
    const j = JSON.parse(ejecutar(['--from', f.file, '--json']).out);
    eq(j.delegations, { critic: 1 }, 'name:"subagent" + state.input.agent');
    eq(j.prompts.totalBytes, 3, 'prompt en bytes');
    eq(j.tokens.total, 17, 'tokens del mensaje plano');
  } finally {
    f.limpiar();
  }
});

test('v2 sin usage por mensaje: cae al tokens de sesión y lo declara', () => {
  const f = fixture(V2_TOKENS_DE_SESION);
  try {
    const j = JSON.parse(ejecutar(['--from', f.file, '--json']).out);
    eq(j.tokens, { available: true, source: 'session', input: 50, output: 5, reasoning: 2, cache: { read: 30, write: 1 }, total: 88 }, 'usage de sesión marcado');
  } finally {
    f.limpiar();
  }
});

test('tolerante: partes y mensajes raros no rompen el parser', () => {
  const f = fixture(JSON.stringify({ messages: [null, 42, { info: null, parts: 'no-es-array' }, { info: { role: 'assistant' }, parts: [null, { type: 'tool' }] }] }));
  try {
    const r = ejecutar(['--from', f.file, '--json']);
    eq(r.status, 0, `un export raro devuelve lo que pueda: ${r.err}`);
    const j = JSON.parse(r.out);
    eq(j.delegations, {}, 'sin delegaciones reconocibles');
    eq(j.tokens, { available: false }, 'sin usage');
    eq(j.messages, 4, 'los mensajes se cuentan igual');
  } finally {
    f.limpiar();
  }
});

test('--help: exit 0 y uso en stdout', () => {
  const r = ejecutar(['--help']);
  eq(r.status, 0, '--help no es error');
  includes(r.out, '--from', 'la ayuda documenta --from');
  includes(r.out, '--session', 'la ayuda documenta --session');
});

test('paridad raíz↔templates byte a byte', () => {
  const raiz = readFileSync(SCRIPT);
  const espejo = readFileSync(MIRROR);
  assert(raiz.equals(espejo), `${MIRROR} debe ser copia byte-idéntica de ${SCRIPT}`);
  assert(!raiz.includes('{{'), 'el script espejado no debe llevar placeholders {{...}}');
});

await runAll();
