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
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll,
} from './harness.mjs';

// Instalador y repo derivados de la ubicacion de ESTE archivo (nunca absolutos).
const INIT = fileURLToPath(new URL('../init.mjs', import.meta.url));
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
// la corrida aunque el instalador intente leer de la terminal.
function instalar(args, cwd) {
  const r = spawnSync(process.execPath, [INIT, ...args], {
    cwd,
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

// ── Informe de entorno y de pasos omitidos ──────────────────────────────────
console.log(`plataforma: ${process.platform} | node: ${process.version} | instalador: ${INIT}`);
console.log(`herramientas externas -> git: ${GIT || 'AUSENTE'} | tar: ${TAR || 'AUSENTE'}`);
if (!TAR) console.log('nota: --upgrade (backup con tar) no se ejercita en este smoke; no es necesario para --quick.');
console.log(omitidos.length ? `omitidos (${omitidos.length}):\n  - ${omitidos.join('\n  - ')}` : 'omitidos: ninguno');

await runAll();