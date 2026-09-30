#!/usr/bin/env node
/**
 * test/lib.test.mjs — tests de la biblioteca compartida del harness.
 *
 * Cubre los tres módulos nuevos de `.opencode/scripts/lib/`:
 *   - core.mjs  : SCRIPT_DIR/REPO_ROOT, isMain, readText, writeAtomic,
 *                 exitUsage/fail (en proceso hijo, por su process.exit) y EXIT_CODES.
 *   - md.mjs    : field, fenceSpans (CommonMark), sectionText, listChangelog,
 *                 todayUTC.
 *   - cache.mjs : fingerprint/isFresh.
 *
 * Contrato con el resto de la suite: micro-framework de `test/harness.mjs`,
 * nada de disco dentro del repo (todo va a `tmpdir()` + `cleanup()`), y
 * `await runAll()` a nivel de módulo.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  suite, test, assert, eq, neq, match, includes, throws, throwsAsync,
  tmpdir, cleanup, runAll,
} from './harness.mjs';
import {
  SCRIPT_DIR, REPO_ROOT, EXIT_CODES, isMain, readText, writeAtomic, exitUsage, fail,
} from '../.opencode/scripts/lib/core.mjs';
import {
  field, fenceSpans, sectionText, listChangelog, todayUTC,
} from '../.opencode/scripts/lib/md.mjs';
import { fingerprint, isFresh } from '../.opencode/scripts/lib/cache.mjs';

const REPO = join(import.meta.dirname, '..');
const CORE_URL = pathToFileURL(join(REPO, '.opencode', 'scripts', 'lib', 'core.mjs')).href;
const CR = '\r';

// Arena temporal: crea un dir, lo limpia pase lo que pase (nada dentro del repo).
function withTmp(prefix, fn) {
  const dir = tmpdir(prefix);
  try { return fn(dir); }
  finally { cleanup(dir); }
}

const write = (p, text) => { writeFileSync(p, text, 'utf8'); return p; };

// ¿El índice cae dentro de algún rango? (mismo criterio que el consumidor real)
const inside = (spans, idx) => spans.some(([a, b]) => idx >= a && idx < b);

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/core — rutas');
// ═════════════════════════════════════════════════════════════════════════════

test('SCRIPT_DIR es el directorio absoluto del propio módulo', () => {
  assert(typeof SCRIPT_DIR === 'string' && SCRIPT_DIR.length > 0, 'SCRIPT_DIR es un string no vacío');
  assert(SCRIPT_DIR.endsWith(join('scripts', 'lib')), `SCRIPT_DIR termina en scripts/lib: ${SCRIPT_DIR}`);
  match(SCRIPT_DIR, /^[A-Za-z]:[\\/]|^[/\\]/, 'SCRIPT_DIR es una ruta absoluta');
});

test('REPO_ROOT es dos niveles por encima de SCRIPT_DIR (desde lib/ eso es .opencode/)', () => {
  // Trampa documentada: desde scripts/lib/, `../..` es `.opencode/`, NO la raíz
  // del repo. El test congela esa semántica para que un adoptante no la cambie
  // por sorpresa; quien necesite el proyecto sube un nivel más.
  eq(REPO_ROOT, join(SCRIPT_DIR, '..', '..'), 'REPO_ROOT = resolve(SCRIPT_DIR, .., ..)');
  eq(REPO_ROOT.endsWith('.opencode'), true, 'desde lib/ ese resolve cae en .opencode/');
  eq(join(REPO_ROOT, '..'), REPO, 'la raíz del repo es un nivel más arriba');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/core — readText');
// ═════════════════════════════════════════════════════════════════════════════

test('LF: pasa el contenido intacto', () => withTmp('lib-rt-', (d) => {
  const f = write(join(d, 'a.md'), 'uno\ndos\ntres\n');
  eq(readText(f), 'uno\ndos\ntres\n', 'LF no se toca');
}));

test('CRLF: normaliza a LF (el bug de los regex que anclan con $)', () => withTmp('lib-rt-', (d) => {
  const f = write(join(d, 'a.md'), 'uno\r\ndos\r\ntres\r\n');
  const out = readText(f);
  eq(out, 'uno\ndos\ntres\n', 'CRLF -> LF');
  // El síntoma real: un front-matter con ^---\n que en CRLF nunca casaba.
  const fm = write(join(d, 'b.md'), '---\r\nname: x\r\n---\r\n');
  assert(/^---\n/.test(readText(fm)), 'el front-matter con CRLF ahora es visible al regex');
}));

test('CR solo: normaliza a LF', () => withTmp('lib-rt-', (d) => {
  const f = write(join(d, 'a.md'), 'uno\rdos\rtres');
  eq(readText(f), 'uno\ndos\ntres', 'CR -> LF');
}));

test('BOM inicial: se quita y la primera línea deja de ser invisible', () => withTmp('lib-rt-', (d) => {
  const f = write(join(d, 'a.md'), '\uFEFF# Titulo\ncuerpo\n');
  const out = readText(f);
  eq(out, '# Titulo\ncuerpo\n', 'BOM eliminado');
  assert(/^#/.test(out), 'el heading de la primera línea ya es visible');
}));

test('BOM + CRLF: quita el BOM y normaliza EOL a la vez', () => withTmp('lib-rt-', (d) => {
  const f = write(join(d, 'a.md'), '\uFEFF# Titulo\r\nlinea 2\r\n');
  eq(readText(f), '# Titulo\nlinea 2\n', 'BOM + CRLFF -> sin BOM y LF');
}));

test('archivo ausente: devuelve el fallback (por defecto "") sin lanzar error de fs', () => withTmp('lib-rt-', (d) => {
  const missing = join(d, 'no-existe.md');
  eq(readText(missing), '', 'fallback por defecto = cadena vacía');
  let lanzó = false;
  try { readText(missing); } catch { lanzó = true; }
  eq(lanzó, false, 'no propaga el ENOENT crudo al llamante');
  eq(readText(missing, { fallback: '# LIMPIO\n' }), '# LIMPIO\n', 'fallback configurable');
  eq(readText(''), '', 'ruta vacía -> fallback, no excepción');
}));

test('archivo ilegible (directorio): fallback, no excepción', () => withTmp('lib-rt-', (d) => {
  mkdirSync(join(d, 'sub'));
  eq(readText(join(d, 'sub'), { fallback: 'X' }), 'X', 'una carpeta no es texto: fallback');
}));

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/core — writeAtomic');
// ═════════════════════════════════════════════════════════════════════════════

const debris = (d) => readdirSync(d).filter((f) => f.includes('.tmp'));

test('crea el archivo con el contenido exacto y devuelve la ruta', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'notas.md');
  eq(writeAtomic(f, 'hola\nmundo\n'), f, 'devuelve la ruta escrita');
  eq(readFileSync(f, 'utf8'), 'hola\nmundo\n', 'contenido exacto');
}));

test('sobrescribe un archivo existente sin dejar restos', () => withTmp('lib-wa-', (d) => {
  const f = write(join(d, 'notas.md'), 'viejo');
  writeAtomic(f, 'nuevo');
  eq(readFileSync(f, 'utf8'), 'nuevo', 'reemplaza');
  eq(debris(d), [], 'sin residuos de temp tras el éxito');
  eq(readdirSync(d), ['notas.md'], 'el directorio solo contiene el destino');
}));

test('JSON inválido: no renombra, no deja temp y NO corrompe el original', () => withTmp('lib-wa-', (d) => {
  const f = write(join(d, 'cache.json'), '{"original":true}\n');
  const e = throws(() => writeAtomic(f, '{roto'), 'lanza ante JSON inválido');
  match(e.message, /cache\.json/, 'el mensaje nombra la ruta');
  eq(readFileSync(f, 'utf8'), '{"original":true}\n', 'el original intacto');
  eq(debris(d), [], 'sin residuos de temp');
}));

test('JSON inválido sobre archivo inexistente: no crea nada', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'nuevo.json');
  throws(() => writeAtomic(f, 'no soy json'), 'lanza');
  eq(readdirSync(d), [], 'ni destino ni temp: nada quedó escrito');
}));

test('JSON válido: valida el temporal y renombra', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'ok.json');
  writeAtomic(f, '{"a":[1,2]}\n');
  eq(JSON.parse(readFileSync(f, 'utf8')).a, [1, 2], 'contenido usable');
  eq(debris(d), [], 'sin residuos');
}));

test('destino .txt: la validación JSON no aplica', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'crudo.txt');
  writeAtomic(f, '{esto no es json');
  eq(readFileSync(f, 'utf8'), '{esto no es json', 'se escribe tal cual');
}));

test('el directorio destino no existe: lo crea', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'nuevo-sub', 'mas-adentro', 'notas.md');
  writeAtomic(f, 'ok\n');
  eq(readFileSync(f, 'utf8'), 'ok\n', 'escribe creando los directorios intermedios');
  eq(debris(join(d, 'nuevo-sub')), [], 'sin residuos en el subdirectorio');
}));

test('mkdir:false falla si el directorio no existe y nombra la ruta', () => withTmp('lib-wa-', (d) => {
  const f = join(d, 'no-existe', 'a.md');
  const e = throws(() => writeAtomic(f, 'x', { mkdir: false }), 'falla sin crear directorios');
  match(e.message, /no-existe/, 'el mensaje nombra la ruta');
}));

test('ruta vacía: TypeError (error de programación, no de fs)', () => {
  throws(() => writeAtomic('', 'x'), 'lanza TypeError');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/core — isMain');
// ═════════════════════════════════════════════════════════════════════════════

const URL_ = 'file:///C:/proj/.opencode/scripts/doctor.mjs';

test('true para la ruta exacta del script', () => {
  eq(isMain(URL_, 'C:\\proj\\.opencode\\scripts\\doctor.mjs'), true, 'win32 nativo');
  eq(isMain('file:///home/u/p/.opencode/scripts/doctor.mjs', '/home/u/p/.opencode/scripts/doctor.mjs'), true, 'posix');
  eq(isMain(URL_, 'C:/proj/.opencode/scripts/doctor.mjs'), true, 'separadores mezclados');
});

test('true con ruta estilo Windows (.cmd) y barra invertida en todo el path', () => {
  eq(isMain(URL_, 'C:\\proj\\.opencode\\scripts\\doctor.cmd'), true, 'shim .cmd del mismo basename');
  eq(isMain(URL_, 'C:\\proj\\.opencode\\scripts\\doctor.bat'), true, 'shim .bat');
});

test('true con path Windows en otra capitalización (el FS de Windows no distingue)', () => {
  eq(isMain(URL_, 'c:\\PROJ\\.OpenCode\\scripts\\doctor.mjs'), true, 'comparación sin capitalización');
});

test('false para un archivo distinto', () => {
  eq(isMain(URL_, 'C:\\proj\\.opencode\\scripts\\memory-index.mjs'), false, 'otro script');
  eq(isMain(URL_, 'C:\\proj\\.opencode\\skills\\loader.mjs'), false, 'otra carpeta');
});

test('false para el mismo basename en otra carpeta (la copia divergente que compara solo el nombre)', () => {
  eq(isMain(URL_, 'C:\\otro\\doctor.mjs'), false, 'homónimo fuera de la carpeta del módulo');
  eq(isMain(URL_, 'C:\\proj\\.opencode\\scripts\\lib\\doctor.cmd'), false, '.cmd de otra subcarpeta');
});

test('false con argv vacío o ausente', () => {
  eq(isMain(URL_, ''), false, 'cadena vacía');
  eq(isMain(URL_, '   '), false, 'solo espacios');
  eq(isMain(URL_, undefined), false, 'undefined');
  eq(isMain(URL_, null), false, 'null');
  eq(isMain('', ''), false, 'URL vacía');
});

test('isMain(import.meta.url, process.argv[1]) es true al ejecutar este archivo', () => {
  const self = pathToFileURL(join(REPO, 'test', 'lib.test.mjs')).href;
  eq(isMain(self, join(REPO, 'test', 'lib.test.mjs')), true, 'coincide con su propia ruta absoluta');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/core — EXIT_CODES y salida de CLI');
// ═════════════════════════════════════════════════════════════════════════════

test('EXIT_CODES: tabla documentada, congelada, con las claves de init.mjs', () => {
  eq(EXIT_CODES, { OK: 0, USO: 1, CONFIRMA: 2, DEPENDENCIA: 3, BACKUP: 4, PARCIAL: 5 }, 'tabla completa');
  eq(Object.isFrozen(EXIT_CODES), true, 'congelada');
  throws(() => { 'use strict'; EXIT_CODES.OK = 99; }, 'no se puede mutar');
  eq(EXIT_CODES.OK, 0, 'sigue en 0 tras el intento de mutación');
});

test('exitUsage: texto a stderr y salida con USO (1)', () => {
  const src = `import { exitUsage } from ${JSON.stringify(CORE_URL)}; exitUsage('Uso: memoria <query>\\n  node memoria.mjs search "q"');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8' });
  eq(r.status, EXIT_CODES.USO, 'sale con USO');
  match(r.stderr, /^Uso: memoria <query>/, 'stderr con el bloque de uso');
  eq(r.stdout, '', 'nada en stdout');
});

test('fail: "<ámbito>: <mensaje>" a stderr y salida con el código dado', () => {
  const src = `import { fail, EXIT_CODES } from ${JSON.stringify(CORE_URL)}; fail('memory-index', 'No encontrado: 2026-01-01', EXIT_CODES.CONFIRMA);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8' });
  eq(r.status, EXIT_CODES.CONFIRMA, 'sale con el código pedido');
  eq(r.stderr.trim(), 'memory-index: No encontrado: 2026-01-01', 'formato único de error');
});

test('fail: sin código explícito usa USO (1)', () => {
  const src = `import { fail } from ${JSON.stringify(CORE_URL)}; fail('doctor', 'algo');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8' });
  eq(r.status, EXIT_CODES.USO, 'por defecto USO');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/md — field');
// ═════════════════════════════════════════════════════════════════════════════

test('presente: topic y review_after de una decisión', () => {
  const line = '- Harness md+grep sin DB [topic: architecture/stack-md-grep] review_after: 2026-12-03';
  eq(field(line, 'topic'), 'architecture/stack-md-grep', 'topic extraído');
  eq(field(line, 'review_after'), '2026-12-03', 'review_after extraído');
});

test('presente: topic de una entrada de SUMMARY', () => {
  eq(field('topic: sdd/routing-organico\n**Goal:** x', 'topic'), 'sdd/routing-organico', 'primer campo de la entrada');
});

test('ausente: devuelve null (no cadena vacía)', () => {
  eq(field('sin metadatos aqui', 'topic'), null, 'sin campo -> null');
  eq(field('', 'topic'), null, 'texto vacío -> null');
  eq(field(undefined, 'topic'), null, 'undefined -> null');
});

test('valor vacío: devuelve null', () => {
  eq(field('topic:   ', 'topic'), null, 'sin valor -> null');
  eq(field('review_after:', 'review_after'), null, 'campo pelado -> null');
});

test('valor con barras: se conserva completo', () => {
  eq(field('[topic: sdd/login/spec]', 'topic'), 'sdd/login/spec', 'dos niveles de barras');
  eq(field('topic: a/b/c/d', 'topic'), 'a/b/c/d', 'cuatro niveles');
  eq(field('topic: kebab-con-guiones', 'topic'), 'kebab-con-guiones', 'guiones conservados');
});

test('el valor no se traga el resto de la línea', () => {
  const line = '- algo [topic: a/b] review_after: 2026-12-03';
  eq(field(line, 'topic'), 'a/b', 'para en el ]');
  eq(field(line, 'review_after'), '2026-12-03', 'para al final de la línea');
});

test('name casa como palabra completa', () => {
  eq(field('review_after: 2026-12-03', 'after'), null, 'no casa dentro de review_after');
  eq(field('mi_topic: a/b', 'topic'), null, 'no casa dentro de mi_topic');
});

test('sin distinguir mayúsculas y tolerante a espacios/CRLF', () => {
  eq(field('Topic:  A/B', 'topic'), 'A/B', 'mayúscula en el valor y en la clave');
  eq(field('TOPIC: a/b', 'topic'), 'a/b', 'clave en mayúsculas');
  eq(field('topic:\ta/b', 'topic'), 'a/b', 'tabulador tras los dos puntos');
  eq(field('topic: a/b' + CR + '\nreview_after: 2026-12-03' + CR, 'review_after'), '2026-12-03', 'cuerpo CRLF');
});

test('name vacío: null en vez de regex degenerado', () => {
  eq(field('topic: a/b', ''), null, 'sin nombre no hay campo');
});

test('pattern propio: el adoptador puede endurecer el charset', () => {
  const body = 'review_after: 2026-12-03 extra';
  eq(field(body, 'review_after', { pattern: '\\d{4}-\\d{2}-\\d{2}' }), '2026-12-03', 'charset restringido');
  eq(field('topic: 2026', 'topic', { pattern: '[a-z/]+' }), null, 'el pattern puede no casar');
  eq(field('topic: a/b 2', 'topic', { pattern: '[a-z/]+' }), 'a/b', 'y corta donde el pattern manda');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/md — fenceSpans');
// ═════════════════════════════════════════════════════════════════════════════

test('entrada vacía: sin spans', () => {
  eq(fenceSpans(''), [], 'vacío');
  eq(fenceSpans(undefined), [], 'undefined');
  eq(fenceSpans('texto sin fences\n'), [], 'sin fences');
});

test('fence de backticks básico: un span que cubre el bloque', () => {
  const md = 'antes\n```js\n## 2026-01-01 — X\n```\ndespues\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span');
  assert(inside(spans, md.indexOf('## 2026-01-01')), 'el contenido está dentro');
  assert(!inside(spans, md.indexOf('antes')), 'el preámbulo está fuera');
  assert(!inside(spans, md.indexOf('despues')), 'el epílogo está fuera');
  eq(md.slice(spans[0][0], spans[0][1]), '```js\n## 2026-01-01 — X\n```', 'el rango es el bloque entero');
});

test('un heading dentro del fence se trata como DENTRO (no es una entrada)', () => {
  const md = '## 2026-05-01 — real\n```\n## 2026-01-01 — fake\n```\n';
  const spans = fenceSpans(md);
  assert(!inside(spans, md.indexOf('## 2026-05-01')), 'el heading real está fuera');
  assert(inside(spans, md.indexOf('## 2026-01-01')), 'el heading del fence está dentro');
});

test('fence de tilde: también cuenta', () => {
  const md = '~~~sh\n## 2026-01-01 — X\n~~~\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span de tildes');
  assert(inside(spans, md.indexOf('## 2026-01-01')), 'contenido dentro');
});

test('carácter distinto NO cierra: ~~~ no cierra un fence de backticks', () => {
  const md = '```\na\n~~~\nb\n```\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un solo span');
  assert(inside(spans, md.indexOf('\nb\n')), 'b sigue dentro: la tilde no cerró');
  eq(md.slice(spans[0][1]).trim(), '', 'el span cierra en el último ```');
});

test('y al revés: ``` no cierra un fence de tildes', () => {
  const md = '~~~\na\n```\nb\n~~~\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un solo span');
  assert(inside(spans, md.indexOf('\nb\n')), 'b sigue dentro');
});

test('cierre más largo sí cierra (len >= apertura)', () => {
  const md = '```\na\n`````\nb\n```\n';
  const spans = fenceSpans(md);
  // Los 5 backticks cierran el fence de 3 (regla >=), y el ``` final abre otro.
  eq(spans.length, 2, 'el primer fence cerró; el último ``` abre uno nuevo');
  assert(inside(spans, md.indexOf('\na\n')), 'a dentro del primero');
  assert(!inside(spans, md.indexOf('\nb\n')), 'b queda FUERA: 5 backticks cierran un fence de 3');
});

test('cierre más corto NO cierra (len < apertura)', () => {
  const md = '````\na\n```\nb\n```\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span');
  assert(inside(spans, md.indexOf('\nb\n')), 'b sigue dentro: 3 no cierran un fence de 4');
  eq(spans[0][1], md.length, 'el fence sin cerrar llega al final del texto');
});

test('texto tras el marcador de cierre NO cierra', () => {
  const md = '```\na\n``` no cerrar\nb\n```\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span');
  assert(inside(spans, md.indexOf('no cerrar')), 'esa línea sigue siendo contenido');
  assert(inside(spans, md.indexOf('\nb\n')), 'b sigue dentro');
});

test('indentación de hasta 3 caracteres abre; 4 no', () => {
  eq(fenceSpans('   ```\na\n   ```\n').length, 1, '3 espacios abren y cierran');
  eq(fenceSpans('    ```\n    a\n').length, 0, '4 espacios es código indentado, no un fence');
});

test('backticks en línea (inline code) no abren fence', () => {
  const md = 'Usa ```foo``` en la linea.\n';
  eq(fenceSpans(md), [], 'los backticks en línea no abren un bloque');
});

test('info string con backtick no abre fence (CommonMark)', () => {
  const md = '```a`b\nc\n```\n';
  const spans = fenceSpans(md);
  // La apertura no cuenta; el ``` final sí abre un fence sin cerrar (no es un
  // error del parser, es un archivo truncado), así que lo que importa es que
  // 'c' NO quede cubierto.
  eq(spans.length, 1, 'solo el fence final queda abierto');
  assert(!inside(spans, md.indexOf('\nc\n')), 'c es texto plano, no contenido de fence');
});

test('fence sin cerrar: un span hasta el final', () => {
  const md = '```\na\nb\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span abierto');
  eq(spans[0][1], md.length, 'llega al final (no desalinea offsets ajenos)');
});

test('varios fences: spans ordenados, sin solaparse', () => {
  const md = '```\n1\n```\ntexto\n~~~\n2\n~~~\n';
  const spans = fenceSpans(md);
  eq(spans.length, 2, 'dos spans');
  assert(spans[0][1] < spans[1][0], 'ordenados y disjuntos');
  assert(inside(spans, md.indexOf('\n1\n')), '1 dentro del primero');
  assert(!inside(spans, md.indexOf('texto')), 'el medio fuera');
  assert(inside(spans, md.indexOf('\n2\n')), '2 dentro del segundo');
});

test('tolerante a CRLF: los offsets siguen alineados con el texto original', () => {
  const md = '```js' + CR + '\n## 2026-01-01 — X' + CR + '\n```' + CR + '\nfin' + CR + '\n';
  const spans = fenceSpans(md);
  eq(spans.length, 1, 'un span');
  assert(inside(spans, md.indexOf('## 2026-01-01')), 'contenido dentro');
  assert(!inside(spans, md.indexOf('fin')), 'el epílogo fuera');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/md — sectionText');
// ═════════════════════════════════════════════════════════════════════════════

const DOC = [
  '# TITULO', '', '## 1. Fase actual', '', 'fase', '',
  '## 2. Decisiones de diseño', '', '- decision A [topic: a/b]', '- decision B',
  '', '## 3. Pendientes', '', '- pendiente', '',
].join('\n');

test('extrae la sección numerada pedida (heading incluido)', () => {
  const s = sectionText(DOC, 2);
  match(s, /^## 2\. Decisiones de diseño/, 'empieza en su heading');
  includes(s, '- decision A', 'incluye su contenido');
  assert(!s.includes('- pendiente'), 'no se pasa de la sección 3');
  includes(s, '## 2.', 'el heading forma parte del cuerpo (mismo criterio que memory-stats)');
});

test('última sección: llega al final del documento', () => {
  const s = sectionText(DOC, 3);
  includes(s, '- pendiente', 'contenido de la última');
  assert(!s.includes('decision A'), 'no arrastra secciones anteriores');
});

test('sección inexistente: cadena vacía', () => {
  eq(sectionText(DOC, 9), '', 'sin sección 9');
  eq(sectionText('', 2), '', 'documento vacío');
  eq(sectionText(undefined, 2), '', 'undefined');
});

test('tolerante al espaciado: no depende de split("## 2.")', () => {
  const d = '## 1. Uno\n\n##  2.  Dos\n\ncuerpo\n\n## 3. Tres\n';
  includes(sectionText(d, 2), 'cuerpo', 'casa con espacios extra tras ##');
  assert(!sectionText(d, 2).includes('Tres'), 'y aun así corta en la 3');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/md — listChangelog');
// ═════════════════════════════════════════════════════════════════════════════

test('directorio ausente: [] sin lanzar', () => withTmp('lib-lc-', (d) => {
  eq(listChangelog(join(d, 'no-existe')), [], 'sin directorio, sin semanas');
  eq(listChangelog(''), [], 'ruta vacía');
  eq(listChangelog(undefined), [], 'undefined');
}));

test('directorio vacío: []', () => withTmp('lib-lc-', (d) => {
  eq(listChangelog(d), [], 'directorio vacío');
}));

test('lista los .md ordenados e ignora lo que no es archivo semanal', () => withTmp('lib-lc-', (d) => {
  for (const f of ['2026-09-21.md', '2026-09-07.md', 'DECISIONS-ARCHIVE.md', 'notas.txt', '2026-09-14.md.json']) write(join(d, f), 'x');
  mkdirSync(join(d, 'sub.md')); // directorio con nombre de .md: NO es una semana
  eq(listChangelog(d), ['2026-09-07.md', '2026-09-21.md', 'DECISIONS-ARCHIVE.md'], 'orden ascendente, solo .md de archivo');
}));

test('orden estable y sin duplicados', () => withTmp('lib-lc-', (d) => {
  for (const f of ['2026-09-14.md', '2026-08-31.md', '2026-09-07.md']) write(join(d, f), 'x');
  eq(listChangelog(d), listChangelog(d), 'mismo directorio -> mismo resultado');
  includes(listChangelog(d), '2026-08-31.md', 'incluye la semana más antigua');
}));

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/md — todayUTC');
// ═════════════════════════════════════════════════════════════════════════════

const utcOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const localOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('sin argumentos: la fecha UTC de hoy (calculada desde toISOString, no fija)', () => {
  const expected = new Date().toISOString().slice(0, 10);
  eq(todayUTC(), expected, 'igual a la fecha UTC de ahora');
  match(todayUTC(), /^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD');
});

test('usa los campos UTC, no los locales, en cualquier instante', () => {
  const instants = [
    '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', '2026-03-15T02:30:00Z',
    '2026-06-30T12:00:00Z', '2026-12-31T23:00:00Z', '2027-02-28T00:00:00Z',
  ].map((s) => new Date(s));
  let divergen = 0;
  for (const d of instants) {
    eq(todayUTC(d), utcOf(d), `instante ${d.toISOString()} -> su fecha UTC`);
    if (utcOf(d) !== localOf(d)) divergen++;
  }
  // Si la máquina está en un huso distinto de UTC, algunas fechas locales
  // difieren: todayUTC debe seguir la UTC en todas, nunca la local.
  if (divergen > 0) assert(true, `${divergen}/${instants.length} fechas locales difieren y aun así devuelve la UTC`);
});

test('meses de un dígito y años cortos se rellenan a dos dígitos (año sin padding)', () => {
  eq(todayUTC(new Date('2026-01-05T00:00:00Z')), '2026-01-05', 'mes 01');
  eq(todayUTC(new Date('2026-09-09T00:00:00Z')), '2026-09-09', 'día 09');
  // Misma semántica que `fmtUTC` de memory-stats: el año se imprime tal cual, sin
  // rellenar a 4 dígitos (a diferencia de toISOString).
  eq(todayUTC(new Date(Date.UTC(999, 0, 2))), '999-01-02', 'año < 1000 no rompe ni engaña');
});

test('instante inválido: TypeError con mensaje claro', () => {
  const e = throws(() => todayUTC(new Date('no-es-fecha')), 'lanza');
  match(e.message, /todayUTC/, 'el mensaje nombra la función');
  throws(() => todayUTC('basura'), 'también con un string no parseable');
});

// ═════════════════════════════════════════════════════════════════════════════
suite('lib/cache — fingerprint + isFresh');
// ═════════════════════════════════════════════════════════════════════════════

// Árbol de memoria en miniatura. `path` DEBE ser la ruta que se puede abrir
// (aquí absoluta): `fingerprint` hace stat de `entry.path`, así que quien
// indexe por ruta relativa tiene que resolver el root antes de llamar.
const memTree = (d) => {
  const cl = join(d, 'CHANGELOG');
  mkdirSync(cl, { recursive: true });
  write(join(d, 'PROJECT_STATE.md'), '# estado\n');
  write(join(d, 'SUMMARY.md'), '# resumen\n');
  write(join(cl, '2026-09-07.md'), '# semana\n');
  const rels = ['PROJECT_STATE.md', 'SUMMARY.md', join('CHANGELOG', '2026-09-07.md')];
  return {
    entries: () => rels.map((rel) => ({ path: join(d, rel) })),
    file: (rel) => join(d, rel),
  };
};

test('fingerprint: lee mtime/size, ordena por clave y preserva los campos del llamante', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const fp = fingerprint(t.entries());
  eq(fp.map((e) => e.path), t.entries().map((e) => e.path).sort(), 'orden ascendente por clave');
  eq(fp[0].path, join(d, 'CHANGELOG', '2026-09-07.md'), 'primero CHANGELOG (C < P < S)');
  eq(fp[0].size, readFileSync(t.file(join('CHANGELOG', '2026-09-07.md')), 'utf8').length, 'size real');
  assert(fp[0].mtime > 0, 'mtime real');
  assert('path' in fp[0] && 'key' in fp[0], 'conserva path y añade key');
}));

test('fingerprint: determinista e independiente del orden de entrada', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const a = fingerprint(t.entries());
  const b = fingerprint([...t.entries()].reverse());
  eq(a, b, 'mismo árbol -> mismo fingerprint, en cualquier orden');
  eq(fingerprint(a, (e) => e.path), a.map((e) => ({ ...e, key: e.path })), 'idempotente');
}));

test('fingerprint: archivo ausente o ilegible = 0/0, nunca excepción', () => withTmp('lib-fp-', (d) => {
  const fp = fingerprint([{ path: join(d, 'fantasma.md') }]);
  eq(fp, [{ path: join(d, 'fantasma.md'), key: join(d, 'fantasma.md'), mtime: 0, size: 0 }], '0/0');
  eq(fingerprint([]), [], 'entrada vacía');
  eq(fingerprint(undefined), [], 'undefined');
}));

test('sin cambios: fresh', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const cached = fingerprint(t.entries());
  eq(isFresh(cached, fingerprint(t.entries())), true, 'árbol intacto -> fresh');
}));

test('archivo tocado por tamaño: stale', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const cached = fingerprint(t.entries());
  write(t.file('SUMMARY.md'), '# resumen\n\n- entrada nueva\n');
  eq(isFresh(cached, fingerprint(t.entries())), false, 'otro tamaño -> stale');
}));

test('archivo tocado solo por mtime (mismo tamaño): stale', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const cached = fingerprint(t.entries());
  const otro = new Date(Date.now() - 86400000);
  utimesSync(t.file('SUMMARY.md'), otro, otro); // mtime explícito: no depende del grano del FS
  eq(isFresh(cached, fingerprint(t.entries())), false, 'stale solo por mtime');
}));

test('archivo añadido: stale', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const cached = fingerprint(t.entries());
  const rel = join('CHANGELOG', '2026-09-14.md');
  write(t.file(rel), '# semana 2\n');
  eq(isFresh(cached, fingerprint([...t.entries(), { path: t.file(rel) }])), false, 'más entradas -> stale');
}));

test('archivo eliminado: stale', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const cached = fingerprint(t.entries());
  const sin = t.entries().filter((e) => e.path !== t.file('SUMMARY.md'));
  rmSync(t.file('SUMMARY.md'));
  eq(isFresh(cached, fingerprint(sin)), false, 'menos entradas -> stale');
}));

test('archivo movido (misma clave, otra ruta): stale', () => withTmp('lib-fp-', (d) => {
  const t = memTree(d);
  const viejo = t.file(join('CHANGELOG', '2026-09-07.md'));
  const nuevo = t.file(join('CHANGELOG', '2026-09-07-renombrado.md'));
  write(nuevo, '# semana\n');
  // Indexando por ruta, el renombrado cambia la clave y cae antes; aquí se
  // comprueba la rama de `path`: MISMA clave, ruta distinta (skill movida).
  const porClave = () => 'k';
  const cached = fingerprint([{ path: viejo }], porClave);
  eq(isFresh(cached, fingerprint([{ path: nuevo }], porClave), porClave), false, 'ruta distinta con la misma clave -> stale');
  eq(isFresh(cached, fingerprint([{ path: viejo }], porClave), porClave), true, 'misma ruta y misma clave -> fresh');
}));

test('entrada vacía: fingerprint([]) es fresh consigo misma', () => {
  eq(fingerprint([]), [], 'sin entradas');
  eq(isFresh([], []), true, 'vacío contra vacío -> fresh');
  eq(isFresh(fingerprint([]), fingerprint([{ path: 'x' }])), false, 'vacío contra uno -> stale');
});

test('caché ausente o corrupta: no array -> stale, sin lanzar', () => {
  eq(isFresh(null, []), false, 'null');
  eq(isFresh(undefined, []), false, 'undefined');
  eq(isFresh({ entries: [] }, []), false, 'objeto con otra forma');
  eq(isFresh([], undefined), false, 'current no es array');
  let lanzó = false;
  try { isFresh('basura', []); } catch { lanzó = true; }
  eq(lanzó, false, 'no lanza con basura: una caché rota se regenera');
});

test('keyFn propio: valida por nombre, no por ruta (familia skill-loader)', () => withTmp('lib-fp-', (d) => {
  const skills = ['_project-docs', '_sdd-lite', '_skill-loader'].map((name) => {
    const dir = join(d, name);
    mkdirSync(dir, { recursive: true });
    return { name, path: write(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`), source: 'proyecto' };
  });
  const byName = (s) => s.name;
  const cached = fingerprint(skills, byName);
  eq(cached.map((e) => e.key), ['_project-docs', '_sdd-lite', '_skill-loader'], 'ordenado por nombre');
  eq(cached[0].source, 'proyecto', 'conserva los campos extra del llamante');
  eq(isFresh(cached, fingerprint([...skills].reverse(), byName), byName), true, 'mismo conjunto, otro orden -> fresh');
  write(skills[1].path, '---\nname: _sdd-lite\n---\n\ncuerpo nuevo\n');
  eq(isFresh(cached, fingerprint(skills, byName), byName), false, 'un cuerpo distinto -> stale');
  eq(isFresh(cached, fingerprint(skills.filter((s) => s.name !== '_sdd-lite'), byName), byName), false, 'skill retirada -> stale');
}));

test('doble comprobación: writeAtomic + isFresh sobre un archivo real', () => withTmp('lib-fp-', (d) => {
  const f = join(d, 'cache.json');
  writeAtomic(f, JSON.stringify({ v: 1 }, null, 2));
  const entries = [{ path: f }];
  const cached = fingerprint(entries);
  eq(JSON.parse(readFileSync(f, 'utf8')).v, 1, 'primera escritura legible');
  eq(isFresh(cached, fingerprint(entries)), true, 'caché escrita y releída: fresh');
  // Otro TAMAÑO: la detección fiable. (Reescribir con el mismo tamaño depende
  // del grano del mtime, así que no se usa como criterio de test — ver el
  // punto ciego que se congela justo debajo.)
  writeAtomic(f, JSON.stringify({ v: 1, extra: 'x' }, null, 2));
  eq(isFresh(cached, fingerprint(entries)), false, 'el segundo writeAtomic invalida la caché');
}));

test('punto ciego conocido: mismo tamaño y mismo mtime = fresh (P3.1, sin hash de contenido)', () => withTmp('lib-fp-', (d) => {
  const f = join(d, 'cache.json');
  const entries = [{ path: f }];
  // mtime fijado a un instante exacto (milisegundos divisibles) en AMBOS
  // estados: el redondeo del FS es el mismo, así que la comparación es
  // determinista sea cual sea la granularidad del disco.
  const t = Date.UTC(2020, 0, 1);
  const pin = () => utimesSync(f, t / 1000, t / 1000);
  writeAtomic(f, '{"v":1}'); pin();
  const cached = fingerprint(entries);
  writeAtomic(f, '{"v":2}'); pin();
  const after = fingerprint(entries);
  eq(after[0].size, cached[0].size, 'mismo tamaño');
  eq(after[0].mtime, cached[0].mtime, 'mismo mtime (fijado)');
  eq(readFileSync(f, 'utf8'), '{"v":2}', 'el contenido SÍ cambió');
  eq(isFresh(cached, after), true, 'fresh: por eso las rutas de escritura llaman a su invalidación');
}));

// ═════════════════════════════════════════════════════════════════════════════
suite('lib — drops de seguridad');
// ═════════════════════════════════════════════════════════════════════════════

test('la biblioteca no depende de ningún script del harness (sin ciclos)', () => {
  for (const rel of ['core.mjs', 'md.mjs', 'cache.mjs']) {
    const src = readFileSync(join(REPO, '.opencode', 'scripts', 'lib', rel), 'utf8');
    neq(/from\s+'\.\.\/(?!lib)/.test(src), true, `${rel} no importa fuera de lib/`);
    for (const script of ['memory-rotate.mjs', 'memory-index.mjs', 'memory-sync.mjs', 'memory-stats.mjs', 'memory-lock.mjs', 'loader.mjs']) {
      assert(!src.includes(script), `${rel} no menciona ${script}`);
    }
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    for (const i of imports) assert(i.startsWith('node:'), `${rel}: import permitido node:* (${i})`);
  }
});

test('ninguna función exportada lanza un error de fs crudo con la ruta en el mensaje', () => withTmp('lib-err-', (d) => {
  const e1 = throws(() => writeAtomic(join(d, 'a', 'b.json'), 'nope'));
  includes(e1.message, 'b.json', 'writeAtomic nombra la ruta');
  const e2 = throws(() => writeAtomic(join(d, 'x', 'y.md'), 'z', { mkdir: false }));
  includes(e2.message, 'y.md', 'writeAtomic (mkdir:false) nombra la ruta');
}));

test('throwsAsync cubre también un fallo síncrono dentro de una fn async', async () => {
  await withTmp('lib-err-', async (d) => {
    const e = await throwsAsync(async () => writeAtomic(join(d, 'z.json'), '{'));
    includes(e.message, 'z.json', 'el rechazo nombra la ruta');
  });
});

await runAll();
