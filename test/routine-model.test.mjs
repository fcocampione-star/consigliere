#!/usr/bin/env node
/**
 * test/routine-model.test.mjs — suite de caracterizacion de
 * `.opencode/scripts/routine-model.mjs`.
 *
 * El modulo exporta funciones puras (`parseArgs`, `getEffectiveOverrides`,
 * `validateAgent`, `validateModel`) mas `mergeAtomically(configPath, overrides)`,
 * que SI acepta una ruta: por eso el merge se prueba contra una copia temporal
 * de `opencode.json` y nunca contra el archivo real del repo.
 *
 * Importar el modulo NO ejecuta `main()`: su guarda (linea 178) solo corre si
 * `process.argv[1]` termina en `routine-model.mjs`, y este archivo se llama
 * `routine-model.test.mjs`.
 *
 * Coverage: las cuatro formas de flag (`--model-x=v`, `--model-x v`, `--model=v`,
 * `--model v`), valor ausente, agente desconocido, modelo invalido, precedencia
 * global vs por-agente, validaciones con entradas limite y el merge atomico.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import {
  ALLOWED_AGENTS,
  MODEL_RE,
  parseArgs,
  getEffectiveOverrides,
  validateAgent,
  validateModel,
  mergeAtomically,
} from '../.opencode/scripts/routine-model.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Config temporal + helpers de merge. Se usa `tmpdir`/`cleanup` del harness.
function tempConfig(contents) {
  const dir = tmpdir('routine-model');
  const path = join(dir, 'opencode.json');
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2) + '\n', 'utf8');
  return { dir, path, read: () => JSON.parse(readFileSync(path, 'utf8')), raw: () => readFileSync(path, 'utf8') };
}

function cleanupAll(...ctxs) {
  cleanup(ctxs.map((c) => c.dir));
}

// ── parseArgs: las cuatro formas de flag ─────────────────────────────────────

suite('routine-model parseArgs: formas de flag');

test('--model-<agente>=valor fija el override de ese agente', () => {
  const p = parseArgs(['--model-builder=vendor/m1']);
  eq(p.overrides, { builder: 'vendor/m1' }, 'override por agente con =');
  eq(p.globalModel, null, 'sin modelo global');
  eq(p.errors, [], 'sin errores');
  eq([p.persist, p.dryRun], [false, false], 'persist y dry-run en false por defecto');
});

test('--model-<agente> valor (con espacio) fija el mismo override', () => {
  eq(parseArgs(['--model-builder', 'vendor/m1']).overrides, { builder: 'vendor/m1' }, 'override por agente con espacio');
  eq(parseArgs(['--model-verifier', 'opencode/mimo-v2.6-flash-free']).overrides, { verifier: 'opencode/mimo-v2.6-flash-free' }, 'otro agente');
});

test('--model=valor fija el modelo global y no toca overrides', () => {
  const p = parseArgs(['--model=vendor/m1']);
  eq(p.globalModel, 'vendor/m1', 'modelo global con =');
  eq(p.overrides, {}, 'overrides vacio');
  eq(p.errors, [], 'sin errores');
});

test('--model valor (con espacio) fija el mismo modelo global', () => {
  const p = parseArgs(['--model', 'vendor/m1']);
  eq(p.globalModel, 'vendor/m1', 'modelo global con espacio');
  eq(p.overrides, {}, 'overrides vacio');
  eq(p.errors, [], 'sin errores');
});

test('las cuatro formas producen el mismo resultado efectivo', () => {
  const forms = [
    parseArgs(['--model=vendor/m1', '--model-builder=vendor/b1']),
    parseArgs(['--model', 'vendor/m1', '--model-builder', 'vendor/b1']),
    parseArgs(['--model=vendor/m1', '--model-builder', 'vendor/b1']),
    parseArgs(['--model', 'vendor/m1', '--model-builder=vendor/b1']),
  ];
  const esperado = getEffectiveOverrides(forms[0]);
  for (const [i, p] of forms.entries()) {
    eq(p.errors, [], `forma ${i + 1} sin errores`);
    eq(getEffectiveOverrides(p), esperado, `forma ${i + 1} equivalente a la primera`);
  }
  eq(esperado.builder, 'vendor/b1', 'el override por agente sobrevive al global');
});

test('los flags --persist y --dry-run se reconocen por separado', () => {
  eq([parseArgs(['--persist']).persist, parseArgs(['--persist']).dryRun], [true, false], '--persist');
  eq([parseArgs(['--dry-run']).persist, parseArgs(['--dry-run']).dryRun], [false, true], '--dry-run');
  eq([parseArgs(['--persist', '--dry-run']).persist, parseArgs(['--persist', '--dry-run']).dryRun], [true, true], 'ambos juntos');
});

// ── parseArgs: errores ───────────────────────────────────────────────────────

suite('routine-model parseArgs: errores');

test('un valor ausente al final del argv da error con el nombre del flag', () => {
  const p = parseArgs(['--model-builder']);
  eq(p.errors, ['Flag --model-builder requiere un valor'], 'error de valor ausente');
  eq(p.overrides, {}, 'no se registra override');
});

test('un valor que empieza por -- se trata como ausente y NO se consume', () => {
  const p = parseArgs(['--model-builder', '--persist']);
  eq(p.errors, ['Flag --model-builder requiere un valor'], 'error de valor ausente');
  eq(p.persist, true, 'el flag siguiente se procesa igual (no se salta)');
});

test('--model y --model= sin valor dan el mismo error', () => {
  eq(parseArgs(['--model']).errors, ['Flag --model requiere un valor'], '--model sin valor');
  eq(parseArgs(['--model=']).errors, ['Flag --model requiere un valor'], '--model= vacio');
});

test('un valor con -- que parece un flag reprocesa el flag como global', () => {
  const p = parseArgs(['--model-builder', '--model=vendor/m1']);
  eq(p.errors, ['Flag --model-builder requiere un valor'], 'error del flag sin valor');
  eq(p.globalModel, 'vendor/m1', 'el valor que parecia valor se interpreta como --model global');
});

test('--model- sin nombre de agente se rechaza mostrando el flag completo', () => {
  eq(parseArgs(['--model-=m1']).errors, ['Flag --model- sin agente: --model-=m1'], 'forma con =');
  eq(parseArgs(['--model-', 'm1']).errors, ['Flag --model- sin agente: --model-'], 'forma con espacio');
});

test('un agente desconocido se rechaza listando los agentes permitidos', () => {
  const p = parseArgs(['--model-nope=m1']);
  eq(p.errors, [`Agente no permitido: nope (permitidos: ${ALLOWED_AGENTS.join(', ')})`], 'error de agente desconocido');
  eq(p.overrides, {}, 'no se registra el override invalido');
});

test('un modelo vacio se distingue del modelo invalido', () => {
  eq(parseArgs(['--model-builder=']).errors, ['Modelo vacío para agente builder'], 'modelo vacio por agente');
  eq(parseArgs(['--model-builder=mal modelo']).errors, ['Modelo inválido para builder: "mal modelo" (regex ^[A-Za-z0-9._:/-]{1,80}$)'], 'modelo invalido por agente');
  eq(parseArgs(['--model=', 'x']).errors, ['Flag --model requiere un valor'], 'el global exige valor antes de validar forma');
});

test('un modelo global invalido se reporta como error global en las dos formas', () => {
  const esperado = 'Modelo global inválido: "mal modelo" (regex ^[A-Za-z0-9._:/-]{1,80}$)';
  eq(parseArgs(['--model=mal modelo']).errors, [esperado], 'forma con =');
  eq(parseArgs(['--model', 'mal modelo']).errors, [esperado], 'forma con espacio');
});

test('parseArgs nunca lanza: acumula errores y conserva los flags validos', () => {
  const p = parseArgs(['--model=ok/m1', '--model-nope=x', '--model-builder=mal modelo', '--persist']);
  eq(p.errors.length, 2, 'los dos flags invalidos se acumulan');
  eq(p.globalModel, 'ok/m1', 'el flag valido se conserva');
  eq(p.overrides, {}, 'los overrides invalidos no se registran');
  eq(p.persist, true, 'los flags de control se conservan');
});

test('los argumentos posicionales y los flags desconocidos se ignoran sin error', () => {
  const p = parseArgs(['refactorizar', '--skip-verify', '--parallel', '--critic', '--model-verifier=v/m1']);
  eq(p.errors, [], 'ningun error por flags no relacionados con modelos');
  eq(p.overrides, { verifier: 'v/m1' }, 'el unico flag de modelo se aplica');
});

test('el ultimo valor gana cuando el mismo flag se repite', () => {
  eq(parseArgs(['--model=a/1', '--model=b/2']).globalModel, 'b/2', 'global repetido');
  eq(parseArgs(['--model-builder=a/1', '--model-builder=b/2']).overrides, { builder: 'b/2' }, 'override repetido');
});

// ── getEffectiveOverrides y precedencia ──────────────────────────────────────

suite('routine-model precedencia y getEffectiveOverrides');

test('un modelo global se propaga a los siete agentes permitidos', () => {
  const eff = getEffectiveOverrides(parseArgs(['--model=vendor/m1']));
  eq(Object.keys(eff).sort(), [...ALLOWED_AGENTS].sort(), 'cubre exactamente los agentes permitidos');
  eq([...new Set(Object.values(eff))], ['vendor/m1'], 'todos reciben el mismo modelo');
});

test('el override por agente gana sobre el modelo global', () => {
  const eff = getEffectiveOverrides(parseArgs(['--model=vendor/m1', '--model-builder=vendor/b1']));
  eq(eff.builder, 'vendor/b1', 'builder usa su override');
  eq(eff.advisor, 'vendor/m1', 'advisor usa el global');
  eq(Object.keys(eff).length, ALLOWED_AGENTS.length, 'siguen siendo los 7 agentes');
});

test('sin modelo global solo aparecen los agentes con override', () => {
  eq(getEffectiveOverrides(parseArgs(['--model-verifier=v/1'])), { verifier: 'v/1' }, 'solo el agente indicado');
  eq(getEffectiveOverrides(parseArgs([])), {}, 'sin flags no hay overrides efectivos');
  eq(getEffectiveOverrides(parseArgs(['--persist'])), {}, '--persist no genera overrides por si solo');
});

test('getEffectiveOverrides no muta el objeto parseado', () => {
  const parsed = parseArgs(['--model=vendor/m1', '--model-builder=vendor/b1']);
  const before = JSON.stringify(parsed);
  getEffectiveOverrides(parsed);
  eq(JSON.stringify(parsed), before, 'el parsed de entrada queda intacto');
  eq(Object.keys(parsed.overrides), ['builder'], 'los overrides por agente siguen siendo los declarados');
});

// ── validateAgent ────────────────────────────────────────────────────────────

suite('routine-model validateAgent');

test('acepta los siete agentes documentados y nada mas', () => {
  eq(ALLOWED_AGENTS, ['advisor', 'planner', 'builder', 'verifier', 'critic', 'summarizer', 'explore'], 'lista de agentes');
  for (const a of ALLOWED_AGENTS) assert(validateAgent(a), `debería aceptar ${a}`);
  assert(!validateAgent('admins'), 'debería rechazar admins');
});

test('rechaza entradas limite: vacio, mayusculas, espacios y sufijos', () => {
  for (const a of ['', 'Advisor', 'BUILDER', ' advisor', 'advisor ', 'builder2', 'advisor\n', 'plan']) {
    assert(!validateAgent(a), `no debería aceptar ${JSON.stringify(a)}`);
  }
});

// ── validateModel ────────────────────────────────────────────────────────────

suite('routine-model validateModel');

test('acepta un id tipo free-tier (opencode/mimo-v2.6-flash-free): hoy solo valida FORMA', () => {
  // Comportamiento ACTUAL y deliberadamente documentado: el harness valida la
  // forma del id contra MODEL_RE, no su disponibilidad ni su plan. Por eso un
  // id estilo free-tier (que en la practica exige entitlement) se acepta sin
  // error. Si algun dia se valida el entitlement, este test es el que hay que
  // cambiar de forma consciente.
  assert(validateModel('opencode/mimo-v2.6-flash-free'), 'el id free-tier pasa la validación de forma');
  eq(validateModel('opencode/mimo-v2.6-flash-free'), true, 'mismo hecho, visto como eq');
  eq(parseArgs(['--model=opencode/mimo-v2.6-flash-free']).errors, [], 'y se acepta como modelo global');
});

test('acepta todo el conjunto de caracteres documentado y rechaza el resto', () => {
  for (const c of ['A', 'z', '0', '9', '.', '_', ':', '/', '-']) {
    assert(validateModel(c), `debería aceptar el carácter ${c}`);
  }
  for (const m of ['', 'mal modelo', 'model$o', 'm#1', 'a b', 'mañana', 'a'.repeat(81)]) {
    assert(!validateModel(m), `no debería aceptar ${JSON.stringify(m.slice(0, 20))}`);
  }
});

test('la longitud admisible es de 1 a 80 caracteres, inclusivo', () => {
  assert(validateModel('a'), '1 carácter es válido');
  assert(validateModel('a'.repeat(80)), '80 caracteres es válido');
  assert(!validateModel('a'.repeat(81)), '81 caracteres es inválido');
});

test('MODEL_RE documenta la forma exacta que se aplica', () => {
  eq(String(MODEL_RE), '/^[A-Za-z0-9._:\\/-]{1,80}$/', 'la regex exportada');
});

// ── mergeAtomically (acepta una ruta: se prueba sobre una copia temporal) ─────

suite('routine-model mergeAtomically');

test('crea agent si falta, preserva el resto de la config y deja newline final', () => {
  const ctx = tempConfig({ $schema: 'https://opencode.ai/config.json', default_agent: 'advisor' });
  try {
    const returned = mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    eq(returned.agent, { builder: { model: 'vendor/b1' } }, 'agent creado con el modelo');
    const written = ctx.read();
    eq(written.default_agent, 'advisor', 'el resto de la config se preserva');
    eq(written.$schema, 'https://opencode.ai/config.json', 'las claves desconocidas se preservan');
    match(ctx.raw(), /\}\n$/, 'el archivo serializado termina en newline');
  } finally { cleanupAll(ctx); }
});

test('preserva las claves existentes del agente y sustituye solo model', () => {
  const ctx = tempConfig({ agent: { builder: { model: 'old/m0', permission: { edit: 'ask' } } } });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    eq(ctx.read().agent.builder, { model: 'vendor/b1', permission: { edit: 'ask' } }, 'permission sobrevive, model se sustituye');
  } finally { cleanupAll(ctx); }
});

test('aplica varios overrides y varios agentes en una sola llamada', () => {
  const ctx = tempConfig({ agent: {} });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1', verifier: 'vendor/v1' });
    eq(ctx.read().agent, { builder: { model: 'vendor/b1' }, verifier: { model: 'vendor/v1' } }, 'los dos agentes escritos');
  } finally { cleanupAll(ctx); }
});

test('descarta en silencio los agentes no permitidos y los modelos invalidos', () => {
  const ctx = tempConfig({ agent: { builder: { permission: { edit: 'ask' } } } });
  try {
    const returned = mergeAtomically(ctx.path, { nope: 'vendor/x1', builder: 'mal modelo' });
    eq(Object.keys(returned.agent), ['builder'], 'el agente desconocido no se anade');
    eq(returned.agent.builder, { permission: { edit: 'ask' } }, 'el modelo invalido no se escribe');
    eq(ctx.read().agent.builder, { permission: { edit: 'ask' } }, 'y tampoco queda en el archivo');
  } finally { cleanupAll(ctx); }
});

test('un valor de agente que no es objeto se reemplaza por { model }', () => {
  const ctx = tempConfig({ agent: { builder: 'no-objeto' } });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    eq(ctx.read().agent.builder, { model: 'vendor/b1' }, 'se sustituye el valor escalar');
  } finally { cleanupAll(ctx); }
});

test('un agent que no es objeto se normaliza a objeto', () => {
  const ctx = tempConfig({ agent: 'no-objeto' });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    eq(ctx.read().agent, { builder: { model: 'vendor/b1' } }, 'agent deja de ser un string');
  } finally { cleanupAll(ctx); }
});

test('el merge es atomico: no deja el temporal .tmp tras el rename', () => {
  const ctx = tempConfig({ agent: {} });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    assert(!existsSync(ctx.path + '.tmp'), 'el temporal .tmp no debe quedar en disco');
    assert(existsSync(ctx.path), 'el destino existe tras el rename');
  } finally { cleanupAll(ctx); }
});

test('el archivo escrito es JSON valido con indentacion de 2 espacios', () => {
  const ctx = tempConfig({ agent: {} });
  try {
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    const raw = ctx.raw();
    match(raw, /^\{\n {2}"agent": \{\n/, 'indentacion de dos espacios, estilo JSON.stringify(x, null, 2)');
    const parsed = JSON.parse(raw);
    eq(parsed.agent.builder.model, 'vendor/b1', 'el contenido releido es el esperado');
  } finally { cleanupAll(ctx); }
});

test('un config con JSON invalido propaga el error y deja el archivo intacto', () => {
  const ctx = tempConfig('{ esto no es json\n');
  try {
    const err = throws(() => mergeAtomically(ctx.path, { builder: 'vendor/b1' }), 'debe lanzar con JSON invalido');
    assert(err instanceof Error, 'lanza un Error');
    eq(ctx.raw(), '{ esto no es json\n', 'el archivo original queda intacto');
    assert(!existsSync(ctx.path + '.tmp'), 'y no se escribe el temporal');
  } finally { cleanupAll(ctx); }
});

test('un config inexistente propaga el error de lectura', () => {
  const dir = tmpdir('routine-model');
  try {
    const err = throws(() => mergeAtomically(join(dir, 'no-existe.json'), { builder: 'vendor/b1' }), 'debe lanzar si el archivo no existe');
    match(err.code || '', /ENOENT/, 'el error es de archivo inexistente');
  } finally { cleanupAll({ dir }); }
});

test('un config sin newline final previo igual se serializa con newline', () => {
  const ctx = tempConfig('{"agent":{}}');
  try {
    assert(!ctx.raw().endsWith('\n'), 'el fixture no lleva newline');
    mergeAtomically(ctx.path, { builder: 'vendor/b1' });
    match(ctx.raw(), /\}\n$/, 'la salida normalizada si lleva newline');
  } finally { cleanupAll(ctx); }
});

test('los overrides del parsed alimentan el merge sin transformacion extra', () => {
  const ctx = tempConfig({ agent: {} });
  try {
    const parsed = parseArgs(['--model=vendor/m1', '--model-builder=vendor/b1']);
    mergeAtomically(ctx.path, getEffectiveOverrides(parsed));
    const written = ctx.read().agent;
    eq(Object.keys(written).length, ALLOWED_AGENTS.length, 'los 7 agentes del global+override');
    eq(written.builder.model, 'vendor/b1', 'builder con su override');
    eq(written.critic.model, 'vendor/m1', 'critic con el global');
  } finally { cleanupAll(ctx); }
});

test('neq documenta que dos configs distintos no se confunden', () => {
  const a = tempConfig({ agent: { builder: { model: 'a/1' } } });
  const b = tempConfig({ agent: { builder: { model: 'b/1' } } });
  try {
    neq(a.read(), b.read(), 'los dos temporales parten de configs distintas');
  } finally { cleanupAll(a, b); }
});

test('includes documenta que el nombre del agente aparece en el archivo escrito', () => {
  const ctx = tempConfig({ agent: {} });
  try {
    mergeAtomically(ctx.path, { verifier: 'vendor/v1' });
    includes(ctx.raw(), 'verifier', 'el nombre del agente queda en el JSON');
  } finally { cleanupAll(ctx); }
});

await runAll();
