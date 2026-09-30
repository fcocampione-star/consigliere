/**
 * Consigliere 2.0 (Advisor Harness) — lib/core.mjs
 * Biblioteca canónica de filesystem, proceso y CLI para los scripts del harness.
 *
 * Consolida las seis copias dispersas de estas utilidades (rutas, test de "soy el
 * entry point", lectura normalizada, escritura atómica, salida de error) en UNA
 * implementación. No depende de ningún script del harness (importar memory-*
 * crearía ciclo): solo `node:*`.
 *
 * Uso previsto (drop-in): los adoptantes sustituyen su copia local por
 * `import { ... } from './lib/core.mjs'` y conservan la firma.
 *
 * Reglas del módulo:
 *  - ESM, Node >= 20.11 (`import.meta.dirname`), cero dependencias.
 *  - Sin glifos ni emojis: la salida va a stderr en texto plano, para que
 *    cualquier consumidor (script, test, hook) pueda compararla literalmente.
 *  - Determinista: ningún valor devuelto lleva marca de tiempo ni azar
 *    (el nombre del temp sí usa azar, es interno y no se devuelve).
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Rutas ───────────────────────────────────────────────────────────────────

/** Directorio absoluto del propio módulo (`.../.opencode/scripts/lib`). */
export const SCRIPT_DIR = import.meta.dirname;

/**
 * Dos niveles por encima de SCRIPT_DIR.
 *
 * OJO, trampa documentada: desde `scripts/lib/` eso es `.opencode/`, NO la raíz
 * del repo. Es la MISMA fórmula que usan los scripts (`scripts/x.mjs` → raíz),
 * pero aquí `SCRIPT_DIR` es un nivel más profundo. Quien necesite la raíz del
 * proyecto debe subir tres niveles (`resolve(SCRIPT_DIR, '..', '..', '..')`) o
 * usar el `--root` que ya expone memory-rotate.
 */
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

// ── Vocabulario de códigos de salida ────────────────────────────────────────

/**
 * Tabla de códigos de salida del harness, congelada.
 * Idéntica (claves incluidas) a `EXIT` de init.mjs: una sola voz para todo el
 * harness, el instalador y los scripts.
 */
export const EXIT_CODES = Object.freeze({
  OK: 0, // éxito
  USO: 1, // error de uso o validación (flag, valor, destino, combinación)
  CONFIRMA: 2, // hace falta confirmación y no la hubo (no interactivo, cancelada)
  DEPENDENCIA: 3, // falta una dependencia requerida (tar)
  BACKUP: 4, // falló el backup/restauración
  PARCIAL: 5, // se escribió algo y un paso posterior falló
});

// ── Test de entry point ─────────────────────────────────────────────────────

/**
 * Canonicaliza una URL de archivo o una ruta a una clave comparable:
 * sin `file://`, separadores `\`, sin barra inicial, sin capitalización y
 * sin escapes percent. Es la clave que permite comparar posix y Windows.
 */
function fileKey(value) {
  let s = String(value ?? '');
  s = s.replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/^\/+/, '');
  try { s = decodeURI(s); } catch { /* ruta con % literal: se usa tal cual */ }
  return s.trim().toLowerCase();
}

// Un shim de shell de Windows (init.cmd / init.bat) deja argv[1] con extensión
// de shell, no de módulo. Solo se acepta como equivalente si TODO lo demás —
// incluida la carpeta — coincide; comparar solo el basename haría que cualquier
// homónimo de otro directorio se creyera entry point.
const SHIM_EXT_RE = /\.(cmd|bat)$/;
// Extensiones de módulo Node: se retiran del lado del módulo para casar con el
// shim (`doctor.cmd` <-> `doctor.mjs`); el resto de la ruta —carpeta incluida—
// debe seguir siendo idéntico.
const JS_EXT_RE = /\.(mjs|cjs|js)$/;

/**
 * `isMain(importMetaUrl, argv1)` → booleano: ¿este módulo es el entry point?
 *
 * Compara URLs de archivo y tolera las tres formas reales de argv[1]: ruta
 * nativa posix, ruta nativa Windows con `\` y shim `.cmd`/`.bat` del mismo
 * basename y carpeta. `argv1` vacío o ausente nunca es entry point.
 */
export function isMain(importMetaUrl, argv1) {
  if (!importMetaUrl || argv1 === undefined || argv1 === null) return false;
  const entry = String(argv1);
  if (!entry.trim()) return false;
  // Intento literal primero (posix y win32 nativos: argv[1] ya viene absoluto).
  try {
    if (pathToFileURL(entry).href === String(importMetaUrl)) return true;
  } catch { /* argv[1] no es una ruta utilizable por pathToFileURL */ }
  const mine = fileKey(importMetaUrl);
  const theirs = fileKey(entry);
  if (!mine || !theirs) return false;
  if (mine === theirs) return true;
  if (!SHIM_EXT_RE.test(theirs)) return false;
  return theirs.replace(SHIM_EXT_RE, '') === mine.replace(JS_EXT_RE, '');
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Quita un BOM inicial si lo hay (lo único que `readFileSync(...,'utf8')` no quita). */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Lee un archivo de texto UTF-8 como texto NORMALIZADO: sin BOM inicial y con
 * todos los finales de línea en LF.
 *
 * Es el arreglo de dos bugs reales del harness: un front-matter/heading con BOM
 * hace invisible la primera línea, y los regex que anclan con `$` no casan ante
 * `\r` de un checkout CRLF (core.autocrlf en Windows). Un archivo ausente o
 * ilegible devuelve `fallback` (por defecto `''`), nunca un error de fs crudo.
 */
export function readText(path, { fallback = '' } = {}) {
  if (!path) return fallback;
  let raw;
  try {
    raw = readFileSync(String(path), 'utf8');
  } catch {
    return fallback; // no existe, es un directorio, no se puede leer: fallback
  }
  return stripBom(raw).replace(/\r\n?/g, '\n');
}

// ── Escritura atómica ───────────────────────────────────────────────────────

// En Windows `rename` falla con EPERM/EBUSY cuando un editor o el antivirus
// tiene el destino abierto sin FILE_SHARE_DELETE. No es un error real: se
// reintenta con backoff corto antes de rendirse.
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Espera síncrona de `ms` (Atomics.wait es la única primitiva stdlib sin deps). */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Envuelve un error de fs añadeéndole la ruta (un mensaje sin ruta no es accionable). */
function named(scope, target, e) {
  const why = (e && e.code ? `${e.code}: ` : '') + ((e && e.message) || String(e));
  const err = new Error(`${scope}: "${target}" — ${why}`);
  if (e && e.code) err.code = e.code;
  return err;
}

/**
 * Escribe `text` en `path` de forma ATÓMICA: temp de nombre único en el MISMO
 * directorio + `rename` (mismo volumen = atómico). Garantiza que un lector nunca
 * ve un archivo a medias y que un fallo no deja ni temp ni destino corrupto.
 *
 * Opciones: `retries` (5) y `delayMs` (20, backoff lineal) para el rename;
 * `mkdir` (true) crea el directorio destino si falta; `validateJson`
 * (por defecto `true` si la ruta acaba en `.json`) parsea el TEMP ya escrito y
 * aborta —sin renombrar ni tocar el original— si no es JSON válido.
 */
export function writeAtomic(path, text, opts = {}) {
  const {
    encoding = 'utf8',
    retries = 5,
    delayMs = 20,
    mkdir = true,
    validateJson = null,
  } = opts;
  const target = String(path ?? '');
  if (!target) throw new TypeError('writeAtomic: falta la ruta de destino');
  const dir = dirname(target);
  if (mkdir) mkdirSync(dir, { recursive: true });
  // Nombre único: dos escritores concurrentes (mismo destino) no se pisan.
  const tmp = join(dir, `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const wantsJson = validateJson === null ? target.endsWith('.json') : !!validateJson;

  try {
    writeFileSync(tmp, text, encoding);
    if (wantsJson) {
      // Se valida el TEMP, no el texto en memoria: lo que se renombra tiene que
      // ser exactamente lo que se comprobó.
      JSON.parse(readFileSync(tmp, 'utf8'));
    }
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    // SyntaxError solo puede venir del JSON.parse del temporal: el destino
    // anterior sigue intacto porque el rename nunca ocurrió.
    if (e instanceof SyntaxError) throw named('writeAtomic: JSON inválido, el temporal no se renombró', target, e);
    throw named('writeAtomic: no se pudo preparar el temporal', target, e);
  }

  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, target);
      return target; // dato verificable: la ruta escrita
    } catch (e) {
      const retryable = RETRYABLE.has(e && e.code) && attempt < retries;
      if (!retryable) {
        try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
        throw named('writeAtomic: no se pudo renombrar el temporal al destino', target, e);
      }
      sleepSync(delayMs * (attempt + 1)); // backoff lineal corto
    }
  }
}

// ── Salida de CLI ───────────────────────────────────────────────────────────

/**
 * Imprime el bloque de uso en stderr y termina con `code` (por defecto USO=1).
 * Forma única para todos los scripts: el texto va tal cual, a stderr.
 */
export function exitUsage(text, code = EXIT_CODES.USO) {
  console.error(String(text ?? '').replace(/\s+$/, ''));
  process.exit(code);
}

/**
 * Imprime `scope: msg` en stderr y termina con `code` (por defecto USO=1).
 * Un solo formato de error en todo el harness, con el ámbito que lo produce.
 */
export function fail(scope, msg, code = EXIT_CODES.USO) {
  console.error(`${String(scope ?? '').trim()}: ${String(msg ?? '')}`.trim());
  process.exit(code);
}
