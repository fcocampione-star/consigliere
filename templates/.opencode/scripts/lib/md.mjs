/**
 * Consigliere 2.0 (Advisor Harness) — lib/md.mjs
 * Biblioteca canónica de parseo de Markdown para los scripts del harness.
 *
 * Consolida las copias dispersas de: extracción de campos de metadatos
 * (`topic:`, `review_after:`), detección de bloques de código, extracción de
 * secciones numeradas, enumeración del CHANGELOG semanal y la fecha UTC de hoy.
 * No depende de ningún script del harness (importar memory-* crearía ciclo):
 * solo `node:*`.
 *
 * Reglas del módulo:
 *  - ESM, Node >= 20.11, cero dependencias.
 *  - Determinista: sin marcas de tiempo ni azar en lo devuelto.
 *  - Toda función es TOLERANTE por defecto ante lo que falta (devuelve `null`,
 *    `''` o `[]`); donde lanza, el mensaje nombra la ruta.
 *  - No presupone EOL: los helpers toleran CRLF/CR aunque lo normal (y
 *    recomendado) es leer con `readText` de lib/core.mjs.
 */

import { readdirSync } from 'node:fs';

// ── Metadatos ───────────────────────────────────────────────────────────────

// Charset de valor "de token": cubre a la vez `family/kebab` (topic) y
// `2026-12-03` (review_after) y se detiene ante el cierre de la línea, de modo
// que `… [topic: a/b] review_after: X` NO se traga el resto de la línea.
const SAFE_VALUE = 'A-Za-z0-9._\\/-';

/**
 * `field(text, name)` → valor del metadato `name:` en la primera coincidencia,
 * o `null` si no existe o está vacío. Garantiza: sin BOM ni CR residuales,
 * sin distinguir mayúsculas, la línea entera NO se cuela en el valor, y
 * `name` solo casa como palabra completa (`field(t,'after')` no ve `review_after`).
 */
export function field(text, name, { pattern } = {}) {
  const key = String(name ?? '').trim();
  if (!key) return null;
  const re = new RegExp(`\\b${key}[ \\t]*:[ \\t]*(${pattern || `[${SAFE_VALUE}]+`})`, 'i');
  const m = re.exec(String(text ?? ''));
  if (!m) return null;
  const value = m[1].trim();
  return value === '' ? null : value;
}

// ── Bloques de código (CommonMark) ──────────────────────────────────────────

// Apertura: hasta 3 caracteres de indentación + 3+ backticks o 3+ tildes.
// Grupo 1 = la tirada del marcador, grupo 2 = el info string.
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

/**
 * `fenceSpans(text)` → lista de rangos `[inicio, fin)` cubiertos por bloques de
 * código delimitados, en orden de aparición.
 *
 * Garantiza semántica CommonMark: fences de backtick Y de tilde, hasta 3 de
 * indentación, cierre con el MISMO carácter y longitud >= a la de apertura, sin
 * texto tras el cierre, y el info string de un fence de backtick no puede
 * contener backticks. Un fence sin cerrar llega hasta el final del texto (un
 * archivo truncado no debe desalinear los offsets de los demás).
 */
export function fenceSpans(text) {
  const src = String(text ?? '');
  const spans = [];
  let fence = null; // { char, len, start }
  let offset = 0;
  for (const line of src.split('\n')) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length; // el `\n` queda FUERA del rango
    offset = lineEnd + 1;
    const body = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (fence) {
      const close = new RegExp(`^[ \\t]{0,3}${fence.char}{${fence.len},}[ \\t]*$`);
      if (close.test(body)) { spans.push([fence.start, lineEnd]); fence = null; }
      continue;
    }
    const open = FENCE_OPEN_RE.exec(body);
    if (!open) continue;
    if (open[1][0] === '`' && open[2].includes('`')) continue; // info con backtick: abre código inline
    fence = { char: open[1][0], len: open[1].length, start: lineStart };
  }
  if (fence) spans.push([fence.start, src.length]);
  return spans;
}

// ── Secciones numeradas ─────────────────────────────────────────────────────

/**
 * `sectionText(text, n)` → cuerpo de la sección `## <n>.` (heading incluido)
 * hasta el siguiente `## <m>.` o el final del documento; `''` si no existe.
 * Garantiza tolerancia a espaciado variable entre `##` y el número, de modo que
 * no depende de una numeración literal rígida ni de `split('## 2.')`.
 */
export function sectionText(text, n) {
  const src = String(text ?? '');
  const re = new RegExp(`^##[ \\t]+${n}\\.`, 'm');
  const m = re.exec(src);
  if (!m) return '';
  const tail = src.slice(m.index + 1);
  const next = /^##[ \t]+\d+\./m.exec(tail);
  return next ? src.slice(m.index, m.index + 1 + next.index) : src.slice(m.index);
}

// ── CHANGELOG semanal ───────────────────────────────────────────────────────

/**
 * `listChangelog(dir)` → nombres de los `.md` de `dir` ordenados ascendentemente,
 * o `[]` si el directorio no existe. Devuelve SOLO archivos (ignora subcarpetas) y
 * el nombre relativo a `dir`, que es lo que consumen `join` y el `source` de las
 * entradas. Incluye `DECISIONS-ARCHIVE.md` si existe: es memoria viva del mismo
 * directorio y `/review` la consulta.
 */
export function listChangelog(dir) {
  if (!dir) return [];
  let entries;
  try { entries = readdirSync(String(dir), { withFileTypes: true }); }
  catch { return []; } // directorio ausente: sin semanas, sin error
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

// ── Fecha ───────────────────────────────────────────────────────────────────

/**
 * `todayUTC()` → `YYYY-MM-DD` del día UTC de hoy (acepta un `Date` para poder
 * fijar el instante en tests). Garantiza fecha en UTC, no local: los días del
 * harness (nombre del archivo semanal, `review_after` vencido) se cuentan igual
 * en todos los husos, y una entrada se nombra por el lunes de SU fecha UTC.
 * El año se imprime tal cual (como `fmtUTC` de memory-stats), sin rellenar.
 */
export function todayUTC(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new TypeError('todayUTC: instante inválido');
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}
