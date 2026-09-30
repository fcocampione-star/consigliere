/**
 * test/memory-rotate-extra.test.mjs — regresiones del motor de rotación que no
 * cabían en `.opencode/scripts/memory-rotate.test.mjs`:
 *
 *  1. Escritura atómica con REINTENTOS ACOTADOS del rename. En Windows el
 *     destino se bloquea momentáneamente (editor, antivirus, indexador) y el
 *     rename falla con EPERM/EBUSY aunque el temp esté escrito; sin reintento
 *     la rotación se abortaba DESPUÉS de haber anexado en otro archivo. Además
 *     un fallo definitivo no puede dejar un `.tmp` detrás.
 *  2. Drenaje LINEAL: la región se parsea una vez y cada iteración quita una
 *     entrada (trabajo ∝ entrada quitada) en vez de reparsear y re-partir el
 *     archivo entero en cada vuelta. Se afirma el RESULTADO sobre un SUMMARY
 *     con 300 entradas (nada se pierde, nada se duplica, el conteo incremental
 *     de líneas coincide con `contentLines`), nunca tiempos.
 *
 * `writeAtomic` es lo único que se importa del motor (además de `rotate`); el
 * resto de la suite usa `rotate({root})` contra fixtures, con `--root` siendo
 * TEST-ONLY y el lock canonico quedandose en la raiz del repo del script. Como
 * `rotate`/`migrateMarkers` toman ese lock DENTRO de la funcion mutante, esta
 * suite lo aparta a su propio sandbox con `ADVISOR_LOCK_ROOT` (ver abajo): sin
 * eso, cada `rotate({root})` de los fixtures tomaba el `.memory-lock` real del
 * repo en pleno `npm test`.
 */

import { readFileSync, existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import { makeProject, summaryWithEntries } from './fixtures.mjs';

// `ADVISOR_LOCK_ROOT` se lee UNA vez al cargar memory-lock.mjs, asi que tiene que
// fijarse ANTES del import de memory-rotate.mjs (que lo importa transitivamente):
// por eso el import del motor es dinamico y no estatico.
const LOCK_SANDBOX = tmpdir('advisor-rotate-lock');
process.env.ADVISOR_LOCK_ROOT = LOCK_SANDBOX;
const { writeAtomic, rotate, CHANGELOG_LINE_LIMIT, DEFAULT_MAX } = await import('../.opencode/scripts/memory-rotate.mjs');
const { lockPath } = await import('../.opencode/scripts/memory-lock.mjs');
const { contentLines, ENTRIES_START, ENTRIES_END } = await import('../.opencode/scripts/memory-stats.mjs');

const TEMPS = [LOCK_SANDBOX];
process.on('exit', () => cleanup(TEMPS));

const N_ESCALA = 300;
const SIN_RETRY = { backoffMs: [0, 0, 0, 0, 0] }; // backoff 0: el test no duerme

function arena(label) {
  const dir = tmpdir(`advisor-rotate-extra-${label}`);
  TEMPS.push(dir);
  return dir;
}

const leer = (p) => readFileSync(p, 'utf8');
const countHeadings = (txt) => (String(txt).match(/^## \d{4}-\d{2}-\d{2} /gm) || []).length;

// `.tmp` residuales en todo el arbol (una rotación fallida no debe dejar debris).
function residuos(dir) {
  const out = [];
  const walk = (p) => {
    for (const n of readdirSync(p)) {
      const f = join(p, n);
      let esDir = false;
      try { esDir = readdirSync(f).length >= 0; } catch { esDir = false; }
      if (esDir) walk(f);
      else if (f.endsWith('.tmp')) out.push(f);
    }
  };
  walk(dir);
  return out;
}

// rename de verdad, para los dobles de prueba que fallan N veces y luego dejan
// pasar el rename como si el bloqueo se hubiera liberado.
const renameSyncReal = renameSync;

// ── 1. Escritura atómica: reintentos acotados, sin debris ────────────────────

suite('memory-rotate · escritura atómica con reintentos');

test('escribe el contenido completo y no deja temp', () => {
  const dir = arena('write-ok');
  const f = join(dir, 'cuerpo.md');
  writeAtomic(f, 'contenido nuevo\n');
  eq(leer(f), 'contenido nuevo\n', 'el contenido queda integro');
  eq(residuos(dir), [], 'sin .tmp residuales');
});

test('sobreescribe un destino existente (atomicidad: nunca queda a medias)', () => {
  const dir = arena('write-sobre');
  const f = join(dir, 'cuerpo.md');
  writeFileSync(f, 'viejo\n');
  writeAtomic(f, 'nuevo\n');
  eq(leer(f), 'nuevo\n', 'el destino se sustituye entero');
  eq(residuos(dir), [], 'sin .tmp residuales');
});

test('un rename bloqueado (EPERM) se reintenta y acaba escribiendo', () => {
  const dir = arena('write-eperm');
  const f = join(dir, 'cuerpo.md');
  let intentos = 0;
  const rename = (from, to) => {
    intentos++;
    if (intentos < 3) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
    renameSyncReal(from, to);
  };
  writeAtomic(f, 'bloqueado al principio\n', { ...SIN_RETRY, rename });
  eq(intentos, 3, 'dos fallos transitorios + el que funciona');
  eq(leer(f), 'bloqueado al principio\n', 'el contenido se escribe pese al bloqueo inicial');
  eq(residuos(dir), [], 'sin .tmp residuales tras los reintentos');
});

test('EBUSY (otro código de bloqueo de Windows) tambien se reintenta', () => {
  const dir = arena('write-ebusy');
  const f = join(dir, 'cuerpo.md');
  let intentos = 0;
  const rename = (from, to) => {
    intentos++;
    if (intentos < 2) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
    renameSyncReal(from, to);
  };
  writeAtomic(f, 'x\n', { ...SIN_RETRY, rename });
  eq(intentos, 2, 'un reintento basta');
  eq(leer(f), 'x\n', 'escrito');
});

test('un error NO transitorio (ENOENT) no se reintenta: se propaga de inmediato', () => {
  const dir = arena('write-enoent');
  const f = join(dir, 'cuerpo.md');
  let intentos = 0;
  const rename = () => { intentos++; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
  const err = throws(() => writeAtomic(f, 'nada\n', { ...SIN_RETRY, rename }), 'debe propagar el error');
  eq(err.code, 'ENOENT', 'se propaga el error original');
  eq(intentos, 1, 'un solo intento para un error no transitorio');
});

test('agotados los reintentos: lanza el error y NO deja temp detrás', () => {
  const dir = arena('write-agota');
  const f = join(dir, 'cuerpo.md');
  writeFileSync(f, 'intacto\n');
  let intentos = 0;
  const rename = () => { intentos++; const e = new Error('EPERM siempre'); e.code = 'EPERM'; throw e; };
  const err = throws(() => writeAtomic(f, 'nuevo\n', { ...SIN_RETRY, attempts: 4, rename }), 'debe fallar');
  eq(err.code, 'EPERM', 'propaga EPERM');
  eq(intentos, 4, 'los reintentos son ACOTADOS: exactamente los pedidos');
  eq(leer(f), 'intacto\n', 'el destino conserva su contenido anterior (nunca a medias)');
  eq(residuos(dir), [], 'una escritura fallida no deja .tmp: esto es lo que abortaba la rotación a medias');
});

test('el número de intentos por defecto está acotado (no es un bucle infinito)', () => {
  const dir = arena('write-default');
  const f = join(dir, 'cuerpo.md');
  let intentos = 0;
  const rename = () => { intentos++; const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; };
  throws(() => writeAtomic(f, 'x\n', { ...SIN_RETRY, rename }), 'con el rename siempre bloqueado debe fallar');
  assert(intentos > 1 && intentos <= 8, `los intentos por defecto deben estar acotados (fueron ${intentos})`);
  eq(residuos(dir), [], 'sin .tmp residuales');
});

// ── 2. Drenaje lineal: 300 entradas ─────────────────────────────────────────

suite('memory-rotate · drenaje lineal a escala (300 entradas)');

const escala = arena('escala');
makeProject(escala);
summaryWithEntries(escala, N_ESCALA);
const resumenAntes = leer(join(escala, 'SUMMARY.md'));
const rEscala = rotate({ root: escala, max: N_ESCALA + 10 });

test('el fixture es el esperado: 300 entradas y por encima del limite', () => {
  eq(countHeadings(resumenAntes), N_ESCALA, '300 entradas en el SUMMARY de partida');
  assert(contentLines(resumenAntes).count > CHANGELOG_LINE_LIMIT, 'el corpus supera el limite de 150 lineas');
  eq(contentLines(resumenAntes).marked, true, 'la region esta delimitada por marcadores');
});

test('drena todas menos la mas nueva (que queda protegida)', () => {
  eq(rEscala.moved.length, N_ESCALA - 1, 'se archivan 299 entradas');
  const masNueva = rEscala.moved.map((m) => m.date).sort().pop();
  const restantes = leer(join(escala, 'SUMMARY.md'));
  eq(countHeadings(restantes), 1, 'queda una sola entrada en el SUMMARY');
  const fechaRestante = (restantes.match(/^## (\d{4}-\d{2}-\d{2}) /m) || [])[1];
  assert(fechaRestante, 'la entrada que queda tiene fecha');
  eq(fechaRestante, '2026-09-06', 'la que queda es la mas nueva del fixture, nunca la mas antigua');
  neq(masNueva, undefined, 'hay movimientos registrados');
});

test('ninguna entrada se pierde ni se duplica: SUMMARY + CHANGELOG = 300', () => {
  const restantes = leer(join(escala, 'SUMMARY.md'));
  let enChangelog = 0;
  const cl = join(escala, 'CHANGELOG');
  const ids = [];
  for (const f of readdirSync(cl).filter((x) => x.endsWith('.md'))) {
    const txt = leer(join(cl, f));
    enChangelog += countHeadings(txt);
    for (const m of txt.matchAll(/^## (\d{4}-\d{2}-\d{2}) - (.*)$/gm)) ids.push(`${m[1]}--${m[2].trim().toLowerCase()}`);
  }
  eq(enChangelog + countHeadings(restantes), N_ESCALA, 'cada entrada esta exactamente una vez');
  eq(new Set(ids).size, ids.length, 'ningun id duplicado entre los CHANGELOG');
  eq(readdirSync(cl).filter((x) => x.endsWith('.md')).length > 30, true, 'el corpus se reparte en muchas semanas');
});

test('el conteo incremental de lineas coincide con contentLines del archivo escrito', () => {
  const written = leer(join(escala, 'SUMMARY.md'));
  eq(rEscala.summaryLinesAfter, contentLines(written).count, 'summaryLinesAfter == contentLines(SUMMARY escrito)');
  eq(rEscala.summaryLinesBefore, contentLines(resumenAntes).count, 'summaryLinesBefore == contentLines(SUMMARY original)');
  eq(rEscala.summaryWritten, true, 'el SUMMARY se reescribio');
});

test('la segunda corrida es idempotente (byte a byte, sin movimientos)', () => {
  const antes = leer(join(escala, 'SUMMARY.md'));
  const clAntes = readdirSync(join(escala, 'CHANGELOG')).sort().map((f) => [f, leer(join(escala, 'CHANGELOG', f))]);
  const r2 = rotate({ root: escala, max: N_ESCALA + 10 });
  eq(r2.moved.length, 0, 'no queda nada por rotar');
  eq(leer(join(escala, 'SUMMARY.md')), antes, 'el SUMMARY no cambia');
  const clDespues = readdirSync(join(escala, 'CHANGELOG')).sort().map((f) => [f, leer(join(escala, 'CHANGELOG', f))]);
  eq(clDespues, clAntes, 'los CHANGELOG no cambian');
  eq(r2.summaryWritten, false, 'no se reescribe un SUMMARY identico');
});

test('drenar a escala no deja .tmp ni marcadores tocados', () => {
  eq(residuos(escala), [], 'sin .tmp residuales tras 299 escrituras atomicas');
  const s = leer(join(escala, 'SUMMARY.md'));
  eq((s.match(/ADVISOR:ENTRIES:START/g) || []).length, 1, 'un solo START');
  eq((s.match(/ADVISOR:ENTRIES:END/g) || []).length, 1, 'un solo END');
  assert(s.indexOf(ENTRIES_START) < s.indexOf(ENTRIES_END), 'START antes de END');
  assert(s.includes('> Cuando registres'), 'el pie del SUMMARY sobrevive intacto');
});

suite('memory-rotate · el bucle rapido no reparsea la region en cada vuelta');

test('parseRegion se llama desde un numero acotado de sitios, no desde el bucle de drenaje', () => {
  const src = leer(join(import.meta.dirname, '..', '.opencode', 'scripts', 'memory-rotate.mjs'));
  const llamadas = (src.match(/parseRegion\(region\)/g) || []).length;
  // Uno al inicio del drenaje y uno en el camino de reparseo (ancla de pie dentro
  // de una entrada, caso patológico). Antes el bucle lo llamaba en cada vuelta.
  eq(llamadas, 2, 'parseRegion(region) debe estar acotado, no en el interior del bucle');
  const recounts = (src.match(/contentLines\(split\.prefix \+ region \+ split\.suffix\)/g) || []).length;
  eq(recounts, 1, 'el recounts del archivo entero solo aparece en el camino de reparseo');
  assert(/baseLines\s*\+\s*liveLines/.test(src), 'el conteo de lineas se mantiene incremental');
  assert(/CHANGELOG_LINE_LIMIT/.test(src), 'el limite documentado sigue aplicandose');
  match(src, /Complejidad/, 'el docstring documenta la complejidad del drenaje');
});

test('DEFAULT_MAX y CHANGELOG_LINE_LIMIT conservan sus valores de contrato', () => {
  eq(DEFAULT_MAX, 20, 'el cap por defecto sigue siendo 20');
  eq(CHANGELOG_LINE_LIMIT, 150, 'el limite sigue siendo 150');
});

test('rotate() toma y suelta el lock canonico (y no lo deja huerfano en el repo)', () => {
  assert(lockPath().startsWith(LOCK_SANDBOX), `el lock debe vivir en el sandbox de la suite, no en el repo: ${lockPath()}`);
  eq(existsSync(lockPath()), false, 'tras todas las corridas de rotate() no queda lock tomado');
});

// ── 3. El cap --max reporta el conteo real ─────────────────────────────────

suite('memory-rotate · cap --max sobre corpus grande');

test('con --max el corte avisa con el contentLines real y respeta el cap', () => {
  const dir = arena('cap');
  makeProject(dir);
  summaryWithEntries(dir, 120);
  const r = rotate({ root: dir, max: 5 });
  eq(r.moved.length, 5, 'rota como mucho max entradas');
  const w = r.warnings.find((x) => x.includes('Cap --max'));
  assert(w, `debe avisar del cap: ${JSON.stringify(r.warnings)}`);
  const m = w.match(/contentLines=(\d+)/);
  assert(m, `el aviso debe traer el conteo: ${w}`);
  eq(Number(m[1]), contentLines(leer(join(dir, 'SUMMARY.md'))).count, 'el conteo del aviso es el del SUMMARY ya drenado');
  eq(residuos(dir), [], 'sin .tmp residuales');
});

test('un corpus de 300 entradas con el cap por defecto se detiene en 20', () => {
  const dir = arena('cap-default');
  makeProject(dir);
  summaryWithEntries(dir, 300);
  const r = rotate({ root: dir });
  eq(r.moved.length, DEFAULT_MAX, 'el cap por defecto manda');
  assert(r.warnings.some((x) => x.includes('Cap --max (20)')), 'avisa del cap');
  match(r.warnings.find((x) => x.includes('Cap --max')), /contentLines=\d+|semana antigua=\d{4}-\d{2}-\d{2}/, 'el motivo del corte es concreto');
});

await runAll();