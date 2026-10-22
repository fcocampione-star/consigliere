#!/usr/bin/env node
/**
 * Consigliere 1.0 (Advisor Harness) — skill-capture.mjs
 * Uso: node .opencode/scripts/skill-capture.mjs <topic> [--name <skill>] [--description ".."] [--chunks a,b] [--summary N] [--json] [--write] [--force]
 * Exit: 0 ok (dry-run imprime el SKILL por stdout; `--write` lo escribe), 1 uso inválido
 * (flag desconocido, topic ausente, sin fuentes consolidables, nombre inválido o
 * destino existente sin `--force`).
 *
 * Consolida la memoria del repo para un topic de memoria en una SKILL REAL (no
 * esqueleto vacío) en `.opencode/skills/<name>/SKILL.md`:
 *  - fuente primaria: decisiones de PROJECT_STATE §2 (`[topic: x]` y también el
 *    plural `[topics: a, b]` que ya existe en el §2 real);
 *  - best-effort: patrones de §5 y entradas de SUMMARY.md/CHANGELOG/ (vía
 *    `allEntries` de memory-index);
 *  - ítems §3 (pendientes) del mismo topic, añadidos marcados "(pendiente)".
 *
 * Un consolidado es reusable tal cual: los chunks SIN contenido se filtran del
 * frontmatter y del cuerpo (el placeholder del esqueleto nunca sobrevive) y las
 * entradas se renderizan con su texto ÍNTEGRO, no con el `preview` recortado a
 * 160 chars de memory-index (ese recorte es para búsqueda, no para consolidar).
 * El cuerpo renderizado va sin metadatos de memoria (`stripMeta`): los
 * marcadores `[topic:]`/`[topics:]` y `review_after:` son ruido para el loader,
 * salvo entre backticks (prosa que cita la sintaxis, no metadato).
 *
 * Fail-closed: sin ≥1 fuente de {decisión §2, patrón §5, entradas
 * SUMMARY/CHANGELOG} sale con uso (1) — un topic que SOLO existe como pendiente
 * §3 no genera skill. El dry-run por defecto imprime por stdout y NUNCA crea
 * directorio; solo `--write` escribe (atómico, vía `writeAtomic`).
 *
 * Reglas: ESM, Node >= 20.11 (`import.meta.dirname`), cero dependencias;
 * reutiliza `validateName`/`normalizeChunks`/`oneLine`/`render` de
 * skill-scaffold y `allEntries`/`slugId`/`score` de memory-index — nunca
 * reimplementa. El parser `[topics:]` nuevo vive aquí: alterar memory-index
 * cambiaría el comportamiento que sus tests actuales fijan.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic, EXIT_CODES, exitUsage, fail, isMain, readText } from './lib/core.mjs';
import { field, sectionText } from './lib/md.mjs';
import { allEntries, slugId, score } from './memory-index.mjs';
import { entriesRegion } from './memory-stats.mjs';
import { headingToId, parseRegion } from './memory-rotate.mjs';
import { validateName, normalizeChunks, oneLine, render } from './skill-scaffold.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const STATE = join(ROOT, 'PROJECT_STATE.md');
const SKILLS_DIR = join(ROOT, '.opencode', 'skills');
const DEFAULT_CHUNKS = ['decisiones', 'patrones', 'entradas'];
const DEFAULT_SUMMARY = 6;

const USAGE = `Uso:
  node .opencode/scripts/skill-capture.mjs <topic> [--name <skill>] [--description ".."] [--chunks a,b] [--summary N] [--json] [--write] [--force]

Consolida la memoria del repo para el topic indicado en una SKILL REAL (no esqueleto
vacío) en .opencode/skills/<name>/SKILL.md: decisiones de PROJECT_STATE §2
(acepta \`[topic: x]\` y el plural \`[topics: a, b]\`), patrones de §5 y entradas de
SUMMARY.md/CHANGELOG/ (vía memory-index, match exacto o por prefijo de categoría).
Los ítems §3 del mismo topic se añaden marcados "(pendiente)". §2 es la fuente primaria.

Flags:
  --name         nombre de la skill (default: último segmento del topic; valida skill-scaffold)
  --description  descripción de una línea para el frontmatter
  --chunks       chunks separados por coma (default: ${DEFAULT_CHUNKS.join(',')})
  --summary      máx. de entradas consolidadas que se conservan de CADA sección de
                 origen (§2 / §5 / SUMMARY/CHANGELOG / §3), tras ordenar por score (default: ${DEFAULT_SUMMARY})
  --json         salida máquina (incluye la lista de fuentes consolidadas)
  --write        escribe .opencode/skills/<name>/SKILL.md (sin él: dry-run por stdout, nunca crea directorio)
  --force        permite sobrescribir un SKILL.md existente
  --help         muestra esta ayuda (exit 0)

Fail-closed: sin ≥1 fuente de {decisión §2, patrón §5, entradas SUMMARY/CHANGELOG} sale
con uso (1); un topic que solo existe como pendiente §3 no genera skill.
`;

// ── Funciones puras: parser de topics ───────────────────────────────────────

/** Topics de una línea: `[topic: x]` y también el plural `[topics: a, b]` que ya
 * existe en el §2/§3 real (p.ej. las decisiones runtime/* y tools/*). Si no hay
 * corchetes cae en `field(text, 'topic')` de lib/md, el extractor canónico.
 * La lógica nueva vive AQUÍ, no en memory-index: su parser (una sola topic por
 * línea) queda intacto para sus tests. */
export function topicsOfLine(line) {
  const m = /\[topics?:\s*([^\]]+)\]/i.exec(String(line ?? ''));
  const out = [];
  if (m) {
    for (const raw of m[1].split(',')) {
      const t = raw.trim().toLowerCase();
      if (t && /^[a-z0-9][a-z0-9._/-]*$/.test(t) && !out.includes(t)) out.push(t);
    }
  }
  if (!out.length) {
    const one = field(line, 'topic');
    if (one) out.push(...one.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

/** Match de topic por lista: EXACTO (`dx/skill-search-registry`) o prefijo de
 * categoría (`memory` matchea `memory/lock-canonico`); dedup por id externo. */
export function topicMatches(topics, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return false;
  return (topics || []).some((t) => t === q || t.startsWith(`${q}/`));
}

/** Match de filas §5 (no llevan `[topic:]`): el query completo como subcadena
 * case-insensitive de la fila cruda, o un segmento de ≥5 chars (tokens muy
 * cortos —"test", "lib"— sobre-matchearían cualquier fila). */
export function rowMatches(text, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return false;
  const tokens = [q, ...q.split('/').filter((t) => t.length >= 5)];
  const row = String(text ?? '').toLowerCase();
  return tokens.some((t) => row.includes(t));
}

// ── Funciones puras: recolección ────────────────────────────────────────────

export function readStateSections(stateText = readText(STATE)) {
  return { sec2: sectionText(stateText, 2), sec3: sectionText(stateText, 3), sec5: sectionText(stateText, 5) };
}

/** Decisiones §2 del texto dado (formato idéntico al que memory-index usa como
 * identidad: `slugId('state', texto)`). */
export function decisionsOf(sec2) {
  const out = [];
  for (const line of String(sec2 ?? '').split('\n')) {
    if (!line.trim().startsWith('- ')) continue;
    const topics = topicsOfLine(line);
    if (!topics.length) continue;
    const text = line.trim().replace(/^-\s+/, '');
    out.push({ id: slugId('state', text), date: 'state', title: text.slice(0, 80), topics, text, source: 'PROJECT_STATE.md §2' });
  }
  return out;
}

/** Pendientes §3: líneas con `[topic:]/[topics:]` marcadas como pendiente. */
export function pendingOf(sec3) {
  const out = [];
  for (const line of String(sec3 ?? '').split('\n')) {
    if (!line.trim().startsWith('- ')) continue;
    const topics = topicsOfLine(line);
    if (!topics.length) continue;
    const text = line.trim().replace(/^-\s+\[\s*[ xX]\]\s*/, '').replace(/^-\s+/, '');
    out.push({ id: slugId('state', text), date: 'state', title: text.slice(0, 80), topics, text, source: 'PROJECT_STATE.md §3', pendiente: true });
  }
  return out;
}

/** Filas §5 (cabecera/separadores excluidos): cells[0] es el patrón, el resto
 * la descripción. Identidad `slugId('state', fila)` — sin colisión con §2. */
export function patternsOf(sec5) {
  const out = [];
  for (const line of String(sec5 ?? '').split('\n')) {
    const row = line.trim();
    if (!row.startsWith('|') || /^\|[\s|:-]+$/.test(row)) continue;
    const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 2) continue;
    out.push({ id: slugId('state', row), date: 'state', title: cells[0], topics: [], text: row, source: 'PROJECT_STATE.md §5', preview: cells.slice(1).join(' · ') });
  }
  return out;
}

/** Texto ÍNTEGRO de las entradas de las fuentes indicadas, por id: re-parsea
 * cada fuente con el lector de memoria ya exportado (`entriesRegion` acota la
 * región de entradas y `parseRegion` tolerante devuelve los bloques) y deriva el
 * id con la MISMA identidad que `parseEntries` de memory-index (`headingToId`,
 * con `slugId` de respaldo). Hace falta porque el `preview` de memory-index se
 * recorta a 160 chars: sirve para búsqueda, pero truncaría el consolidado.
 * Devuelve un Map id → bloque completo (heading incluido). */
export function entryBodies(sources) {
  const map = new Map();
  for (const src of new Set(sources || [])) {
    if (!src) continue;
    const file = join(ROOT, String(src));
    if (!existsSync(file)) continue;
    const text = readText(file);
    let region;
    try { region = entriesRegion(text).region; }
    catch { region = text; }
    for (const b of parseRegion(region, { tolerant: true }).entries) {
      const id = headingToId(b.text.split('\n', 1)[0]) || slugId(b.date, b.title);
      if (!map.has(id)) map.set(id, b.text);
    }
  }
  return map;
}

/** Entradas SUMMARY/CHANGELOG (best-effort) desde `allEntries` de memory-index:
 * descarta las derivadas de §2 (se re-parsean arriba para soportar el plural).
 * Id al de memory-index (headingToId o slugId) — dedup por ese id. `text` es el
 * bloque completo de la entrada (ver `entryBodies`). */
export function memoryEntriesOf() {
  const raw = allEntries()
    .filter((e) => !String(e.source || '').startsWith('PROJECT_STATE') && (e.topic || ''));
  const bodies = entryBodies(raw.map((e) => e.source));
  return raw.map((e) => ({ id: e.id, date: e.date, title: e.title, topics: topicsOfLine(`[topic: ${e.topic}]`), text: bodies.get(e.id) ?? e.title, source: e.source, preview: e.preview || '' }));
}

/** Toma las N primeras de cada sección (o todas si N < 1). */
const cap = (list, n) => (n >= 1 ? list.slice(0, n) : [...list]);

/**
 * collectSources(topic) → { buckets, sources, justified }
 *  - buckets: { decisiones, patrones, entradas, pendientes } (cada lista ya
 *    filtrada por topic, ordenada por `score` DESC y recortada a `--summary N`
 *    por sección de origen);
 *  - sources: lista para el encabezado "Fuentes consolidadas";
 *  - justified: nº de fuentes del set fail-closed {§2, §5, SUMMARY/CHANGELOG}.
 */
export function collectSources(topic, { stateText = readText(STATE), summaryN = DEFAULT_SUMMARY } = {}) {
  const { sec2, sec3, sec5 } = readStateSections(stateText);
  const byScore = (list) => list.slice().sort((a, b) => score(b, topic) - score(a, topic));
  // Dedup por id: mismas entradas de SUMMARY+CHANGELOG (id idéntico de
  // memory-index) y decisiones/patrones/pendientes por su `slugId`.
  const byId = (list) => {
    const seen = new Set();
    return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  };
  const buckets = {
    decisiones: byId(cap(byScore(decisionsOf(sec2).filter((d) => topicMatches(d.topics, topic))), summaryN)),
    patrones: byId(cap(byScore(patternsOf(sec5).filter((p) => rowMatches(p.text, topic))), summaryN)),
    entradas: byId(cap(byScore(memoryEntriesOf().filter((e) => topicMatches(e.topics, topic))), summaryN)),
    pendientes: byId(cap(byScore(pendingOf(sec3).filter((p) => topicMatches(p.topics, topic))), summaryN)),
  };

  const pluralWord = { 'decisión': 'decisiones', 'patrón': 'patrones' };
  const plural = (n, word) => `${n} ${n === 1 ? word : (pluralWord[word] || `${word}s`)}`;
  const nDec = buckets.decisiones.length;
  const nPat = buckets.patrones.length;
  const sumCount = buckets.entradas.filter((e) => !String(e.source).startsWith('CHANGELOG')).length;
  const chgCount = buckets.entradas.length - sumCount;
  const nPen = buckets.pendientes.length;
  const sources = [];
  if (nDec) sources.push({ section: 'decisiones', label: `PROJECT_STATE §2 — ${plural(nDec, 'decisión')} (fuente primaria)`, count: nDec, primary: true });
  if (nPat) sources.push({ section: 'patrones', label: `PROJECT_STATE §5 — ${plural(nPat, 'patrón')}`, count: nPat });
  if (sumCount) sources.push({ section: 'entradas', label: `SUMMARY.md — ${plural(sumCount, 'entrada')}`, count: sumCount });
  if (chgCount) sources.push({ section: 'entradas', label: `CHANGELOG/ — ${plural(chgCount, 'entrada')}`, count: chgCount });
  if (nPen) sources.push({ section: 'pendientes', label: `PROJECT_STATE §3 — ${plural(nPen, 'pendiente')} (no generan skill solos)`, count: nPen });
  return { buckets, sources, justified: nDec + nPat + buckets.entradas.length };
}

// ── Funciones puras: render ─────────────────────────────────────────────────

/** Aplica `fn` solo a los tramos de la línea que NO están dentro de un code span
 * inline (backticks equilibrados): una mención del marcador entre backticks es
 * prosa que cita la sintaxis, no un metadato. */
function outsideInlineCode(line, fn) {
  let out = '';
  let openLen = 0;
  for (const part of String(line).split(/(`+)/)) {
    const ticks = /^(`+)$/.exec(part);
    if (ticks) {
      const n = ticks[1].length;
      if (!openLen) openLen = n;
      else if (openLen === n) openLen = 0;
      out += part;
    } else out += openLen ? part : fn(part);
  }
  return out;
}

/** Quita del texto los metadatos de memoria que no pertenecen al artefacto
 * consumible: la topic entre corchetes (`[topic: x]`, `[topics: a, b]`) y la
 * caducidad `review_after: YYYY-MM-DD`. Solo esos dos patrones (la palabra
 * "topic" suelta y una mención entre backticks se respetan: la sintaxis citada
 * en prosa no es un metadato). Una línea que SOLO lleva la caducidad desaparece;
 * en el resto se colapsan los espacios que dejó la eliminación, nunca la sangría
 * ni el contenido de un code span. Pura: no muta la entrada, así que `--json`
 * conserva sus `sources[]` intactas. */
export function stripMeta(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (/^[ \t]*review_after:[ \t]*\d{4}-\d{2}-\d{2}[ \t]*$/i.test(line)) continue;
    const clean = outsideInlineCode(line, (seg) => seg.replace(/\s*\[topics?:[^\]]*\]/gi, '').replace(/\s+review_after:[ \t]*\d{4}-\d{2}-\d{2}/gi, ''));
    if (clean === line) {
      out.push(line);
      continue;
    }
    const indent = /^[ \t]*/.exec(clean)[0];
    const rest = outsideInlineCode(clean.slice(indent.length), (seg) => seg.replace(/[ \t]{2,}/g, ' '));
    out.push(indent + rest.replace(/[ \t]+$/, ''));
  }
  return out.join('\n');
}

/** Viñetas markdown de una lista de items, o '' si la lista quedó vacía. */
function bulleted(items) {
  return (items || []).map((i) => `- ${i}`).join('\n');
}

/** Una entrada consolidada: título en negrita + origen y el cuerpo ÍNTEGRO de la
 * entrada (sin el heading, que ya va en el título) indentado como continuación
 * de la viñeta. Si el bloque no se pudo localizar se queda en el título. */
function entryBullet(entry) {
  const head = `**${entry.title}** — \`${entry.source}\``;
  const body = stripMeta(String(entry.text || '').split('\n').slice(1).join('\n')).trim();
  return body ? `${head}\n${body.split('\n').map((l) => (l.trim() ? `  ${l}` : '')).join('\n')}` : head;
}

/** Relleno de cada chunk pedido. `entradas` lleva el texto completo (nunca el
 * `preview`) y todos los chunks van sin metadatos (`stripMeta`); los §3
 * pendientes se anidan tras las decisiones salvo que el usuario pida el chunk
 * `pendientes` propio. */
export function captureFills(buckets, chunks) {
  const pendOwn = chunks.includes('pendientes');
  const pendFill = bulleted((buckets.pendientes || []).map((p) => `${stripMeta(p.text)} *(pendiente)*`));
  const fills = {
    decisiones: bulleted((buckets.decisiones || []).map((d) => stripMeta(d.text))),
    patrones: bulleted((buckets.patrones || []).map((p) => stripMeta(`**${p.title}** — ${p.preview}`))),
    entradas: bulleted((buckets.entradas || []).map(entryBullet)),
    pendientes: pendOwn ? pendFill : '',
  };
  if (!pendOwn && pendFill) fills.decisiones = [fills.decisiones, pendFill].filter(Boolean).join('\n\n');
  return fills;
}

/** Chunks que recibieron contenido real, en el orden pedido. */
export function chunksWithContent(chunks, fills) {
  return chunks.filter((c) => String((fills || {})[c] ?? '').trim() !== '');
}

/**
 * renderCapture muestra el SKILL consolidado reutilizando el render() del
 * scaffold: frontmatter válida para `_skill-loader` + marcadores CHUNK que se
 * sustituyen por el consolidado real. Los chunks SIN contenido se filtran del
 * frontmatter y del cuerpo: el placeholder `(pendiente: contenido de x)` es del
 * esqueleto de skill-scaffold y nunca debe sobrevivir a un consolidado, de modo
 * que el artefacto es reusable tal cual. Encabezado "Fuentes consolidadas"
 * listando las fuentes; los §3 pendientes, marcados *(pendiente)* y anidadas
 * tras las decisiones (o en su propio chunk `pendientes` si el usuario las pide).
 * Devuelve `null` si ningún chunk tiene contenido (el CLI lo trata como uso).
 */
export function renderCapture(name, description, chunks, buckets, sources) {
  const fills = captureFills(buckets, chunks);
  const kept = chunksWithContent(chunks, fills);
  if (!kept.length) return null;
  let content = render(name, description, kept);
  const anchor = `# ${name}\n`;
  if (content.includes(anchor)) content = content.replace(anchor, () => `${anchor}\n## Fuentes consolidadas\n\n${sources.map((s) => `- ${s.label}`).join('\n')}\n\n`);
  for (const c of kept) {
    const marker = `(pendiente: contenido de ${c})`;
    if (content.includes(marker)) content = content.replace(marker, () => fills[c]);
  }
  return content;
}

/** Nombre derivado de un topic: el último segmento (`process/skill-capture` → `skill-capture`). */
export function deriveName(topic) {
  const raw = String(topic ?? '').trim();
  return raw.split('/').filter(Boolean).pop() || '';
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { topic: '', name: '', description: '', chunks: '', summary: null, json: false, write: false, force: false, help: false, unknown: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--write') o.write = true;
    else if (a === '--force') o.force = true;
    else if (a === '--help') o.help = true;
    else if (a === '--name') o.name = argv[++i] ?? '';
    else if (a.startsWith('--name=')) o.name = a.slice('--name='.length);
    else if (a === '--description') o.description = argv[++i] ?? '';
    else if (a.startsWith('--description=')) o.description = a.slice('--description='.length);
    else if (a === '--chunks') o.chunks = argv[++i] ?? '';
    else if (a.startsWith('--chunks=')) o.chunks = a.slice('--chunks='.length);
    else if (a === '--summary') o.summary = argv[++i] ?? null;
    else if (a.startsWith('--summary=')) o.summary = a.slice('--summary='.length);
    else if (a.startsWith('-')) o.unknown = a;
    else rest.push(a);
  }
  o.topic = rest.join(' ').trim();
  o.name = String(o.name ?? '').trim();
  return o;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.unknown) exitUsage(`skill-capture.mjs: flag desconocido "${opts.unknown}"\n\n${USAGE}`);
  if (!opts.topic) exitUsage(`skill-capture.mjs: falta el topic\n\n${USAGE}`);

  const name = opts.name || deriveName(opts.topic);
  const nameError = validateName(name);
  if (nameError) exitUsage(`skill-capture.mjs: ${nameError}\n\n${USAGE}`);

  const summaryN = opts.summary === null ? DEFAULT_SUMMARY : Number.parseInt(String(opts.summary), 10);
  if (!Number.isInteger(summaryN) || summaryN < 1) {
    exitUsage(`skill-capture.mjs: --summary debe ser un entero >= 1 (recibido "${opts.summary}")\n\n${USAGE}`);
  }
  let chunks;
  try {
    chunks = normalizeChunks(opts.chunks ? opts.chunks : DEFAULT_CHUNKS.join(','));
  } catch (e) {
    exitUsage(`skill-capture.mjs: ${e.message}\n\n${USAGE}`);
  }

  const { buckets, sources, justified } = collectSources(opts.topic, { summaryN });
  if (!justified) {
    exitUsage(`skill-capture.mjs: el topic "${opts.topic}" no tiene fuentes consolidables (decisión §2 / patrón §5 / entradas SUMMARY-CHANGELOG) — un topic que solo existe como pendiente §3 no genera skill.\n\n${USAGE}`);
  }

  const description = oneLine(opts.description) || `Consolidado de memoria para el topic ${opts.topic}: decisiones, patrones y entradas generados por /skill-capture.`;
  const keptChunks = chunksWithContent(chunks, captureFills(buckets, chunks));
  if (!keptChunks.length) {
    exitUsage(`skill-capture.mjs: ninguno de los chunks [${chunks.join(', ')}] recibió contenido para el topic "${opts.topic}" — ajusta --chunks a las fuentes disponibles.\n\n${USAGE}`);
  }
  const content = renderCapture(name, description, keptChunks, buckets, sources);
  const target = join(SKILLS_DIR, name, 'SKILL.md');
  const meta = { topic: opts.topic, name, chunks: keptChunks, summary: summaryN, target, sources, sources_total: justified + buckets.pendientes.length };

  if (!opts.write) {
    if (opts.json) console.log(JSON.stringify({ mode: 'dry-run', ...meta }, null, 2));
    else process.stdout.write(content);
    return;
  }

  if (existsSync(target) && !opts.force) {
    fail('skill-capture', `ya existe ${target}; usa --force para sobrescribir`, EXIT_CODES.USO);
  }
  writeAtomic(target, content);
  if (opts.json) console.log(JSON.stringify({ mode: 'write', written: true, bytes: content.length, ...meta }, null, 2));
  else console.log(`skill-capture: escrito ${target}`);
}

if (isMain(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2));
}
