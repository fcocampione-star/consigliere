/**
 * Consigliere 2.0 (Advisor Harness) — lib/cache.mjs
 * Biblioteca canónica de validación por fingerprint para las cachés del harness.
 *
 * Las cachés derivadas (`.advisor/memory-index.json`,
 * `.advisor/skill-registry.cache.json`) se validan con UNA idea: "si el estado
 * del conjunto de archivos no cambió, la caché sirve". Este módulo es esa idea;
 * las dos implementaciones previas (familia memory-index y skill loader)
 * convergen aquí.
 *
 * Decisión vigente del harness (PROJECT_STATE §2, P3.1): el fingerprint es
 * path+mtime+size, NO hash de contenido — hashear el corpus encarecería cada
 * `search`. Por eso un archivo reescrito con el MISMO tamaño y el MISMO mtime es
 * indistinguible, y es una limitación conocida, no un fallo.
 *
 * Reglas del módulo:
 *  - ESM, Node >= 20.11, cero dependencias (solo `node:*`).
 *  - Determinista: el orden NO depende de `localeCompare` (varía por locale de
 *    la máquina) sino de una comparación de bytes; dos máquinas con el mismo
 *    árbol producen el mismo fingerprint, byte a byte.
 *  - Una entrada ilegible o ausente NO lanza: se registra con mtime 0 / size 0,
 *    igual que los scripts actuales, para que "borrado" y "renombrado" se vean
 *    como staleness y no como un crash.
 */

import { statSync } from 'node:fs';

/** Clave de una entrada del fingerprint: `keyFn` si se da, si no su `path`. */
function keyOf(entry, keyFn) {
  if (typeof keyFn === 'function') return String(keyFn(entry));
  const e = entry && typeof entry === 'object' ? entry : {};
  return String(e.path ?? e.name ?? '');
}

/** Comparación de orden estable e independiente del locale. */
function byKey(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * `fingerprint(entries, keyFn)` → array de entradas `{...entry, key, mtime, size}`
 * ordenado por `key`, con `mtime`/`size` leídos de disco (`0`/`0` si el archivo no
 * está o no se puede leer). Garantiza orden estable y campos del llamante
 * preservados (`path`, `name`, `source`, …), de modo que el mismo objeto sirve
 * tanto para comparar como para serializar en la caché.
 */
export function fingerprint(entries, keyFn) {
  const list = Array.isArray(entries) ? entries : Array.from(entries ?? []);
  return list
    .map((e) => {
      const src = e && typeof e === 'object' ? e : {};
      let mtime = 0;
      let size = 0;
      try {
        const st = statSync(String(src.path ?? ''));
        mtime = st.mtimeMs;
        size = st.size;
      } catch { /* ausente o ilegible: 0/0 = cambio detectable, no excepción */ }
      return { ...src, key: keyOf(src, keyFn), mtime, size };
    })
    .sort(byKey);
}

/**
 * `isFresh(cachedFp, currentFp, keyFn)` → booleano: ¿la caché sigue sirviendo?
 *
 * Cubre TODAS las ramas de las dos implementaciones previas, en este orden:
 *  1. no es un array (caché ausente o corrupta) → `false`;
 *  2. el número de entradas NO coincide (alta o baja de archivos) → `false`;
 *  3. por clave: falta la entrada, o cambian `mtime`, `size`, o —cuando ambas
 *     lo traen— `path` (un archivo que se movió no es el mismo archivo).
 *
 * El `version` de la caché NO se mira aquí: pertenece al envoltorio que la
 * persiste (cada consumidor lo compara por su cuenta), no al fingerprint.
 */
export function isFresh(cachedFp, currentFp, keyFn) {
  if (!Array.isArray(cachedFp) || !Array.isArray(currentFp)) return false;
  if (cachedFp.length !== currentFp.length) return false; // alta/baja: primer filtro
  const map = new Map(cachedFp.map((e) => [keyOf(e, keyFn), e]));
  for (const c of currentFp) {
    const e = map.get(keyOf(c, keyFn));
    if (!e) return false;
    if (e.mtime !== c.mtime || e.size !== c.size) return false;
    if ('path' in e && 'path' in c && e.path !== c.path) return false;
  }
  return true;
}
