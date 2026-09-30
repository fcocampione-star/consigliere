#!/usr/bin/env node
/**
 * test/init.test.mjs — smoke test de caracterizacion del instalador `init.mjs`.
 *
 * Reglas del suite:
 *  - CERO dependencias: solo `node:*` + el micro-framework `test/harness.mjs`.
 *  - TODA la instalacion ocurre en directorios temporales creados con `tmpdir()`
 *    y borrados con `cleanup()` en `finally`. Nunca se instala en este repo.
 *  - El instalador se maneja SIEMPRE como proceso hijo con `spawnSync`,
 *    `input: ''` + stdin pipeado (nunca puede colgarse esperando teclado) y un
 *    timeout como red de seguridad.
 *  - Si falta una herramienta externa (git/tar) el paso se OMITE y se reporta,
 *    nunca se convierte en fallo.
 *
 * Comportamiento caracterizado (ver init.mjs, lineas a la fecha de este archivo):
 *  - `--quick`/`-y` (init.mjs:604, 570-582) fuerza el happy path: ignora los
 *    flags posteriores (`--autoskills`, `--git`, `--force`, `--dry-run`), avisa
 *    "Directorio no vacio" si el destino no esta vacio y lo SOBREESCRIBE. Fija
 *    AUTO_CHOICE='3' (sin npx) y DO_GIT=true (init.mjs:551-556): es decir
 *    `git init/add/commit` SIEMPRE corre, pero solo dentro del temporal.
 *  - Instalacion no interactiva sobre directorio no vacio se NIEGA: exit 1 +
 *    mensaje con --force/--dry-run/--upgrade (init.mjs:674-686).
 *  - `--dry-run` no escribe nada (init.mjs:727-732), tampoco crea el destino.
 *  - Destino inexistente: se crea con `mkdirSync(recursive)` (init.mjs:735).
 *  - `--help`/`--version` salen con 0 (init.mjs:601-602, 488-537).
 *  - Un flag desconocido es un error de uso: `init.mjs <dir> --flag-inexistente`
 *    sale con 1 y NO escribe nada (parseo por tabla de flags). Sin destino el
 *    mismo flag avisa, imprime el uso y sale con 1 por falta de destino.
 *    Ver test 'flag desconocido CON destino...' y 'flag desconocido SIN destino...'.
 *
 * Sobre placeholders: `renderFile` sustituye por splicing de texto crudo
 * (init.mjs:147-156), asi que un marcador desconocido sobrevive tal cual. El
 * escaner de este archivo busca `{{CLAVE}}` (clave en mayusculas). El unico
 * `{{` legitimo que queda en el arbol generado es el ejemplo documentado
 * `{{MODEL_*}}` de AGENTS.md (templates/AGENTS.md:25), que por llevar `*` no
 * casa con el patron de marcador y ademas se comprueba aparte.
 *
 * Suite 2 — seguridad de datos (lo que el camino feliz no cubria). El contrato
 * de la rama es "el backup previo es obligatorio, la memoria NUNCA se regenera
 * y la config SI", asi que se comprueba en las dos direcciones:
 *  - install sobre un destino no vacio deja un .tgz con el contenido PREVIO.
 *  - --upgrade preserva PROJECT_STATE/SUMMARY/CHANGELOG, REGENERA AGENTS.md y
 *    funde de opencode.json solo agent.<nombre>.model. Repetido, es idempotente.
 *  - el render salta lo preservado que ya esta respaldado (no lo vacia para
 *    reponerlo despues: la memoria nunca pasa por un estado vacio). El
 *    contenido por si solo no lo demuestra —el restore del backup lo repone
 *    igual—, asi que se comprueba que el render ANUNCIE el salto.
 *  - install en un directorio vacio crea la memoria: el salto no puede
 *    comerse la creacion inicial.
 *  - --restore repone la memoria; un .tgz con ruta absoluta o '../' se rechaza
 *    con exit 4 sin escribir nada (archivo malicioso hecho a mano en Node:
 *    ni bsdtar ni GNU tar dejan crear uno).
 *  - --uninstall --part harness borra por ruta exacta y no toca lo del usuario
 *    (scripts/deploy.sh).
 *  - la poda de backups borra por EDAD (timestamp del nombre, parseado), no por
 *    prefijo, y el preflight solo exige tar si hay algo que respaldar.
 *  - el guardián anti-bucle (init.mjs:208-227): instalar el harness en su PROPIO
 *    repo (templates/.opencode/ + init.mjs + package.json con el nombre del
 *    paquete) se NIEGA con exit 2 sin escribir nada; con --force avisa y sigue (con
 *    su backup previo). Ojo al montar el fixture: sin marca de harness previo
 *    (.opencode/ o AGENTS.md) un --upgrade sale con 1 por uso ANTES de llegar al
 *    guardián (init.mjs:1375), y el nombre del paquete sale del package.json del
 *    repo, no de una constante. Y al revés: un directorio que solo se le parece
 *    (mismo esqueleto, otro `name`) se instala normal.
 */

import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll,
} from './harness.mjs';

// Instalador y repo derivados de la ubicacion de ESTE archivo (nunca absolutos).
// ADVISOR_TEST_INIT solo lo usa la verificacion de no-vacuidad del guardián
// anti-bucle (una COPIA parcheada de init.mjs en un temporal, para comprobar que
// el test de rechazo falla cuando la deteccion se rompe). En el resto de corridas
// es el init.mjs de la raíz, sin indirección.
const INIT = process.env.ADVISOR_TEST_INIT || fileURLToPath(new URL('../init.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../', import.meta.url));
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

const TIMEOUT_MS = 120000;
const MAX_BUFFER = 16 * 1024 * 1024;

// Archivos/directorios que el happy path debe materializar.
const ESPERADOS = [
  'opencode.json',
  'AGENTS.md',
  'PROJECT_STATE.md',
  'SUMMARY.md',
  'skills-lock.json',
  '.opencode/agents/advisor.md',
  '.opencode/scripts/doctor.mjs',
  '.opencode/scripts/routine-model.mjs',
  '.opencode/skills/_skill-loader/loader.mjs',
];
const ESPERADOS_DIR = ['CHANGELOG', '.opencode', '.advisor', '.advisor/backups', '.advisor/chunks'];

// ── Omitidos (herramientas ausentes / diferencias de plataforma) ──────────────
const omitidos = [];
function omitir(motivo) {
  omitidos.push(motivo);
  console.log(`  [omitido] ${motivo}`);
}

function toolVersion(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  const txt = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return txt.split('\n')[0] || cmd;
}
const GIT = toolVersion('git', ['--version']);
const TAR = toolVersion('tar', ['--version']);

// ── Utilidades ──────────────────────────────────────────────────────────────
function existe(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function esDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
function leer(p) {
  return readFileSync(p, 'utf8');
}
function cola(s, n = 400) {
  const t = String(s || '').trimEnd();
  return t.length <= n ? t : `${t.slice(0, n)}...`;
}

// Lista rutas relativas POSIX de todos los archivos del arbol, saltando .git
// (sus objetos van comprimidos: un grep ahi no es determinista ni barato).
function listar(root, acc = [], cur = root) {
  for (const e of readdirSync(cur, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(cur, e.name);
    if (e.isDirectory()) listar(root, acc, p);
    else if (e.isFile()) acc.push(relative(root, p).split(sep).join('/'));
  }
  return acc.sort();
}

// Instala como proceso hijo. stdin pipeado y vacio: ningun prompt puede colgar
// la corrida aunque el instalador intente leer de la terminal. `env` permite
// simular una maquina sin una herramienta (PATH vacio).
function instalar(args, cwd, env) {
  const r = spawnSync(process.execPath, [INIT, ...args], {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const res = { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout || '', stderr: r.stderr || '' };
  res.out = `${res.stdout}${res.stderr}`;
  assert(!res.error, `install.mjs no arranco (${args.join(' ')}): ${res.error && res.error.message}`);
  assert(!res.signal, `el instalador termino por senal ${res.signal} (${args.join(' ')})`);
  return res;
}

function salida(res, ctx) {
  return `${ctx}: exit=${res.status}\n${cola(res.out, 600)}`;
}

// ── Utilidades de seguridad de datos (backup / upgrade / restore / uninstall) ──
const RE_BACKUP = /^(?:harness|advisor)-.*\.tgz$/;
const DIR_BACKUPS = '.advisor/backups';

function escribir(p, txt) {
  writeFileSync(p, txt, 'utf8');
}
// Anade al final conservando lo que habia (asi el sentinel se distingue del
// contenido de la plantilla sin depender de la plantilla).
function anadir(p, txt) {
  writeFileSync(p, `${leer(p)}\n\n${txt}\n`, 'utf8');
}
function backupsDe(dir) {
  try {
    return readdirSync(join(dir, ...DIR_BACKUPS.split('/'))).filter((f) => RE_BACKUP.test(f)).sort();
  } catch {
    return [];
  }
}
// Miembros de un .tgz (o null si tar no lo puede leer).
function miembros(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
// Extrae a un temporal propio para poder COMPARAR el contenido archivado con el
// que habia antes del install.
function extraerEn(tgz, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync('tar', ['-xzf', tgz, '-C', dest], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert(!r.error && r.status === 0, `no se pudo extraer ${tgz}: ${r.stderr || (r.error && r.error.message)}`);
  return dest;
}
// Foto del arbol: { ruta relativa -> contenido }. `skip` deja fuera lo que cambia
// en cada corrida (backups, repo git).
function instantanea(root, skip = ['.advisor', '.git']) {
  const out = {};
  for (const rel of listar(root)) {
    if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
    out[rel] = leer(join(root, ...rel.split('/')));
  }
  return out;
}

// --- .tgz。...
// Un .tgz malicioso hay que construirlo A MANO: ni bsdtar ni GNU tar aceptan
// meter rutas absolutas o '../' en un archivo que ellos mismos crean (lo
// stripsan), así que para poder probar el rechazo del instalador se escribe la
// cabecera ustar (512 B) en Node puro + gzip. Formato: sin cambios respecto al
// ustar de POSIX, que es lo que leen los dos tars de las tres plataformas de CI.
function octalTar(n, len) {
  return `${n.toString(8).padStart(len - 1, '0')}\0`;
}
function cabeceraUstar(name, size) {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, 'utf8');
  b.write(octalTar(0o644, 8), 100, 8, 'ascii'); // mode
  b.write(octalTar(0, 8), 108, 8, 'ascii'); // uid
  b.write(octalTar(0, 8), 116, 8, 'ascii'); // gid
  b.write(octalTar(size, 12), 124, 12, 'ascii');
  b.write(octalTar(1750000000, 12), 136, 12, 'ascii'); // mtime (fijo: determinista)
  b.write('        ', 148, 8, 'ascii'); // chksum = espacios
  b.write('0', 156, 1, 'ascii'); // typeflag: fichero
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  let suma = 0;
  for (const byte of b) suma += byte;
  b.write(`${suma.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return b;
}
function tgzDe(members) {
  const trozos = [];
  for (const [name, content] of members) {
    const data = Buffer.from(content, 'utf8');
    trozos.push(cabeceraUstar(name, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) trozos.push(Buffer.alloc(pad));
  }
  trozos.push(Buffer.alloc(1024)); // dos bloques de fin
  return gzipSync(Buffer.concat(trozos));
}

// Fixture que imita la raiz del repo del harness, tal y como la detecta
// isHarnessSource (init.mjs:208): templates/.opencode/ + init.mjs + un
// package.json cuyo name sea el del paquete del harness. El nombre sale del
// package.json de ESTE repo (nunca hardcodeado) para que un renombrado del
// paquete no deje los tests probando otra cosa.
// Los interruptores quitan UNA condicion cada uno, que es lo que permite
// comprobar que el guardián decide por la que falta y no por "hay templates/":
//  - conInit=false: sin init.mjs (y sin la marca de harness previo, que --upgrade
//    exige en main(): sin .opencode/ ni AGENTS.md un --upgrade sale con 1 por uso,
//    ANTES de llegar al guardián).
//  - conAgents=true: AGENTS.md, la marca mínima de "proyecto con harness previo".
//    También es lo único que hay que respaldar, así que con --upgrade hace falta
//    tar: sin él, el preflight corta con 3 antes de que el guardián opine.
function fixtureHarnessSource(parent, nombre, { conInit = true, conAgents = false, dirName = 'harness-falso' } = {}) {
  const dir = join(parent, dirName);
  mkdirSync(join(dir, 'templates', '.opencode'), { recursive: true });
  escribir(join(dir, 'templates', '.opencode', 'nota.txt'), 'contenido de plantilla, da igual lo que sea\n');
  if (conInit) escribir(join(dir, 'init.mjs'), '// instalador del fixture, cualquier contenido\n');
  escribir(join(dir, 'package.json'), `${JSON.stringify({ name: nombre, version: PKG.version }, null, 2)}\n`);
  if (conAgents) escribir(join(dir, 'AGENTS.md'), '# AGENTS del fixture\n\nDivergencia propia que el render puede pisar sin dano.\n');
  return dir;
}

// ── Escaneo de placeholders ─────────────────────────────────────────────────
// Marcador de plantilla: {{CLAVE}} con CLAVE en mayusculas/guion bajo/digitos.
// Un `*` lo convierte en ejemplo documentado, no en marcador a sustituir.
const RE_MARCADOR = /\{\{[A-Z][A-Z0-9_]*\}\}/g;
const RE_EJEMPLO = /\{\{[A-Z][A-Z0-9_]*\*\}\}/g;

function assertSinMarcadores(texto, donde) {
  eq(texto.match(RE_MARCADOR) || [], [], `quedaron placeholders sin sustituir en ${donde}`);
}
function assertSinMarcadoresEnArbol(root) {
  for (const rel of listar(root)) {
    assertSinMarcadores(leer(join(root, ...rel.split('/'))), `${root}/${rel}`);
  }
}

function assertArbolBase(root) {
  for (const rel of ESPERADOS) {
    assert(existe(join(root, ...rel.split('/'))), `falta el archivo esperado ${rel} en ${root}\n${cola(listar(root).join(', '), 600)}`);
  }
  for (const rel of ESPERADOS_DIR) {
    assert(esDir(join(root, ...rel.split('/'))), `falta el directorio esperado ${rel}/ en ${root}`);
  }
}

// Opciones no interactivas y sin red: sin autoskills (npx) y sin git.
const SIN_RED = ['--autoskills', '3', '--git', 'no'];

// =============================================================================
suite('init.mjs - instalador (smoke de caracterizacion)');

test('--quick en directorio vacio: exit 0 y arbol base completo', () => {
  const base = tmpdir('advisor-init-quick');
  const dir = join(base, 'proyecto');
  try {
    const res = instalar(['--quick', dir], base);
    eq(res.status, 0, salida(res, 'instalacion --quick'));
    assert(esDir(dir), `--quick debe crear el destino ${dir}`);
    assertArbolBase(dir);
    match(res.out, /Happy path/, salida(res, 'debe announce el happy path'));
    match(res.out, /Harness Gen/, salida(res, 'debe imprimir el banner del harness'));
    includes(res.out, `v${PKG.version}`, `el banner debe llevar la version de package.json (${PKG.version})`);
    if (!GIT) {
      omitir('git ausente: se omite la asercion de .git/ y del hook post-commit (--quick fija DO_GIT=true)');
    } else {
      assert(esDir(join(dir, '.git')), '--quick inicializa git en el destino');
      assert(existe(join(dir, '.git', 'hooks', 'post-commit')), '--quick instala el hook post-commit');
      if (process.platform === 'win32') {
        omitir('win32: chmod(0o755) no aplica, se omite el bit ejecutable del hook post-commit');
      } else {
        const modo = statSync(join(dir, '.git', 'hooks', 'post-commit')).mode & 0o777;
        assert(modo & 0o111, `el hook post-commit deberia ser ejecutable (modo ${modo.toString(8)})`);
      }
    }
  } finally {
    cleanup(base);
  }
});

test('el opencode.json generado es JSON valido y con los agentes esperados', () => {
  const base = tmpdir('advisor-init-json');
  const dir = join(base, 'proyecto');
  try {
    const res = instalar([dir, ...SIN_RED], base);
    eq(res.status, 0, salida(res, 'instalacion no interactiva'));
    const txt = leer(join(dir, 'opencode.json'));
    let cfg = null;
    try {
      cfg = JSON.parse(txt);
    } catch (e) {
      throw new Error(`opencode.json generado no es JSON valido: ${e.message}\n${cola(txt)}`);
    }
    eq(typeof cfg, 'object', 'la raiz de opencode.json debe ser un objeto');
    includes(Object.keys(cfg).join(','), '$schema', 'falta $schema en el config generado');
    assert(cfg.agent && typeof cfg.agent === 'object', 'falta el mapa agent en el config generado');
    for (const nombre of ['advisor', 'planner', 'builder', 'verifier', 'critic', 'summarizer', 'explore']) {
      assert(cfg.agent[nombre], `falta el agente ${nombre} en el config generado`);
    }
    // Sin modelos por defecto los marcadores {{MODEL_*}} deben quedar como "".
    for (const [nombre, def] of Object.entries(cfg.agent)) {
      eq(def.model, '', `el agente ${nombre} deberia heredar el modelo (modelo vacio)`);
    }
    assertSinMarcadores(txt, 'opencode.json generado');
  } finally {
    cleanup(base);
  }
});

test('el arbol generado no deja placeholders sin resolver (sustitucion de valores y de vacios)', () => {
  const base = tmpdir('advisor-init-vars');
  const dir = join(base, 'proyecto');
  try {
    const res = instalar([dir, '--name', 'PROYECTO-PRUEBA', '--stack-db', 'sqlite', ...SIN_RED], base);
    eq(res.status, 0, salida(res, 'instalacion con --name y --stack-db'));

    // Asercion de mayor valor: ningun {{CLAVE}} sobrevive en todo el arbol.
    assertSinMarcadoresEnArbol(dir);

    // ... y los valores si llegaron por splicing de texto crudo.
    const agents = leer(join(dir, 'AGENTS.md'));
    includes(agents, 'PROYECTO-PRUEBA', 'PROJECT_NAME no quedo sustituido en AGENTS.md');
    includes(agents, 'sqlite', 'STACK_DB no quedo sustituido en AGENTS.md');
    assert(!agents.includes('N/A'), 'no se esperaba el placeholder N/A en AGENTS.md generado');
    includes(leer(join(dir, 'PROJECT_STATE.md')), 'PROYECTO-PRUEBA', 'PROJECT_NAME no quedo sustituido en PROJECT_STATE.md');
    includes(leer(join(dir, '.opencode', 'agents', 'advisor.md')), 'PROYECTO-PRUEBA', 'PROJECT_NAME no quedo sustituido en advisor.md');

    // El unico `{{` admisible es el ejemplo documentado `{{MODEL_*}}` de AGENTS.md.
    const ejemplos = [];
    for (const rel of listar(dir)) {
      const txt = leer(join(dir, ...rel.split('/')));
      const hits = txt.match(/\{\{[^\n]{0,60}?\}\}/g) || [];
      for (const h of hits) ejemplos.push({ rel, hit: h });
    }
    eq(
      ejemplos,
      [{ rel: 'AGENTS.md', hit: '{{MODEL_*}}' }],
      'todo `{{` sin sustituir debe ser el ejemplo documentado de AGENTS.md',
    );
    // skills-lock.json tambien es plantilla .json: debe quedar JSON valido.
    const lock = JSON.parse(leer(join(dir, 'skills-lock.json')));
    assert(lock && typeof lock === 'object', 'skills-lock.json generado no es un objeto JSON');
  } finally {
    cleanup(base);
  }
});

test('autoprueba del escaner: el assert de placeholders no es vacuo', () => {
  const sintetico = '# demo\nmodel: "{{MODEL_BUILDER}}"\n';
  const e = throws(
    () => assertSinMarcadores(sintetico, 'fixture sintetico'),
    'el escaner debe fallar ante un marcador sin resolver',
  );
  match(e.message, /MODEL_BUILDER/, 'el fallo del escaner debe nombrar el marcador encontrado');
  // Y no debe fallar con el ejemplo documentado ni con un texto limpio.
  assertSinMarcadores('sin nada que sustituir aqui\n', 'fixture limpio');
  assertSinMarcadores('documentado: `{{MODEL_*}}`\n', 'fixture con ejemplo');
});

test('destino inexistente (ruta anidada): se crea con exit 0', () => {
  const base = tmpdir('advisor-init-nuevo');
  const dir = join(base, 'a', 'b', 'proyecto-nuevo');
  try {
    assert(!existe(dir), 'precondicion: el destino debe empezar sin existir');
    const res = instalar([dir, ...SIN_RED], base);
    eq(res.status, 0, salida(res, 'instalacion sobre destino inexistente'));
    assert(esDir(dir), 'el instalador debe crear el directorio destino');
    assertArbolBase(dir);
    assert(!esDir(join(dir, '.git')), '--git no debe inicializar git');
  } finally {
    cleanup(base);
  }
});

test('--dry-run no crea el destino ni escribe nada', () => {
  const base = tmpdir('advisor-init-dry');
  const dir = join(base, 'simulado');
  try {
    const res = instalar([dir, '--dry-run', ...SIN_RED], base);
    eq(res.status, 0, salida(res, '--dry-run'));
    match(res.out, /dry-run/, salida(res, 'debe marcar la simulacion'));
    assert(!existe(dir), '--dry-run no debe crear el directorio destino');
    assert(!existe(join(base, 'proyecto')), '--dry-run no debe escribir nada en el temporal');
  } finally {
    cleanup(base);
  }
});

test('reintento sobre directorio no vacio sin --quick: se niega con exit 1 y no toca el arbol', () => {
  const base = tmpdir('advisor-init-reintento');
  const dir = join(base, 'proyecto');
  try {
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'la primera instalacion debe salir con 0');
    assertArbolBase(dir);
    const antes = leer(join(dir, 'AGENTS.md'));

    const res = instalar([dir, ...SIN_RED], base);
    eq(res.status, 1, salida(res, 'reintento sin --force sobre destino no vacio'));
    match(res.out, /existe y no est/, salida(res, 'debe explicar que el destino no esta vacio'));
    match(res.out, /--force/, salida(res, 'debe sugerir --force'));
    match(res.out, /--upgrade/, salida(res, 'debe sugerir --upgrade'));
    eq(leer(join(dir, 'AGENTS.md')), antes, 'el rechazo no debe haber modificado el arbol');

    // --force si sobrescribe (comportamiento real de init.mjs:674).
    const forzado = instalar([dir, '--force', ...SIN_RED], base);
    eq(forzado.status, 0, salida(forzado, 'reintento con --force'));
    assertArbolBase(dir);
  } finally {
    cleanup(base);
  }
});

test('reintento con --quick: exit 0, avisa y sobreescribe (idempotente)', () => {
  const base = tmpdir('advisor-init-quick2');
  const dir = join(base, 'proyecto');
  try {
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'la primera instalacion debe salir con 0');
    const marca = '<!-- MARCA-DE-PRUEBA -->';
    const agentsPath = join(dir, 'AGENTS.md');
    const conMarca = `${leer(agentsPath)}\n${marca}\n`;
    writeFileSync(agentsPath, conMarca, 'utf8');

    const res = instalar(['--quick', dir], base);
    eq(res.status, 0, salida(res, 'segundo paso con --quick'));
    match(res.out, /Directorio no vac/, salida(res, '--quick debe avisar del destino no vacio'));
    neq(leer(agentsPath).includes(marca), true, '--quick debe sobreescribir los archivos existentes');
    assertArbolBase(dir);
  } finally {
    cleanup(base);
  }
});

test('--version y -v: exit 0 con la version de package.json', () => {
  const base = tmpdir('advisor-init-version');
  try {
    for (const flag of ['--version', '-v']) {
      const res = instalar([flag], base);
      eq(res.status, 0, salida(res, `${flag} debe salir con 0`));
      match(res.stdout, /ADVISOR/i, salida(res, `${flag} debe nombrar el harness`));
      includes(res.stdout, `v${PKG.version}`, `${flag} debe imprimir la version de package.json (${PKG.version})`);
      eq(res.stdout.trim(), `ADVISOR v${PKG.version}`, `${flag} debe imprimir una sola linea`);
    }
  } finally {
    cleanup(base);
  }
});

test('--help y -h: exit 0 con uso, nombre del paquete y version', () => {
  const base = tmpdir('advisor-init-help');
  try {
    for (const flag of ['--help', '-h']) {
      const res = instalar([flag], base);
      eq(res.status, 0, salida(res, `${flag} debe salir con 0`));
      includes(res.stdout, PKG.name, `${flag} debe mencionar el paquete npm ${PKG.name}`);
      includes(res.stdout, `v${PKG.version}`, `${flag} debe imprimir la version de package.json (${PKG.version})`);
      match(res.stdout, /--quick/, `${flag} debe documentar --quick`);
      match(res.stdout, /--dry-run/, `${flag} debe documentar --dry-run`);
      match(res.stdout, /--upgrade/, `${flag} debe documentar --upgrade`);
      match(res.stdout, /--uninstall/, `${flag} debe documentar --uninstall`);
    }
  } finally {
    cleanup(base);
  }
});

test('flag desconocido SIN destino: exit 1 con aviso y uso', () => {
  const base = tmpdir('advisor-init-flag1');
  try {
    const res = instalar(['--flag-inexistente'], base);
    eq(res.status, 1, salida(res, 'flag desconocido sin destino'));
    match(res.out, /Flag desconocido/, salida(res, 'debe avisar del flag desconocido'));
    match(res.out, /Uso r/, salida(res, 'debe imprimir el uso'));
    match(res.out, /Falta el directorio destino/, salida(res, 'el fallo real es la falta de destino'));
  } finally {
    cleanup(base);
  }
});

test('flag desconocido CON destino: exit 1 y no escribe nada (rechazo por flag desconocido)', () => {
  const base = tmpdir('advisor-init-flag2');
  const dir = join(base, 'proyecto');
  try {
    const res = instalar([dir, '--flag-inexistente', ...SIN_RED], base);
    // Comportamiento CORRECTO (tabla de flags): un token `--x` no es un destino,
    // así que se rechaza el comando entero (exit 1 = uso/validación) y no se
    // genera nada. Antes solo avisaba e instalaba igual con exit 0.
    eq(res.status, 1, salida(res, 'flag desconocido con destino debe abortar'));
    match(res.out, /Flag desconocido/, salida(res, 'debe nombrar el flag desconocido'));
    assert(!existe(join(dir, 'AGENTS.md')), 'un flag desconocido no debe generar archivos');
    assert(!esDir(dir), 'un flag desconocido no debe crear el directorio destino');
  } finally {
    cleanup(base);
  }
});

test('--part invalido: exit 1 y no escribe nada', () => {
  const base = tmpdir('advisor-init-part');
  const dir = join(base, 'proyecto');
  try {
    const res = instalar([dir, '--part', 'invalido', ...SIN_RED], base);
    eq(res.status, 1, salida(res, '--part invalido debe rechazarse'));
    match(res.out, /--part inv/, salida(res, 'debe explicar los valores validos'));
    assert(!existe(join(dir, 'AGENTS.md')), 'un --part invalido no debe generar archivos');
  } finally {
    cleanup(base);
  }
});

// =============================================================================
// Suite 2: seguridad de datos. El contrato de la rama es "el backup previo es
// obligatorio, la memoria nunca se regenera, la config sí" y hasta ahora solo
// lo caracterizaba el camino feliz del install. Cada test instala en un temporal
// con --autoskills 3 --git no (sin red, sin repo) y lo borra en el finally.
// Los que necesitan tar se OMITEN (no fallan) si no está en el PATH.
// =============================================================================
suite('init.mjs - seguridad de datos (backup / upgrade / restore / uninstall)');

test('install sobre un destino no vacío: deja un backup con el contenido PREVIO', () => {
  const base = tmpdir('advisor-init-backup');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: el backup previo de un install no se puede ejercitar'); return; }
    mkdirSync(dir, { recursive: true });
    escribir(join(dir, 'AGENTS.md'), 'AGENTS PROPIO v1\n');
    escribir(join(dir, 'PROJECT_STATE.md'), 'ESTADO PROPIO v1\n');
    escribir(join(dir, 'notas.txt'), 'notas del usuario\n');

    const res = instalar([dir, '--force', ...SIN_RED], base);
    eq(res.status, 0, salida(res, 'install con --force sobre destino no vacío'));

    const backups = backupsDe(dir);
    eq(backups.length, 1, `debe quedar exactamente un backup previo, no ${backups.length}`);
    const tgz = join(dir, ...DIR_BACKUPS.split('/'), backups[0]);
    assert(esDir(join(dir, '.opencode')), 'el harness debe quedar instalado tras el install');

    // El .tgz contiene lo que había ANTES, no lo que dejó el render.
    const nombres = miembros(tgz);
    assert(nombres, `tar no pudo listar el backup ${tgz}`);
    for (const esperado of ['AGENTS.md', 'PROJECT_STATE.md']) {
      assert(nombres.includes(esperado), `el backup debe contener ${esperado} (miembros: ${cola(nombres.join(', '))})`);
    }
    const copia = extraerEn(tgz, join(base, 'extraido'));
    eq(leer(join(copia, 'AGENTS.md')), 'AGENTS PROPIO v1\n', 'el backup debe guardar el AGENTS.md anterior al install');
    eq(leer(join(copia, 'PROJECT_STATE.md')), 'ESTADO PROPIO v1\n', 'el backup debe guardar el PROJECT_STATE.md anterior al install');
    // Y el destino ya tiene la versión regenerada.
    neq(leer(join(dir, 'AGENTS.md')), 'AGENTS PROPIO v1\n', 'AGENTS.md debe quedar regenerado desde la plantilla');
  } finally {
    cleanup(base);
  }
});

test('--upgrade preserva la memoria, REGENERA AGENTS.md y funde tu modelo de opencode.json', () => {
  const base = tmpdir('advisor-init-upgrade');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: --upgrade exige backup previo'); return; }
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'el install base debe salir con 0');
    mkdirSync(join(dir, 'CHANGELOG'), { recursive: true });
    anadir(join(dir, 'PROJECT_STATE.md'), '## SENTINEL-ESTADO-USUARIO');
    anadir(join(dir, 'SUMMARY.md'), 'SENTINEL-SUMMARY-USUARIO');
    escribir(join(dir, 'CHANGELOG', '2026-01-05.md'), 'entrada de changelog del usuario');
    anadir(join(dir, 'AGENTS.md'), '<!-- MARCA-QUE-DEBE-DESAPARECER -->');
    const cfgPath = join(dir, 'opencode.json');
    const cfg = JSON.parse(leer(cfgPath));
    cfg.agent.builder.model = 'anthropic/claude-sonnet-4-5';
    escribir(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

    const res = instalar([dir, '--upgrade', ...SIN_RED], base);
    eq(res.status, 0, salida(res, '--upgrade'));

    // PRESERVADO: la memoria no se regenera (ni siquiera durante el proceso).
    includes(leer(join(dir, 'PROJECT_STATE.md')), 'SENTINEL-ESTADO-USUARIO', 'el upgrade debe preservar PROJECT_STATE.md');
    includes(leer(join(dir, 'SUMMARY.md')), 'SENTINEL-SUMMARY-USUARIO', 'el upgrade debe preservar SUMMARY.md');
    includes(leer(join(dir, 'CHANGELOG', '2026-01-05.md')), 'entrada de changelog del usuario', 'el upgrade debe preservar CHANGELOG/');

    // REGENERADO: tu edición de AGENTS.md se pierde, y esa es la gracia del upgrade.
    assert(!leer(join(dir, 'AGENTS.md')).includes('MARCA-QUE-DEBE-DESAPARECER'), 'AGENTS.md debe REGENERARSE (la marca editada tiene que desaparecer)');

    // FUSIÓN: de opencode.json solo sobrevive agent.<nombre>.model.
    const nuevo = JSON.parse(leer(cfgPath));
    eq(nuevo.agent.builder.model, 'anthropic/claude-sonnet-4-5', 'el modelo del usuario debe pasar al opencode.json regenerado');
    eq(nuevo.agent.explore.model, '', 'un agente sin modelo propio debe seguir heredando');
    includes(leer(cfgPath), '$schema', 'el opencode.json regenerado debe conservar el resto de la plantilla');
  } finally {
    cleanup(base);
  }
});

test('--upgrade dos veces seguidas deja el árbol idéntico (idempotente)', () => {
  const base = tmpdir('advisor-init-idem');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: --upgrade exige backup previo'); return; }
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'el install base debe salir con 0');
    anadir(join(dir, 'PROJECT_STATE.md'), '## SENTINEL-ESTADO-USUARIO');
    eq(instalar([dir, '--upgrade', ...SIN_RED], base).status, 0, 'el primer upgrade debe salir con 0');
    const primera = instantanea(dir);
    assert(Object.keys(primera).length > 10, `el árbol generado debe tener archivos que comparar (hay ${Object.keys(primera).length})`);

    const segunda = instalar([dir, '--upgrade', ...SIN_RED], base);
    eq(segunda.status, 0, salida(segunda, 'el segundo upgrade debe salir con 0'));
    const tras = instantanea(dir);
    eq(Object.keys(tras).sort(), Object.keys(primera).sort(), 'un --upgrade repetido no debe crear ni quitar archivos');
    const distintos = Object.keys(primera).filter((k) => tras[k] !== primera[k]);
    eq(distintos, [], `un --upgrade repetido debe dejar el contenido idéntico (cambiaron: ${cola(distintos.join(', '))})`);
    includes(tras['PROJECT_STATE.md'], 'SENTINEL-ESTADO-USUARIO', 'la memoria sigue intacta tras dos upgrades');
  } finally {
    cleanup(base);
  }
});

test('--restore desde el backup del install repone la memoria', () => {
  const base = tmpdir('advisor-init-restore');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: --restore necesita tar para extraer'); return; }
    mkdirSync(dir, { recursive: true });
    escribir(join(dir, 'PROJECT_STATE.md'), 'ESTADO PROPIO v1\n');
    escribir(join(dir, 'AGENTS.md'), 'AGENTS PROPIO v1\n');
    eq(instalar([dir, '--force', ...SIN_RED], base).status, 0, 'install con --force');
    const [backup] = backupsDe(dir);
    assert(backup, 'debe existir un backup que restaurar');

    // Simula la pérdida: la memoria del proyecto se destruye después del install.
    escribir(join(dir, 'PROJECT_STATE.md'), 'MEMORIA PERDIDA\n');
    escribir(join(dir, 'AGENTS.md'), 'AGENTS PERDIDO\n');

    const res = instalar([dir, '--restore', '--from', join(dir, ...DIR_BACKUPS.split('/'), backup)], base);
    eq(res.status, 0, salida(res, '--restore --from <advisor-*.tgz>'));
    eq(leer(join(dir, 'PROJECT_STATE.md')), 'ESTADO PROPIO v1\n', '--restore debe devolver PROJECT_STATE.md tal como estaba antes del install');
    eq(leer(join(dir, 'AGENTS.md')), 'AGENTS PROPIO v1\n', '--restore debe devolver AGENTS.md tal como estaba antes del install');
  } finally {
    cleanup(base);
  }
});

test('--uninstall --part harness deja scripts/deploy.sh intacto y borra lo del harness', () => {
  const base = tmpdir('advisor-init-uninstall');
  const dir = join(base, 'proyecto');
  try {
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'el install base debe salir con 0');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    escribir(join(dir, 'scripts', 'deploy.sh'), '#!/bin/sh\necho deploy propio\n');
    assert(existe(join(dir, 'scripts', 'check-memory-limits.sh')), 'precondición: el harness trae su propio script');

    const res = instalar([dir, '--uninstall', '--part', 'harness', '--force'], base);
    eq(res.status, 0, salida(res, '--uninstall --part harness --force'));

    // Lo del usuario: intacto, contenido incluido.
    assert(existe(join(dir, 'scripts', 'deploy.sh')), 'scripts/deploy.sh es del usuario: --uninstall harness no puede borrarlo');
    eq(leer(join(dir, 'scripts', 'deploy.sh')), '#!/bin/sh\necho deploy propio\n', 'scripts/deploy.sh no debe cambiar de contenido');
    // Lo del harness: fuera, por ruta exacta.
    for (const rel of ['AGENTS.md', 'opencode.json', '.gitignore', 'skills-lock.json', 'scripts/check-memory-limits.sh', '.opencode/agents/advisor.md']) {
      assert(!existe(join(dir, ...rel.split('/'))), `${rel} es del harness y debe desaparecer con --uninstall --part harness`);
    }
    assert(!esDir(join(dir, '.opencode')), '.opencode/ debe quedarse vacío y podarse (no hay nada del usuario dentro)');
    // La memoria es de otro --part: intacta.
    assert(existe(join(dir, 'PROJECT_STATE.md')), '--uninstall --part harness no debe tocar la memoria');
    assert(esDir(join(dir, '.advisor')), '--uninstall --part harness no debe tocar .advisor/');
  } finally {
    cleanup(base);
  }
});

test('un .tgz con ruta absoluta o ../ se rechaza con exit 4 y no escribe fuera del destino', () => {
  const base = tmpdir('advisor-init-evil');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: --restore necesita tar para listar el .tgz'); return; }
    mkdirSync(dir, { recursive: true });
    escribir(join(base, 'canario.txt'), 'NO DEBE CAMBIAR\n');
    const evil = join(base, 'advisor-2001-01-01T00-00-00-000Z.tgz');
    escribir(evil, tgzDe([
      ['../escape.txt', 'PWNED-POR-SUBIDA\n'],
      ['/C:/tmp/abs.txt', 'PWNED-ABSOLUTA\n'],
      ['PROJECT_STATE.md', 'PWNED-MEMORIA\n'],
    ]));
    assert(miembros(evil), 'el .tgz malicioso debe ser legible por tar (si no, el caso no probaría nada)');

    const res = instalar([dir, '--restore', '--from', evil], base);
    eq(res.status, 4, salida(res, 'un .tgz con rutas fuera del destino debe salir con 4 (BACKUP)'));
    match(res.out, /rechazad|no se ha escrito nada/i, 'el fallo debe decir que no se ha escrito nada');
    // Nada fuera del destino: ni un archivo nuevo en el temporal, ni canario tocado.
    eq(leer(join(base, 'canario.txt')), 'NO DEBE CAMBIAR\n', 'el --restore no puede tocar nada fuera del destino');
    assert(!existe(join(base, 'escape.txt')), "no debe existir escape.txt en el padre (miembro '../')");
    for (const rel of listar(base)) {
      assert(!rel.includes('escape.txt') && !rel.includes('abs.txt'), `un miembro escapó del temporal: ${rel}`);
    }
    assert(!existe(join(dir, 'PROJECT_STATE.md')), 'un .tgz rechazado no debe materializar ningún miembro dentro del destino');
  } finally {
    cleanup(base);
  }
});

test('install en un directorio VACÍO crea la memoria (el salto del render no la impide)', () => {
  const base = tmpdir('advisor-init-vacio');
  const dir = join(base, 'proyecto');
  try {
    mkdirSync(dir, { recursive: true });
    assert(backupsDe(dir).length === 0, 'precondición: nada que respaldar en un destino vacío');
    const res = instalar([dir, '--name', 'memoria-nueva', ...SIN_RED], base);
    eq(res.status, 0, salida(res, 'install en directorio vacío'));
    for (const rel of ['PROJECT_STATE.md', 'SUMMARY.md']) {
      assert(existe(join(dir, rel)), `${rel} debe crearse desde la plantilla en un install limpio`);
    }
    includes(leer(join(dir, 'PROJECT_STATE.md')), 'memoria-nueva', 'PROJECT_STATE.md generado debe llevar PROJECT_NAME sustituido');
    match(leer(join(dir, 'SUMMARY.md')), /^# Session Log/m, 'SUMMARY.md debe generarse desde la plantilla (no estar vacío)');
    assert(esDir(join(dir, 'CHANGELOG')), 'CHANGELOG/ debe crearse en un install limpio');
    eq(backupsDe(dir).length, 0, 'sin nada que respaldar no debe crearse un .tgz vacío');
    match(res.out, /no ten/i, 'el informe debe decir que no había memoria previa que preservar');
  } finally {
    cleanup(base);
  }
});

test('--part memoria: el render SALTA la memoria ya respaldada (no la reescribe)', () => {
  const base = tmpdir('advisor-init-skip');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: --part memoria sobre un proyecto existente exige backup'); return; }
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'el install base debe salir con 0');
    anadir(join(dir, 'PROJECT_STATE.md'), '## SENTINEL-ESTADO-USUARIO');
    anadir(join(dir, 'SUMMARY.md'), 'SENTINEL-SUMMARY-USUARIO');

    const res = instalar([dir, '--part', 'memoria', ...SIN_RED], base);
    eq(res.status, 0, salida(res, '--part memoria sobre un proyecto existente'));
    includes(leer(join(dir, 'PROJECT_STATE.md')), 'SENTINEL-ESTADO-USUARIO', 'la memoria debe sobrevivir a --part memoria');
    includes(leer(join(dir, 'SUMMARY.md')), 'SENTINEL-SUMMARY-USUARIO', 'la memoria debe sobrevivir a --part memoria');
    // El contenido por sí solo NO prueba el salto (el restore del backup lo
    // repone igual): lo que lo demuestra es que el render diga que se saltó
    // cada archivo. Sin esa línea, el árbol se vacía y se rellena después.
    for (const rel of ['PROJECT_STATE.md', 'SUMMARY.md']) {
      match(res.out, new RegExp(`${rel}: dato tuyo ya respaldado`), `el render debe anunciar que salta ${rel} (issue 1)`);
    }
  } finally {
    cleanup(base);
  }
});

test('la poda de backups borra por EDAD (timestamp parseado), no por prefijo', () => {
  const base = tmpdir('advisor-init-prune');
  const dir = join(base, 'proyecto');
  try {
    if (!TAR) { omitir('tar ausente: sin backup previo no hay poda que ejercitar'); return; }
    eq(instalar([dir, ...SIN_RED], base).status, 0, 'el install base debe salir con 0');
    const bkDir = join(dir, ...DIR_BACKUPS.split('/'));
    // Seis nombres en LOS DOS formatos que el código produce, con edades
    // intercaladas. Ordenados como string, `advisor-*` y `harness-*` caen en
    // rangos fijos ('a' < 'h') y la poda borraría un grupo por prefijo.
    const falsos = [
      'advisor-2001-01-01T00-00-00-000Z.tgz',
      'harness-2001-01-02T00-00-00-000Z.tgz',
      'advisor-2001-01-03T00-00-00-000Z.tgz',
      'harness-2001-01-04T00-00-00-000Z.tgz',
      'advisor-2001-01-05T00-00-00-000Z.tgz',
      'harness-2001-01-06T00-00-00-000Z.tgz',
    ];
    for (const f of falsos) escribir(join(bkDir, f), 'no es un tgz real, solo un nombre para la poda\n');
    // El install de un destino vacío no deja backup (nada que respaldar): aquí
    // solo están los 6 nombres de prueba, y el upgrade añade el 7º.
    const antes = backupsDe(dir);
    eq(antes.length, 6, `precondición: los 6 nombres de prueba (hay ${antes.length}: ${cola(antes.join(', '))})`);

    eq(instalar([dir, '--upgrade', ...SIN_RED], base).status, 0, '--upgrade que dispara la poda');
    const despues = backupsDe(dir);
    eq(despues.length, 5, `la poda debe dejar 5 backups (dejó ${despues.length}: ${cola(despues.join(', '))})`);
    // Los dos MÁS VIEJOS por timestamp se van, estén donde estén en el string.
    assert(!despues.includes('advisor-2001-01-01T00-00-00-000Z.tgz'), 'el backup más viejo (advisor 01) debe podarse');
    assert(!despues.includes('harness-2001-01-02T00-00-00-000Z.tgz'), 'el segundo más viejo (harness 02) debe podarse');
    for (const f of ['advisor-2001-01-03T00-00-00-000Z.tgz', 'harness-2001-01-04T00-00-00-000Z.tgz', 'advisor-2001-01-05T00-00-00-000Z.tgz', 'harness-2001-01-06T00-00-00-000Z.tgz']) {
      assert(despues.includes(f), `${f} es más reciente que los podados y debe sobrevivir`);
    }
    const reales = despues.filter((f) => !f.includes('2001-'));
    eq(reales.length, 1, `el backup real del upgrade (el más reciente) debe sobrevivir (quedan: ${cola(reales.join(', '))})`);
  } finally {
    cleanup(base);
  }
});

test('preflight: contenido ajeno al harness sin tar NO bloquea el install; con harness sí', () => {
  const base = tmpdir('advisor-init-preflight');
  const dir = join(base, 'proyecto');
  const binVacio = join(base, 'bin-vacio');
  try {
    mkdirSync(binVacio, { recursive: true });
    mkdirSync(dir, { recursive: true });
    escribir(join(dir, 'notas.txt'), 'contenido del usuario, nada del harness\n');
    escribir(join(dir, 'main.js'), '// su codigo\n');
    const sinTar = { ...process.env, PATH: binVacio };

    // No hay nada del harness que respaldar: doBackup no llamaría a tar, así que
    // exigirlo en el preflight sería contradecir su propia regla.
    const res = instalar([dir, '--force', ...SIN_RED], base, sinTar);
    if (!/No encuentro 'tar'/.test(res.out)) {
      omitir(`tar sigue resoluble pese al PATH vacío en ${process.platform}: el caso no probaría nada`);
    } else {
      eq(res.status, 0, salida(res, 'install forzado sin tar sobre un directorio con contenido ajeno'));
      assert(existe(join(dir, 'AGENTS.md')), 'el harness debe generarse igualmente');
      eq(leer(join(dir, 'notas.txt')), 'contenido del usuario, nada del harness\n', 'los archivos del usuario no se tocan');
    }

    // Ahora sí hay algo que respaldar (AGENTS.md es un ítem de BACKUP_ITEMS):
    // sin tar el backup es imposible y el preflight debe cortar con exit 3.
    mkdirSync(dir, { recursive: true });
    escribir(join(dir, 'AGENTS.md'), 'AGENTS PROPIO\n');
    const conHarness = instalar([dir, '--force', ...SIN_RED], base, sinTar);
    if (/No encuentro 'tar'/.test(conHarness.out)) {
      eq(conHarness.status, 3, salida(conHarness, 'install sobre un destino CON harness sin tar (DEPENDENCIA)'));
      eq(leer(join(dir, 'AGENTS.md')), 'AGENTS PROPIO\n', 'sin backup no se puede escribir nada: AGENTS.md intacto');
    }
  } finally {
    cleanup(base);
  }
});

// ── Guardián anti-bucle: el harness NO se instala en su propio repo ──────────
// El hazard es real y ya se demostró: un --upgrade contra este repo regenera
// desde templates/ los ficheros que divergen a propósito (AGENTS.md con el stack
// real, la variante dev de doctor.mjs, contract-tests, version-check, test/) y
// los sustituye por la versión genérica, además de dejar .advisor/backups/ y una
// opencode.json de la raíz que el .gitignore deja de ignorar. El guardián
// (init.mjs:208-227) se niega con 2; con --force avisa y sigue.
test('instalar el harness en su PROPIO repo: exit 2, se explica y no escribe NADA', () => {
  const base = tmpdir('advisor-init-guardian');
  const dir = fixtureHarnessSource(base, PKG.name, { conAgents: true });
  try {
    // El fixture trae AGENTS.md, que está en BACKUP_ITEMS: el preflight exige
    // tar antes de que installTail llegue al guardián. Sin tar, exit 3 y el
    // guardián no se llega a ejecutar: el caso no probaría nada.
    if (!TAR) { omitir('tar ausente: un --upgrade sobre un destino con harness previo exige backup previo y el preflight corta con 3 antes del guardián'); return; }
    const antes = instantanea(dir);

    const res = instalar([dir, '--upgrade', ...SIN_RED], base);
    eq(res.status, 2, salida(res, '--upgrade contra el repo del harness (CONFIRMA)'));
    match(res.out, /es el propio repo del harness/, salida(res, 'debe decir que el destino es el repo del harness'));
    match(res.out, /divergen a prop/, salida(res, 'debe explicar qué se regeneraría y se perdería'));
    match(res.out, /--force/, salida(res, 'debe señalar --force como la salida con confirmación explícita'));
    match(res.out, /pasa la ruta del proyecto/, salida(res, 'debe recordar que la ruta que se quiere es la de un proyecto'));

    // NADA escrito: ni .advisor/ (ni sus backups) ni un solo byte cambiado.
    assert(!esDir(join(dir, '.advisor')), 'un rechazo no debe crear .advisor/ en el repo del harness');
    eq(backupsDe(dir).length, 0, 'un rechazo no debe dejar ningún backup');
    eq(listar(dir), Object.keys(antes), `el rechazo no debe crear archivos (aparecieron: ${cola(listar(dir).join(', '))})`);
    eq(instantanea(dir), antes, 'el rechazo no debe cambiar ni un byte del repo del harness');
  } finally {
    cleanup(base);
  }
});

test('con --force el guardián AVISA y continúa sobre el repo del harness (con backup previo)', () => {
  const base = tmpdir('advisor-init-guardian-force');
  const dir = fixtureHarnessSource(base, PKG.name, { conAgents: true });
  try {
    // Con --force el guardián NO se niega, así que el install sí llega al backup
    // previo (obligatorio) y de ahí al render: sin tar no hay caso que probar.
    if (!TAR) { omitir('tar ausente: con --force el guardián deja pasar el install, que sí hace backup previo'); return; }
    assert(!esDir(join(dir, '.advisor')), 'precondición: el fixture empieza sin estado vivo');

    const res = instalar([dir, '--upgrade', '--force', ...SIN_RED], base);
    eq(res.status, 0, salida(res, '--upgrade --force contra el repo del harness'));
    match(res.out, /--force detectado/, salida(res, 'con --force debe avisar en vez de negarse'));
    match(res.out, /repo del harness/, salida(res, 'el aviso debe decir sobre qué está continúando'));
    assert(esDir(join(dir, '.opencode')), 'con --force el harness debe quedar generado en el fixture');
    eq(backupsDe(dir).length, 1, `y antes de escribir debe haber hecho su backup (hay ${backupsDe(dir).length})`);
    // El fixture es desechable, pero lo que el render NO regenera (init.mjs y
    // package.json no están en templates/) debe seguir siendo lo que pusimos.
    includes(leer(join(dir, 'init.mjs')), 'cualquier contenido', 'el render no debe tocar el init.mjs del fixture (no existe en templates/)');
    eq(JSON.parse(leer(join(dir, 'package.json'))).name, PKG.name, 'el render no debe tocar el package.json del fixture (no existe en templates/)');
  } finally {
    cleanup(base);
  }
});

test('el guardián NO se dispara por un directorio que se le parece (sin su nombre de paquete)', () => {
  const base = tmpdir('advisor-init-guardian-no');
  // Un caso por cada condición que el guardián exige, quitando una sola: si
  // sobre-dispara, estos exits dejan de ser 0.
  const soloTemplates = fixtureHarnessSource(base, 'otro-paquete', { conInit: false, dirName: 'a-solo-templates' });
  const casiIgual = fixtureHarnessSource(base, 'otro-paquete', { dirName: 'b-casi-igual' });
  const conHarness = fixtureHarnessSource(base, 'otro-paquete', { conAgents: true, dirName: 'c-con-harness-previo' });
  try {
    // a: templates/.opencode/ pero nada de init.mjs. Nada que respaldar, así que
    // ni siquiera hace falta tar. Destino no vacío -> hace falta --force.
    const a = instalar([soloTemplates, '--force', ...SIN_RED], base);
    eq(a.status, 0, salida(a, 'install forzado en un directorio con templates/ y otro paquete'));
    assertArbolBase(soloTemplates);

    // b: idéntico al repo del harness (templates/.opencode/ + init.mjs) y solo
    // cambia el `name` del package.json. Nada que respaldar tampoco.
    const b = instalar([casiIgual, '--force', ...SIN_RED], base);
    eq(b.status, 0, salida(b, 'install forzado en un directorio igual al harness salvo el nombre del paquete'));
    assertArbolBase(casiIgual);

    // c: la MISMA invocación que el rechazo (--upgrade sin --force) pero con otro
    // `name`: aquí solo se diferencia por el nombre, y tiene que instalar.
    if (!TAR) { omitir('tar ausente: el caso c trae AGENTS.md (harness previo) y un --upgrade exige backup'); return; }
    const c = instalar([conHarness, '--upgrade', ...SIN_RED], base);
    eq(c.status, 0, salida(c, '--upgrade sin --force en un directorio con harness previo y otro nombre de paquete'));
    assertArbolBase(conHarness);
  } finally {
    cleanup(base);
  }
});

// ── Informe de entorno y de pasos omitidos ──────────────────────────────────
console.log(`plataforma: ${process.platform} | node: ${process.version} | instalador: ${INIT}`);
console.log(`herramientas externas -> git: ${GIT || 'AUSENTE'} | tar: ${TAR || 'AUSENTE'}`);
if (!TAR) console.log('nota: --upgrade/--restore y el backup previo no se ejercitan sin tar; los tests correspondientes se omiten (nunca fallan).');
console.log(omitidos.length ? `omitidos (${omitidos.length}):\n  - ${omitidos.join('\n  - ')}` : 'omitidos: ninguno');

await runAll();