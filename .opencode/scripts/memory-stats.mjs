#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-stats.mjs
 * Utilidades puras para rotación de memoria (F1b): fecha de lunes en UTC y
 * conteo de líneas de entradas delimitadas por marcadores. Sin dependencias.
 *
 * - `mondayOf(dateStr)`: 'YYYY-MM-DD' del lunes de la semana, calculado en UTC.
 *   Convención ISO-ish (semana empieza en lunes): getUTCDay() 1..6 resta (day-1)
 *   días; domingo (0) se mapea a la semana anterior, restando 6 días.
 * - `entriesRegion(summaryText)`: devuelve `{ region, marked, advisory }` — la
 *   región de entradas (única fuente para "dónde empiezan/acaban"). Sin
 *   marcadores → fallback whole-file con advisory; parciales/duplicados/orden
 *   inválido → throw. No lanza si simplemente faltan los marcadores.
 * - `contentLines(summaryText)`: cuenta líneas no vacías ESTRICTAMENTE entre
 *   `ENTRIES_START` y `ENTRIES_END` (exclusivas). Delega en `entriesRegion`.
 *
 * Lo que ya no vive aquí: `sectionText` y la fecha UTC (`todayUTC`) son de
 * lib/md.mjs, la biblioteca canónica; este módulo los reexporta para no romper
 * a quien ya los importa desde aquí (doctor.mjs, la suite de memory-stats).
 *
 * Uso:
 *   node .opencode/scripts/memory-stats.mjs monday <YYYY-MM-DD>
 *   node .opencode/scripts/memory-stats.mjs lines [ruta/SUMMARY.md]
 */
import { join } from 'node:path';
import { exitUsage, isMain, readText } from './lib/core.mjs';
import { todayUTC } from './lib/md.mjs';

export const ENTRIES_START = '<!-- ADVISOR:ENTRIES:START -->';
export const ENTRIES_END = '<!-- ADVISOR:ENTRIES:END -->';

export function mondayOf(input) {
  let d;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new TypeError('mondayOf: Date inválido');
    d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim());
    if (!m) throw new TypeError(`mondayOf: fecha inválida "${input}" (esperado YYYY-MM-DD o Date)`);
    d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]))
      throw new TypeError(`mondayOf: fecha inexistente "${input}"`);
  }
  const day = d.getUTCDay(); // 0=domingo .. 6=sábado
  const delta = day === 0 ? 6 : day - 1; // domingo → semana anterior
  d.setUTCDate(d.getUTCDate() - delta);
  return todayUTC(d);
}

function allIndexes(hay, needle) {
  const out = [];
  let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + needle.length); }
  return out;
}

function countNonEmpty(text) {
  return text.split('\n').filter((l) => l.trim() !== '').length;
}

// Única fuente de la región de entradas (reutilizada por contentLines,
// memory-rotate.splitRegion, memory-index.parseEntries y memory-sync.export).
// No lanza si faltan marcadores (fallback whole-file + advisory); sí lanza si
// están parciales, duplicados o en orden inválido (dato corrupto).
export function entriesRegion(summaryText) {
  const text = String(summaryText ?? '');
  const starts = allIndexes(text, ENTRIES_START);
  const ends = allIndexes(text, ENTRIES_END);
  if (starts.length === 0 && ends.length === 0) {
    return {
      region: text,
      marked: false,
      advisory: 'Faltan marcadores ADVISOR:ENTRIES (START/END); se usó el archivo completo.',
    };
  }
  if (starts.length !== 1 || ends.length !== 1)
    throw new Error(`Marcadores ADVISOR:ENTRIES duplicados (start=${starts.length}, end=${ends.length}); se esperaba exactamente un par.`);
  if (starts[0] > ends[0])
    throw new Error('Marcadores ADVISOR:ENTRIES en orden inválido (END antes de START).');
  return { region: text.slice(starts[0] + ENTRIES_START.length, ends[0]), marked: true, advisory: null };
}

export function contentLines(summaryText) {
  const { region, marked, advisory } = entriesRegion(summaryText);
  return { count: countNonEmpty(region), marked, advisory };
}

// Cuerpo de la sección `## <n>.` hasta el siguiente `## <m>.` (o EOF), tolerante a
// espaciado. La implementación es la de lib/md.mjs (una sola en el harness); aquí
// solo se reexporta para conservar la ruta de import histórica.
export { sectionText } from './lib/md.mjs';

// Registro neutro de invalidadores de caché in-process (F4/MINOR).
// memory-index.mjs YA importa memory-rotate.mjs; si memory-rotate importara
// memory-index se crearía un ciclo. Para evitarlo, la invalidación se expone
// desde este módulo (importado por ambos): los productores de caché registran
// su función y los que escriben memoria llaman `invalidateCaches()`.
const _cacheInvalidators = new Set();

export function registerCacheInvalidator(fn) {
  if (typeof fn !== 'function') return () => {};
  _cacheInvalidators.add(fn);
  return () => _cacheInvalidators.delete(fn);
}

// Ejecuta todos los invalidadores registrados. Best-effort: una caché no debe
// romper una escritura de memoria ya completada.
export function invalidateCaches() {
  for (const fn of _cacheInvalidators) {
    try { fn(); } catch { /* best-effort */ }
  }
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'monday': {
      const arg = process.argv[3];
      if (!arg) exitUsage('Uso: memory-stats.mjs monday <YYYY-MM-DD>');
      console.log(mondayOf(arg));
      break;
    }
    case 'lines': {
      // Raíz del repo = dos niveles por encima de scripts/; NO es
      // core.REPO_ROOT, que desde lib/ resuelve en `.opencode/` (un nivel más).
      const p = process.argv[3] || join(import.meta.dirname, '..', '..', 'SUMMARY.md');
      const res = contentLines(readText(p));
      console.log(JSON.stringify({ file: p, ...res }, null, 2));
      break;
    }
    default: {
      // El uso sin comando sigue saliendo por STDOUT como siempre: aquí
      // core.exitUsage escribiría a stderr y cambiaría un stream observable.
      console.log(`Uso:
  node .opencode/scripts/memory-stats.mjs monday <YYYY-MM-DD>
  node .opencode/scripts/memory-stats.mjs lines [ruta/SUMMARY.md]`);
      process.exit(1);
    }
  }
}

if (isMain(import.meta.url, process.argv[1])) main();
