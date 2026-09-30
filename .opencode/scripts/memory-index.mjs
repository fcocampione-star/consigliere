#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-index.mjs (md+grep, sin SQLite)
 * Búsqueda progresiva inspirada en Engram: search → timeline → get
 * v2: índice derivado `.advisor/memory-index.json` con fingerprint
 * path+mtime+size (contrato loader.mjs: entradas ordenadas, comparación
 * por mapa, version:1). Escritura y lectura solo `.advisor/`. Score solo
 * en salida search --json, nunca persistido. Sin índice o stale → fallback
 * md+grep sin error.
 * v3 (F3.2/F3.3/F3.5): parseo por REGIÓN de marcadores ADVISOR:ENTRIES
 * (entriesRegion de memory-stats; fallback whole-file + advisory) y parser
 * tolerante en separador `— - : | ,` vía parseRegion({tolerant:true}) del
 * motor (headingToId). Id canónico = headingToId; slugId añade hash corto para
 * evitar colisiones por truncado. `allEntries` memoiza por fingerprint
 * (path+mtime+size) para no releer CHANGELOG en buildManifest+buildIndex.
 * `invalidateEntriesCache()` invalida ese memo explícitamente (FIX-2); lo
 * llaman las rutas de escritura de memory-sync (export/import) y, vía el
 * registro neutro de memory-stats, memory-rotate (rotate/migrate-markers), para
 * que el proceso anfitrión no sirva entradas stale. Se mantiene el fingerprint
 * path+mtime+size (decisión P3.1: NO hash de contenido para freshness).
 * v4 (bugs reales):
 *  - `get` imprime el CUERPO de la entrada, no solo la línea de heading: la
 *    búsqueda del bloque pasa a usar el parser de región del propio módulo
 *    (entriesRegion + parseRegion tolerante, el mismo de parseEntries) en vez de
 *    un regex con flag `m` cuyo ancla `$` cortaba el match en el primer salto de
 *    línea (ver entryBody).
 *  - Los ids de PROJECT_STATE §2 se derivan con `slugId` (hash sha1 del texto
 *    completo) en vez de truncar la línea: dos decisiones con prefijo común ya no
 *    colisionan ni se persisten duplicadas en el índice.
 *  - `search` puntúa y ORDENA SIEMPRE por score (con índice fresco o stale): el
 *    texto era idéntico en contenido pero distinto en orden según el estado del
 *    índice persistido. El aviso de índice stale tiene una única fuente
 *    (liveEntries), no dos copias del mismo mensaje.
 *  - Toda escritura a disco es atómica (temp + rename en el mismo directorio).
 * v5 (adopción de la lib compartida, sin cambio de comportamiento): `isMain`,
 *  `readText`, `writeAtomic`, `field`, `sectionText`, `listChangelog` e `isFresh`
 *  vienen ya de lib/. No cambian: el ROOT local (core.REPO_ROOT apunta a
 *  `.opencode/`), el `fingerprint` con `path` RELATIVO (forma del contrato del
 *  índice) ni el uso sin comando, que sigue por stdout.
 * Uso:
 *   node memory-index.mjs search "query" [--json] [--refresh]
 *   node memory-index.mjs timeline <id-or-date>  (date YYYY-MM-DD o índice)
 *   node memory-index.mjs get <id-or-date>
 *   node memory-index.mjs list [--json]
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { exitUsage, isMain, readText, writeAtomic } from './lib/core.mjs';
import { field, listChangelog, sectionText } from './lib/md.mjs';
import { isFresh as isFreshFp } from './lib/cache.mjs';
import { entriesRegion, registerCacheInvalidator } from './memory-stats.mjs';
import { headingToId, parseRegion } from './memory-rotate.mjs';

// Raíz del repo = dos niveles por encima de scripts/. NO es core.REPO_ROOT: ese se
// resuelve desde lib/ y cae en `.opencode/`, un nivel más abajo.
const ROOT = join(import.meta.dirname, '..', '..');
const SUMMARY = join(ROOT, 'SUMMARY.md');
const STATE = join(ROOT, 'PROJECT_STATE.md');
const CHANGELOG_DIR = join(ROOT, 'CHANGELOG');
const INDEX_VERSION = 1;
const INDEX_FILE = join(ROOT, '.advisor', 'memory-index.json');

// Id de respaldo cuando no hay heading de entrada reconocible (p.ej. decisiones
// §2 sin `## fecha`). Incluye un hash corto (sha1 hex, 6) del título COMPLETO
// para que títulos largos con prefijo común NO colisionen por el truncado a 30.
// Los headings usan el id canónico `headingToId` (fecha--título normalizado).
function slugId(date, title) {
  const raw = String(title || '');
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 6);
  return `${date}--${slug}-${hash}`;
}

// Parsea entradas de un texto. Para SUMMARY.md, restringe el parseo a la región
// de marcadores (entriesRegion; fallback whole-file + advisory). Usa el parser
// fence-aware y TOLERANTE en separador (`— - : | ,`) del motor, y el id
// canónico `headingToId` — misma identidad que memory-sync export/import.
function parseEntries(text, source, { advisory = false } = {}) {
  let r;
  try { r = entriesRegion(text); }
  catch (e) {
    r = { region: String(text ?? ''), marked: false, advisory: `Marcadores ADVISOR:ENTRIES inválidos (${e.message}); se usó el archivo completo.` };
  }
  if (advisory && !r.marked && r.advisory) console.error(`⚠️ ${source}: ${r.advisory}`);
  const { entries: blocks } = parseRegion(r.region, { tolerant: true });
  const entries = [];
  for (const b of blocks) {
    const heading = b.text.split('\n', 1)[0];
    // topic/review_after: los regex vivían copiados aquí, en memory-sync y en
    // doctor.mjs; el extractor canónico es md.field.
    const topic = field(b.text, 'topic');
    const review_after = field(b.text, 'review_after');
    entries.push({
      id: headingToId(heading) || slugId(b.date, b.title),
      date: b.date, title: b.title, topic, review_after, source,
      preview: b.text.split('\n').slice(1, 5).join(' ').slice(0, 160),
    });
  }
  return entries;
}

// Memoización por invocación: evita releer/reparsear SUMMARY+CHANGELOG+STATE
// cuando buildManifest y buildIndex corren en el mismo proceso (export). Se
// invalida si cambia el fingerprint path+mtime+size de alguna fuente.
let _entriesCache = null;
function fpKey(fp) { return fp.map(e => `${e.path}:${e.mtime}:${e.size}`).join('|'); }

// FIX-2: invalidación explícita del memo. El fingerprint path+mtime+size es una
// decisión consolidada (P3.1: NO hash de contenido para freshness), pero una
// escritura del mismo tamaño con mtime no actualizado (mtime granularidad
// gruesa / FS) dejaría servir datos stale in-process. Las rutas de escritura
// (memory-sync export/import) llaman aquí para forzar relectura en su proceso.
function invalidateEntriesCache() { _entriesCache = null; }

// F4/MINOR: registra la invalidación en el registro neutro de memory-stats para
// que memory-rotate (rotate/migrate-markers) la dispare sin ciclo de imports.
registerCacheInvalidator(invalidateEntriesCache);

function allEntries() {
  const key = fpKey(fingerprint());
  if (_entriesCache && _entriesCache.key === key) return _entriesCache.entries;
  const out=[];
  if (existsSync(SUMMARY)) out.push(...parseEntries(readText(SUMMARY), 'SUMMARY.md', { advisory: true }));
  // listChangelog: los `.md` de CHANGELOG/ ordenados (no solo los de fecha, porque
  // DECISIONS-ARCHIVE.md es memoria viva del mismo directorio y lo consulta /review).
  for (const f of listChangelog(CHANGELOG_DIR)) {
    out.push(...parseEntries(readText(join(CHANGELOG_DIR, f)), `CHANGELOG/${f}`));
  }
  if (existsSync(STATE)) {
    // decisions §2 as entries-like (sección extraída de forma tolerante)
    const c = readText(STATE);
    // FIX-3: `- ` (guion + espacio) evita contar la regla horizontal `---`.
    const lines = sectionText(c, 2).split('\n').filter(l=>l.trim().startsWith('- '));
    for (const l of lines) {
      const topic = field(l, 'topic');
      // FIX: el id se truncaba a 38 caracteres de la línea SIN hash, así que dos
      // decisiones con un prefijo largo común («Harness-only sin runtime de app:
      // Node >=20.11 ESM…») producían el MISMO id y el índice persistía duplicados
      // (el propio comentario de `slugId` declara que eso no debe pasar). Se enruta
      // por `slugId`, que añade el hash sha1 del texto COMPLETO: `date` sigue siendo
      // 'state', así que el prefijo `state--` se conserva. `title` mantiene su
      // truncado de display histórico (primeros 80 chars); la identidad usa el texto
      // entero, sin la viñeta «- ».
      out.push({ id: slugId('state', l.trim().replace(/^-\s+/, '')), date: 'state', title: l.slice(2,80).trim(), topic, source: 'PROJECT_STATE.md §2', preview: l.slice(0,160) });
    }
  }
  _entriesCache = { key, entries: out };
  return out;
}

function sourceFiles() {
  const files = [];
  if (existsSync(STATE)) files.push('PROJECT_STATE.md');
  if (existsSync(SUMMARY)) files.push('SUMMARY.md');
  for (const f of listChangelog(CHANGELOG_DIR)) files.push(`CHANGELOG/${f}`);
  return files.sort();
}

// P3.1 (decisión consolidada, PROJECT_STATE §2): el fingerprint de freshness
// sigue siendo path+mtime+size, NO hash de contenido — hashear todo el corpus
// encarecería `search`. El hash (sha1) se usa SOLO a nivel de entrada, en
// `slugId`, para desambiguar ids truncados; nunca para decidir staleness.
// NOTA: aquí NO se usa cache.fingerprint porque el `path` que se persiste y se
// compara es RELATIVO al repo (forma del contrato del índice, y lo que consume
// el memo `fpKey`); stat sí necesita la ruta absoluta de cada fuente.
function fingerprint() {
  const fp = [];
  for (const rel of sourceFiles()) {
    try {
      const st = statSync(join(ROOT, rel));
      fp.push({ path: rel, mtime: st.mtimeMs, size: st.size });
    } catch {
      fp.push({ path: rel, mtime: 0, size: 0 });
    }
  }
  return fp.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// La comparación de fingerprints es la de lib/cache.mjs (misma idea en toda la
// familia memory-index y en el skill loader). La comparación de `version` NO
// entra ahí: es del envoltorio que persiste el índice, así que sigue aquí.
function isFresh(cached, currentFp = fingerprint()) {
  if (!cached || cached.version !== INDEX_VERSION) return false;
  return isFreshFp(cached.fingerprint, currentFp);
}

function score(entry, query, now = Date.now()) {
  const q = (query || '').toLowerCase();
  const t = Date.parse(entry.date || '1970-01-01');
  const recency = Number.isFinite(t) ? 1 - Math.min(1, (now - t) / (30 * 864e5)) : 0;
  const topic = (entry.topic || '').toLowerCase().includes(q) ? 1 : 0;
  const title = (entry.title || '').toLowerCase().includes(q) ? 1 : ((entry.preview || '').toLowerCase().includes(q) ? 0.5 : 0);
  return 0.6 * recency + 0.3 * topic + 0.1 * title;
}

function loadIndex() {
  const f = INDEX_FILE;
  if (!existsSync(f)) return null;
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    if (data.version !== INDEX_VERSION || !Array.isArray(data.entries)) return null;
    return { data, fresh: isFresh(data), file: f };
  } catch { return null; }
}

function writeIndex() {
  mkdirSync(join(ROOT, '.advisor'), { recursive: true });
  const data = { version: INDEX_VERSION, generatedAt: new Date().toISOString(), fingerprint: fingerprint(), entries: allEntries() };
  writeAtomic(INDEX_FILE, JSON.stringify(data, null, 2));
  return data;
}

// NOTA: substring case-insensitive, no regex perl. `timeline`/`get`
// aceptan id exacto, fecha o subcadena de título por la misma razón.
function matches(e, q) {
  return (e.title + ' ' + e.preview + ' ' + (e.topic || '')).toLowerCase().includes(q);
}

// Aviso de índice stale. Fuente ÚNICA del mensaje (antes estaba copiado: una vez
// en `freshEntries` y otra dentro de `search`), de modo que una corrida nunca lo
// puede imprimir dos veces.
const STALE_NOTE = '⚠️ memory-index.json desactualizado (stale) — fallback md+grep.';

// Entradas vivas para search/timeline/get: índice persistido si es fresh y, si no,
// re-parseo md+grep con un único aviso por stderr. `fromIndex` informa de qué modo
// se sirvió la lista (el ranking ya no depende de él).
function liveEntries() {
  const loaded = loadIndex();
  if (loaded && loaded.fresh) return { entries: loaded.data.entries, fromIndex: true };
  if (loaded) console.error(STALE_NOTE);
  return { entries: allEntries(), fromIndex: false };
}

// Cuerpo íntegro de la entrada `hit` (heading + campos + prosa), localizándolo con
// el parser de región del propio módulo: `entriesRegion` acota la región de
// entradas (mismo criterio que parseEntries, fallback whole-file si los marcadores
// están rotos) y `parseRegion(..., {tolerant:true})` devuelve los bloques con su
// texto. El id se deriva con la MISMA expresión que parseEntries (`headingToId` del
// heading, con `slugId` de respaldo), así que la identidad coincide bloque a bloque.
// Antes `get` usaba un regex `## <fecha>[\s\S]*?(?=\n## …|$)` con flag `m`: en modo
// multilínea el ancla de fin de línea casa TAMBIÉN en cada salto de línea, así que el
// match perezoso terminaba en la propia línea del heading y `get` devolvía solo el
// heading, rompiendo el flujo documentado search → timeline → get.
function entryBody(hit, text) {
  let region;
  try { region = entriesRegion(text).region; }
  catch { region = text; }
  const { entries: blocks } = parseRegion(region, { tolerant: true });
  const id = String(hit.id || '');
  const byId = blocks.find((b) => (headingToId(b.text.split('\n', 1)[0]) || slugId(b.date, b.title)) === id);
  if (byId) return byId.text;
  // Respaldo: el bloque puede haber cambiado de posición/título entre el índice y
  // el fichero, pero fecha + título siguen localizándolo.
  const byTitle = blocks.find((b) => b.date === hit.date && b.title === hit.title);
  return byTitle ? byTitle.text : null;
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  const json = process.argv.includes('--json');

  switch(cmd){
    case 'search': {
      if (!arg) exitUsage('Uso: memory-index.mjs search "query" [--json] [--refresh]');
      if (process.argv.includes('--refresh')) writeIndex();
      const q = arg.toLowerCase();
      const { entries } = liveEntries();
      // Ranking ÚNICO: el score se adjunta y se ordena SIEMPRE, haya índice fresco
      // o no. Antes solo la rama con índice fresco puntuaba y ordenaba; el fallback
      // md+grep (y el `--json` de esa rama) devolvía los hits en orden de archivo,
      // así que la MISMA consulta salía ordenada o sin ordenar según el estado del
      // índice persistido. El texto ya no depende del modo (solo del contenido).
      const hits = entries
        .filter((e) => matches(e, q))
        .map((e) => ({ ...e, score: score(e, arg) }))
        .sort((a, b) => b.score - a.score);
      if (json) console.log(JSON.stringify(hits,null,2));
      else {
        if (!hits.length) console.log(`Sin resultados para "${arg}".`);
        else for (const h of hits) console.log(`- ${h.id} [${h.source}] topic:${h.topic||'-'} — ${h.title} :: ${h.preview.slice(0,80)}`);
      }
      break;
    }
    case 'timeline':
    case 'get': {
      if (!arg) exitUsage(`Uso: memory-index.mjs ${cmd} <id-or-date>`);
      const { entries } = liveEntries();
      const want = arg.toLowerCase();
      // El id se compara también en minúsculas: los ids de PROJECT_STATE §2 ahora
      // salen de `slugId` (minúsculas) mientras que los antiguos iban con el caso
      // original, y un id pegado desde una salida previa debe seguir resolviendo.
      const hit = entries.find(e=>e.id===arg || e.id.toLowerCase()===want || e.date===arg || e.title.toLowerCase().includes(want));
      if (!hit) { console.error(`No encontrado: ${arg}. Prueba: search "query"`); process.exit(1); }
      // for get, dump full file section
      let text='';
      const src = hit.source.includes('SUMMARY')?SUMMARY: hit.source.includes('CHANGELOG')?join(ROOT,hit.source):STATE;
      text=readText(src);
      if (cmd==='get') {
        if (hit.source.startsWith('PROJECT_STATE')) {
          // FIX-4: misma extracción tolerante (sectionText) que doctor.mjs, sin
          // `split('## 2.')` con numeración literal rígida.
          const sec2 = sectionText(text, 2);
          console.log(`# PROJECT_STATE.md §2 — ${hit.title}\n${sec2.trim().slice(0,2000)}`);
          break;
        }
        // Bloque completo de la entrada (heading + topic/review_after + los campos
        // de sesión), localizado con el parser de región. Degradación: si la fuente
        // ya no parsea (marcadores rotos, entrada que salió del índice), se
        // conserva el volcado de cabecera en vez de no mostrar nada.
        const body = entryBody(hit, text);
        console.log(body !== null ? body.trim() : text.slice(0,2000));
      } else {
        console.log(`# ${hit.id} [${hit.source}] topic:${hit.topic||'-'}`);
        console.log(hit.preview);
        // show neighbors
        const idx = entries.indexOf(hit);
        console.log('\n-- vecinos --');
        for (const nb of entries.slice(Math.max(0,idx-2), idx+3)) if (nb!==hit) console.log(`  - ${nb.id} [${nb.source}] ${nb.title}`);
      }
      break;
    }
    case 'list': {
      const e = allEntries();
      if (json) console.log(JSON.stringify(e,null,2));
      else for (const x of e) console.log(`- ${x.id} [${x.source}] topic:${x.topic||'-'} — ${x.title}`);
      break;
    }
    default: {
      // Sin comando el uso sigue yendo a STDOUT (core.exitUsage iría a stderr).
      console.log(`Uso:
  node .opencode/scripts/memory-index.mjs search "query" [--json] [--refresh]
  node .opencode/scripts/memory-index.mjs timeline <id-or-date>
  node .opencode/scripts/memory-index.mjs get <id-or-date>
  node .opencode/scripts/memory-index.mjs list [--json]`);
      process.exit(1);
    }
  }
}

if (isMain(import.meta.url, process.argv[1])) main();

export { allEntries, parseEntries, fingerprint, isFresh, score, loadIndex, writeIndex, slugId, INDEX_VERSION, invalidateEntriesCache };
