#!/usr/bin/env node
/**
 * test/memory-index.test.mjs — caracterización de .opencode/scripts/memory-index.mjs.
 *
 * Cubre lo que el módulo EXPORTA y es puro (sin disco): slugId, parseEntries,
 * score e isFresh con fingerprint explícito. Para lo que sí necesita un árbol de
 * proyecto real (allEntries, writeIndex, loadIndex — todos resolubles contra el
 * ROOT fijo del script) se usa un ESPEJO byte-idéntico de los scripts en un
 * tmpdir: el módulo se importa desde la copia, así que `join(dirname,'..','..')`
 * resuelve al sandbox y NUNCA se escribe en este repo (ver AGENTS.md §anti-lock y
 * el reporte de gaps: memory-index.mjs no expone override de root).
 * `main()` NO se exporta, así que el flujo documentado search → timeline → get
 * (incluido `get` volcando el CUERPO de la entrada y el ranking único de `search`)
 * se prueba con `cli()`: spawnSync del script del espejo.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import { makeProject, summaryWithEntries, entry } from './fixtures.mjs';
import { ENTRIES_START, ENTRIES_END, entriesRegion } from '../.opencode/scripts/memory-stats.mjs';
import { parseEntries, slugId, score, isFresh, fingerprint, INDEX_VERSION } from '../.opencode/scripts/memory-index.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCRIPTS_DIR = join(REPO_ROOT, '.opencode', 'scripts');
// Cierre transitivo de memory-index.mjs: sus dos imports locales y el lock que
// memory-rotate.mjs importa (nunca ejecutado aquí, pero el módulo debe existir).
const MIRROR_FILES = ['memory-index.mjs', 'memory-rotate.mjs', 'memory-stats.mjs', 'memory-lock.mjs'];

// Los temporales se limpian en el hook de salida: runAll() termina con
// process.exit(), así que un cleanup posterior a runAll() no se ejecutaría.
const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

function temp(label) {
  const dir = tmpdir(`advisor-idx-${label}`);
  TEMPS.push(dir);
  return dir;
}

async function sandbox(label) {
  const dir = temp(label);
  const dst = join(dir, '.opencode', 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const f of MIRROR_FILES) copyFileSync(join(SCRIPTS_DIR, f), join(dst, f));
  makeProject(dir);
  return { dir, mod: await import(pathToFileURL(join(dst, 'memory-index.mjs')).href) };
}

// Captura la salida del código bajo prueba para poder afirmar sobre ella (y para
// no ensuciar el reporte del runner).
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

// sha1 hex de 6 sobre el TÍTULO COMPLETO, recalculado aquí de forma independiente
// para no validar la implementación contra sí misma.
function hash6(title) {
  return createHash('sha1').update(String(title)).digest('hex').slice(0, 6);
}

// Comparación numérica con tolerancia: los pesos de score() son decimales y la
// aritmética binaria no es exacta (0.6*1 - 0.6*0 da 0.29999999999999993).
function close(actual, expected, msg, eps = 1e-9) {
  assert(Math.abs(actual - expected) <= eps, `${msg} — esperado ~${expected} (±${eps}) | obtenido ${actual}`);
}

const F = '2026-09-06';
const FP = [
  { path: 'CHANGELOG/2026-08-31.md', mtime: 1000, size: 40 },
  { path: 'SUMMARY.md', mtime: 2000, size: 20 },
];
const cached = (over = {}) => ({ version: INDEX_VERSION, fingerprint: FP.map((e) => ({ ...e })), ...over });

// ── slugId ─────────────────────────────────────────────────────────────────
suite('memory-index · slugId');

test('slugId: forma <fecha>--<slug>-<hash6> con hash sha1 del título completo', () => {
  const t = 'Fix de memoria';
  eq(slugId(F, t), `${F}--fix-de-memoria-${hash6(t)}`, 'id = fecha--slug-kebab-hash6');
  match(slugId(F, t), /^[0-9]{4}-[0-9]{2}-[0-9]{2}--[a-z0-9-]+-[0-9a-f]{6}$/, 'forma general del id');
});

test('slugId: determinista (misma fecha+título → mismo id)', () => {
  eq(slugId(F, 'Rotación semanal'), slugId(F, 'Rotación semanal'), 'misma entrada, mismo id');
  neq(slugId(F, 'Rotación semanal'), slugId(F, 'Rotacion semanal'), 'el hash distingue acentos');
});

test('slugId: títulos largos con prefijo común NO colisionan pese al truncado a 30', () => {
  // Es el caso que el comentario del módulo declara existir: el slug se corta a
  // 30 chars, así que solo el hash del título completo desambigua.
  const t1 = 'ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 AAA';
  const t2 = 'ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 BBB';
  const id1 = slugId(F, t1);
  const id2 = slugId(F, t2);
  eq(id1.slice(0, -7), id2.slice(0, -7), 'el prefijo truncado a 30 es idéntico (colisión sin hash)');
  eq(id1.slice(0, -7), `${F}--abcdefghij-klmnopqrst-uvwxyz01`, 'el slug truncado son los 30 primeros chars');
  neq(id1, id2, 'los ids completos NO colisionan');
  neq(id1.slice(-6), id2.slice(-6), 'los 6 hex del hash difieren');
  eq(id1, `${F}--abcdefghij-klmnopqrst-uvwxyz01-${hash6(t1)}`, 'hash del título completo');
  eq(id2, `${F}--abcdefghij-klmnopqrst-uvwxyz01-${hash6(t2)}`, 'hash del título completo');
});

test('slugId: acentos y símbolos se reducen a guiones en minúsculas', () => {
  const t = 'Título Ágil: R2/D3';
  eq(slugId(F, t), `${F}--t-tulo-gil-r2-d3-${hash6(t)}`, 'cada run de caracteres fuera de [a-z0-9] se reduce a un guion');
  match(slugId(F, t), new RegExp(`^${F}--[a-z0-9-]+-[0-9a-f]{6}$`), 'sin mayúsculas ni acentos en el slug');
});

test('slugId: sin título no lanza y usa sha1 de la cadena vacía', () => {
  eq(slugId('2026-01-01', ''), `2026-01-01---${hash6('')}`, 'título vacío → slug vacío + hash de ""');
  eq(slugId('2026-01-01', null), `2026-01-01---${hash6('')}`, 'null se trata como cadena vacía');
  match(slugId('2026-01-01', undefined), /^2026-01-01---[0-9a-f]{6}$/, 'undefined no lanza');
});

test('slugId: la fecha se copia tal cual, sin normalizar', () => {
  match(slugId('06/09/2026', 'X'), /^06\/09\/2026--x-[0-9a-f]{6}$/, 'la fecha va literal en el id');
});

// ── parseEntries ───────────────────────────────────────────────────────────
suite('memory-index · parseEntries');

const E1 = entry('2026-09-06', 'Entrada Uno', 'Cuerpo uno.');
const E2 = entry('2026-09-05', 'Entrada Dos', 'Cuerpo dos.');

test('parseEntries: una entrada por bloque con date/topic/review_after/source', () => {
  const text = [ENTRIES_START, '', E1, E2, ENTRIES_END].join('\n');
  const out = parseEntries(text, 'SUMMARY.md');
  eq(out.length, 2, 'dos bloques → dos entradas');
  eq(out.map((e) => e.date), ['2026-09-06', '2026-09-05'], 'fechas en orden de bloque');
  eq(out.map((e) => e.title), ['Entrada Uno', 'Entrada Dos'], 'títulos del heading');
  eq(out.map((e) => e.topic), ['test/fixture', 'test/fixture'], 'topic: de la línea propia');
  eq(out.map((e) => e.review_after), ['2099-12-31', '2099-12-31'], 'review_after de la línea propia');
  eq(out.map((e) => e.source), ['SUMMARY.md', 'SUMMARY.md'], 'source es el que se pasó');
});

test('parseEntries: id canónico fecha--título normalizado (idéntico a headingToId)', () => {
  const out = parseEntries([ENTRIES_START, '', E1, E2, ENTRIES_END].join('\n'), 'SUMMARY.md');
  eq(out.map((e) => e.id), ['2026-09-06--entrada uno', '2026-09-05--entrada dos'], 'id = <fecha>--<título normalizado>');
});

test('parseEntries: preview = líneas 2..5 unidas con espacio, topadas a 160 chars', () => {
  const out = parseEntries([ENTRIES_START, '', E1].join('\n'), 'SUMMARY.md');
  eq(out[0].preview, ' topic: test/fixture review_after: 2099-12-31 **Goal:** Cuerpo uno.', 'preview exacto');
  const largo = entry('2026-09-06', 'Largo', 'x'.repeat(400));
  const out2 = parseEntries([ENTRIES_START, '', largo, ENTRIES_END].join('\n'), 'SUMMARY.md');
  eq(out2[0].preview.length, 160, 'el preview se corta a 160 caracteres');
});

test('parseEntries: separador coma admitido (parser tolerante de lectura)', () => {
  const coma = entry('2026-09-04', 'Con coma', 'cuerpo').replace('## 2026-09-04 - ', '## 2026-09-04, ');
  const out = parseEntries([ENTRIES_START, '', coma, ENTRIES_END].join('\n'), 'SUMMARY.md');
  eq(out.length, 1, 'la coma es separador válido en lectura');
  eq(out[0].id, '2026-09-04--con coma', 'el id canónico es separador-agnóstico');
});

test('parseEntries: un heading dentro de un fence no es entrada (fence-aware)', () => {
  const conFence = entry('2026-09-06', 'Con fence', 'cuerpo', ['```markdown', '## 2020-01-01 — Falso', '```']);
  const out = parseEntries([ENTRIES_START, '', conFence, ENTRIES_END].join('\n'), 'SUMMARY.md');
  eq(out.map((e) => e.date), ['2026-09-06'], 'el heading del fence no se cuenta');
});

test('parseEntries: solo se parsea la región; lo posterior a END se ignora', () => {
  const p = summaryWithEntries(temp('region'), 2);
  const conFuera = readFileSync(p, 'utf8').replace(ENTRIES_END, `${ENTRIES_END}\n\n## 2026-01-01 — Fuera de región\n\ncuerpo fuera\n`);
  const out = parseEntries(conFuera, 'SUMMARY.md');
  eq(out.map((e) => e.date), ['2026-09-06', '2026-09-05'], 'solo las 2 entradas dentro de los marcadores');
  assert(!out.some((e) => /fuera/i.test(e.title + e.preview)), 'la entrada posterior a END no aparece');
});

test('parseEntries: marcadores parciales → archivo completo, sin lanzar', () => {
  const p = summaryWithEntries(temp('parcial'), 2);
  const sinEnd = readFileSync(p, 'utf8').replace(ENTRIES_END, '');
  const e = throws(() => entriesRegion(sinEnd), 'entriesRegion lanza con marcadores parciales');
  match(e.message, /exactamente un par/, 'el motivo es el par de marcadores incompleto');
  const { value: out, errs } = capture(() => parseEntries(sinEnd, 'SUMMARY.md', { advisory: true }));
  eq(out.map((x) => x.date), ['2026-09-06', '2026-09-05'], 'el fallback usa el archivo completo');
  assert(errs.join('|').includes('inválidos'), 'el advisory reporta marcadores inválidos por stderr');
});

test('parseEntries: sin marcadores y advisory:false no avisa; advisory:true avisa', () => {
  const p = summaryWithEntries(temp('sinmarcadores'), 2);
  const sinMarcadores = readFileSync(p, 'utf8').split('\n').filter((l) => l !== ENTRIES_START && l !== ENTRIES_END).join('\n');
  const silencioso = capture(() => parseEntries(sinMarcadores, 'SUMMARY.md'));
  eq(silencioso.value.length, 2, 'sin marcadores igual parsea (fallback whole-file)');
  eq(silencioso.errs, [], 'advisory:false (por defecto) no escribe en stderr');
  const ruidoso = capture(() => parseEntries(sinMarcadores, 'SUMMARY.md', { advisory: true }));
  eq(ruidoso.errs.length, 1, 'advisory:true emite exactamente un aviso');
  match(ruidoso.errs[0], /Faltan marcadores ADVISOR:ENTRIES/, 'el aviso cita los marcadores ausentes');
});

test('parseEntries: sin headings de entrada devuelve lista vacía', () => {
  eq(parseEntries('', 'SUMMARY.md'), [], 'texto vacío → []');
  eq(parseEntries('# Session Log\n\nNada que ver aquí.\n', 'SUMMARY.md'), [], 'solo prosa → []');
  eq(parseEntries([ENTRIES_START, '', 'texto sin heading', ENTRIES_END].join('\n'), 'SUMMARY.md'), [], 'región sin headings → []');
});

test('parseEntries: sin topic/review_after los campos quedan a null', () => {
  const pelado = entry('2026-09-06', 'Pelado', 'cuerpo').split('\n').filter((l) => !l.startsWith('topic:') && !l.startsWith('review_after:')).join('\n');
  const out = parseEntries([ENTRIES_START, '', pelado, ENTRIES_END].join('\n'), 'SUMMARY.md');
  eq(out.length, 1, 'la entrada se sigue detectando sin los campos');
  eq(out[0].topic, null, 'topic ausente → null');
  eq(out[0].review_after, null, 'review_after ausente → null');
});

// ── fingerprint / isFresh ──────────────────────────────────────────────────
suite('memory-index · fingerprint e isFresh');

test('fingerprint: contrato de forma — lista ordenada por path con {path,mtime,size} (solo lectura)', () => {
  const fp = fingerprint();
  assert(Array.isArray(fp) && fp.length > 0, 'devuelve una lista no vacía');
  const paths = fp.map((e) => e.path);
  eq(paths, [...paths].sort(), 'orden ascendente por path (estable entre corridas)');
  for (const e of fp) {
    eq(Object.keys(e).sort(), ['mtime', 'path', 'size'], `claves exactas de ${e.path}`);
    assert(typeof e.mtime === 'number' && Number.isFinite(e.mtime), `mtime numérico en ${e.path}`);
    assert(typeof e.size === 'number' && Number.isFinite(e.size), `size numérico en ${e.path}`);
  }
  assert(paths.includes('PROJECT_STATE.md'), 'PROJECT_STATE.md es fuente de memoria');
  assert(paths.includes('SUMMARY.md'), 'SUMMARY.md es fuente de memoria');
});

test('isFresh: sin caché, sin versión o sin fingerprint → false', () => {
  eq(isFresh(null, FP), false, 'null → stale');
  eq(isFresh(undefined, FP), false, 'undefined → stale');
  eq(isFresh({}, FP), false, 'objeto vacío → stale');
  eq(isFresh({ version: INDEX_VERSION }, FP), false, 'sin fingerprint → stale');
});

test('isFresh: versión distinta de INDEX_VERSION → false', () => {
  eq(isFresh(cached({ version: INDEX_VERSION + 1 }), FP), false, 'versión mayor');
  eq(isFresh(cached({ version: 0 }), FP), false, 'versión 0');
  eq(isFresh(cached({ version: String(INDEX_VERSION) }), FP), false, 'versión como string no vale');
});

test('isFresh: fingerprint no-array → false', () => {
  eq(isFresh(cached({ fingerprint: 'nope' }), FP), false, 'string');
  eq(isFresh(cached({ fingerprint: null }), FP), false, 'null');
  eq(isFresh(cached({ fingerprint: {} }), FP), false, 'objeto');
});

test('isFresh: longitud distinta (fuente añadida o borrada) → false', () => {
  eq(isFresh(cached(), FP.slice(0, 1)), false, 'se perdió una fuente');
  eq(isFresh(cached(), [...FP, { path: 'CHANGELOG/2026-09-07.md', mtime: 3, size: 9 }]), false, 'apareció una fuente');
});

test('isFresh: path+mtime+size idénticos → true', () => {
  eq(isFresh(cached(), FP), true, 'caché idéntica al fingerprint actual');
  eq(isFresh(cached(), FP.map((e) => ({ ...e }))), true, 'copia con otro orden de claves no altera nada');
});

test('isFresh: cualquier cambio de path, mtime o size → false', () => {
  eq(isFresh(cached(), FP.map((e) => (e.path === 'SUMMARY.md' ? { ...e, mtime: e.mtime + 1 } : e))), false, 'mtime distinto');
  eq(isFresh(cached(), FP.map((e) => (e.path === 'SUMMARY.md' ? { ...e, size: e.size + 1 } : e))), false, 'size distinto');
  eq(isFresh(cached(), FP.map((e) => (e.path === 'SUMMARY.md' ? { ...e, path: 'OTRO.md' } : e))), false, 'path distinto con el mismo número de fuentes');
  eq(isFresh(cached(), FP.map((e) => (e.path === 'SUMMARY.md' ? { ...e, mtime: e.mtime + 1, size: e.size + 1 } : e))), false, 'mtime y size a la vez');
});

// ── score ──────────────────────────────────────────────────────────────────
suite('memory-index · score');

const NOW = Date.parse('2026-09-10T00:00:00Z');
const ent = (over = {}) => ({ id: 'x', date: '2026-09-10', title: 'Sin coincidencia', topic: 'otro/tema', preview: 'nada', source: 'SUMMARY.md', ...over });

test('score: un topic que casa vale más que uno que no casa', () => {
  const conTopic = score(ent({ topic: 'memoria/sync' }), 'memoria', NOW);
  const sinTopic = score(ent(), 'memoria', NOW);
  assert(conTopic > sinTopic, `topic que casa (${conTopic}) > topic que no casa (${sinTopic})`);
  close(conTopic - sinTopic, 0.3, 'la bonificación de topic es 0.3');
});

test('score: título > solo preview > nada (mismo query, sin match de topic)', () => {
  const enTitulo = score(ent({ title: 'Sincronía de memoria' }), 'sincro', NOW);
  const enPreview = score(ent({ preview: 'detalle de sincronizacion' }), 'sincro', NOW);
  const enNada = score(ent(), 'sincro', NOW);
  assert(enTitulo > enPreview, `título (${enTitulo}) > preview (${enPreview})`);
  assert(enPreview > enNada, `preview (${enPreview}) > nada (${enNada})`);
  close(enTitulo - enPreview, 0.05, 'la diferencia título/preview es media ponderación (0.1*(1-0.5))');
  close(enPreview - enNada, 0.05, 'la diferencia preview/nada es media ponderación');
});

test('score: con query vacía el score es solo recencia', () => {
  eq(score(ent(), '', NOW), score(ent({ topic: 'lo-que-sea' }), '', NOW), 'sin query no hay bonus de topic ni título');
});

test('score: la entrada más reciente queda por encima de la más antigua', () => {
  const hoy = score(ent({ date: '2026-09-10' }), 'memoria', NOW);
  const mes = score(ent({ date: '2026-08-25' }), 'memoria', NOW);
  const viejo = score(ent({ date: '2026-06-10' }), 'memoria', NOW);
  assert(hoy > mes && mes > viejo, `orden por recencia: ${hoy} > ${mes} > ${viejo}`);
  close(hoy - viejo, 0.6, 'la recencia pesa 0.6');
  close(hoy, 0.6, 'hoy (0 días) aporta la recencia máxima');
  close(mes, 0.6 * (1 - 16 / 30), 'a 16 días la recencia decae linealmente');
  close(viejo, 0, 'a más de 30 días la recencia se satura en 0');
});

test('score: una fecha futura no rompe (finito y por encima de hoy)', () => {
  const futuro = score(ent({ date: '2026-12-31' }), 'memoria', NOW);
  const hoy = score(ent({ date: '2026-09-10' }), 'memoria', NOW);
  assert(Number.isFinite(futuro) && Number.isFinite(hoy), 'ambos scores son finitos');
  assert(futuro >= hoy, `una fecha futura no puntúa por debajo de hoy (${futuro} >= ${hoy})`);
});

test('score: fecha no parseable ("state" de §2) → recencia 0, sin lanzar', () => {
  const decision = score(ent({ date: 'state' }), 'memoria', NOW);
  const entrada = score(ent({ date: '2026-09-10' }), 'memoria', NOW);
  assert(Number.isFinite(decision), 'no lanza con fecha inválida');
  assert(decision >= 0, 'el score no es negativo');
  assert(entrada > decision, `una entrada real de hoy (${entrada}) supera a la decisión sin fecha (${decision})`);
  assert(Number.isFinite(score({ title: 'sin fecha ni topic' }, 'x', NOW)), 'campos ausentes no rompen');
});

test('score: el query se normaliza a minúsculas en título, topic y preview', () => {
  const conMayus = score(ent({ topic: 'Memoria/Sync' }), 'MEMORIA', NOW);
  const enMinus = score(ent({ topic: 'Memoria/Sync' }), 'memoria', NOW);
  const sinMatch = score(ent({ topic: 'Memoria/Sync' }), 'otra-cosa', NOW);
  eq(conMayus, enMinus, 'MAYÚSCULAS y minúsculas dan el mismo score');
  assert(conMayus > sinMatch, 'y el match sigue contando');
});

// ── sandbox (allEntries / writeIndex / loadIndex) ──────────────────────────
suite('memory-index · sandbox byte-idéntico (ROOT del espejo = tmpdir)');

test('sandbox: los scripts del espejo son byte-idénticos a los del repo', async () => {
  const sb = await sandbox('fidelidad');
  for (const f of MIRROR_FILES) {
    eq(readFileSync(join(sb.dir, '.opencode', 'scripts', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, f), 'utf8'), `${f} sin modificar`);
  }
  eq(typeof sb.mod.allEntries, 'function', 'el espejo exporta la misma API');
});

test('allEntries: §2 de PROJECT_STATE entra como entradas "state--" y es estable', async () => {
  const a = await sandbox('state-a');
  const b = await sandbox('state-b');
  const dec = (m) => m.allEntries().filter((e) => e.source === 'PROJECT_STATE.md §2');
  const da = dec(a.mod);
  eq(da.length, 2, 'las 2 decisiones del fixture (las reglas `---` no cuentan)');
  eq(da.map((d) => ({ date: d.date, topic: d.topic })), [
    { date: 'state', topic: 'test/fixture-a' },
    { date: 'state', topic: 'test/fixture-b' },
  ], 'date "state" + topic del corchete');
  for (const d of da) assert(d.id.startsWith('state--'), `el id de la decisión empieza por state-- (${d.id})`);
  eq(new Set(da.map((d) => d.id)).size, 2, 'las dos decisiones tienen ids distintos');
  eq(da.map((d) => d.id), dec(b.mod).map((d) => d.id), 'los ids son estables entre instancias (dos sandboxes)');
  a.mod.invalidateEntriesCache();
  eq(da.map((d) => d.id), dec(a.mod).map((d) => d.id), 'y estables tras invalidar el memo');
  eq(dec(a.mod).length, 2, 'invalidar el memo no duplica entradas');
});

test('allEntries: memoiza entre llamadas y la invalidación explícita fuerza relectura', async () => {
  const sb = await sandbox('memo');
  const uno = sb.mod.allEntries();
  const dos = sb.mod.allEntries();
  assert(uno === dos, 'la segunda llamada devuelve el MISMO objeto (memo por fingerprint)');
  sb.mod.invalidateEntriesCache();
  const tres = sb.mod.allEntries();
  assert(tres !== uno, 'tras invalidateEntriesCache() se relee el árbol');
  eq(tres, uno, 'y el contenido es idéntico (no había cambios en disco)');
});

test('allEntries: agrega SUMMARY.md y CHANGELOG/*.md con su source', async () => {
  const sb = await sandbox('agrega');
  summaryWithEntries(sb.dir, 3);
  const antes = sb.mod.allEntries().filter((e) => e.source !== 'PROJECT_STATE.md §2');
  eq(antes.length, 3, '3 entradas de SUMMARY.md');
  eq(new Set(antes.map((e) => e.source)), new Set(['SUMMARY.md']), 'todas con source SUMMARY.md');
  const weekly = entry('2026-10-05', 'Entrada de la semana nueva', 'cuerpo nuevo');
  const p = join(sb.dir, 'SUMMARY.md');
  const txt = readFileSync(p, 'utf8');
  const i = txt.indexOf(ENTRIES_START) + ENTRIES_START.length;
  writeFileSync(p, `${txt.slice(0, i)}\n${weekly}${txt.slice(i)}`, 'utf8');
  const { value: data } = capture(() => sb.mod.writeIndex());
  eq(data.version, INDEX_VERSION, 'writeIndex() escribe version INDEX_VERSION');
  const fuentes = new Set(data.entries.map((e) => e.source));
  assert(fuentes.has('SUMMARY.md'), 'el índice incluye SUMMARY.md');
  assert(data.entries.some((e) => e.source === 'CHANGELOG/2026-10-05.md') === false, 'aún no hay CHANGELOG escrito');
  eq(data.entries.filter((e) => e.source === 'SUMMARY.md').length, 4, '4 entradas de SUMMARY tras añadir una');
  eq(data.entries.filter((e) => e.source === 'PROJECT_STATE.md §2').length, 2, 'más las 2 decisiones §2');
  assert(Array.isArray(data.fingerprint) && data.fingerprint.length > 0, 'el índice guarda su fingerprint');
});

test('loadIndex: null sin fichero, con JSON corrupto o con versión distinta', async () => {
  const sb = await sandbox('loadindex');
  const idx = join(sb.dir, '.advisor', 'memory-index.json');
  eq(sb.mod.loadIndex(), null, 'sin .advisor/memory-index.json → null');
  mkdirSync(join(sb.dir, '.advisor'), { recursive: true });
  writeFileSync(idx, '{ esto no es json');
  eq(sb.mod.loadIndex(), null, 'JSON corrupto → null (sin lanzar)');
  writeFileSync(idx, JSON.stringify({ version: INDEX_VERSION + 1, entries: [], fingerprint: [] }));
  eq(sb.mod.loadIndex(), null, 'versión distinta → null');
  writeFileSync(idx, JSON.stringify({ version: INDEX_VERSION, fingerprint: [], entries: 'no-array' }));
  eq(sb.mod.loadIndex(), null, 'entries no-array → null');
});

test('loadIndex: fresh tras writeIndex y stale en cuanto cambia una fuente', async () => {
  const sb = await sandbox('fresh');
  const { value: data } = capture(() => sb.mod.writeIndex());
  eq(sb.mod.isFresh(data), true, 'isFresh(data) con el fingerprint vivo (2º argumento por defecto)');
  const loaded = sb.mod.loadIndex();
  assert(loaded !== null && loaded.fresh === true, 'loadIndex() marca el índice recién escrito como fresh');
  eq(loaded.data.version, INDEX_VERSION, 'y expone la versión del contrato');
  const p = join(sb.dir, 'SUMMARY.md');
  writeFileSync(p, `${readFileSync(p, 'utf8')}\n<!-- línea extra -->\n`);
  eq(sb.mod.isFresh(data), false, 'cambia el tamaño de SUMMARY.md → stale');
  eq(sb.mod.loadIndex().fresh, false, 'loadIndex() lo detecta como stale');
});

// ── CLI (search → timeline → get) sobre el espejo ───────────────────────────
suite('memory-index · CLI del espejo (search/timeline/get)');

// Corre el CLI contra el espejo del sandbox: `main()` no se exporta, y es la ruta
// que documentan AGENTS.md / README.md / PROJECT_STATE.md §5.
function cli(sb, args) {
  const r = spawnSync(process.execPath, [join(sb.dir, '.opencode', 'scripts', 'memory-index.mjs'), ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const lineIds = (out) => out.split('\n').filter((l) => l.startsWith('- ')).map((l) => (/^- (.*?) \[/.exec(l) || [])[1]);

test('get: imprime el CUERPO de la entrada, no solo su heading (flujo search → timeline → get)', async () => {
  const sb = await sandbox('get-cuerpo');
  summaryWithEntries(sb.dir, 3);
  const s = cli(sb, ['search', 'entrada fixture 2']);
  eq(s.status, 0, 'search sale 0');
  const id = lineIds(s.out)[0];
  eq(id, '2026-09-05--entrada fixture 2', 'el id canonico que devuelve search');
  const t = cli(sb, ['timeline', id]);
  eq(t.status, 0, 'timeline sale 0');
  const g = cli(sb, ['get', id]);
  eq(g.status, 0, 'get sale 0');
  includes(g.out, '## 2026-09-05 - Entrada fixture 2', 'el heading de la entrada');
  includes(g.out, 'topic: test/fixture', 'el topic');
  includes(g.out, '**Goal:** Cuerpo de la entrada 2.', 'el cuerpo de la entrada');
  includes(g.out, '**Verificación:** pendiente.', 'y hasta el ultimo campo del bloque');
  assert(!g.out.includes('## 2026-09-04'), 'solo ese bloque: no se cuela la entrada siguiente');
  assert(!g.out.includes('Entrada fixture 1'), 'ni la anterior');
});

test('get: el cuerpo sale completo tambien para una entrada ya archivada en CHANGELOG', async () => {
  const sb = await sandbox('get-changelog');
  summaryWithEntries(sb.dir, 2);
  writeFileSync(join(sb.dir, 'CHANGELOG', '2026-08-31.md'), `# Changelog 2026-08-31\n\n> Historial semanal archivado desde SUMMARY.md.\n\n${entry('2026-08-25', 'Entrada archivada', 'cuerpo archivado.')}\n`, 'utf8');
  const g = cli(sb, ['get', '2026-08-25--entrada archivada']);
  eq(g.status, 0, 'get sale 0');
  includes(g.out, '## 2026-08-25 - Entrada archivada', 'el heading del CHANGELOG');
  includes(g.out, '**Goal:** cuerpo archivado.', 'y el cuerpo, que antes nunca se volcaba');
});

test('get: §2 de PROJECT_STATE conserva su cabecera y su volcado (sin tocar ese caso)', async () => {
  const sb = await sandbox('get-state');
  const id = sb.mod.allEntries().find((e) => e.source === 'PROJECT_STATE.md §2').id;
  const g = cli(sb, ['get', id]);
  eq(g.status, 0, 'get sale 0');
  includes(g.out, '# PROJECT_STATE.md §2 — Decisión de fixture A [topic: test/fixture-a] review_after: 2099-12-31', 'la cabecera propia de §2 no cambia');
  includes(g.out, '- Decisión de fixture B [topic: test/fixture-b]', 'y sigue volcando la sección entera');
});

test('search: el texto es IDENTICO con índice fresco y sin índice (rank único por score)', async () => {
  // El orden por score NO coincide con el orden de archivo: la entrada de CHANGELOG
  // solo casa en la prosa (0.05) y las decisiones de §2 casan en topic + título
  // (0.4), aunque en disco la del CHANGELOG va ANTES que las de §2.
  const sb = await sandbox('search-ranking');
  summaryWithEntries(sb.dir, 3);
  const viejo = ['## 2026-08-25 - Entrada antigua sin el termino', '', 'topic: test/otro', 'review_after: 2099-12-31', '**Goal:** Esta prosa es la unica que menciona fixture.', ''].join('\n');
  writeFileSync(join(sb.dir, 'CHANGELOG', '2026-08-31.md'), `# Changelog 2026-08-31\n\n> Historial semanal archivado desde SUMMARY.md.\n\n${viejo}\n`, 'utf8');
  const sinIndice = cli(sb, ['search', 'fixture']);
  eq(sinIndice.status, 0, 'sin índice: sale 0');
  sb.mod.writeIndex(); // índice fresco
  const conIndice = cli(sb, ['search', 'fixture']);
  eq(conIndice.status, 0, 'con índice: sale 0');
  eq(conIndice.err, '', 'con índice fresco no avisa de nada');
  eq(conIndice.out, sinIndice.out, 'el MISMO texto, byte a byte, en los dos modos');
  const orden = lineIds(conIndice.out);
  eq(orden.length, 6, '3 de SUMMARY + 1 de CHANGELOG + 2 decisiones §2');
  const ultimo = orden[orden.length - 1];
  assert(ultimo.startsWith('2026-08-25--'), `la entrada de CHANGELOG (score 0.05) sale la ÚLTIMA también sin índice: ${ultimo}`);
  const antesDeUltimo = orden[orden.length - 2];
  assert(antesDeUltimo.startsWith('state--'), `las decisiones de §2 (0.4) la preceden: ${antesDeUltimo}`);
});

test('search: el aviso de índice stale sale UNA vez por corrida (fuente única del mensaje)', async () => {
  const sb = await sandbox('search-stale');
  summaryWithEntries(sb.dir, 2);
  const r = cli(sb, ['search', '--refresh', 'fixture']);
  eq(r.status, 0, '--refresh sale 0');
  appendTo(sb.dir, 'SUMMARY.md', '\n<!-- línea extra -->');
  const stale = cli(sb, ['search', 'fixture']);
  eq(stale.status, 0, 'con índice stale sale 0');
  eq((stale.err.match(/desactualizado \(stale\)/g) || []).length, 1, 'exactamente un aviso por stderr');
  const get = cli(sb, ['get', '2026-09-06--entrada fixture 1']);
  eq((get.err.match(/desactualizado \(stale\)/g) || []).length, 1, 'get también avisa una sola vez');
});

function appendTo(dir, rel, extra) {
  const p = join(dir, rel);
  writeFileSync(p, readFileSync(p, 'utf8') + extra, 'utf8');
  return p;
}

test('allEntries: dos decisiones de §2 con prefijo largo común tienen ids DISTINTOS (hash)', async () => {
  const sb = await sandbox('state-colision');
  // Prefijo común más largo que el truncado de 38 chars del id antiguo: sin hash
  // las dos decisiones producían `state--<mismo-truncado>` y el índice persistía
  // ids duplicados (justo lo que el comentario de slugId declara que no pasa).
  const largo = 'Memoria en 3 capas con busqueda md+grep y cache fingerprint de rutas';
  const lineas = [
    `- ${largo}, sin SQLite [topic: architecture/stack-md-grep] review_after: 2099-12-31`,
    `- ${largo}, con SQLite como fallback [topic: architecture/stack-sqlite] review_after: 2099-12-31`,
  ].join('\n');
  const p = join(sb.dir, 'PROJECT_STATE.md');
  const txt = readFileSync(p, 'utf8');
  const ancla = '- Decisión de fixture B [topic: test/fixture-b] review_after: 2099-12-31\n';
  assert(txt.includes(ancla), 'el fixture tiene la línea de anclaje de §2');
  writeFileSync(p, txt.replace(ancla, `${ancla}${lineas}\n`), 'utf8');
  sb.mod.invalidateEntriesCache();
  const dec = sb.mod.allEntries().filter((e) => e.source === 'PROJECT_STATE.md §2');
  eq(dec.length, 4, 'las 2 del fixture + las 2 largas');
  const largos = dec.slice(-2);
  const id1 = largos[0].id;
  const id2 = largos[1].id;
  eq(id1, slugId('state', `${largo}, sin SQLite [topic: architecture/stack-md-grep] review_after: 2099-12-31`), 'id = slugId(state, texto completo)');
  match(id1, /^state--memoria-en-3-capas-con-busqued-[0-9a-f]{6}$/, 'prefijo state-- conservado + hash sha1 de 6 (slug recortado a 30)');
  neq(id1, id2, 'las dos decisiones con prefijo común NO colisionan');
  neq(id1.slice(0, 38), id2.slice(0, 38) + 'x', 'el prefijo truncado sigue siendo el mismo (el hash es lo que desambigua)');
  assert(!/[A-Z]/.test(id1), 'el id sale en minúsculas (slugId normaliza el caso)');
  // Estabilidad entre corridas y tras invalidar el memo.
  sb.mod.invalidateEntriesCache();
  eq(sb.mod.allEntries().filter((e) => e.source === 'PROJECT_STATE.md §2').slice(-2).map((e) => e.id), [id1, id2], 'los ids son estables tras releer el árbol');
  const sb2 = await sandbox('state-colision-2');
  const p2 = join(sb2.dir, 'PROJECT_STATE.md');
  const t2 = readFileSync(p2, 'utf8');
  writeFileSync(p2, t2.replace(ancla, `${ancla}${lineas}\n`), 'utf8');
  sb2.mod.invalidateEntriesCache();
  eq(sb2.mod.allEntries().filter((e) => e.source === 'PROJECT_STATE.md §2').slice(-2).map((e) => e.id), [id1, id2], 'y estables entre instancias (dos sandboxes)');
});

test('writeIndex: los ids de §2 con prefijo común se persisten sin duplicados', async () => {
  const sb = await sandbox('state-colision-index');
  const p = join(sb.dir, 'PROJECT_STATE.md');
  const txt = readFileSync(p, 'utf8');
  const ancla = '- Decisión de fixture B [topic: test/fixture-b] review_after: 2099-12-31\n';
  const lineas = [
    '- Decisiones de memoria con prefijo larguisimo compartido, variante uno [topic: test/largo-1] review_after: 2099-12-31',
    '- Decisiones de memoria con prefijo larguisimo compartido, variante dos [topic: test/largo-2] review_after: 2099-12-31',
  ].join('\n');
  writeFileSync(p, txt.replace(ancla, `${ancla}${lineas}\n`), 'utf8');
  sb.mod.invalidateEntriesCache();
  const { value: data } = capture(() => sb.mod.writeIndex());
  const ids = data.entries.filter((e) => e.source === 'PROJECT_STATE.md §2').map((e) => e.id);
  eq(ids.length, 4, '4 decisiones en el índice persistido');
  eq(new Set(ids).size, 4, 'y los 4 ids son únicos: el truncado sin hash habría colisionado');
});

await runAll();
