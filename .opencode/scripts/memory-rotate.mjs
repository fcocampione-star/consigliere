#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-rotate.mjs
 * Motor de rotación de memoria (F1b): mueve entradas antiguas de SUMMARY.md a
 * CHANGELOG/<lunes-de-cada-entrada>.md y actualiza el índice §4 de
 * PROJECT_STATE.md. Sin flock/sed/grep/perl/date externos: solo Node ESM
 * cross-platform (node:fs / node:path / node:crypto).
 *
 * Contrato (fijo):
 *  - Región: opera SOLO dentro de la región delimitada por los marcadores
 *    `<!-- ADVISOR:ENTRIES:START -->` / `<!-- ADVISOR:ENTRIES:END -->`.
 *    Sin marcadores → fallback whole-file + advisory (consistente con
 *    `contentLines` de memory-stats.mjs). Nunca toca lo posterior a END.
 *  - Parseo de entradas: dentro de la región, cada entrada empieza en un
 *    heading `## YYYY-MM-DD <sep> Título` con `<sep>` ∈ `[— - : |]`
 *    (regex `^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*([—\-:|])[ \t]*(.+?)[ \t]*$`).
 *    Parser FENCE-AWARE: se rastrea el estado de bloques de código (``` / ~~~,
 *    con indentación opcional y cierre por mismo char de longitud >= apertura)
 *    y solo se aceptan headings FUERA de fences; un `## YYYY-MM-DD` dentro de
 *    un fence no es entrada (evita partir la entrada contenedora).
 *    Orden esperado: la más nueva ARRIBA (descendente). Si se detecta orden
 *    ascendente se emite warning y NUNCA se archiva la entrada más nueva.
 *  - Trigger de rotación: (a) lunes(entrada más antigua) < lunes(hoy), o
 *    (b) `contentLines(SUMMARY) > 150`. Drena en batch hasta <=150 con cap
 *    `--max N` (default 20) por ejecución.
 *  - Protección: NUNCA archiva la última entrada ni la más nueva (SUMMARY no
 *    queda vacío). En FALLBACK sin marcadores además NUNCA archiva el último
 *    bloque de entrada (puede contener/conducir a un pie/índice no reconocido):
 *    emite advisory recomendando `migrate-markers` y rota solo entradas
 *    anteriores. Las anclas de pie (EPILOGUE_RE) se conservan como señal
 *    adicional, pero la preservación del pie NO depende de reconocerlo.
 *    Si la única entrada restante supera por sí sola el umbral → warning.
 *  - Dedup: identificador robusto `fecha + título normalizado` (ver
 *    `headingToId`), comparado contra el CHANGELOG con la MISMA normalización
 *    que el dedup intra-run (`seen`): case-insensitive y separador-agnóstico
 *    (`— - : | ,`), en vez del prefijo de ~80 chars que daba falsos positivos.
 *  - Separación: al anexar 2+ entradas al mismo CHANGELOG se normaliza a una
 *    única línea en blanco entre entradas.
 *  - Atomicidad: escrituras con temp+rename en el mismo directorio.
 *  - Cross-platform EOL: la lectura normaliza CRLF/CR a LF antes de parsear
 *    (los regex anclan con `$`, que no casa ante `\r`); evita perder entradas
 *    en checkouts Windows con core.autocrlf=true.
 *  - §4: actualiza la tabla con una fila `| <lunes> | <lunes>.md | ... |`
 *    insertada tras la fila separadora (manipulación de strings, sin sed -i);
 *    idempotente; si §4 no aparece, avisa y sigue.
 *  - Lock: adquiere memory-lock al inicio y SIEMPRE lo libera en finally.
 *
 * Uso:
 *   node .opencode/scripts/memory-rotate.mjs rotate [--dry-run] [--max N] [--json] [--root <dir>]
 *   node .opencode/scripts/memory-rotate.mjs migrate-markers [--dry-run] [--json] [--root <dir>]
 *
 * Nota `--root`: es TEST-ONLY (default = raíz del repo inferida del script,
 * `../..`), para correr contra fixtures sandbox. Importante: el lock canónico
 * (memory-lock.mjs) vive SIEMPRE en la raíz del repo del propio script (su ROOT
 * es fijo), NO en `--root`; `--root` solo redirige los archivos de memoria
 * (SUMMARY.md / PROJECT_STATE.md / CHANGELOG/), no el lock.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mondayOf, contentLines, ENTRIES_START, ENTRIES_END } from './memory-stats.mjs';
import { acquireLock, releaseLock } from './memory-lock.mjs';

const DEFAULT_ROOT = resolve(join(import.meta.dirname, '..', '..'));
const CHANGELOG_LINE_LIMIT = 150;
const DEFAULT_MAX = 20;

// Heading de entrada tolerante: separador em dash, guion, dos puntos o pipe.
// Se aplica LÍNEA A LÍNEA y solo fuera de fences (ver scanEntryHeads).
// NOTA: el parseo/rotación NO acepta `,` como separador (mantiene el historial
// de qué líneas son entradas); la normalización de id SÍ lo acepta (ver
// HEAD_ID_RE), para que `## F, T` y `## F — T` casen en el dedup.
const HEAD_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*([—\-:|])[ \t]*(.+?)[ \t]*$/;
// Apertura de fence CommonMark básico: hasta 3 espacios de indentación + ```/~~~
const FENCE_OPEN_RE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;
// Anclas de pie de SUMMARY (señal adicional; no imprescindible en fallback).
const EPILOGUE_RE = /^(?:>\s*Cuando registres|>\s*Topic upsert|##\s+Índice de historial)/m;

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Normaliza finales de línea a LF: los regex de heading/fence anclan con `$`,
// que NO casa antes de un `\r`; sin esto un SUMMARY.md en CRLF (Windows,
// core.autocrlf=true) dejaría de parsearse. Cross-platform sin debate.
function normalizeEol(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n');
}

// Recorre la región línea a línea manteniendo estado de fence. Un heading
// `## <fecha>` solo cuenta si está FUERA de un bloque ``` / ~~~. Un fence se
// cierra con el mismo char y longitud >= a la apertura (CommonMark básico),
// con indentación opcional y sin texto tras el cierre.
function scanEntryHeads(region) {
  const heads = [];
  let fence = null; // { char, len }
  let offset = 0;
  for (const line of region.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line; // tolera CRLF
    if (fence) {
      const closeRe = new RegExp(`^[ \\t]{0,3}[${fence.char}]{${fence.len},}[ \\t]*$`);
      if (closeRe.test(clean)) fence = null;
      continue;
    }
    const open = FENCE_OPEN_RE.exec(clean);
    if (open) { fence = { char: open[2][0], len: open[2].length }; continue; }
    const h = HEAD_RE.exec(clean);
    if (h) heads.push({ idx: lineStart, date: h[1], title: h[3].trim() });
  }
  return heads;
}

function changelogHeader(monday) {
  return `# Changelog ${monday}\n\n> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: \`git log\`.\n\n`;
}

// Escritura atómica temp+rename en el mismo directorio.
function writeAtomic(file, content) {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw e;
  }
}

// Divide el texto en prefix (incluye START), región interna y suffix (desde END).
function splitRegion(text) {
  const s = text.indexOf(ENTRIES_START);
  const e = text.indexOf(ENTRIES_END);
  if (s === -1 && e === -1) {
    return { prefix: '', region: text, suffix: '', marked: false, advisory: 'Faltan marcadores ADVISOR:ENTRIES (START/END); se usó fallback whole-file.' };
  }
  const s2 = s === -1 ? -1 : text.indexOf(ENTRIES_START, s + 1);
  const e2 = e === -1 ? -1 : text.indexOf(ENTRIES_END, e + 1);
  if (s === -1 || e === -1 || s2 !== -1 || e2 !== -1 || s > e) {
    throw new Error('Marcadores ADVISOR:ENTRIES parciales, duplicados o en orden inválido.');
  }
  return { prefix: text.slice(0, s + ENTRIES_START.length), region: text.slice(s + ENTRIES_START.length, e), suffix: text.slice(e), marked: true, advisory: null };
}

function ensureTrailingBlank(p) {
  if (p === '') return p;
  if (p.endsWith('\n\n')) return p;
  return p.endsWith('\n') ? p + '\n' : p + '\n\n';
}

// Parsea la región en { preamble, entries[], epilogue }.
// entries[i].text es el bloque completo (trim de cola). epilogue = cola tras la
// última entrada (pie/índice en fallback; vacío en región marcada).
function parseRegion(region) {
  const heads = scanEntryHeads(region);
  if (!heads.length) return { preamble: region, entries: [], epilogue: '' };
  const preamble = region.slice(0, heads[0].idx);
  const lastHead = heads[heads.length - 1];
  let entryEnd = region.length;
  const tail = region.slice(lastHead.idx);
  const rel = tail.search(EPILOGUE_RE);
  if (rel > 0) entryEnd = lastHead.idx + rel;
  const entries = heads.map((h, i) => {
    const start = h.idx;
    const end = i + 1 < heads.length ? heads[i + 1].idx : entryEnd;
    return { date: h.date, title: h.title, text: region.slice(start, end).replace(/\s+$/, '') };
  });
  return { preamble, entries, epilogue: entryEnd < region.length ? region.slice(entryEnd) : '' };
}

// Índice de la entrada más nueva (max fecha). Empates → la primera.
function newestIndex(entries) {
  let best = 0;
  for (let i = 1; i < entries.length; i++) if (entries[i].date > entries[best].date) best = i;
  return best;
}

// Índice de la entrada más antigua NO protegida (min fecha); -1 si no hay.
function oldestCandidate(entries, protectedIdx) {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    if (protectedIdx.has(i)) continue;
    if (best === -1 || entries[i].date < entries[best].date) best = i;
  }
  return best;
}

// Anexa una entrada al CHANGELOG con exactamente UNA línea en blanco de
// separación (normaliza colas previas para no acumular dobles blancos).
function appendToChangelog(existing, monday, entryText) {
  const body = String(entryText).replace(/^\s+|\s+$/g, '');
  if (!existing) return changelogHeader(monday) + body + '\n';
  const base = existing.replace(/\n+$/, '');
  return `${base}\n\n${body}\n`;
}

// --- Contrato de id de entrada (única fuente de verdad para dedup) ----------
//   id = `<fecha>--<título normalizado>`
//     · fecha: YYYY-MM-DD del heading.
//     · título normalizado: lowercase + espacios colapsados (ver `normalize`),
//       y separador-agnóstico: cualquiera de `— - : | ,` se ignora, de modo que
//       `## 2026-09-11, Comma` y `## 2026-09-11 — Comma` producen el MISMO id.
//   Dos entradas con la misma fecha y el mismo título normalizado se consideran
//   la misma entrada (limitación conocida: no se soportan colisiones legítimas
//   de mismo título el mismo día). Esta misma normalización se usa tanto en el
//   dedup intra-run (`seen` en memory-sync) como en el cross-run (`hasEntry`).
const ID_SEP = '[—\\-:|,]';
const HEAD_ID_RE = new RegExp(`^##[ \\t]+(\\d{4}-\\d{2}-\\d{2})[ \\t]*${ID_SEP}[ \\t]*(.+?)[ \\t]*$`, 'm');

// Deriva el id canónico de una línea de heading `## <fecha> <sep> <título>`;
// null si la línea no es un heading de entrada. Independiente de mayúsculas y
// del separador usado (incluye la coma).
function headingToId(line) {
  const m = HEAD_ID_RE.exec(String(line ?? '').trim());
  return m ? `${m[1]}--${normalize(m[2])}` : null;
}

// Descompone un bloque de entrada en { date, title, id } a partir de su heading
// (o null si no hay heading reconocible). Reutiliza la misma normalización.
function parseEntryHeading(body) {
  const m = HEAD_ID_RE.exec(String(body ?? '').trim());
  return m ? { date: m[1], title: m[2].trim(), id: `${m[1]}--${normalize(m[2])}` } : null;
}

// Dedup por identificador robusto `fecha + título normalizado`: busca en el
// CHANGELOG un heading con el MISMO id canónico (case-insensitive y
// separador-agnóstico, `— - : | ,`). Evita el falso positivo del prefijo de
// ~80 chars y la inconsistencia de comparar el título case-sensitive.
function hasEntry(existing, { date, title }) {
  if (!title) return false;
  const want = `${date}--${normalize(title)}`;
  for (const line of normalizeEol(existing).split('\n')) {
    if (headingToId(line) === want) return true;
  }
  return false;
}

function renderRegion(preamble, entries, epilogue) {
  const pre = ensureTrailingBlank(preamble);
  const body = entries.map((e) => e.text).join('\n\n');
  if (!entries.length) return pre + epilogue;
  return `${pre}${body}\n\n${epilogue}`;
}

// Inserta filas `| <lunes> | <lunes>.md | rotación automática |` tras la fila
// separadora de la tabla de §4. Idempotente; quita el placeholder inicial.
function updateStateIndex(stateText, mondays) {
  const secIdx = stateText.indexOf('## 4.');
  if (secIdx === -1) return { text: stateText, updated: [], missing: true };
  const rest = stateText.slice(secIdx);
  const nextSec = rest.indexOf('\n## ', 1);
  const secEnd = nextSec === -1 ? stateText.length : secIdx + nextSec;
  const section = stateText.slice(secIdx, secEnd);
  const toAdd = mondays.filter((m) => !new RegExp(`\\|\\s*${m}\\s*\\|`).test(section));
  if (!toAdd.length) return { text: stateText, updated: [] };
  const lines = section.split('\n');
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|[\s\-:|]+\|$/.test(lines[i].trim())) { sepIdx = i; break; }
  }
  if (sepIdx === -1) return { text: stateText, updated: [], tableMissing: true };
  const cleaned = lines.filter((l, i) => i <= sepIdx || !/^\|\s*\(aún sin historial\)/.test(l));
  const rows = toAdd.map((m) => `| ${m} | ${m}.md | rotación automática |`);
  const out = [...cleaned.slice(0, sepIdx + 1), ...rows, ...cleaned.slice(sepIdx + 1)];
  return { text: stateText.slice(0, secIdx) + out.join('\n') + stateText.slice(secEnd), updated: toAdd };
}

export function rotate({ root = DEFAULT_ROOT, dryRun = false, max = DEFAULT_MAX } = {}) {
  const summaryPath = join(root, 'SUMMARY.md');
  const statePath = join(root, 'PROJECT_STATE.md');
  const changelogDir = join(root, 'CHANGELOG');
  const result = {
    command: 'rotate', dryRun, root,
    moved: [], changelog: [], stateUpdated: [], warnings: [], advisory: null,
    summaryLinesBefore: null, summaryLinesAfter: null, summaryWritten: false,
  };
  if (!existsSync(summaryPath)) throw new Error(`No existe SUMMARY.md en ${root}`);
  const beforeText = normalizeEol(readFileSync(summaryPath, 'utf8'));
  const split = splitRegion(beforeText);
  result.advisory = split.advisory;
  if (split.advisory) result.warnings.push(split.advisory);
  result.summaryLinesBefore = contentLines(beforeText).count;
  let region = split.region;
  const thisMonday = mondayOf(new Date());
  let moved = 0;

  const initialEntries = parseRegion(region).entries;
  if (initialEntries.length > 1 && initialEntries[0].date < initialEntries[initialEntries.length - 1].date) {
    result.warnings.push('Orden ascendente detectado (se espera descendente: más nueva arriba); se protege la entrada más nueva y no se archiva.');
  }

  while (true) {
    const parsed = parseRegion(region);
    const entries = parsed.entries;
    const count = contentLines(split.prefix + region + split.suffix).count;
    if (entries.length <= 1) {
      if (entries.length === 1) {
        if (count > CHANGELOG_LINE_LIMIT)
          result.warnings.push(`Protección: la única entrada supera ${CHANGELOG_LINE_LIMIT} líneas (${count}); no se archiva (no dejar SUMMARY vacío).`);
        else if (mondayOf(entries[0].date) < thisMonday)
          result.warnings.push(`Protección: la única entrada es de la semana ${mondayOf(entries[0].date)} (< ${thisMonday}); no se archiva.`);
      }
      break;
    }
    // Protegidos: la entrada más nueva siempre; en fallback, además el último
    // bloque posicional (puede contener/conducir a un pie no reconocido).
    const protectedIdx = new Set([newestIndex(entries)]);
    if (!split.marked) protectedIdx.add(entries.length - 1);
    const candIdx = oldestCandidate(entries, protectedIdx);
    if (candIdx === -1) break;
    const oldest = entries[candIdx];
    const oldestMonday = mondayOf(oldest.date);
    const oldWeek = oldestMonday < thisMonday;
    const over = count > CHANGELOG_LINE_LIMIT;
    if (!oldWeek && !over) break;
    if (moved >= max) {
      result.warnings.push(`Cap --max (${max}) alcanzado; quedan entradas por rotar (${over ? `contentLines=${count}` : `semana antigua=${oldestMonday}`}).`);
      break;
    }
    const destFile = join(changelogDir, `${oldestMonday}.md`);
    const existing = existsSync(destFile) ? readFileSync(destFile, 'utf8') : '';
    const dup = hasEntry(existing, oldest);
    if (!dup) {
      const out = appendToChangelog(existing, oldestMonday, oldest.text);
      if (!dryRun) { mkdirSync(changelogDir, { recursive: true }); writeAtomic(destFile, out); }
    }
    result.changelog.push({ file: destFile, monday: oldestMonday, appended: !dup, reason: dup ? 'dedup' : 'append' });
    result.moved.push({ date: oldest.date, title: oldest.title, monday: oldestMonday, file: destFile, dedup: dup });
    region = renderRegion(parsed.preamble, entries.filter((_, i) => i !== candIdx), parsed.epilogue);
    moved++;
  }

  if (!split.marked) {
    const note = 'Fallback sin marcadores: no se archiva el último bloque de entrada (posible pie/índice no reconocido); ejecuta migrate-markers para delimitarlo.';
    result.advisory = result.advisory ? `${result.advisory} ${note}` : note;
    result.warnings.push(note);
  }

  const afterText = split.prefix + region + split.suffix;
  result.summaryLinesAfter = contentLines(afterText).count;
  if (!dryRun && afterText !== beforeText) { writeAtomic(summaryPath, afterText); result.summaryWritten = true; }

  if (result.moved.length && existsSync(statePath)) {
    const stateText = normalizeEol(readFileSync(statePath, 'utf8'));
    const mondays = [...new Set(result.moved.map((m) => m.monday))];
    const r = updateStateIndex(stateText, mondays);
    result.stateUpdated = r.updated;
    if (r.missing) result.warnings.push('PROJECT_STATE §4 no encontrado; índice no actualizado.');
    else if (r.tableMissing) result.warnings.push('PROJECT_STATE §4 sin tabla (fila separadora no encontrada); índice no actualizado.');
    else if (r.updated.length && !dryRun) writeAtomic(statePath, r.text);
  }
  return result;
}

export function migrateMarkers({ root = DEFAULT_ROOT, dryRun = false } = {}) {
  const summaryPath = join(root, 'SUMMARY.md');
  const result = { command: 'migrate-markers', dryRun, root, changed: false, alreadyMarked: false, summaryWritten: false };
  if (!existsSync(summaryPath)) throw new Error(`No existe SUMMARY.md en ${root}`);
  const text = normalizeEol(readFileSync(summaryPath, 'utf8'));
  const s = text.indexOf(ENTRIES_START);
  const e = text.indexOf(ENTRIES_END);
  const s2 = s === -1 ? -1 : text.indexOf(ENTRIES_START, s + 1);
  const e2 = e === -1 ? -1 : text.indexOf(ENTRIES_END, e + 1);
  if (s !== -1 && e !== -1 && s2 === -1 && e2 === -1 && s < e) { result.alreadyMarked = true; return result; }
  if ((s !== -1) !== (e !== -1) || s2 !== -1 || e2 !== -1) {
    throw new Error('Marcadores ADVISOR:ENTRIES parciales o duplicados; no se migra.');
  }
  const lines = text.split('\n');
  const entryHead = /^##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*[—\-:|]/;
  let firstEntry = lines.findIndex((l) => entryHead.test(l));
  let footer = lines.findIndex((l) => /^>\s*Cuando registres/.test(l));
  if (footer === -1) footer = lines.findIndex((l) => /^>\s*Topic upsert/.test(l));
  if (footer === -1) footer = lines.length;
  if (firstEntry === -1 || firstEntry > footer) firstEntry = footer;
  const head = lines.slice(0, firstEntry);
  const body = lines.slice(firstEntry, footer);
  let bodyEnd = body.length;
  while (bodyEnd > 0 && body[bodyEnd - 1].trim() === '') bodyEnd--;
  const entriesBody = body.slice(0, bodyEnd);
  const tail = lines.slice(footer);
  if (head.length && head[head.length - 1].trim() !== '') head.push('');
  const inner = entriesBody.length ? ['', ...entriesBody, ''] : [''];
  const newText = [...head, ENTRIES_START, ...inner, ENTRIES_END, '', ...tail].join('\n');
  result.changed = newText !== text;
  if (result.changed && !dryRun) { writeAtomic(summaryPath, newText); result.summaryWritten = true; }
  return result;
}

function report(result, json) {
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (result.command === 'migrate-markers') {
    if (result.alreadyMarked) console.log('migrate-markers: ya hay un par de marcadores válido; sin cambios.');
    else if (result.changed) console.log(`migrate-markers: marcadores insertados${result.dryRun ? ' (dry-run, no escrito)' : ''}.`);
    else console.log('migrate-markers: sin cambios.');
    return;
  }
  console.log(`rotate${result.dryRun ? ' (dry-run)' : ''}: ${result.moved.length} entrada(s) movida(s) · líneas ${result.summaryLinesBefore} → ${result.summaryLinesAfter}${result.advisory ? ' [fallback sin marcadores]' : ''}`);
  for (const m of result.moved) console.log(`  - ${m.date} — ${m.title} → ${m.file}${m.dedup ? ' (dedup: ya existía)' : ''}`);
  const appended = result.changelog.filter((c) => c.appended).map((c) => c.file);
  if (appended.length) console.log(`  CHANGELOG escrito: ${[...new Set(appended)].join(', ')}`);
  if (result.stateUpdated.length) console.log(`  §4 PROJECT_STATE: +${result.stateUpdated.join(', +')}`);
  for (const w of result.warnings) console.log(`  ⚠️ ${w}`);
}

function parseArgs(argv) {
  const flags = { dryRun: false, json: false, max: DEFAULT_MAX, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--max') flags.max = Number(argv[++i]);
    else if (a.startsWith('--max=')) flags.max = Number(a.slice('--max='.length));
    else if (a === '--root') flags.root = argv[++i] ?? null;
    else if (a.startsWith('--root=')) flags.root = a.slice('--root='.length);
  }
  return flags;
}

function main() {
  const cmd = process.argv[2];
  const flags = parseArgs(process.argv.slice(3));
  if (cmd !== 'rotate' && cmd !== 'migrate-markers') {
    console.log(`Uso:
  node .opencode/scripts/memory-rotate.mjs rotate [--dry-run] [--max N] [--json] [--root <dir>]
  node .opencode/scripts/memory-rotate.mjs migrate-markers [--dry-run] [--json] [--root <dir>]

  --root es TEST-ONLY (fixtures sandbox); el lock de memoria se toma sobre la
  raíz del repo del script, no sobre --root.`);
    process.exit(1);
  }
  const root = flags.root ? resolve(flags.root) : DEFAULT_ROOT;
  const lock = acquireLock();
  if (!lock.acquired) {
    console.error(`memory-rotate: no se pudo adquirir lock de memoria (${lock.reason}${lock.owner ? `, pid ${lock.owner.pid}` : ''}); reintente.`);
    process.exit(3);
  }
  let exitCode = 0;
  try {
    const max = Number.isFinite(flags.max) && flags.max >= 0 ? flags.max : DEFAULT_MAX;
    const result = cmd === 'rotate'
      ? rotate({ root, dryRun: flags.dryRun, max })
      : migrateMarkers({ root, dryRun: flags.dryRun });
    report(result, flags.json);
  } catch (e) {
    console.error(`memory-rotate: ${e.message}`);
    exitCode = 1;
  } finally {
    const rel = releaseLock({ token: lock.token });
    if (!rel.released) console.error(`memory-rotate: no se pudo liberar lock (${rel.reason || rel.error || 'desconocido'})`);
  }
  process.exit(exitCode);
}

let isMain = false;
try { isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { isMain = false; }
if (isMain) main();

export { splitRegion, parseRegion, renderRegion, updateStateIndex, scanEntryHeads, appendToChangelog, hasEntry, headingToId, parseEntryHeading, normalize, CHANGELOG_LINE_LIMIT, DEFAULT_MAX };
