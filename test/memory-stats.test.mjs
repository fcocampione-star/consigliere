/**
 * test/memory-stats.test.mjs — caracterizacion del modulo puro de memoria.
 *
 * Cubre `.opencode/scripts/memory-stats.mjs`:
 *  - `mondayOf`: la funcion de la que depende toda la rotacion semanal. Se cubre
 *    cada dia de la semana, la rama de DOMINGO (nunca ejercida en produccion),
 *    fronteras de mes/anio, ano bisiesto, fechas inexistentes y entradas Date.
 *  - `entriesRegion`: region marcada, fallback sin marcadores y los tres throws
 *    (START duplicado, END duplicado, END antes de START).
 *  - `contentLines`: cuenta de lineas NO VACIAS solo entre marcadores, incluida
 *    la delegacion en entriesRegion y la variante CRLF.
 *  - `sectionText`: seccion ausente, ultima seccion y tolerancias del heading.
 *  - `registerCacheInvalidator` / `invalidateCaches`: registro best-effort.
 *
 * Solo se leen/escriben ficheros dentro de `tmpdir()`; nada toca el repo.
 */
import { suite, test, assert, eq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import { summaryWithEntries, readIfExists, countLines } from './fixtures.mjs';
import {
  mondayOf,
  entriesRegion,
  contentLines,
  sectionText,
  registerCacheInvalidator,
  invalidateCaches,
  ENTRIES_START,
  ENTRIES_END,
} from '../.opencode/scripts/memory-stats.mjs';

// ── Utilidades locales (no replican logica del modulo) ───────────────────────
// Dia de la semana UTC segun el calendario de la plataforma (0=domingo). Es un
// oraculo independiente de la aritmetica de deltas que implementa mondayOf.
function dowUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// Documento sintetico para sectionText: seccion numerada 1..3 + heading NO
// numerado al final (para fijar el comportamiento en la ultima seccion).
const DOC = [
  '# Doc',
  '',
  '## 1. Uno',
  'a',
  '## 2. Dos',
  'b',
  'c',
  '## 3. Tres',
  'd',
  '## Notas',
  'e',
].join('\n');

// ── mondayOf ────────────────────────────────────────────────────────────────
suite('memory-stats.mondayOf');

test('cada dia de la semana cae en su lunes (lunes a sabado)', () => {
  // Semana completa 2026-09-28 (lunes) .. 2026-10-03 (sabado).
  const esperado = {
    '2026-09-28': '2026-09-28', // lunes
    '2026-09-29': '2026-09-28', // martes
    '2026-09-30': '2026-09-28', // miercoles
    '2026-10-01': '2026-09-28', // jueves
    '2026-10-02': '2026-09-28', // viernes
    '2026-10-03': '2026-09-28', // sabado
  };
  for (const [fecha, lunes] of Object.entries(esperado)) {
    eq(mondayOf(fecha), lunes, `lunes de ${fecha}`);
  }
});

test('domingo pertenece a la semana anterior (rama day === 0)', () => {
  eq(mondayOf('2026-10-04'), '2026-09-28', 'domingo 2026-10-04 resta 6 dias');
  eq(mondayOf('2026-09-27'), '2026-09-21', 'domingo 2026-09-27 resta 6 dias');
  eq(mondayOf('2026-03-01'), '2026-02-23', 'domingo 2026-03-01 cruza el mes');
  eq(mondayOf('2027-01-03'), '2026-12-28', 'domingo 2027-01-03 cruza el ano');
});

test('un lunes devuelve el mismo lunes (idempotente)', () => {
  for (const fecha of ['2026-09-28', '2026-10-05', '2026-12-28', '2024-02-26', '2025-01-06']) {
    eq(mondayOf(fecha), fecha, `lunes estable: ${fecha}`);
  }
});

test('frontera de mes: el lunes del 1 de octubre no se retrocede a septiembre', () => {
  eq(mondayOf('2026-10-05'), '2026-10-05', 'lunes 2026-10-05');
  eq(mondayOf('2026-10-01'), '2026-09-28', 'jueves 2026-10-01');
  eq(mondayOf('2026-10-02'), '2026-09-28', 'viernes 2026-10-02');
  eq(mondayOf('2026-09-30'), '2026-09-28', 'miercoles 2026-09-30');
});

test('frontera de ano: 2026-12-31 y 2027-01-01 pertenecen a la semana del 2026-12-28', () => {
  eq(mondayOf('2026-12-31'), '2026-12-28', 'jueves 2026-12-31');
  eq(mondayOf('2027-01-01'), '2026-12-28', 'viernes 2027-01-01 (cruza el ano)');
  eq(mondayOf('2027-01-02'), '2026-12-28', 'sabado 2027-01-02');
  eq(mondayOf('2027-01-03'), '2026-12-28', 'domingo 2027-01-03');
  eq(mondayOf('2027-01-04'), '2027-01-04', 'lunes 2027-01-04 (semana nueva)');
  eq(mondayOf('2024-12-31'), '2024-12-30', 'martes 2024-12-31');
  eq(mondayOf('2025-01-01'), '2024-12-30', 'miercoles 2025-01-01');
});

test('ano bisiesto: 29 de febrero y el domingo siguiente', () => {
  eq(mondayOf('2024-02-26'), '2024-02-26', 'lunes 2024-02-26');
  eq(mondayOf('2024-02-29'), '2024-02-26', 'jueves bisiesto 2024-02-29');
  eq(mondayOf('2024-03-01'), '2024-02-26', 'viernes 2024-03-01');
  eq(mondayOf('2024-03-02'), '2024-02-26', 'sabado 2024-03-02');
  eq(mondayOf('2024-03-03'), '2024-02-26', 'domingo 2024-03-03');
});

test('barrido de 120 dias: siempre devuelve un lunes a 0..6 dias de distancia', () => {
  const inicio = Date.UTC(2026, 8, 21); // lunes 2026-09-21
  let fallos = 0;
  for (let i = 0; i < 120; i++) {
    const fecha = new Date(inicio + i * 86400000).toISOString().slice(0, 10); // cruza mes y ano
    const lunes = mondayOf(fecha);
    const offset = daysBetween(lunes, fecha);
    if (dowUTC(lunes) !== 1 || !Number.isInteger(offset) || offset < 0 || offset > 6) {
      fallos++;
      assert(false, `${fecha} -> ${lunes} (dow ${dowUTC(lunes)}, offset ${offset})`);
    }
  }
  eq(fallos, 0, 'todas las fechas del barrido caen en su lunes');
});

test('fecha inexistente del calendario lanza TypeError "fecha inexistente"', () => {
  for (const fecha of ['2026-02-30', '2026-04-31', '2025-02-29', '2026-13-01', '2026-00-10', '2026-01-32']) {
    const e = throws(() => mondayOf(fecha), `${fecha} debe lanzar`);
    eq(e.name, 'TypeError', `${fecha} lanza TypeError`);
    match(e.message, /fecha inexistente/, `${fecha} reporta fecha inexistente`);
    includes(e.message, fecha, `${fecha} aparece en el mensaje`);
  }
});

test('formato invalido lanza TypeError "fecha invalida"', () => {
  for (const fecha of ['2026-9-3', '20260230', '', '   ', 'abc', '2026/09/30', null, undefined, 0]) {
    const e = throws(() => mondayOf(fecha), `${JSON.stringify(fecha)} debe lanzar`);
    eq(e.name, 'TypeError', `${JSON.stringify(fecha)} lanza TypeError`);
    match(e.message, /fecha inválida/, `${JSON.stringify(fecha)} reporta formato invalido`);
    match(e.message, /YYYY-MM-DD o Date/, `${JSON.stringify(fecha)} documenta el formato esperado`);
  }
});

test('acepta Date y usa sus componentes UTC ignorando la hora', () => {
  eq(mondayOf(new Date(Date.UTC(2026, 8, 28, 0, 0, 0))), '2026-09-28', 'lunes a medianoche UTC');
  eq(mondayOf(new Date(Date.UTC(2026, 8, 28, 23, 59, 59))), '2026-09-28', 'lunes a las 23:59 UTC');
  eq(mondayOf(new Date(Date.UTC(2026, 8, 27, 23, 30))), '2026-09-21', 'domingo tardio sigue siendo la semana anterior');
});

test('Date invalido lanza TypeError "Date invalido"', () => {
  const e = throws(() => mondayOf(new Date('no-es-fecha')), 'Date invalido debe lanzar');
  eq(e.name, 'TypeError', 'lanza TypeError');
  match(e.message, /Date inválido/, 'mensaje especifico de Date invalido');
});

test('tolera espacios alrededor de la fecha', () => {
  eq(mondayOf(' 2026-09-30 '), '2026-09-28', 'espacios recortados');
  eq(mondayOf('\t2026-10-04\n'), '2026-09-28', 'tab y salto tambien');
});

// ── entriesRegion ───────────────────────────────────────────────────────────
suite('memory-stats.entriesRegion');

test('los marcadores exportados son los que el motor busca', () => {
  eq(ENTRIES_START, '<!-- ADVISOR:ENTRIES:START -->', 'marcador de inicio');
  eq(ENTRIES_END, '<!-- ADVISOR:ENTRIES:END -->', 'marcador de fin');
});

test('region marcada: texto entre marcadores, marked true y advisory null', () => {
  const texto = `cabecera\n${ENTRIES_START}\nA\nB\n${ENTRIES_END}\npie\n`;
  const r = entriesRegion(texto);
  eq(r.marked, true, 'marked');
  eq(r.advisory, null, 'advisory nulo cuando hay marcadores');
  eq(r.region, '\nA\nB\n', 'region exclusiva de marcadores');
  assert(!r.region.includes(ENTRIES_START), 'el marcador START queda fuera');
  assert(!r.region.includes(ENTRIES_END), 'el marcador END queda fuera');
});

test('sin marcadores: fallback a archivo completo con advisory', () => {
  const texto = 'a\n\nb\n';
  const r = entriesRegion(texto);
  eq(r.marked, false, 'marked false sin marcadores');
  eq(r.region, texto, 'la region es el archivo entero');
  includes(r.advisory, 'Faltan marcadores', 'el advisory avisa de los marcadores ausentes');
  includes(r.advisory, 'ADVISOR:ENTRIES', 'el advisory nombra los marcadores');
});

test('texto vacio, null y undefined: fallback sin lanzar', () => {
  for (const [nombre, valor] of [['vacio', ''], ['null', null], ['undefined', undefined]]) {
    const r = entriesRegion(valor);
    eq(r.region, '', `${nombre}: region vacia`);
    eq(r.marked, false, `${nombre}: marked false`);
    assert(r.advisory !== null && r.advisory !== undefined, `${nombre}: advisory presente`);
  }
});

test('START duplicado lanza', () => {
  const texto = `${ENTRIES_START}\nx\n${ENTRIES_START}\ny\n${ENTRIES_END}`;
  const e = throws(() => entriesRegion(texto), 'START duplicado debe lanzar');
  eq(e.constructor.name, 'Error', 'lanza Error simple');
  includes(e.message, 'duplicados', 'menciona duplicados');
  includes(e.message, 'start=2', 'reporta el conteo de START');
});

test('END duplicado lanza', () => {
  const texto = `${ENTRIES_START}\nx\n${ENTRIES_END}\ny\n${ENTRIES_END}`;
  const e = throws(() => entriesRegion(texto), 'END duplicado debe lanzar');
  includes(e.message, 'duplicados', 'menciona duplicados');
  includes(e.message, 'end=2', 'reporta el conteo de END');
});

test('END antes de START lanza por orden invalido', () => {
  const texto = `${ENTRIES_END}\nx\n${ENTRIES_START}`;
  const e = throws(() => entriesRegion(texto), 'orden invertido debe lanzar');
  includes(e.message, 'orden inválido', 'menciona orden invalido');
  includes(e.message, 'END antes de START', 'detalla que END precede a START');
});

test('marcador sin su par (start=1,end=0 o start=0,end=1) tambien lanza', () => {
  // Caracterizacion: el mensaje dice "duplicados" aunque en realidad falta uno;
  // el motor prefiere un unico mensaje para "no hay exactamente un par".
  const soloStart = throws(() => entriesRegion(`a\n${ENTRIES_START}\nx\n`), 'solo START debe lanzar');
  includes(soloStart.message, 'duplicados', 'solo START: mismo mensaje que duplicados');
  includes(soloStart.message, 'start=1, end=0', 'solo START: conteos reportados');
  const soloEnd = throws(() => entriesRegion(`a\n${ENTRIES_END}\nx\n`), 'solo END debe lanzar');
  includes(soloEnd.message, 'start=0, end=1', 'solo END: conteos reportados');
});

test('no es fence-aware: un marcador dentro de un bloque de codigo cuenta igual', () => {
  // memory-rotate.splitRegion SI es fence-aware; memory-stats.entriesRegion no lo
  // es, asi que un ejemplo con el marcador dentro de un fence duplica el START.
  const texto = `\`\`\`\n${ENTRIES_START}\n\`\`\`\n${ENTRIES_START}\nx\n${ENTRIES_END}`;
  const e = throws(() => entriesRegion(texto), 'marcador en fence debe lanzar');
  includes(e.message, 'start=2', 'cuenta tambien el marcador dentro del fence');
});

test('marcadores contiguos producen region y conteo vacios sin lanzar', () => {
  const texto = `${ENTRIES_START}${ENTRIES_END}`;
  const r = entriesRegion(texto);
  eq(r.marked, true, 'marked true aunque no haya contenido');
  eq(r.region, '', 'region vacia');
  eq(contentLines(texto).count, 0, 'conteo 0');
});

// ── contentLines ────────────────────────────────────────────────────────────
suite('memory-stats.contentLines');

test('cuenta solo lineas NO vacias entre los marcadores', () => {
  const texto = `cabecera\n${ENTRIES_START}\nA\n\n   \nB\n${ENTRIES_END}\npie\n`;
  eq(contentLines(texto), { count: 2, marked: true, advisory: null }, 'dos lineas con contenido');
});

test('no cuenta cabecera ni pie', () => {
  const dentro = `${ENTRIES_START}\nA\nB\nC\n${ENTRIES_END}`;
  const conPeriferia = `cabecera\n\n${dentro}\npie\n\n`;
  eq(contentLines(dentro).count, contentLines(conPeriferia).count, 'el perimetro no cuenta');
});

test('region de un SUMMARY real de fixture: escala linealmente con las entradas', () => {
  const dir = tmpdir('advisor-stats-fixture');
  try {
    const ruta1 = summaryWithEntries(dir, 1);
    const uno = contentLines(readIfExists(ruta1));
    const ruta3 = summaryWithEntries(dir, 3);
    const tres = contentLines(readIfExists(ruta3));
    eq(uno.marked, true, 'el SUMMARY de fixture trae los marcadores');
    eq(uno.advisory, null, 'sin advisory con marcadores');
    eq(tres.count, uno.count * 3, 'tres entradas = tres veces una entrada');
    assert(uno.count > 0, 'una entrada tiene lineas no vacias');
    // contentLines (dentro de marcadores, no vacias) es menor que wc -l del
    // archivo completo: son dos metricas distintas a proposito.
    assert(tres.count < countLines(ruta3), 'menos que el total de lineas del archivo');
  } finally {
    cleanup([dir]);
  }
});

test('region de un SUMMARY real de fixture: los headings quedan dentro y los marcadores fuera', () => {
  const dir = tmpdir('advisor-stats-fixture');
  try {
    const texto = readIfExists(summaryWithEntries(dir, 2));
    const r = entriesRegion(texto);
    assert(r.marked, 'el fixture esta marcado');
    includes(r.region, '## 2026-09-06 - Entrada fixture 1', 'primer heading de entrada dentro');
    includes(r.region, 'topic: test/fixture', 'campos de la entrada dentro');
    assert(!r.region.includes(ENTRIES_START), 'marcador START fuera de la region');
    assert(!r.region.includes(ENTRIES_END), 'marcador END fuera de la region');
    assert(!r.region.includes('Session Log'), 'la cabecera del archivo queda fuera');
  } finally {
    cleanup([dir]);
  }
});

test('sin marcadores cuenta el archivo entero y lo avisa', () => {
  const r = contentLines('uno\n\ndos\n');
  eq(r.count, 2, 'lineas no vacias del archivo completo');
  eq(r.marked, false, 'marked false');
  includes(r.advisory, 'Faltan marcadores', 'advisory de fallback');
});

test('CRLF cuenta igual que LF', () => {
  const lf = `${ENTRIES_START}\n\nA\n\nB\n${ENTRIES_END}\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  eq(contentLines(crlf).count, contentLines(lf).count, 'mismo conteo con CRLF');
  eq(contentLines(crlf).marked, true, 'marcadores detectados con CRLF');
});

test('region con solo lineas en blanco cuenta 0 sin lanzar', () => {
  eq(contentLines(`${ENTRIES_START}\n\n   \n\t\n${ENTRIES_END}`).count, 0, 'conteo 0');
});

test('delega en entriesRegion: tambien lanza con marcadores duplicados', () => {
  const e = throws(() => contentLines(`${ENTRIES_START}\n${ENTRIES_START}\n${ENTRIES_END}`), 'debe delegar el throw');
  includes(e.message, 'duplicados', 'mismo mensaje que entriesRegion');
  const e2 = throws(() => contentLines(`${ENTRIES_END}\n${ENTRIES_START}`), 'orden invalido tambien');
  includes(e2.message, 'orden inválido', 'mismo mensaje de orden invalido');
});

test('texto vacio: conteo 0, sin marcadores, con advisory', () => {
  const r = contentLines('');
  eq(r.count, 0, 'conteo 0');
  eq(r.marked, false, 'marked false');
  assert(r.advisory !== null, 'advisory presente');
  eq(contentLines(null).count, 0, 'null tambien cuenta 0');
});

// ── sectionText ─────────────────────────────────────────────────────────────
suite('memory-stats.sectionText');

test('seccion intermedia: del heading al siguiente heading numerado', () => {
  eq(sectionText(DOC, 1), '## 1. Uno\na\n', 'seccion 1');
  eq(sectionText(DOC, 2), '## 2. Dos\nb\nc\n', 'seccion 2');
});

test('seccion ausente devuelve cadena vacia', () => {
  eq(sectionText(DOC, 9), '', 'seccion inexistente');
  eq(sectionText(DOC, 0), '', 'seccion 0 no existe');
  eq(sectionText('sin secciones', 1), '', 'documento sin secciones');
  eq(sectionText(null, 1), '', 'texto null');
  eq(sectionText(undefined, 2), '', 'texto undefined');
});

test('la ultima seccion numerada se lleva hasta el final del archivo', () => {
  eq(sectionText('## 1. Uno\nc\n## 2. Dos\nfin\n', 2), '## 2. Dos\nfin\n', 'seccion ultima hasta EOF');
  eq(sectionText('## 1. Uno\nc\n## 2. Dos\n', 1), '## 1. Uno\nc\n', 'todo antes de la ultima');
});

test('caracterizacion: un heading NO numerado tras la ultima seccion no la corta', () => {
  // El corte solo reconoce `## <num>.`; `## Notas` se queda dentro de la 3.
  eq(sectionText(DOC, 3), '## 3. Tres\nd\n## Notas\ne', 'la seccion 3 absorbe el heading sin numero');
});

test('tolerante a espaciado entre ## y el numero (espacios y tabulador)', () => {
  const doc = '##   2. Espaciado\ncuerpo\n##\t3. Tab\ncuerpo3\n';
  eq(sectionText(doc, 2), '##   2. Espaciado\ncuerpo\n', 'varios espacios');
  eq(sectionText(doc, 3), '##\t3. Tab\ncuerpo3\n', 'tabulador');
});

test('exige el punto tras el numero', () => {
  eq(sectionText('## 2 Dos\ncuerpo\n', 2), '', 'sin punto no es seccion');
  eq(sectionText('## 2\ncuerpo\n', 2), '', 'solo el numero tampoco');
});

test('no confunde prefijos numericos', () => {
  eq(sectionText('## 20. Veinte\ncuerpo\n## 2. Dos\nx\n', 2), '## 2. Dos\nx\n', '## 20. no cuenta como 2');
  eq(sectionText('## 12. Doce\n## 1. Uno\n', 1), '## 1. Uno\n', '## 12. no corta la seccion 1');
});

test('solo acepta el heading al principio de linea', () => {
  eq(sectionText('texto ## 2. Dos\ncuerpo\n', 2), '', 'no ancla dentro de la linea');
  eq(sectionText('# 2. Dos\ncuerpo\n', 2), '', 'un solo # no es seccion');
});

test('con secciones duplicadas gana la primera coincidencia', () => {
  eq(sectionText('## 2. A\nuno\n## 2. B\ndos\n', 2), '## 2. A\nuno\n', 'primera coincidencia');
});

test('acepta el numero como texto', () => {
  eq(sectionText('## 2. Dos\ncuerpo\n', '2'), '## 2. Dos\ncuerpo\n', 'string equivalente al numero');
});

// ── Invalidadores de cache ───────────────────────────────────────────────────
suite('memory-stats cachés');

test('invalidateCaches ejecuta los invalidadores registrados', () => {
  const llamadas = [];
  const fuera1 = registerCacheInvalidator(() => llamadas.push('a'));
  const fuera2 = registerCacheInvalidator(() => llamadas.push('b'));
  try {
    invalidateCaches();
    eq(llamadas, ['a', 'b'], 'ambos invalidadores en orden de registro');
  } finally {
    fuera1();
    fuera2();
  }
});

test('un invalidador que lanza no impide a los demas (best-effort)', () => {
  const llamadas = [];
  const fuera1 = registerCacheInvalidator(() => { throw new Error('boom'); });
  const fuera2 = registerCacheInvalidator(() => llamadas.push('tras el boom'));
  try {
    invalidateCaches();
    eq(llamadas, ['tras el boom'], 'el que viene despues si se ejecuta');
  } finally {
    fuera1();
    fuera2();
  }
});

test('el registro es un Set: la misma funcion se invoca una sola vez', () => {
  let n = 0;
  const fn = () => { n++; };
  const fuera1 = registerCacheInvalidator(fn);
  const fuera2 = registerCacheInvalidator(fn);
  try {
    invalidateCaches();
    eq(n, 1, 'una sola invocacion para la misma funcion');
  } finally {
    fuera1();
    fuera2();
  }
  n = 0;
  invalidateCaches();
  eq(n, 0, 'desregistrada, ya no se invoca');
});

test('la funcion devuelta da de baja y es idempotente', () => {
  let n = 0;
  const fuera = registerCacheInvalidator(() => { n++; });
  fuera();
  fuera();
  invalidateCaches();
  eq(n, 0, 'dos bajas no rompen nada');
});

test('una entrada que no es funcion no se registra y devuelve un no-op', () => {
  for (const valor of ['x', null, undefined, 42, {}]) {
    const baja = registerCacheInvalidator(valor);
    eq(typeof baja, 'function', `no-op devuelto para ${JSON.stringify(valor)}`);
    eq(baja(), undefined, 'el no-op no hace nada ni devuelve nada');
    invalidateCaches();
  }
});

await runAll();
