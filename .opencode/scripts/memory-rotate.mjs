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
 *    `scanEntryHeads`/`parseRegion` aceptan `{ tolerant: true }` (LECTURA/índice)
 *    que además admite la coma `,` como separador; la rotación usa el default sin
 *    coma (no cambia qué líneas son entradas).
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
 *  - Atomicidad: escrituras con temp+rename en el mismo directorio y
 *    reintentos ACOTADOS del rename, con backoff corto. Un fallo definitivo
 *    borra el temp: una rotación fallida nunca deja debris.
 *  - Complejidad: la región se parsea UNA vez y el bucle de drenaje quita una
 *    entrada por iteración (trabajo ∝ entrada quitada, no ∝ archivo entero).
 *  - Cross-platform EOL: la lectura normaliza CRLF/CR a LF antes de parsear
 *    (los regex anclan con `$`, que no casa ante `\r`); evita perder entradas
 *    en checkouts Windows con core.autocrlf=true.
 *  - §4: actualiza la tabla con una fila `| <lunes> | <lunes>.md | ... |`
 *    insertada tras la fila separadora (manipulación de strings, sin sed -i);
 *    idempotente; si §4 no aparece, avisa y sigue.
 *  - Lock: `rotate` y `migrateMarkers` toman el lock canónico (memory-lock.mjs)
 *    DENTRO de la función que muta, y lo liberan en `finally` por su token —
 *    igual que hace memory-sync con `withMemoryLock`. Quien llama por API queda
 *    protegido por tanto, no solo el CLI. `--dry-run` no lo toma: no escribe
 *    nada, y exigir el lock para una simulación solo añade un modo de fallo.
 *    Si el lock está ocupado, la función lanza con `exitCode = 3` y no se
 *    escribe nada.
 *  - Cache: tras escribir (rotate/migrate-markers) llama `invalidateCaches()`
 *    (registro neutro de memory-stats) para que un host in-process no sirva
 *    entradas stale de memory-index (evita ciclo memory-rotate→memory-index).
 *
 * Uso:
 *   node .opencode/scripts/memory-rotate.mjs rotate [--dry-run] [--max N] [--json] [--root <dir>]
 *   node .opencode/scripts/memory-rotate.mjs migrate-markers [--dry-run] [--json] [--root <dir>]
 *
 * Nota `--root`: es TEST-ONLY (default = raíz del repo inferida del script,
 * `../..`), para correr contra fixtures sandbox. Importante: el lock canónico
 * (memory-lock.mjs) NO cuelga de `--root`: vive en la raíz del repo del propio script
 * (su ROOT es fijo) salvo el override `ADVISOR_LOCK_ROOT` de memory-lock.mjs, que
 * es lo que usan los tests para apuntarlo a un sandbox. `--root` solo redirige
 * los archivos de memoria (SUMMARY.md / PROJECT_STATE.md / CHANGELOG/), no el lock.
 * v5 (adopción de la lib compartida): `isMain` y `readText` vienen de
 * lib/core.mjs, y la escritura atómica ES la de lib/core.mjs (ver `writeAtomic`).
 * Se mantiene el ROOT local —core.REPO_ROOT resuelve en `.opencode/`—, la
 * lectura CRUDA del CHANGELOG destino de `archivar` (se reescribe tal cual) y el
 * uso sin comando por stdout. La ÚNICA diferencia de comportamiento es de
 * seguridad: el lock canónico lo toman ahora las funciones mutantes (antes lo
 * tomaba solo el dispatcher del CLI), de modo que la API tiene la misma garantía
 * que la línea de comandos.
 */
import { existsSync, readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isMain, readText, writeAtomic as writeAtomicShared } from './lib/core.mjs';
import { mondayOf, contentLines, entriesRegion, ENTRIES_START, ENTRIES_END, invalidateCaches } from './memory-stats.mjs';
import { acquireLock, releaseLock } from './memory-lock.mjs';

// Raíz del repo por defecto = dos niveles por encima de scripts/ (NO
// core.REPO_ROOT, que desde lib/ cae en `.opencode/`). Es solo el default de
// `--root`, que existe para las fixtures sandbox de los tests.
const DEFAULT_ROOT = resolve(join(import.meta.dirname, '..', '..'));
const CHANGELOG_LINE_LIMIT = 150;
const DEFAULT_MAX = 20;
// Exit 3 = lock de memoria ocupado (mismo código que memory-sync.mjs): quien
// reintenta sabe que debe esperar, no que la memoria esté corrupta.
const LOCK_BUSY_EXIT = 3;

// Envuelve el trabajo que MUTA el corpus en el lock canónico (memory-lock.mjs),
// el MISMO que toma memory-sync: acquire con token propio, trabajo, release POR
// TOKEN en `finally` (nunca `owner` a ciegas, nunca sin liberar).
//
// Vive AQUÍ, en la función que muta, y NO en el dispatcher del CLI. Estaba al
// revés: el módulo documentaba "adquiere el lock al inicio y SIEMPRE lo libera"
// pero la adquisición estaba en `main()`, así que la mitad del contrato era
// mentira para la API — y la ruta que los tests ejercitan (y con la que un host
// in-process o cualquier importador rotaría) era justo la SIN lock.
function withMemoryLock(etiqueta, fn) {
  const lock = acquireLock();
  if (!lock.acquired) {
    const err = new Error(`no se pudo adquirir lock de memoria (${lock.reason}${lock.owner ? `, pid ${lock.owner.pid}` : ''}); no se escribió nada, reintente.`);
    err.exitCode = LOCK_BUSY_EXIT;
    throw err;
  }
  try {
    return fn();
  } finally {
    const rel = releaseLock({ token: lock.token });
    if (!rel.released) console.error(`memory-rotate ${etiqueta}: no se pudo liberar lock (${rel.reason || rel.error || 'desconocido'})`);
  }
}

// Heading de entrada tolerante: separador em dash, guion, dos puntos o pipe.
// Se aplica LÍNEA A LÍNEA y solo fuera de fences (ver scanEntryHeads).
// NOTA: el parseo/rotación NO acepta `,` como separador (mantiene el historial
// de qué líneas son entradas); la normalización de id SÍ lo acepta (ver
// HEAD_ID_RE), para que `## F, T` y `## F — T` casen en el dedup.
const HEAD_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*([—\-:|])[ \t]*(.+?)[ \t]*$/;
// Variante tolerante (solo LECTURA/índice, ver `tolerant`): además acepta `,`
// como separador. La rotación sigue usando HEAD_RE (sin coma) para no cambiar
// la semántica de qué líneas son entradas; el id canónico (HEAD_ID_RE) ya
// acepta la coma, así que `## F, T` y `## F — T` casan en el dedup.
const HEAD_TOLERANT_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*([—\-:|,])[ \t]*(.+?)[ \t]*$/;
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
// `tolerant: true` usa HEAD_TOLERANT_RE (acepta `,`) para LECTURA/índice; el
// default (rotación) mantiene HEAD_RE y NO acepta coma.
function scanEntryHeads(region, { tolerant = false } = {}) {
  const re = tolerant ? HEAD_TOLERANT_RE : HEAD_RE;
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
    const h = re.exec(clean);
    if (h) heads.push({ idx: lineStart, date: h[1], title: h[3].trim() });
  }
  return heads;
}

function changelogHeader(monday) {
  return `# Changelog ${monday}\n\n> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: \`git log\`.\n\n`;
}

// --- Escritura atómica -------------------------------------------------------
// La del harness: lib/core.mjs. Temp de nombre único en el MISMO directorio +
// `rename` (mismo volumen = atómico), de modo que un lector nunca ve el fichero a
// medias y un fallo no deja ni temp ni destino corrupto. En Windows el rename
// falla con EPERM/EBUSY/EACCES aunque el temp esté escrito (destino bloqueado
// momentáneamente por un editor, un antivirus o un indexador): la compartida
// reintenta esos TRES códigos con backoff corto y ACOTADO, y borra el temp si el
// fallo es definitivo — una rotación fallida nunca deja debris. Ese conjunto es
// el de `RETRYABLE` en lib/core.mjs y es el ÚNICO que aplica en producción.
//
// `attempts` es el nombre histórico de esta firma (tries TOTALES del rename) y se
// traduce a `retries` de la compartida. `rename` es un SEAM SOLO PARA TESTS (permite
// simular el bloqueo de Windows sin bloquear un archivo real); core.writeAtomic no
// admite rename inyectado, así que cuando viene se conserva el bucle acotado de
// aquí — y ese bucle usa `RENAME_RETRYABLE`, más ancho (añade EEXIST y ENOTEMPTY)
// solo porque los dobles de prueba las usan para ejercitar el agotamiento de
// reintentos. En producción `rename` no se pasa nunca y el algoritmo real solo
// existe en lib/core.mjs.
const RENAME_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = [10, 25, 50, 100, 200];
// Solo del seam de test (ver arriba): en producción manda RETRYABLE de lib/core.
const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY']);

// Pausa síncrona sin dependencias ni busy-wait: Atomics.wait sobre un buffer
// compartido duerme el hilo (el rename de fs es síncrono, no hay await aquí).
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(SLEEPER, 0, 0, ms);
}

// Renombra con reintentos ACOTADOS solo para los códigos transitorios de
// bloqueo; cualquier otro error (p.ej. ENOENT) se propaga de inmediato.
function renameWithRetry(from, to, { attempts = RENAME_ATTEMPTS, backoffMs = RENAME_BACKOFF_MS, rename = renameSync } = {}) {
  const tries = Math.max(1, Number(attempts) || 1);
  for (let i = 0; i < tries; i++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      if (i === tries - 1 || !RENAME_RETRYABLE.has(e && e.code)) throw e;
      sleepSync(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0);
    }
  }
}

// Escritura atómica temp+rename en el mismo directorio: o el destino queda con
// el contenido nuevo completo, o queda como estaba y sin temp huérfano.
export function writeAtomic(file, content, opts = {}) {
  const { attempts, backoffMs, rename, ...compartida } = opts;
  if (typeof rename !== 'function') {
    // Camino real: la compartida, con el número de intentos de este módulo.
    const total = attempts === undefined ? RENAME_ATTEMPTS : Math.max(1, Number(attempts) || 1);
    return writeAtomicShared(file, content, { ...compartida, retries: total - 1 });
  }
  // Camino de test con rename inyectado (ver la nota de RENAME_ATTEMPTS).
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const dropTmp = () => { try { rmSync(tmp, { force: true }); } catch { /* best-effort */ } };
  try {
    writeFileSync(tmp, content, 'utf8');
  } catch (e) {
    dropTmp();
    throw e;
  }
  try {
    renameWithRetry(tmp, file, { attempts, backoffMs, rename });
  } catch (e) {
    dropTmp(); // rotación fallida no deja temp detrás
    throw e;
  }
}

// Divide el texto en prefix (incluye START), región interna y suffix (desde END).
// Reutiliza entriesRegion (memory-stats) como única validación; aquí solo se
// añaden prefix/suffix para poder reensamblar sin tocar lo exterior a los marcadores.
function splitRegion(text) {
  let r;
  try { r = entriesRegion(text); }
  catch (e) { throw new Error(`Marcadores ADVISOR:ENTRIES parciales, duplicados o en orden inválido (${e.message}).`); }
  if (!r.marked) return { prefix: '', region: text, suffix: '', marked: false, advisory: r.advisory };
  const s = text.indexOf(ENTRIES_START);
  const e = text.indexOf(ENTRIES_END);
  return { prefix: text.slice(0, s + ENTRIES_START.length), region: r.region, suffix: text.slice(e), marked: true, advisory: null };
}

function ensureTrailingBlank(p) {
  if (p === '') return p;
  if (p.endsWith('\n\n')) return p;
  return p.endsWith('\n') ? p + '\n' : p + '\n\n';
}

// Parsea la región en { preamble, entries[], epilogue }.
// entries[i].text es el bloque completo (trim de cola). epilogue = cola tras la
// última entrada (pie/índice en fallback; vacío en región marcada).
function parseRegion(region, { tolerant = false } = {}) {
  const heads = scanEntryHeads(region, { tolerant });
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
  return entryIds(existing).has(`${date}--${normalize(title)}`);
}

// Set de ids canónicos presentes en un archivo de entradas (SUMMARY/CHANGELOG).
// Permite dedup O(1) por entrada indexando el destino UNA vez (evita el O(n²)
// de escanear el contenido completo por cada entrada importada). Misma
// normalización que `hasEntry`/dedup intra-run.
function entryIds(text) {
  const ids = new Set();
  for (const line of normalizeEol(text).split('\n')) {
    const id = headingToId(line);
    if (id) ids.add(id);
  }
  return ids;
}

function renderRegion(preamble, entries, epilogue) {
  const pre = ensureTrailingBlank(preamble);
  const body = entries.map((e) => e.text).join('\n\n');
  if (!entries.length) return pre + epilogue;
  return `${pre}${body}\n\n${epilogue}`;
}

// --- Helpers del drenaje lineal ---------------------------------------------
// Líneas NO vacías: la misma métrica que cuenta memory-stats.countNonEmpty
// detrás de contentLines. Sumable porque los separadores en blanco que mete
// renderRegion entre entradas no aportan ninguna.
function nonEmptyLines(text) {
  return String(text ?? '').split('\n').filter((l) => l.trim() !== '').length;
}

// Orden de candidatos al drenaje: fecha ascendente y, a igualdad de fecha,
// índice ascendente — el mismo desempate que `oldestCandidate` (comparación
// estricta `date < date` sobre índices crecientes). Los protegidos se calculan
// una vez y nunca salen, así que este orden no cambia al vaciar entradas y un
// puntero que solo avanza basta: O(1) por iteración en vez de un O(entradas).
function candidateOrder(entries, protectedFlags) {
  const order = [];
  for (let i = 0; i < entries.length; i++) if (!protectedFlags[i]) order.push(i);
  return order.sort((a, b) => (entries[a].date < entries[b].date ? -1 : entries[a].date > entries[b].date ? 1 : a - b));
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

// `rotate` es la FUNCIÓN MUTANTE: toma el lock canónico y lo libera en `finally`
// (ver `withMemoryLock`). `--dry-run` no lo toma porque no escribe nada y
// exigir el lock para una simulación solo añade un modo de fallo.
export function rotate({ root = DEFAULT_ROOT, dryRun = false, max = DEFAULT_MAX } = {}) {
  return dryRun ? rotateBajoLock({ root, dryRun, max }) : withMemoryLock('rotate', () => rotateBajoLock({ root, dryRun, max }));
}

function rotateBajoLock({ root = DEFAULT_ROOT, dryRun = false, max = DEFAULT_MAX } = {}) {
  const summaryPath = join(root, 'SUMMARY.md');
  const statePath = join(root, 'PROJECT_STATE.md');
  const changelogDir = join(root, 'CHANGELOG');
  const result = {
    command: 'rotate', dryRun, root,
    moved: [], changelog: [], stateUpdated: [], warnings: [], advisory: null,
    summaryLinesBefore: null, summaryLinesAfter: null, summaryWritten: false,
  };
  if (!existsSync(summaryPath)) throw new Error(`No existe SUMMARY.md en ${root}`);
  const beforeText = readText(summaryPath);
  const split = splitRegion(beforeText);
  result.advisory = split.advisory;
  if (split.advisory) result.warnings.push(split.advisory);
  result.summaryLinesBefore = contentLines(beforeText).count;
  let region = split.region;
  const thisMonday = mondayOf(new Date());
  let moved = 0;

  // Archivado de UNA entrada: anexa al CHANGELOG de su semana con dedup y deja
  // el rastro en `result`. Compartido por los dos caminos del drenaje.
  const archivar = (oldest, oldestMonday) => {
    const destFile = join(changelogDir, `${oldestMonday}.md`);
    // Lectura CRUDA a propósito: `appendToChangelog` la devuelve como prefijo del
    // CHANGELOG reescrito, así que normalizarla (readText) reescribiría los finales
    // de línea de todo el archivo ya archivado.
    const existing = existsSync(destFile) ? readFileSync(destFile, 'utf8') : '';
    const dup = hasEntry(existing, oldest);
    if (!dup) {
      const out = appendToChangelog(existing, oldestMonday, oldest.text);
      if (!dryRun) { mkdirSync(changelogDir, { recursive: true }); writeAtomic(destFile, out); }
    }
    result.changelog.push({ file: destFile, monday: oldestMonday, appended: !dup, reason: dup ? 'dedup' : 'append' });
    result.moved.push({ date: oldest.date, title: oldest.title, monday: oldestMonday, file: destFile, dedup: dup });
  };

  const parsed = parseRegion(region);
  const entries = parsed.entries;
  if (entries.length > 1 && entries[0].date < entries[entries.length - 1].date) {
    result.warnings.push('Orden ascendente detectado (se espera descendente: más nueva arriba); se protege la entrada más nueva y no se archiva.');
  }

  // El epilogue solo es estable al vaciar entradas si NINGUNA de ellas trae un
  // ancla de pie: con una, un reparseo movería a epilogue el resto de la región
  // y la salida cambiaría. Camino normal (las anclas viven en el pie, fuera de
  // la región de entradas): `true`, y el parseo se hace UNA vez. Si apareciera
  // una, se conserva el reparseo por iteración para no alterar la salida.
  const epilogueEstable = !entries.some((e) => EPILOGUE_RE.test(e.text));

  if (epilogueEstable) {
    // Protegidos: la entrada más nueva siempre; en fallback, además el último
    // bloque posicional (puede contener/conducir a un pie no reconocido). Ambos
    // son invariantes durante el drenaje (la más nueva nunca es candidata y el
    // último bloque está protegido), así que se calculan una sola vez.
    const protectedFlags = entries.map(() => false);
    if (entries.length) protectedFlags[newestIndex(entries)] = true;
    if (!split.marked && entries.length) protectedFlags[entries.length - 1] = true;
    const order = candidateOrder(entries, protectedFlags);

    const baseLines = nonEmptyLines(parsed.preamble) + nonEmptyLines(parsed.epilogue);
    const entryLines = entries.map((e) => nonEmptyLines(e.text));
    let liveLines = entryLines.reduce((a, b) => a + b, 0);
    const removed = entries.map(() => false);
    let alive = entries.length;
    let cursor = 0;

    while (true) {
      const count = baseLines + liveLines;
      if (alive <= 1) {
        if (alive === 1) {
          const only = entries[removed.findIndex((r) => !r)];
          if (count > CHANGELOG_LINE_LIMIT)
            result.warnings.push(`Protección: la única entrada supera ${CHANGELOG_LINE_LIMIT} líneas (${count}); no se archiva (no dejar SUMMARY vacío).`);
          else if (mondayOf(only.date) < thisMonday)
            result.warnings.push(`Protección: la única entrada es de la semana ${mondayOf(only.date)} (< ${thisMonday}); no se archiva.`);
        }
        break;
      }
      while (cursor < order.length && removed[order[cursor]]) cursor++;
      if (cursor >= order.length) break;
      const candIdx = order[cursor];
      const oldest = entries[candIdx];
      const oldestMonday = mondayOf(oldest.date);
      const oldWeek = oldestMonday < thisMonday;
      const over = count > CHANGELOG_LINE_LIMIT;
      if (!oldWeek && !over) break;
      if (moved >= max) {
        result.warnings.push(`Cap --max (${max}) alcanzado; quedan entradas por rotar (${over ? `contentLines=${count}` : `semana antigua=${oldestMonday}`}).`);
        break;
      }
      archivar(oldest, oldestMonday);
      removed[candIdx] = true;
      liveLines -= entryLines[candIdx];
      alive--;
      cursor++;
      moved++;
    }
    // Sin movimientos la región se deja intacta byte a byte (no se re-renderiza:
    // `ensureTrailingBlank` introduciría blancos que no estaban).
    if (moved > 0) region = renderRegion(parsed.preamble, entries.filter((_, i) => !removed[i]), parsed.epilogue);
  } else {
    // Caso patológico (ancla de pie dentro de una entrada): reparseo por vuelta.
    while (true) {
      const p = parseRegion(region);
      const live = p.entries;
      const count = contentLines(split.prefix + region + split.suffix).count;
      if (live.length <= 1) {
        if (live.length === 1) {
          if (count > CHANGELOG_LINE_LIMIT)
            result.warnings.push(`Protección: la única entrada supera ${CHANGELOG_LINE_LIMIT} líneas (${count}); no se archiva (no dejar SUMMARY vacío).`);
          else if (mondayOf(live[0].date) < thisMonday)
            result.warnings.push(`Protección: la única entrada es de la semana ${mondayOf(live[0].date)} (< ${thisMonday}); no se archiva.`);
        }
        break;
      }
      const protectedIdx = new Set([newestIndex(live)]);
      if (!split.marked) protectedIdx.add(live.length - 1);
      const candIdx = oldestCandidate(live, protectedIdx);
      if (candIdx === -1) break;
      const oldest = live[candIdx];
      const oldestMonday = mondayOf(oldest.date);
      const oldWeek = oldestMonday < thisMonday;
      const over = count > CHANGELOG_LINE_LIMIT;
      if (!oldWeek && !over) break;
      if (moved >= max) {
        result.warnings.push(`Cap --max (${max}) alcanzado; quedan entradas por rotar (${over ? `contentLines=${count}` : `semana antigua=${oldestMonday}`}).`);
        break;
      }
      archivar(oldest, oldestMonday);
      region = renderRegion(p.preamble, live.filter((_, i) => i !== candIdx), p.epilogue);
      moved++;
    }
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
    const stateText = readText(statePath);
    const mondays = [...new Set(result.moved.map((m) => m.monday))];
    const r = updateStateIndex(stateText, mondays);
    result.stateUpdated = r.updated;
    if (r.missing) result.warnings.push('PROJECT_STATE §4 no encontrado; índice no actualizado.');
    else if (r.tableMissing) result.warnings.push('PROJECT_STATE §4 sin tabla (fila separadora no encontrada); índice no actualizado.');
    else if (r.updated.length && !dryRun) writeAtomic(statePath, r.text);
  }
  // F4/MINOR: invalida memorias in-process tras las escrituras de esta corrida
  // (SUMMARY/CHANGELOG/PROJECT_STATE) para que un host que reutilice
  // memory-index no sirva entradas stale (mismo tamaño/mtime sin refrescar).
  if (!dryRun && (result.summaryWritten || result.stateUpdated.length || result.changelog.some((c) => c.appended))) invalidateCaches();
  return result;
}

// `migrateMarkers` también es mutante y toma el lock por el mismo motivo que
// `rotate`: comparte corpus con ella y con memory-sync.
export function migrateMarkers({ root = DEFAULT_ROOT, dryRun = false } = {}) {
  return dryRun ? migrateMarkersBajoLock({ root, dryRun }) : withMemoryLock('migrate-markers', () => migrateMarkersBajoLock({ root, dryRun }));
}

function migrateMarkersBajoLock({ root = DEFAULT_ROOT, dryRun = false } = {}) {
  const summaryPath = join(root, 'SUMMARY.md');
  const result = { command: 'migrate-markers', dryRun, root, changed: false, alreadyMarked: false, summaryWritten: false };
  if (!existsSync(summaryPath)) throw new Error(`No existe SUMMARY.md en ${root}`);
  const text = readText(summaryPath);
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
  if (result.changed && !dryRun) { writeAtomic(summaryPath, newText); result.summaryWritten = true; invalidateCaches(); }
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
    // El uso sin comando sigue por STDOUT (core.exitUsage iría a stderr: observable).
    console.log(`Uso:
  node .opencode/scripts/memory-rotate.mjs rotate [--dry-run] [--max N] [--json] [--root <dir>]
  node .opencode/scripts/memory-rotate.mjs migrate-markers [--dry-run] [--json] [--root <dir>]

  --root es TEST-ONLY (fixtures sandbox); el lock de memoria lo toma la propia
  función mutante (rotate/migrate-markers) sobre la raíz del repo del script, no
  sobre --root. --dry-run no lo toma: no escribe nada.`);
    process.exit(1);
  }
  const root = flags.root ? resolve(flags.root) : DEFAULT_ROOT;
  // El lock NO se toma aquí: lo toma y lo libera la función mutante, que es la
  // que de verdad escribe (ver `withMemoryLock`). Así el CLI y la API comparten
  // exactamente la misma garantía. Aquí ya no queda nada que liberar, así que un
  // error se reporta con el `exitCode` que le puso la propia función (3 = lock
  // ocupado) en vez del 1 genérico.
  try {
    const max = Number.isFinite(flags.max) && flags.max >= 0 ? flags.max : DEFAULT_MAX;
    const result = cmd === 'rotate'
      ? rotate({ root, dryRun: flags.dryRun, max })
      : migrateMarkers({ root, dryRun: flags.dryRun });
    report(result, flags.json);
  } catch (e) {
    console.error(`memory-rotate: ${e.message}`);
    process.exit(e.exitCode || 1);
  }
  process.exit(0);
}

if (isMain(import.meta.url, process.argv[1])) main();

export { splitRegion, parseRegion, renderRegion, updateStateIndex, scanEntryHeads, appendToChangelog, hasEntry, entryIds, headingToId, parseEntryHeading, normalize, CHANGELOG_LINE_LIMIT, DEFAULT_MAX };
