/**
 * test/memory-tokens.test.mjs — caracterizacion del estimador estatico de tokens.
 *
 * Cubre `.opencode/scripts/memory-tokens.mjs`:
 *  - `estimateTokens`: heuristica chars/4 con techo (''/null -> 0).
 *  - `parseChunks`: extraccion de chunks `<!-- CHUNK: x -->...<!-- /CHUNK -->`.
 *  - `measureRoot`: suma state+summary+changelog+skills sobre un arbol sintetico.
 *  - `compare`: baseline > advisor y savingPct en (0,100); escenario invalido lanza.
 *  - CLI (`measure`/`compare --json`, uso sin args -> exit 1) via hijo.
 *
 * Solo se leen/escriben ficheros dentro de `tmpdir()`; nada toca el repo.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, includes, match, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import {
  estimateTokens,
  parseChunks,
  measureRoot,
  compare,
  TOKENS_PER_CHAR,
  DELTA_TOKENS,
  ON_DEMAND_TOKENS,
  CHUNK_TOKENS,
  SPEC_TOKENS,
} from '../.opencode/scripts/memory-tokens.mjs';

const SCRIPT = join(import.meta.dirname, '..', '.opencode', 'scripts', 'memory-tokens.mjs');
const START = '<!-- ADVISOR:ENTRIES:START -->';
const END = '<!-- ADVISOR:ENTRIES:END -->';

// Arbol sintetico de tamano REALISTA (la memoria solo compensa con contexto
// no trivial: con un arbol de 40 tokens el coste fijo del advisor supera al
// baseline y el ahorro sale negativo, que es la respuesta honesta).
function arbol() {
  const dir = tmpdir('advisor-tokens');
  writeFileSync(join(dir, 'PROJECT_STATE.md'), 'a'.repeat(8000), 'utf8'); // 8000 chars -> 2000 tok
  writeFileSync(join(dir, 'SUMMARY.md'), `cabecera\n${START}\n${'e'.repeat(2000)}\n${END}\npie\n`, 'utf8');
  mkdirSync(join(dir, 'CHANGELOG'), { recursive: true });
  writeFileSync(join(dir, 'CHANGELOG', '2026-09-28.md'), 's'.repeat(4000), 'utf8'); // 4000 chars -> 1000 tok
  mkdirSync(join(dir, '.opencode', 'skills', 'demo'), { recursive: true });
  writeFileSync(
    join(dir, '.opencode', 'skills', 'demo', 'SKILL.md'),
    `## T\n\n<!-- CHUNK: urls -->\n${'h'.repeat(800)}\n<!-- /CHUNK -->\n${'t'.repeat(800)}\n`,
    'utf8',
  );
  return dir;
}

// ── estimateTokens ───────────────────────────────────────────────────────────
suite('memory-tokens.estimateTokens');

test('heuristica chars/4 con techo', () => {
  eq(TOKENS_PER_CHAR, 4, 'constante documentada');
  eq(estimateTokens(''), 0, 'vacio');
  eq(estimateTokens(null), 0, 'null');
  eq(estimateTokens('abcd'), 1, '4 chars = 1 token');
  eq(estimateTokens('abcde'), 2, '5 chars = 2 tokens');
  eq(estimateTokens('abcdefgh'), 2, '8 chars = 2 tokens');
});

// ── parseChunks ──────────────────────────────────────────────────────────────
suite('memory-tokens.parseChunks');

test('extrae nombre y tokens de cada chunk', () => {
  const chunks = parseChunks('a\n<!-- CHUNK: urls -->\nhttp://x\n<!-- /CHUNK -->\nb\n<!-- CHUNK: ejemplos -->\nzz\n<!-- /CHUNK -->');
  eq(chunks.map((c) => c.name), ['urls', 'ejemplos'], 'nombres en orden');
  eq(chunks[0].tokens, estimateTokens('\nhttp://x\n'), 'tokens del contenido del chunk');
});

test('sin chunks devuelve lista vacia', () => {
  eq(parseChunks('sin marcadores'), [], 'vacio');
  eq(parseChunks(''), [], 'texto vacio');
});

// ── measureRoot ──────────────────────────────────────────────────────────────
suite('memory-tokens.measureRoot');

test('totals.full es la suma de las cuatro capas', () => {
  const dir = arbol();
  try {
    const m = measureRoot(dir);
    eq(m.state.tokens, 2000, 'state 8000 chars');
    eq(m.summaryEntries.marked, true, 'entradas marcadas');
    eq(m.changelog.files, 1, 'un fichero de changelog (sin DECISIONS-ARCHIVE)');
    eq(m.skills.length, 1, 'una skill');
    eq(m.skills[0].name, 'demo', 'nombre de la skill');
    eq(m.skills[0].chunks.length, 1, 'un chunk');
    eq(m.totals.full, m.state.tokens + m.summaryFull.tokens + m.changelog.tokens + m.totals.skillsFull, 'full = suma');
    assert(m.totals.full > 0, 'total positivo');
  } finally {
    cleanup([dir]);
  }
});

test('DECISIONS-ARCHIVE.md no cuenta como semana', () => {
  const dir = arbol();
  try {
    writeFileSync(join(dir, 'CHANGELOG', 'DECISIONS-ARCHIVE.md'), 'x'.repeat(4000), 'utf8');
    eq(measureRoot(dir).changelog.files, 1, 'el archivo se ignora aunque sea grande');
  } finally {
    cleanup([dir]);
  }
});

test('arbol vacio mide 0 sin lanzar', () => {
  const dir = tmpdir('advisor-tokens-vacio');
  try {
    const m = measureRoot(dir);
    eq(m.totals.full, 0, 'sin memoria no hay coste');
    eq(m.skills, [], 'sin skills');
  } finally {
    cleanup([dir]);
  }
});

// ── compare ──────────────────────────────────────────────────────────────────
suite('memory-tokens.compare');

test('advisor < baseline y ahorro en (0,100) en los tres escenarios', () => {
  const dir = arbol();
  try {
    const m = measureRoot(dir);
    for (const s of ['direct', 'delegated', 'spec-lite']) {
      const r = compare(s, m);
      eq(r.scenario, s, 'escenario');
      assert(r.baseline > r.advisor, `${s}: baseline ${r.baseline} > advisor ${r.advisor}`);
      assert(r.savingPct > 0 && r.savingPct < 100, `${s}: ahorro ${r.savingPct}% en (0,100)`);
    }
  } finally {
    cleanup([dir]);
  }
});

test('formula documentada con constantes exportadas', () => {
  const dir = arbol();
  try {
    const m = measureRoot(dir);
    const r = compare('direct', m);
    const full = m.totals.full;
    eq(r.baseline, 2 * full, 'direct: (1+1)*full sin rework');
    eq(r.advisor, m.state.tokens + ON_DEMAND_TOKENS + DELTA_TOKENS + CHUNK_TOKENS, 'direct: state+ondemand+delta+chunk');
    const spec = compare('spec-lite', m);
    eq(spec.advisor, m.state.tokens + 2 * ON_DEMAND_TOKENS + 6 * DELTA_TOKENS + 2 * CHUNK_TOKENS + SPEC_TOKENS, 'spec-lite suma la spec');
  } finally {
    cleanup([dir]);
  }
});

test('escenario desconocido lanza con los validos en el mensaje', () => {
  const dir = arbol();
  try {
    const e = throws(() => compare('enorme', measureRoot(dir)), 'debe lanzar');
    includes(e.message, 'direct', 'lista direct');
    includes(e.message, 'spec-lite', 'lista spec-lite');
  } finally {
    cleanup([dir]);
  }
});

// ── CLI ──────────────────────────────────────────────────────────────────────
suite('memory-tokens CLI');

function cli(args, cwd) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });
  assert(!res.error, `spawn fallo: ${res.error && res.error.message}`);
  return res;
}

test('measure --json emite totales parseables', () => {
  const dir = arbol();
  try {
    const r = cli(['measure', '--json', '--root', dir]);
    eq(r.status, 0, 'exit 0');
    const out = JSON.parse(r.stdout);
    eq(out.totals.full > 0, true, 'total positivo');
    eq(out.tokensPerChar, 4, 'heuristica declarada');
  } finally {
    cleanup([dir]);
  }
});

test('compare --scenario direct --json emite ahorro', () => {
  const dir = arbol();
  try {
    const r = cli(['compare', '--scenario', 'direct', '--json', '--root', dir]);
    eq(r.status, 0, 'exit 0');
    const out = JSON.parse(r.stdout);
    eq(out.scenario, 'direct', 'escenario');
    assert(out.savingPct > 0, 'ahorro positivo');
  } finally {
    cleanup([dir]);
  }
});

test('compare acepta el escenario posicional', () => {
  const dir = arbol();
  try {
    const r = cli(['compare', 'delegated', '--json', '--root', dir]);
    eq(r.status, 0, 'exit 0');
    eq(JSON.parse(r.stdout).scenario, 'delegated', 'escenario posicional');
  } finally {
    cleanup([dir]);
  }
});

test('sin comando y compare sin escenario salen con exit 1 por stderr', () => {
  const dir = arbol();
  try {
    const a = cli([], dir);
    eq(a.status, 1, 'sin args exit 1');
    match(a.stderr, /Uso:/, 'uso en stderr');
    const b = cli(['compare', '--root', dir], dir);
    eq(b.status, 1, 'compare sin escenario exit 1');
  } finally {
    cleanup([dir]);
  }
});

await runAll();
