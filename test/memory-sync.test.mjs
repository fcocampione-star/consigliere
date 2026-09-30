#!/usr/bin/env node
/**
 * test/memory-sync.test.mjs — caracterización de .opencode/scripts/memory-sync.mjs.
 *
 * EXPORT del módulo: mondayOf, exportChunks, importChunks, buildManifest, buildIndex.
 * Ninguna acepta un `root`: el ROOT se deriva de `join(import.meta.dirname,'..','..')`
 * (memory-sync.mjs:27) y no hay override por parámetro ni por env (a diferencia de
 * memory-rotate.mjs `--root` / memory-lock.mjs `ADVISOR_LOCK_ROOT`). Para no ejecutar
 * nada contra ESTE repo, el módulo se importa desde un ESPEJO byte-idéntico de los
 * scripts en un tmpdir: la misma expresión `dirname/../..` resuelve al sandbox, y el
 * primer test comprueba la identidad byte a byte de la copia. Beneficio lateral: el
 * lock canónico que toman `exportChunks`/`importChunks` (memory-lock.mjs, cuya raíz es
 * la del propio script) cae también en el sandbox, así que se puede simular un lock
 * ajeno sin tocar el `.memory-lock` del repo. `main()` no se exporta: el contrato de
 * exit codes se prueba con `cli()` (spawnSync sobre el espejo).
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import { makeProject, summaryWithEntries, entry, countLines } from './fixtures.mjs';
import { ENTRIES_START } from '../.opencode/scripts/memory-stats.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCRIPTS_DIR = join(REPO_ROOT, '.opencode', 'scripts');
// Cierre transitivo de memory-sync.mjs: memory-index + memory-rotate (+ memory-stats
// y el lock que memory-rotate importa).
const MIRROR_FILES = ['memory-sync.mjs', 'memory-index.mjs', 'memory-rotate.mjs', 'memory-stats.mjs', 'memory-lock.mjs'];
// La biblioteca compartida que los scripts de arriba importan: sin copiarla al
// sandbox, el import del módulo falla con ERR_MODULE_NOT_FOUND.
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const WEEK_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;
const HEAD_LINE = /^## \d{4}-\d{2}-\d{2} /gm;
const N_ESCALA = 300; // corpus de la regresión O(n^2) → 43 semanas

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

async function sandbox(label) {
  const dir = tmpdir(`advisor-sync-${label}`);
  TEMPS.push(dir);
  const dst = join(dir, '.opencode', 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const f of MIRROR_FILES) copyFileSync(join(SCRIPTS_DIR, f), join(dst, f));
  mkdirSync(join(dst, 'lib'), { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(SCRIPTS_DIR, 'lib', f), join(dst, 'lib', f));
  makeProject(dir);
  const url = (f) => pathToFileURL(join(dst, f)).href;
  return {
    dir,
    mod: await import(url('memory-sync.mjs')),
    idx: await import(url('memory-index.mjs')), // misma instancia que importa memory-sync
  };
}

function capture(fn) {
  const logs = [];
  const errs = [];
  const out = console.log;
  const err = console.error;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  try {
    return { value: fn(), logs, errs };
  } finally {
    console.log = out;
    console.error = err;
  }
}

const chunksDir = (dir) => join(dir, '.advisor', 'chunks');
const chunkPath = (dir, f) => join(chunksDir(dir), f);
const jsonFiles = (dir) => (existsSync(chunksDir(dir)) ? readdirSync(chunksDir(dir)).filter((f) => f.endsWith('.json')).sort() : []);
const weeklyFiles = (dir) => jsonFiles(dir).filter((f) => WEEK_JSON.test(f));
const readChunk = (dir, f) => JSON.parse(readFileSync(chunkPath(dir, f), 'utf8'));
const allChunks = (dir) => weeklyFiles(dir).map((f) => [f, readFileSync(chunkPath(dir, f), 'utf8')]);
const changelog = (dir, monday) => join(dir, 'CHANGELOG', `${monday}.md`);
const readChangelog = (dir, monday) => readFileSync(changelog(dir, monday), 'utf8');
const countHeadings = (txt) => (String(txt).match(HEAD_LINE) || []).length;
const countAllHeadings = (dir) => {
  const d = join(dir, 'CHANGELOG');
  if (!existsSync(d)) return 0;
  return readdirSync(d).filter((f) => f.endsWith('.md')).reduce((n, f) => n + countHeadings(readFileSync(join(d, f), 'utf8')), 0);
};
const occurrences = (hay, needle) => String(hay).split(needle).length - 1;

// Inserta un bloque de entrada (de fixtures) al inicio de la región del SUMMARY del
// fixture, sin reescribir el resto de la estructura que los scripts reales parsean.
function addEntry(dir, block) {
  const p = join(dir, 'SUMMARY.md');
  const txt = readFileSync(p, 'utf8');
  const i = txt.indexOf(ENTRIES_START) + ENTRIES_START.length;
  writeFileSync(p, `${txt.slice(0, i)}\n${block}${txt.slice(i)}`, 'utf8');
  return p;
}
const stateOf = (dir) => join(dir, 'PROJECT_STATE.md');
// Lock ajeno FRESCO (otro pid/host, edad 0) en la raiz del sandbox: acquireLock
// debe responder busy, que es el estado que evita que dos escritores de memoria se
// pisen. Es el mismo lock canonico que toma memory-rotate.mjs.
const lockDirOf = (dir) => join(dir, '.memory-lock');
function tomarLockAjeno(dir) {
  const d = lockDirOf(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'owner.json'), JSON.stringify({ pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-ajeno' }) + '\n', 'utf8');
  return d;
}
const soltarLockAjeno = (dir) => rmSync(lockDirOf(dir), { recursive: true, force: true });
// Temporales que deja writeAtomic() si el rename falla (o si el proceso muere).
const debrisTmp = (dir, rel = '') => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel)) : []).filter((n) => n.endsWith('.tmp'));
// Corre el CLI del espejo (main() no se exporta; el código de salida es el contrato).
const cli = (dir, args) => {
  const r = spawnSync(process.execPath, [join(dir, '.opencode', 'scripts', 'memory-sync.mjs'), ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
};
// Parchea PROJECT_STATE.md del sandbox; lanza si el patrón no aparece (un parche
// silencioso haría pasar el test por la razón equivocada).
const patchState = (dir, from, to) => {
  const p = stateOf(dir);
  const before = readFileSync(p, 'utf8');
  if (!before.includes(from)) throw new Error(`patchState: el patrón "${from}" no existe en PROJECT_STATE.md`);
  writeFileSync(p, before.replaceAll(from, to), 'utf8');
  return p;
};
const patchStateAppend = (dir, after, extra) => {
  const p = stateOf(dir);
  const before = readFileSync(p, 'utf8');
  if (!before.includes(after)) throw new Error(`patchStateAppend: el ancla "${after}" no existe en PROJECT_STATE.md`);
  writeFileSync(p, before.replace(after, after + extra), 'utf8');
  return p;
};

// Las 7 entradas que produce summaryWithEntries(dir, 7): 2026-09-06 y un día
// hacia atrás por entrada (misma regla que fixtures.mjs, recalculada aquí).
const dates7 = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 8, 6) - i * 86400000).toISOString().slice(0, 10));
const ids7 = dates7.map((d, i) => `${d}--entrada fixture ${i + 1}`);
const heads7 = dates7.map((d, i) => `## ${d} - Entrada fixture ${i + 1}`);
const SEMANA_A = '2026-08-31';
const OTRA_SEMANA = '2026-10-05';

// ── sandbox ────────────────────────────────────────────────────────────────
suite('memory-sync · sandbox byte-idéntico (ROOT del espejo = tmpdir)');

test('sandbox: el espejo es byte-idéntico y buildManifest escribe dentro del sandbox', async () => {
  const sb = await sandbox('fidelidad');
  for (const f of MIRROR_FILES) {
    eq(readFileSync(join(sb.dir, '.opencode', 'scripts', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, f), 'utf8'), `${f} sin modificar`);
  }
  for (const f of LIB_FILES) {
    eq(readFileSync(join(sb.dir, '.opencode', 'scripts', 'lib', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, 'lib', f), 'utf8'), `lib/${f} sin modificar`);
  }
  for (const fn of ['exportChunks', 'importChunks', 'buildManifest', 'buildIndex', 'mondayOf']) {
    eq(typeof sb.mod[fn], 'function', `el espejo exporta ${fn}`);
  }
  const { logs } = capture(() => sb.mod.buildManifest());
  includes(logs.join('|'), sb.dir, 'la ruta de salida del manifest cuelga del sandbox, no del repo');
  assert(existsSync(join(sb.dir, '.advisor', 'memory-manifest.json')), 'el manifest se crea en <sandbox>/.advisor/');
});

// ── exportChunks ───────────────────────────────────────────────────────────
suite('memory-sync · exportChunks');

test('exportChunks: agrupa por semana ISO en <lunes>.json con id canónico y body íntegro', async () => {
  const sb = await sandbox('export-basico');
  summaryWithEntries(sb.dir, 7);
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 7 bloques nuevos/, 'una línea de resumen por corrida');
  includes(logs.join('|'), 'nuevos', 'sin --force los bloques se anuncian como nuevos');
  eq(weeklyFiles(sb.dir), [`${SEMANA_A}.json`], 'las 7 entradas del fixture caen en la semana del lunes 2026-08-31');
  const arr = readChunk(sb.dir, `${SEMANA_A}.json`);
  eq(arr.length, 7, 'las 7 entradas van al chunk de su semana');
  eq(arr.map((e) => e.id), ids7, 'id canónico `<fecha>--<título normalizado>` en orden de bloque');
  eq(arr.map((e) => e.date), dates7, 'fecha del heading de cada bloque');
  eq(new Set(arr.map((e) => e.monday)), new Set([SEMANA_A]), 'todas comparten el lunes de su semana');
  assert(arr[0].body.startsWith('## 2026-09-06 - Entrada fixture 1'), 'el body es el bloque completo, heading incluido');
  assert(arr[0].body.includes('**Goal:** Cuerpo de la entrada 1.'), 'y conserva el cuerpo de la entrada');
  match(arr[0].exportedAt, ISO, 'cada entrada lleva exportedAt ISO');
  assert(arr.every((e) => ISO.test(e.exportedAt)), 'cada entrada lleva su propio exportedAt ISO (se sella en el bucle)');
  assert(countLines(chunkPath(sb.dir, `${SEMANA_A}.json`)) > 0, 'el chunk se escribe formateado (JSON con saltos)');
});

test('exportChunks: una chunk por semana y un id único por entrada (300 entradas, regresión O(n^2))', async () => {
  const sb = await sandbox('export-semanas');
  summaryWithEntries(sb.dir, N_ESCALA);
  const { logs } = capture(() => sb.mod.exportChunks());
  includes(logs.join('|'), `Export: ${N_ESCALA} bloques nuevos`, `las ${N_ESCALA} entradas se exportan en una sola pasada`);
  const files = weeklyFiles(sb.dir);
  assert(files.length > 30, `el corpus de ${N_ESCALA} entradas cubre muchas semanas (${files.length} archivos)`);
  const semanas = new Set();
  const ids = new Set();
  let total = 0;
  for (const f of files) {
    const monday = f.replace(/\.json$/, '');
    for (const e of readChunk(sb.dir, f)) {
      total++;
      ids.add(e.id);
      semanas.add(e.monday);
      eq(e.monday, monday, `la entrada ${e.id} se archivó en la semana de su fecha`);
      eq(sb.mod.mondayOf(e.date), monday, `el nombre del chunk es el lunes real de ${e.date}`);
    }
  }
  eq(total, N_ESCALA, 'ninguna entrada se pierde al agrupar por semana');
  eq(ids.size, N_ESCALA, `${N_ESCALA} ids únicos: el dedup por archivo usa un Set, no un re-escaneo`);
  eq(semanas.size, files.length, 'un archivo por semana distinta, sin colisiones de nombre');
  eq(jsonFiles(sb.dir).filter((f) => !WEEK_JSON.test(f)), ['state.json'], 'state.json es el único json que no es semanal');
});

test('exportChunks: la segunda corrida es idempotente (chunk byte-idéntico, 0 nuevos)', async () => {
  const sb = await sandbox('export-idem');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  const antes = readFileSync(chunkPath(sb.dir, `${SEMANA_A}.json`), 'utf8');
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 0 bloques nuevos/, 'la segunda corrida no exporta nada nuevo');
  eq(readFileSync(chunkPath(sb.dir, `${SEMANA_A}.json`), 'utf8'), antes, 'el chunk semanal queda byte-idéntico (exportedAt incluidos)');
});

test('exportChunks: el estado.json de una corrida anterior se conserva y solo cambia el sello de tiempo', async () => {
  const sb = await sandbox('export-idem-state');
  summaryWithEntries(sb.dir, 2);
  capture(() => sb.mod.exportChunks());
  const antes = readChunk(sb.dir, 'state.json');
  capture(() => sb.mod.exportChunks());
  const despues = readChunk(sb.dir, 'state.json');
  eq(despues.body, antes.body, 'el body de state.json es idempotente');
  eq(despues.body, readFileSync(stateOf(sb.dir), 'utf8'), 'y refleja PROJECT_STATE.md actual');
  match(despues.exportedAt, ISO, 'state.json lleva su propio exportedAt');
});

test('exportChunks: --force reexporta el chunk desde cero, sin duplicar ni perder bloques', async () => {
  const sb = await sandbox('export-force');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks(false));
  const antes = readChunk(sb.dir, `${SEMANA_A}.json`);
  // Marca el chunk previo con un sello reconocible: con --force debe desaparecer.
  antes[0].exportedAt = '2000-01-01T00:00:00.000Z';
  writeFileSync(chunkPath(sb.dir, `${SEMANA_A}.json`), JSON.stringify(antes, null, 2), 'utf8');
  const { logs } = capture(() => sb.mod.exportChunks(true));
  match(logs.join('|'), /Export: 7 bloques forzados/, '--force reexporta todos los bloques del SUMMARY');
  match(logs.join('|'), /\(--force\)/, 'y lo dice en el log');
  const despues = readChunk(sb.dir, `${SEMANA_A}.json`);
  eq(despues.length, 7, '--force no apila sobre el chunk previo');
  eq(despues.map((e) => e.id), antes.map((e) => e.id), 'mismos ids, mismo orden');
  eq(despues.map((e) => e.body), antes.map((e) => e.body), 'mismos bodies');
  neq(despues[0].exportedAt, '2000-01-01T00:00:00.000Z', 'el contenido previo se descarta: --force ignora el chunk existente');
  match(despues[0].exportedAt, ISO, 'y se vuelve a sellar con la corrida actual');
});

test('exportChunks: una entrada nueva crea su chunk sin reescribir el de la semana anterior', async () => {
  const sb = await sandbox('export-acumula');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  const antes = allChunks(sb.dir);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 1 bloques nuevos/, 'solo se exporta lo que no estaba');
  const despues = allChunks(sb.dir);
  eq(despues.filter(([f]) => f === `${SEMANA_A}.json`)[0][1], antes[0][1], 'el chunk de la semana anterior queda byte-idéntico');
  eq(weeklyFiles(sb.dir), [`2026-08-31.json`, `${OTRA_SEMANA}.json`], 'aparece el archivo de la semana nueva');
  const nuevo = readChunk(sb.dir, `${OTRA_SEMANA}.json`);
  eq(nuevo.map((e) => e.id), [`${OTRA_SEMANA}--entrada de la semana nueva`], 'con el id canónico de la entrada nueva');
  eq(nuevo[0].monday, OTRA_SEMANA, 'y su lunes');
});

test('exportChunks: state.json = {exportedAt, body} con PROJECT_STATE.md íntegro', async () => {
  const sb = await sandbox('export-state');
  summaryWithEntries(sb.dir, 2);
  capture(() => sb.mod.exportChunks());
  const st = readChunk(sb.dir, 'state.json');
  eq(Object.keys(st).sort(), ['body', 'exportedAt'], 'state.json tiene exactamente esas dos claves');
  eq(st.body, readFileSync(stateOf(sb.dir), 'utf8'), 'el body es el PROJECT_STATE.md completo');
  match(st.exportedAt, ISO, 'con sello de tiempo ISO');
  eq(weeklyFiles(sb.dir), [`${SEMANA_A}.json`], 'state.json no se confunde con un chunk semanal');
});

test('exportChunks: sin PROJECT_STATE.md exporta igual y no escribe state.json', async () => {
  const sb = await sandbox('export-sinstate');
  summaryWithEntries(sb.dir, 2);
  rmSync(stateOf(sb.dir));
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 2 bloques nuevos/, 'la ausencia de PROJECT_STATE.md no impide exportar');
  eq(jsonFiles(sb.dir), [`${SEMANA_A}.json`], 'y no se crea state.json');
});

test('exportChunks: a escala la reexportación no crece ni duplica (regresión del índice por archivo)', async () => {
  const sb = await sandbox('export-escala-idem');
  summaryWithEntries(sb.dir, N_ESCALA);
  capture(() => sb.mod.exportChunks());
  const antes = allChunks(sb.dir);
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 0 bloques nuevos/, `la segunda pasada sobre ${antes.length} archivos no añade nada`);
  eq(allChunks(sb.dir), antes, `${N_ESCALA} entradas: los ${antes.length} chunks quedan byte-idénticos`);
});

test('exportChunks: a escala, --force reconstruye cada chunk sin duplicar', async () => {
  const sb = await sandbox('export-escala-force');
  summaryWithEntries(sb.dir, N_ESCALA);
  capture(() => sb.mod.exportChunks());
  const antes = allChunks(sb.dir).map(([f, txt]) => [f, JSON.parse(txt).map((e) => e.id)]);
  const { logs } = capture(() => sb.mod.exportChunks(true));
  includes(logs.join('|'), `Export: ${N_ESCALA} bloques forzados`, 'fuerza los mismos bloques, ni uno más');
  const despues = allChunks(sb.dir).map(([f, txt]) => [f, JSON.parse(txt).map((e) => e.id)]);
  eq(despues, antes, 'los ids por chunk son idénticos antes y después del --force');
  eq(despues.reduce((n, [, ids]) => n + ids.length, 0), N_ESCALA, 'siguen siendo N_ESCALA entradas en total, sin duplicados');
});

// ── importChunks ───────────────────────────────────────────────────────────
suite('memory-sync · importChunks');

test('importChunks: round-trip export→import deja cada entrada una vez en CHANGELOG/<lunes>.md', async () => {
  const sb = await sandbox('import-roundtrip');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  capture(() => sb.mod.exportChunks());
  const { logs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 8 bloques a CHANGELOG\/ \(2 archivo\(s\) escrito\(s\)\)/, '8 bloques en 2 archivos (uno por semana)');
  const a = readChangelog(sb.dir, SEMANA_A);
  const b = readChangelog(sb.dir, OTRA_SEMANA);
  assert(a.startsWith(`# Changelog ${SEMANA_A}\n`), 'el archivo nuevo arranca con la cabecera semanal');
  includes(a, '> Historial semanal archivado desde SUMMARY.md.', 'y su nota de provenance');
  eq(countHeadings(a), 7, 'las 7 entradas de la semana A, una vez cada una');
  eq(countHeadings(b), 1, 'la entrada de la semana B en su propio archivo');
  for (const h of heads7) includes(a, h, `el heading ${h} está en el CHANGELOG`);
  includes(a, '**Goal:** Cuerpo de la entrada 7.', 'y el cuerpo de la entrada');
  includes(b, `## ${OTRA_SEMANA} - Entrada de la semana nueva`, 'la semana nueva con su contenido');
  assert(!/\n\n\n/.test(a), 'separación de UNA línea en blanco entre entradas (appendToChangelog)');
  eq(occurrences(a, '## 2026-09-06 - Entrada fixture 1'), 1, 'sin duplicados');
});

test('importChunks: reimportar es un no-op (0 importadas, archivo byte-idéntico)', async () => {
  const sb = await sandbox('import-idem');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  capture(() => sb.mod.importChunks());
  const antes = readFileSync(changelog(sb.dir, SEMANA_A), 'utf8');
  const { logs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 0 bloques a CHANGELOG\/ \(0 archivo\(s\) escrito\(s\)\)/, 'la segunda importación no importa ni escribe');
  eq(readFileSync(changelog(sb.dir, SEMANA_A), 'utf8'), antes, 'el CHANGELOG queda byte-idéntico');
  const { logs: l3 } = capture(() => sb.mod.importChunks());
  match(l3.join('|'), /Import: 0 bloques/, 'y sigue siendo idempotente en la tercera pasada');
});

test('importChunks: un chunk corrupto se omite sin abortar el resto del import', async () => {
  const sb = await sandbox('import-corrupto');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  writeFileSync(chunkPath(sb.dir, '2026-01-05.json'), '{ esto no es un array', 'utf8');
  const { logs, errs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 7 bloques a CHANGELOG\/ \(1 archivo\(s\) escrito\(s\)\) · 1 chunk\(s\) omitido\(s\)/, 'importa el chunk válido y resume el omitido');
  includes(errs.join('|'), 'import: chunk corrupto, omitido: 2026-01-05.json', 'avisa por stderr qué chunk se saltó');
  assert(existsSync(changelog(sb.dir, SEMANA_A)), 'el chunk válido se importa igualmente');
  eq(existsSync(changelog(sb.dir, '2026-01-05')), false, 'y no se crea CHANGELOG para el corrupto');
  eq(countHeadings(readChangelog(sb.dir, SEMANA_A)), 7, 'las 7 entradas llegan completas');
});

test('importChunks: un chunk con formato que no es lista también se omite', async () => {
  const sb = await sandbox('import-nolista');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  writeFileSync(chunkPath(sb.dir, '2026-01-05.json'), JSON.stringify({ version: 1, entradas: [] }), 'utf8');
  const { logs, errs } = capture(() => sb.mod.importChunks());
  includes(errs.join('|'), 'import: chunk sin formato de lista, omitido: 2026-01-05.json', 'motivo distinto: no es un array');
  match(logs.join('|'), /1 chunk\(s\) omitido\(s\)/, 'y cuenta igual en el resumen (la nota dice "JSON corrupto")');
  eq(countHeadings(readChangelog(sb.dir, SEMANA_A)), 7, 'el resto del import no se resiente');
  assert(!existsSync(changelog(sb.dir, '2026-01-05')), 'no se inventa un destino para el chunk inválido');
});

test('importChunks: dedup contra entradas ya presentes en el CHANGELOG (id separador-agnóstico)', async () => {
  const sb = await sandbox('import-dedup');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.exportChunks());
  // Tres entradas ya archivadas, con separador `|` en vez de `-` y otro orden de campos.
  const previas = [
    entry('2026-09-06', 'Entrada fixture 1', 'Cuerpo de la entrada 1.'),
    entry('2026-09-05', 'Entrada fixture 2', 'Cuerpo de la entrada 2.'),
    entry('2026-09-04', 'Entrada fixture 3', 'Cuerpo de la entrada 3.'),
  ].map((b) => b.trim().replace(' - ', ' | ')).join('\n\n');
  writeFileSync(changelog(sb.dir, SEMANA_A), `# Changelog ${SEMANA_A}\n\n> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: \`git log\`.\n\n${previas}\n`, 'utf8');
  const { logs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 4 bloques a CHANGELOG\/ \(1 archivo\(s\) escrito\(s\)\)/, 'solo se anexan las 4 que faltaban');
  const despues = readChangelog(sb.dir, SEMANA_A);
  eq(countHeadings(despues), 7, '7 entradas en total: las 3 previas + las 4 nuevas');
  for (let n = 1; n <= 7; n++) eq(occurrences(despues, `Entrada fixture ${n}`), 1, `la entrada ${n} aparece exactamente una vez`);
  includes(despues, '## 2026-09-06 | Entrada fixture 1', 'las preexistentes conservan su separador original');
  assert(despues.indexOf('Entrada fixture 3') < despues.indexOf('Entrada fixture 4'), 'las nuevas se anexan al final, no al principio');
});

test('importChunks: dedup intra-ejecución entre entradas del mismo chunk', async () => {
  const sb = await sandbox('import-intra');
  const dup = entry('2026-09-06', 'Entrada repetida', 'cuerpo.').trim();
  // Mismo id canónico con tres separadores distintos: el dedup intra-run compara
  // `fecha--título normalizado`, no el texto.
  const variantes = [dup, dup.replace(' - ', ' | '), dup.toUpperCase().replace('## 2026-09-06 - ', '## 2026-09-06 : ')];
  mkdirSync(chunksDir(sb.dir), { recursive: true });
  writeFileSync(chunkPath(sb.dir, `${SEMANA_A}.json`), JSON.stringify(variantes.map((body) => ({ id: 'legacy', date: SEMANA_A, body }))), 'utf8');
  const { logs } = capture(() => sb.mod.importChunks());
  includes(logs.join('|'), 'Import: 1 bloques a CHANGELOG/ (1 archivo(s) escrito(s))', 'tres variantes del mismo id → una sola importación');
  const dest = readChangelog(sb.dir, SEMANA_A);
  eq(countHeadings(dest), 1, 'una sola entrada en el CHANGELOG');
  includes(dest, '## 2026-09-06 - Entrada repetida', 'y es la primera variante (la que se vio primero)');
});

test('importChunks: un body vacío se descarta sin escribir nada', async () => {
  const sb = await sandbox('import-vacio');
  mkdirSync(chunksDir(sb.dir), { recursive: true });
  writeFileSync(chunkPath(sb.dir, `${SEMANA_A}.json`), JSON.stringify([{ id: 'a', date: SEMANA_A, body: '   \n  ' }]), 'utf8');
  const { logs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 0 bloques a CHANGELOG\/ \(0 archivo\(s\) escrito\(s\)\)/, 'nada que importar');
  eq(existsSync(changelog(sb.dir, SEMANA_A)), false, 'y no se crea un CHANGELOG vacío');
});

test('importChunks: sin chunks (o solo state.json) informa y no lanza', async () => {
  const sb = await sandbox('import-sinchunks');
  const vacio = capture(() => sb.mod.importChunks());
  eq(vacio.logs, ['Sin chunks en .advisor/chunks/'], 'sin directorio de chunks: mensaje y salida limpia');
  eq(vacio.errs, [], 'nada por stderr');
  mkdirSync(chunksDir(sb.dir), { recursive: true });
  writeFileSync(chunkPath(sb.dir, 'state.json'), '{}', 'utf8');
  const soloState = capture(() => sb.mod.importChunks());
  eq(soloState.logs, ['Sin chunks en .advisor/chunks/'], 'un state.json suelto no es un chunk importable');
});

test('importChunks: a escala, una escritura por archivo y cada entrada una sola vez (regresión O(n^2))', async () => {
  const sb = await sandbox('import-escala');
  summaryWithEntries(sb.dir, N_ESCALA);
  capture(() => sb.mod.exportChunks());
  const semanas = weeklyFiles(sb.dir);
  const { logs } = capture(() => sb.mod.importChunks());
  includes(logs.join('|'), `Import: ${N_ESCALA} bloques a CHANGELOG/ (${semanas.length} archivo(s) escrito(s))`, `un archivo escrito por semana (${semanas.length})`);
  eq(countAllHeadings(sb.dir), N_ESCALA, `${N_ESCALA} entradas en total, sin duplicados ni pérdidas`);
  for (const f of semanas) {
    const monday = f.replace(/\.json$/, '');
    const enChunk = readChunk(sb.dir, f).length;
    eq(countHeadings(readChangelog(sb.dir, monday)), enChunk, `${monday}.md tiene exactamente las ${enChunk} entradas de su chunk`);
  }
});

test('importChunks: a escala, el dedup contra el destino aguanta miles de entradas', async () => {
  const sb = await sandbox('import-escala-dedup');
  summaryWithEntries(sb.dir, N_ESCALA);
  capture(() => sb.mod.exportChunks());
  capture(() => sb.mod.importChunks());
  const antes = allChunks(sb.dir);
  const snapshot = readFileSync(changelog(sb.dir, SEMANA_A), 'utf8');
  const { logs } = capture(() => sb.mod.importChunks());
  match(logs.join('|'), /Import: 0 bloques a CHANGELOG\/ \(0 archivo\(s\) escrito\(s\)\)/, 'reimportar el corpus completo no añade nada');
  eq(countAllHeadings(sb.dir), N_ESCALA, 'siguen siendo N_ESCALA entradas');
  eq(readFileSync(changelog(sb.dir, SEMANA_A), 'utf8'), snapshot, 'el archivo ya completo queda byte-idéntico');
  eq(allChunks(sb.dir), antes, 'y los chunks tampoco cambian');
});

test('importChunks: invalida el memo de allEntries del proceso anfitrión (FIX-2)', async () => {
  const sb = await sandbox('import-invalida');
  summaryWithEntries(sb.dir, 3);
  capture(() => sb.mod.exportChunks());
  const antes = sb.idx.allEntries(); // memo tibio, aún sin CHANGELOG
  eq(antes.filter((e) => e.source.startsWith('CHANGELOG')).length, 0, 'todavía no hay entradas de CHANGELOG');
  capture(() => sb.mod.importChunks());
  const despues = sb.idx.allEntries(); // sin llamar a mano a invalidateEntriesCache
  eq(despues.filter((e) => e.source.startsWith('CHANGELOG')).length, 3, 'allEntries ya ve el CHANGELOG recién escrito');
  eq(despues.filter((e) => e.source === 'SUMMARY.md').length, 3, 'las entradas de SUMMARY siguen ahí');
});

// ── buildManifest ──────────────────────────────────────────────────────────
suite('memory-sync · buildManifest');

test('buildManifest: el manifest se mantiene en 13 líneas y pasa los dos gates', async () => {
  const sb = await sandbox('manifest-lineas');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  const { logs } = capture(() => sb.mod.buildManifest());
  match(logs.join('|'), /Manifest: 13 líneas/, '8 líneas fijas + 5 entradas recientes');
  const p = join(sb.dir, '.advisor', 'memory-manifest.json');
  const txt = readFileSync(p, 'utf8');
  eq(countLines(p), 13, 'wc -l = 13 con 5 entradas recientes');
  assert(txt.split('\n').length < 15, `gate de doctor.mjs:107 (ml<15) → ${txt.split('\n').length} < 15`);
  assert(countLines(p) < 15, 'gate de scripts/check-memory-limits.sh:68 (wc -l >= 15 falla)');
  const m = JSON.parse(txt);
  eq(m.version, 1, 'version 1');
  eq(m.recent.length, 5, 'como máximo 5 entradas recientes');
});

test('buildManifest: sin entradas de SUMMARY el manifest se queda en las 8 líneas fijas', async () => {
  const sb = await sandbox('manifest-minimo');
  const { logs } = capture(() => sb.mod.buildManifest());
  match(logs.join('|'), /Manifest: 8 líneas/, 'solo la estructura fija');
  const p = join(sb.dir, '.advisor', 'memory-manifest.json');
  eq(countLines(p), 8, '8 líneas sin entradas');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  eq(m.recent, [], 'recent vacío');
  eq(m.counts, { stateDecisions: 2, recentEntries: 0, archivedWeeks: 0 }, 'los tres contadores a 0 salvo las decisiones de §2');
  eq(m.stale, [], 'sin topics caducados');
});

test('buildManifest: serialización compacta (una clave por línea, arrays en una sola línea)', async () => {
  const sb = await sandbox('manifest-forma');
  summaryWithEntries(sb.dir, 7);
  capture(() => sb.mod.buildManifest());
  const lineas = readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8').trim().split('\n');
  eq(lineas[0], '{', 'abre con {');
  eq(lineas[1], '  "version": 1,', 'version en la línea 2');
  assert(/^ {2}"generatedAt": "\d{4}-\d{2}-\d{2}T/.test(lineas[2]), 'generatedAt ISO en la línea 3');
  assert(lineas[3].startsWith('  "counts": {') && lineas[3].endsWith('},'), 'los 3 contadores caben en una línea');
  eq(lineas[4], '  "recent": [', 'recent abre en la línea 5');
  for (let i = 5; i < 10; i++) assert(/^ {4}\{"id": ".+", "topic": (".+"|null), "date": "\d{4}-\d{2}-\d{2}"\},?$/.test(lineas[i]), `la reciente ${i - 4} es una línea {id, topic, date}`);
  eq(lineas[10], '  ],', 'recent cierra en la línea 11');
  assert(/^ {2}"stale": \[.*\]$/.test(lineas[11]), 'stale en una sola línea');
  eq(lineas[12], '}', 'cierra con }');
});

test('buildManifest: counts = decisiones §2 + entradas de SUMMARY + semanas archivadas', async () => {
  const sb = await sandbox('manifest-counts');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  capture(() => sb.mod.exportChunks());
  capture(() => sb.mod.importChunks());
  capture(() => sb.mod.buildManifest());
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq(m.counts, { stateDecisions: 2, recentEntries: 8, archivedWeeks: 2 }, 'los tres contadores (recentEntries cuenta TODO, no solo las 5 de recent)');
  eq(m.recent.length, 5, 'pero recent sigue topado a 5');
});

test('buildManifest: recent = las 5 más nuevas de SUMMARY, ordenadas de más nueva a más antigua', async () => {
  const sb = await sandbox('manifest-recent');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  capture(() => sb.mod.buildManifest());
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq(m.recent.map((r) => r.date), [OTRA_SEMANA, '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03'], 'descendente por fecha');
  eq(Object.keys(m.recent[0]).sort(), ['date', 'id', 'topic'], 'cada reciente expone {id, topic, date}');
  eq(m.recent[0].id, `${OTRA_SEMANA}--entrada de la semana nueva`, 'con el id canónico');
  eq(m.recent[0].topic, 'test/fixture', 'y el topic de la entrada');
  assert(!m.recent.some((r) => r.id.startsWith('state--')), 'solo entradas de SUMMARY, no las decisiones §2');
});

test('buildManifest: §2 se extrae por "- " y las reglas horizontales no cuentan como decisiones (FIX-3)', async () => {
  const sb = await sandbox('manifest-seccion2');
  summaryWithEntries(sb.dir, 1);
  patchStateAppend(sb.dir, '- Decisión de fixture B [topic: test/fixture-b] review_after: 2099-12-31\n', '\n---\n\n');
  capture(() => sb.mod.buildManifest());
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq(m.counts.stateDecisions, 2, 'sigue contando 2 decisiones con un `---` dentro de §2');
  assert(!m.stale.includes('--'), 'la regla horizontal no se cuela en stale');
});

test('buildManifest: stale[] = topics con review_after vencido, deduplicados y sin topic descartados', async () => {
  const sb = await sandbox('manifest-stale');
  summaryWithEntries(sb.dir, 1);
  const bLine = '- Decisión de fixture B [topic: test/fixture-b] review_after: 2099-12-31\n';
  patchStateAppend(sb.dir, bLine, '- Decisión de fixture C review_after: 2099-12-31\n'); // sin topic
  patchState(sb.dir, '2099-12-31', '2000-01-01'); // caduca las tres decisiones
  patchState(sb.dir, 'topic: test/fixture-b', 'topic: test/fixture-a'); // A y B comparten topic
  capture(() => sb.mod.buildManifest());
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq(m.counts.stateDecisions, 3, 'la tercera decisión cuenta, aunque no tenga topic');
  eq(m.stale, ['test/fixture-a'], 'solo el topic vencido y presente, deduplicado');
  const largo = readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8');
  assert(/\n {2}"stale": \["test\/fixture-a"\]$/m.test(largo.trim()), 'stale se serializa en una sola línea');
});

test('buildManifest: sin PROJECT_STATE.md el manifest sale con stateDecisions 0', async () => {
  const sb = await sandbox('manifest-sinstate');
  summaryWithEntries(sb.dir, 2);
  rmSync(stateOf(sb.dir));
  const { logs } = capture(() => sb.mod.buildManifest());
  match(logs.join('|'), /Manifest: 10 líneas/, 'las 2 entradas de SUMMARY siguen contando');
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq(m.counts.stateDecisions, 0, 'sin §2 no hay decisiones');
  eq(m.stale, [], 'y stale queda vacío');
});

test('buildManifest: a escala el manifest no crece (13 líneas) aunque el corpus sea enorme', async () => {
  const sb = await sandbox('manifest-escala');
  summaryWithEntries(sb.dir, N_ESCALA);
  capture(() => sb.mod.exportChunks());
  const semanas = weeklyFiles(sb.dir).length;
  capture(() => sb.mod.importChunks());
  const { logs } = capture(() => sb.mod.buildManifest());
  match(logs.join('|'), /Manifest: 13 líneas/, 'la serialización compacta aguanta 300 entradas');
  const p = join(sb.dir, '.advisor', 'memory-manifest.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  eq(countLines(p), 13, '13 líneas de manifiesto');
  eq(m.recent.length, 5, 'recent topado a 5');
  eq(m.counts.recentEntries, N_ESCALA, 'el contador sí ve el corpus completo');
  eq(m.counts.archivedWeeks, semanas, 'las semanas archivadas coinciden con los chunks semanales');
});

test('buildIndex: escribe memory-index.json con INDEX_VERSION y las entradas del árbol', async () => {
  const sb = await sandbox('buildindex');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  capture(() => sb.mod.exportChunks());
  capture(() => sb.mod.importChunks());
  const { logs } = capture(() => sb.mod.buildIndex());
  match(logs.join('|'), /Index: v1 18 entries/, '18 = 8 de SUMMARY + 8 de CHANGELOG + 2 decisiones §2');
  const data = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-index.json'), 'utf8'));
  eq(data.version, sb.idx.INDEX_VERSION, 'la versión del índice es INDEX_VERSION');
  eq(data.entries.length, 18, 'todas las entradas del árbol');
  eq(data.entries.filter((e) => e.source === 'SUMMARY.md').length, 8, '8 de SUMMARY.md');
  eq(data.entries.filter((e) => e.source === `CHANGELOG/${SEMANA_A}.md`).length, 7, '7 del CHANGELOG de la semana A');
  eq(data.entries.filter((e) => e.source === 'PROJECT_STATE.md §2').length, 2, '2 decisiones §2');
  match(data.generatedAt, ISO, 'con sello de tiempo');
  assert(Array.isArray(data.fingerprint) && data.fingerprint.length >= 3, 'y el fingerprint de las fuentes');
});

// ── regresión de escala ────────────────────────────────────────────────────
suite('memory-sync · regresión O(n^2) a escala');

test('escala: 300 entradas a través de export → import → manifest, con los conteos correctos', async () => {
  const sb = await sandbox('escala-flujo');
  summaryWithEntries(sb.dir, N_ESCALA);
  const le = capture(() => sb.mod.exportChunks());
  includes(le.logs.join('|'), `Export: ${N_ESCALA} bloques nuevos`, 'export: N bloques nuevos');
  const semanas = weeklyFiles(sb.dir);
  const li = capture(() => sb.mod.importChunks());
  includes(li.logs.join('|'), `Import: ${N_ESCALA} bloques a CHANGELOG/ (${semanas.length} archivo(s) escrito(s))`, 'import: N bloques, un archivo por semana');
  eq(countAllHeadings(sb.dir), N_ESCALA, 'los CHANGELOG suman exactamente N entradas');
  const lm = capture(() => sb.mod.buildManifest());
  match(lm.logs.join('|'), /Manifest: 13 líneas/, 'manifest: 13 líneas');
  const m = JSON.parse(readFileSync(join(sb.dir, '.advisor', 'memory-manifest.json'), 'utf8'));
  eq([m.counts.stateDecisions, m.counts.recentEntries, m.counts.archivedWeeks, m.recent.length], [2, N_ESCALA, semanas.length, 5], 'conteos del manifest a escala');
  const li2 = capture(() => sb.mod.buildIndex());
  includes(li2.logs.join('|'), `Index: v1 ${N_ESCALA * 2 + 2} entries`, `el índice ve N SUMMARY + N CHANGELOG + 2 decisiones`);
  eq(jsonFiles(sb.dir).filter((f) => !WEEK_JSON.test(f)), ['state.json'], 'los chunks semanales siguen siendo los mismos');
});

// ── Lock canónico + escrituras atómicas ─────────────────────────────────────
suite('memory-sync · lock canónico y escrituras atómicas');

test('exportChunks: toma el lock canónico y lo libera (no deja .memory-lock)', async () => {
  const sb = await sandbox('lock-export');
  summaryWithEntries(sb.dir, 3);
  assert(!existsSync(lockDirOf(sb.dir)), 'partimos sin lock');
  capture(() => sb.mod.exportChunks());
  assert(!existsSync(lockDirOf(sb.dir)), 'el lock se libera en el finally: el sandbox queda como estaba');
  eq(readdirSync(sb.dir).filter((n) => n.startsWith('.memory-lock')), [], 'ni el lock ni dirs stale de takeover quedan en la raíz');
});

test('exportChunks: con el lock ocupado NO escribe nada y falla con el motivo', async () => {
  const sb = await sandbox('lock-export-busy');
  summaryWithEntries(sb.dir, 3);
  tomarLockAjeno(sb.dir);
  try {
    const e = throws(() => sb.mod.exportChunks(), 'exportChunks debe propagar el lock ocupado');
    match(e.message, /no se pudo adquirir el lock de memoria \(busy, pid 4242424\)/, 'el motivo cita el estado y el pid del holder');
    eq(e.exitCode, 3, 'exit 3 = lock ocupado (mismo código que memory-rotate)');
    eq(weeklyFiles(sb.dir), [], 'no se escribió ningún chunk');
    eq(existsSync(join(sb.dir, '.advisor')), false, 'ni siquiera se creó el directorio de chunks');
  } finally {
    soltarLockAjeno(sb.dir);
  }
});

test('importChunks: con el lock ocupado NO toca CHANGELOG', async () => {
  const sb = await sandbox('lock-import-busy');
  summaryWithEntries(sb.dir, 3);
  capture(() => sb.mod.exportChunks());
  tomarLockAjeno(sb.dir);
  try {
    const e = throws(() => sb.mod.importChunks(), 'importChunks debe propagar el lock ocupado');
    match(e.message, /memory-sync import/, 'el mensaje identifica la ruta');
    eq(e.exitCode, 3, 'exit 3');
    eq(countAllHeadings(sb.dir), 0, 'ningún CHANGELOG escrito');
  } finally {
    soltarLockAjeno(sb.dir);
  }
});

test('el lock se vuelve a tomar bien tras un rechazo (no queda tomado a medias)', async () => {
  const sb = await sandbox('lock-recuperado');
  summaryWithEntries(sb.dir, 2);
  tomarLockAjeno(sb.dir);
  throws(() => sb.mod.exportChunks(), 'rechazo por lock ajeno');
  soltarLockAjeno(sb.dir);
  const { logs } = capture(() => sb.mod.exportChunks());
  match(logs.join('|'), /Export: 2 bloques nuevos/, 'con el lock libre el export funciona');
  assert(!existsSync(lockDirOf(sb.dir)), 'y vuelve a liberar el suyo');
});

test('CLI: con el lock ocupado, export sale con 3 y no escribe (falla claro, no corrompe)', async () => {
  const sb = await sandbox('cli-lock-busy');
  summaryWithEntries(sb.dir, 3);
  tomarLockAjeno(sb.dir);
  try {
    const r = cli(sb.dir, ['export']);
    eq(r.status, 3, 'exit 3 = lock ocupado');
    match(r.err, /no se pudo adquirir el lock de memoria/, 'stderr explica el motivo');
    match(r.err, /no se escribió nada/, 'y que no se escribió nada');
    eq(weeklyFiles(sb.dir), [], 'cero chunks escritos');
    eq(existsSync(join(sb.dir, '.advisor', 'memory-manifest.json')), false, 'tampoco manifest ni índice');
  } finally {
    soltarLockAjeno(sb.dir);
  }
});

test('CLI: sin lock, export sale con 0 y deja el árbol coherente', async () => {
  const sb = await sandbox('cli-lock-ok');
  summaryWithEntries(sb.dir, 3);
  const r = cli(sb.dir, ['export']);
  eq(r.status, 0, 'exit 0');
  match(r.out, /Export: 3 bloques nuevos/, 'los chunks salen');
  match(r.out, /Manifest: \d+ líneas/, 'y el manifest');
  match(r.out, /Index: v1 \d+ entries/, 'y el índice');
  eq(debrisTmp(sb.dir, '.advisor').length, 0, 'sin temporales en .advisor');
  eq(debrisTmp(sb.dir, '.advisor', 'chunks').length, 0, 'ni en chunks/');
});

test('escrituras atómicas: export/import/manifest no dejan ningún temporal .tmp', async () => {
  const sb = await sandbox('atomic-sin-debris');
  summaryWithEntries(sb.dir, 7);
  addEntry(sb.dir, entry(OTRA_SEMANA, 'Entrada de la semana nueva', 'cuerpo nuevo.'));
  capture(() => sb.mod.exportChunks());
  capture(() => sb.mod.importChunks());
  capture(() => sb.mod.buildManifest());
  capture(() => sb.mod.buildIndex());
  eq(debrisTmp(sb.dir, '.advisor'), [], 'nada en .advisor');
  eq(debrisTmp(sb.dir, '.advisor', 'chunks'), [], 'nada en chunks/');
  eq(debrisTmp(sb.dir, 'CHANGELOG'), [], 'nada en CHANGELOG/');
  // Y el contenido es el esperado (el rename no pierde ni un byte).
  eq(countAllHeadings(sb.dir), 8, 'las 8 entradas llegaron al CHANGELOG');
  eq(countLines(join(sb.dir, '.advisor', 'memory-manifest.json')), 13, 'manifest de 13 líneas');
});

test('escritura atómica: si el rename falla, el error sube y el temporal se borra', async () => {
  const sb = await sandbox('atomic-fallo');
  // Destino que no admite rename: un DIRECTORIO con el nombre del manifest.
  mkdirSync(join(sb.dir, '.advisor', 'memory-manifest.json'), { recursive: true });
  const e = throws(() => sb.mod.buildManifest(), 'el rename sobre un directorio falla');
  match(e.code, /EISDIR|EPERM|ENOTEMPTY|EACCES|EBUSY/, 'código del sistema de ficheros propagado');
  eq(debrisTmp(sb.dir, '.advisor'), [], 'el temporal se borra: no queda debris tras el fallo');
});

await runAll();
