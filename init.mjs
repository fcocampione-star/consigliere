#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — Harness de agentes + memoria persistente para opencode.
 * Instalador/generador SOLO por proyecto (Node >=20.11). Sin instalación global.
 *
 * Estado vivo en `.advisor/` (sin ramas legacy).
 *
 * Uso:
 *   node init.mjs                          # modo interactivo
 *   npx advisor-harness@latest /ruta/proyecto  # vía npm (recomendado)
 *   node init.mjs /ruta/proyecto [flags]   # no-interactivo
 *   node init.mjs --version | --help
 *   node init.mjs /ruta/proyecto --status   # diagnóstico read-only (no escribe)
 *   node init.mjs /ruta/proyecto --upgrade [--part harness|memoria|autoskills|all]
 *   node init.mjs /ruta/proyecto --restore --from <advisor|harness>-<ts>.tgz
 *   node init.mjs /ruta/proyecto --uninstall --part <harness|memoria|autoskills|all> [--force]
 *
 * Contrato de códigos de salida (única fuente: `EXIT`, documentado en --help):
 *   0 ok · 1 uso/validación · 2 requiere confirmación · 3 falta tar ·
 *   4 fallo de backup/restauración · 5 fallo parcial
 */

import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const VERSION = '2.0.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const IS_WIN = platform() === 'win32';

const HOME = homedir();
const TEMPLATE_DIR = join(HERE, 'templates');

// Contrato de códigos de salida: ningún return path sale con un código suelto.
const EXIT = {
  OK: 0,          // éxito
  USO: 1,         // error de uso o validación (flag, valor, destino, combinación)
  CONFIRMA: 2,    // hace falta confirmación y no la hubo (no interactivo, cancelada)
  DEPENDENCIA: 3, // falta una dependencia requerida (tar)
  BACKUP: 4,      // falló el backup/restauración con tar
  PARCIAL: 5,     // se escribió algo y un paso posterior falló
};

// Estado: solo vivo. Const ÚNICA de backup/preservados
// (paridad con init.sh/init.ps1: BACKUP_ITEMS/PRESERVED idénticos).
const STATE_DIR = '.advisor';
const BACKUP_ITEMS = ['.opencode', 'AGENTS.md', 'PROJECT_STATE.md', 'SUMMARY.md', 'CHANGELOG', STATE_DIR, 'opencode.json', '.gitignore', 'skills-lock.json', 'scripts'];
const PRESERVED = ['PROJECT_STATE.md', 'SUMMARY.md', 'opencode.json', 'AGENTS.md', '.gitignore'];
// Subsets por --part (allowlist de primer nivel del render; null = árbol completo).
const PART_HARNESS = ['.opencode', 'scripts', 'AGENTS.md', 'opencode.json', '.gitignore', 'skills-lock.json'];
const PART_MEMORIA = ['PROJECT_STATE.md', 'SUMMARY.md', 'CHANGELOG'];
const PARTS = ['harness', 'memoria', 'autoskills', 'all'];
const BACKUP_RE = /^(harness|advisor)-.*\.tgz$/;
const NO_BACKUP = Object.freeze({ file: '', items: [] });

const MIN_NODE = [20, 11, 0];

// Colores
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m',
};
const info = (m) => console.log(`${C.cyan}ℹ️  ${m}${C.reset}`);
const ok = (m) => console.log(`${C.green}✅ ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}⚠️  ${m}${C.reset}`);
const err = (m) => console.log(`${C.red}❌ ${m}${C.reset}`);
const step = (m) => console.log(`\n${C.bold}▶ ${m}${C.reset}`);
const die = (code) => process.exit(code);

function requireNode() {
  const cur = process.versions.node.split('.').map(Number);
  const tooOld = MIN_NODE.some((min, i) => (cur[i] || 0) !== min && (cur[i] || 0) < min);
  if (tooOld) { err(`Node >=${MIN_NODE.join('.')} requerido (usa import.meta.dirname). Actual: ${process.versions.node}`); die(EXIT.USO); }
}

function banner() {
  console.log(`${C.cyan}
                                              ░██           ░██ ░██
                                                            ░██
   ░███████   ░███████  ░████████   ░███████  ░██ ░████████ ░██ ░██ ░███████  ░██░████  ░███████
  ░██    ░██ ░██    ░██ ░██    ░██ ░██        ░██░██    ░██ ░██ ░██░██    ░██ ░███     ░██    ░██
  ░██        ░██    ░██ ░██    ░██  ░███████  ░██░██    ░██ ░██ ░██░█████████ ░██      ░█████████
  ░██    ░██ ░██    ░██ ░██    ░██        ░██ ░██░██   ░███ ░██ ░██░██        ░██      ░██
   ░███████   ░███████  ░██    ░██  ░███████  ░██ ░█████░██ ░██ ░██ ░███████  ░██       ░███████
                                                        ░██
                                                  ░███████
${C.reset}${C.dim}  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v${VERSION} · solo por proyecto)${C.reset}`);
}

// Política de bit ejecutable, explícita y solo-POSIX: en Windows el bit no
// significa nada (manda la extensión) y chmodSync solo tocaría el read-only.
const EXEC_EXT = ['.sh', '.mjs', '.ps1'];
function chmodExecutable(p) {
  if (IS_WIN) return;
  try { chmodSync(p, 0o755); } catch {}
}

// readline helper: resuelve SIEMPRE. Con stdin cerrado (pipe, TTY cerrada) el
// callback de question() nunca llega, así que 'close' es la vía de escape.
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const settle = (v) => { if (done) return; done = true; rl.close(); resolve(v); };
    rl.once('close', () => settle(''));
    rl.question(question, (ans) => settle(ans));
  });
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const c = (await ask(question)).trim();
  return /^[SsYy]$/.test(c);
}

// El asistente sin TTY cuelga para siempre (readline espera teclado que no
// existe) y hoy no devolvía ni una línea: se corta aquí con exit 2.
function requireInteractive() {
  if (process.stdin.isTTY) return;
  err('Sesión no interactiva: stdin no es TTY y el asistente necesita una terminal.');
  err('Usa los flags no interactivos: <ruta> --quick | --name/--stack-*/--autoskills/--git/--force/--dry-run (--help).');
  die(EXIT.CONFIRMA);
}

// Herramientas externas (memoizadas): se resuelven una vez, antes de escribir.
const toolCache = new Map();
function hasTool(cmd, args) {
  if (toolCache.has(cmd)) return toolCache.get(cmd);
  const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true });
  const found = !r.error && r.status === 0;
  toolCache.set(cmd, found);
  return found;
}
const hasTar = () => hasTool('tar', ['--version']);
const hasGit = () => hasTool('git', ['--version']);

// Preflight: todo lo que puede fallar ANTES de tocar el destino. tar es fatal
// solo cuando la operación lo necesita (si no, es un aviso, no un bloqueante).
function preflight({ tar = false } = {}) {
  if (!existsSync(TEMPLATE_DIR)) {
    err(`No encuentro templates en '${TEMPLATE_DIR}'.`);
    err('Si clonaste el repo, ejecuta desde la raíz: node init.mjs /ruta/proyecto');
    die(EXIT.USO);
  }
  if (!hasTar()) {
    if (tar) {
      err(`Falta 'tar' y esta operación lo necesita (--upgrade / --restore / --uninstall memoria).`);
      err('Instala un tar funcional (GNU tar o bsdtar) y repite; sin él no hay backup ni restore.');
      die(EXIT.DEPENDENCIA);
    }
    warn(`No encuentro 'tar': --upgrade, --restore y el backup previo de memoria no estarán disponibles aquí.`);
  }
  if (!hasGit()) warn(`No encuentro 'git': se omiten la inicialización del repo y el hook post-commit.`);
}

// Estado vivo ---------------------------------------------------------------
function stateStatus(target) {
  const vivo = existsSync(join(target, STATE_DIR));
  return { vivo, active: vivo ? STATE_DIR : null };
}

function ensureStateDirs(target, dry) {
  for (const sub of ['', 'backups', 'chunks']) {
    const p = join(target, STATE_DIR, sub);
    if (dry) { info(`[dry-run] mkdir -p ${p}`); continue; }
    mkdirSync(p, { recursive: true });
  }
}

// Backup / restore ----------------------------------------------------------
function doBackup(target, items, dry) {
  const present = items.filter((item) => existsSync(join(target, item)));
  if (present.length === 0) { info('Sin harness previo que respaldar (directorio vacío/inexistente)'); return { file: '', items: [] }; }
  if (dry) {
    info(`[dry-run] backup -> ${STATE_DIR}/backups/advisor-<ts>.tgz (keep 5): ${present.join(', ')}`);
    const preview = PRESERVED.filter((p) => present.includes(p));
    if (preview.length > 0) info(`[dry-run] restore -> ${preview.join(', ')}`);
    return { file: '[dry-run]', items: present };
  }
  const backupDir = join(target, STATE_DIR, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = join(backupDir, `advisor-${ts}.tgz`);
  const tar = spawnSync('tar', ['-czf', backupFile, '-C', target, `--exclude=${STATE_DIR}/backups`, '--exclude=.memory-lock', ...present], { stdio: 'ignore' });
  if (tar.error || tar.status !== 0) {
    // El backup previo es obligatorio: si falla, no se sobrescribe nada.
    err(`Backup falló (tar ${tar.error ? `no disponible: ${tar.error.code || tar.error.message}` : `salió con código ${tar.status}`}): ${backupFile}`);
    die(EXIT.BACKUP);
  }
  ok(`Backup: ${backupFile} (${present.length} ítems)`);
  pruneBackups(backupDir);
  return { file: backupFile, items: present };
}

function pruneBackups(backupDir) {
  try {
    const files = readdirSync(backupDir)
      .filter((f) => /^(harness|advisor)-/.test(f) && f.endsWith('.tgz'))
      .sort()
      .reverse();
    for (const f of files.slice(5)) unlinkSync(join(backupDir, f));
  } catch {}
}

// true = preservado (o nada que preservar), false = el tar falló.
function restorePreserved(target, backupFile, backupItems) {
  const restored = PRESERVED.filter((f) => backupItems.includes(f));
  if (!restored.length || !backupFile) return true;
  const r = spawnSync('tar', ['-xzf', backupFile, '-C', target, ...restored], { stdio: 'ignore' });
  if (r.error || r.status !== 0) { warn(`Restauración de memoria/config falló (backup disponible en ${backupFile})`); return false; }
  ok(`Memoria/config preservadas: ${restored.join(', ')}`);
  return true;
}

// Variables de plantilla -----------------------------------------------------
const STACK_KEYS = ['STACK_DB', 'STACK_BACKEND', 'STACK_FRONTEND', 'STACK_AUTH', 'STACK_VALIDATION', 'STACK_DEPLOY'];
const MODEL_KEYS = ['MODEL_ADVISOR', 'MODEL_PLANNER', 'MODEL_BUILDER', 'MODEL_VERIFIER', 'MODEL_CRITIC', 'MODEL_SUMMARIZER', 'MODEL_EXPLORE'];
// Estas aterrizan dentro de archivos .json (opencode.json): se escapan.
// En markdown el splicing es literal (una barra o un acento se queda igual).
const JSON_VARS = new Set(['PROJECT_NAME', ...MODEL_KEYS]);

// Único origen de las variables de sustitución: install, upgrade, interactivo y
// --quick comparten exactamente el mismo conjunto de claves.
function buildVars(opts) {
  const vars = {
    PROJECT_NAME: opts.projectName || '',
    DEV_COMMANDS: opts.DEV_COMMANDS || '',
    LANG_BACKEND: opts.LANG_BACKEND || 'typescript',
  };
  for (const k of STACK_KEYS) vars[k] = opts[k] || '';
  for (const k of MODEL_KEYS) vars[k] = opts[k] || '';
  return vars;
}

// Escapa como literal JSON el interior de una cadena (comillas, barras,
// controles): sin esto un nombre de proyecto con comillas rompe opencode.json.
function escapeJsonValue(v) {
  return JSON.stringify(String(v)).slice(1, -1);
}

// Render
function renderFile(src, dst, vars) {
  const isJson = src.endsWith('.json');
  let content = readFileSync(src, 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    const value = isJson && JSON_VARS.has(k) ? escapeJsonValue(v ?? '') : (v ?? '');
    content = content.split(`{{${k}}}`).join(value);
  }
  writeFileSync(dst, content, 'utf8');
  if (EXEC_EXT.some((ext) => src.endsWith(ext))) chmodExecutable(dst);
}

// Un único renderizador. `allow` filtra SOLO el primer nivel (así --part
// harness/memoria incluye el .opencode/ entero, como siempre).
function renderTree(srcDir, dstDir, vars, allow = null) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (allow && !allow.includes(e.name)) continue;
    const src = join(srcDir, e.name);
    const dst = join(dstDir, e.name);
    if (e.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      renderTree(src, dst, vars);
    } else if (e.isFile()) {
      const isTemplate = /\.(md|json|mjs|sh|ps1)$/.test(e.name);
      if (isTemplate) renderFile(src, dst, vars);
      else cpSync(src, dst);
    }
  }
}

function partAllowlist(part) {
  return part === 'harness' ? PART_HARNESS : part === 'memoria' ? PART_MEMORIA : null;
}

function renderSelected(srcDir, dstDir, vars, part) {
  renderTree(srcDir, dstDir, vars, partAllowlist(part));
}

// Git helpers
function gitOk(r) {
  return !r.error && r.status === 0;
}

function spawnWhy(r) {
  return r.error ? (r.error.code || r.error.message) : `código ${r.status}`;
}

// Instala el hook post-commit. Nunca pisa un hook existente sin que lo pidas:
// antes lo copia a .advisor/backups/hooks/ y solo lo reemplaza con --force.
function installGitHook(repo, templateDir, force) {
  const src = join(templateDir, '.opencode', 'hooks', 'post-commit-memory-rotate.sh');
  if (!existsSync(src)) {
    warn(`No encuentro la plantilla del hook (${src}): el hook post-commit NO se instaló.`);
    return false;
  }
  const dotGit = join(repo, '.git');
  let st = null;
  try { st = statSync(dotGit); } catch {}
  if (st && !st.isDirectory()) {
    warn(`'.git' es un archivo en '${repo}' (worktree o submódulo): no hay directorio de hooks, el hook post-commit NO se instaló.`);
    return false;
  }
  const hooksDir = join(dotGit, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const dst = join(hooksDir, 'post-commit');
  if (existsSync(dst)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = join(repo, STATE_DIR, 'backups', 'hooks', `post-commit.${ts}.bak`);
    try {
      mkdirSync(dirname(bak), { recursive: true });
      copyFileSync(dst, bak);
    } catch (e) {
      warn(`No se pudo preservar el hook post-commit previo (${e.message}): el hook NO se instaló para no perderlo.`);
      return false;
    }
    if (!force) {
      warn(`Ya existía un hook post-commit: NO se sobrescribió (copia en ${bak}). Usa --force para reemplazarlo.`);
      return false;
    }
    info(`Hook post-commit previo copiado a ${bak} (--force: se reemplaza).`);
  }
  try {
    copyFileSync(src, dst);
  } catch (e) {
    warn(`No se pudo instalar el hook post-commit (${e.message}).`);
    return false;
  }
  chmodExecutable(dst);
  ok('Hook post-commit instalado (rotación de memoria)');
  const cfg = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (gitOk(cfg) && String(cfg.stdout || '').trim()) {
    warn(`El repo fija core.hooksPath=${String(cfg.stdout).trim()}: el hook post-commit puede NO ejecutarse.`);
  }
  return true;
}

// Secuencia git honesta: se informa del resultado de CADA paso. Un fallo de git
// nunca es fatal (el harness ya está escrito) pero nunca se anuncia como éxito.
function gitInitAndCommit(repo, templateDir, force) {
  if (!hasGit()) {
    warn(`No encuentro 'git': no se inicializó repo ni hook en '${repo}' (el harness sí está instalado).`);
    return;
  }
  const fresh = !existsSync(join(repo, '.git'));
  if (fresh) {
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'inherit' });
    if (!gitOk(init)) {
      warn(`git init falló en '${repo}' (${spawnWhy(init)}): el harness queda sin repo git.`);
      warn(`Créalo a mano: cd "${repo}" && git init`);
      return;
    }
  } else {
    info('Ya existía repo git: solo se revisa el hook post-commit.');
  }
  const hook = installGitHook(repo, templateDir, force);
  if (!fresh) return;
  const add = spawnSync('git', ['add', '.'], { cwd: repo, stdio: 'inherit' });
  if (!gitOk(add)) {
    warn(`git add falló (${spawnWhy(add)}): repo inicializado, archivos sin preparar. Usa git add -A a mano.`);
    return;
  }
  const commit = spawnSync('git', ['-c', 'user.name=CONSIGLIERE', '-c', 'user.email=consigliere@local', 'commit', '-q', '-m', 'chore: scaffold harness ADVISOR 2.0'], { cwd: repo, stdio: 'inherit' });
  if (!gitOk(commit)) {
    warn(`git commit falló (${spawnWhy(commit)}): repo inicializado y staged, sin commit. Confirma a mano.`);
    return;
  }
  ok(`Git inicializado${hook ? ' + hook post-commit' : ''} + commit inicial`);
}

function handleAutoskills(mode, dir) {
  if (mode === '2') {
    step('Instalando autoskills global');
    const r = spawnSync('npm', ['i', '-g', 'autoskills'], { stdio: 'inherit', shell: IS_WIN });
    if (r.status === 0) ok('autoskills global instalado');
    else warn('npm i -g autoskills falló');
  } else if (mode === '3') {
    info(`Autoskills omitido. Instálalas luego con: cd "${dir}" && npx autoskills`);
  } else {
    step('Instalando autoskills en el proyecto');
    if (!hasTool('node', ['--version'])) { warn('Node no encontrado. Instala node y corre: npx autoskills'); return; }
    const r = spawnSync('npx', ['--yes', 'autoskills'], { cwd: dir, stdio: 'inherit', shell: IS_WIN });
    if (r.status === 0) ok('autoskills ejecutado');
    else warn('autoskills no corrió (¿falta package.json? Instálalo luego: npx autoskills)');
  }
}

function finish(projectName, targetDir) {
  console.log(`\n${C.green}═══════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}¡Proyecto '${projectName}' listo en ${targetDir}!${C.reset}\n`);
  console.log(`${C.bold}Próximos pasos:${C.reset}`);
  console.log(`  1. cd ${targetDir}`);
  console.log(`  2. Edita AGENTS.md → completa el stack y los comandos dev`);
  console.log(`  3. Edita .opencode/skills/_project-docs/SKILL.md → URLs/shortcuts`);
  console.log(`  4. Opcional: rellena modelos en opencode.json (cheap vs strong)`);
  console.log(`  5. Si tienes package.json → npm install`);
  console.log(`  6. Arranca opencode → /discover (audita contexto + skills) → /routine "configurar base del proyecto"`);
  console.log(`  7. Verifica harness: /doctor | Memoria: node .opencode/scripts/memory-index.mjs search "query"\n`);
  console.log(`${C.bold}Comandos del harness:${C.reset}`);
  console.log(`  /discover [foco]       Audita contexto + skills presentes/faltantes`);
  console.log(`  /routine <tarea>       Ciclo completo (explore→plan/spec→critic→build→verify→record)`);
  console.log(`  /doctor                Diagnóstico del harness y memoria`);
  console.log(`  /record <contexto>     Persistir progreso en la memoria`);
  console.log(`  /review                Listar decisiones stale (review_after)`);
  console.log(`  /rotate-memory         Rotación semanal manual`);
  console.log(`  /compact-state         Compactar PROJECT_STATE.md\n`);
  console.log(`${C.dim}Instalación 100% por proyecto — sin binario global. Actualiza con: npx advisor-harness@latest ${targetDir} --upgrade${C.reset}\n`);
}

// Un dry-run no escribe nada: jamás debe cantar éxito ni la lista de próximos
// pasos de una instalación que no ocurrió.
function dryRunSummary({ projectName, targetDir, scope, upgrade, backup }) {
  const items = (backup && backup.items) || [];
  if (scope !== 'autoskills') info(`[dry-run] would render ${TEMPLATE_DIR} -> ${targetDir} --part ${scope} (project: ${projectName})`);
  info('[dry-run] no se escribió nada en disco');
  console.log(`\n${C.yellow}═══════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}[dry-run] SIMULACIÓN de '${projectName}' en ${targetDir} — nada escrito.${C.reset}\n`);
  console.log(`${C.bold}Pasos simulados:${C.reset}`);
  if (scope === 'autoskills') console.log('  - sin render (--part autoskills: solo autoskills)');
  else console.log(`  - render de plantillas -> ${targetDir} (--part ${scope})`);
  console.log(`  - CHANGELOG/ + ${STATE_DIR}/{,backups,chunks}`);
  if (items.length) {
    console.log(`  - backup de ${items.length} ítems -> ${STATE_DIR}/backups/ (keep 5)`);
    const keep = items.filter((f) => PRESERVED.includes(f));
    if (keep.length) console.log(`  - restauración de memoria/config preservada: ${keep.join(', ')}`);
  }
  if (upgrade) info(`Simulación de upgrade (--part ${scope}): el backup real se haría antes de escribir.`);
  console.log(`${C.dim}Repite el comando sin --dry-run para escribir de verdad.${C.reset}\n`);
}

// --status (read-only) --------------------------------------------------------
function statusCmd(targetDir, projectName) {
  step(`Estado harness '${projectName}' (read-only)`);
  const isHarness = existsSync(join(targetDir, '.opencode')) || existsSync(join(targetDir, 'AGENTS.md'));
  const st = stateStatus(targetDir);
  const parts = {
    harness: existsSync(join(targetDir, '.opencode')),
    memoria: existsSync(join(targetDir, 'PROJECT_STATE.md')) || existsSync(join(targetDir, 'SUMMARY.md')) || existsSync(join(targetDir, 'CHANGELOG')),
    autoskills: existsSync(join(targetDir, '.agents', 'skills')),
  };
  const backups = [];
  try {
    for (const f of readdirSync(join(targetDir, STATE_DIR, 'backups'))) if (BACKUP_RE.test(f)) backups.push(f);
  } catch {}
  backups.sort().reverse();
  const cacheFile = join(targetDir, STATE_DIR, 'skill-registry.cache.json');
  let cache = 'sin cache';
  try {
    const j = JSON.parse(readFileSync(cacheFile, 'utf8'));
    cache = `${cacheFile} (v${j.version}, ${j.entries?.length || 0} skills)`;
  } catch {}
  console.log(`  harness : ${isHarness ? 'sí' : 'no'}`);
  console.log(`  estado  : ${st.active || 'ninguno'} (vivo=${st.vivo})`);
  console.log(`  parts   : harness=${parts.harness} memoria=${parts.memoria} autoskills=${parts.autoskills}`);
  console.log(`  backups : ${backups.length} (keep 5) ${backups[0] ? '→ ' + backups[0] : ''}`);
  console.log(`  cache   : ${cache}`);
  console.log(`  bin     : npx advisor-harness@latest (alias: consigliere-harness)`);
}

// --uninstall (seguro: confirmación sin --force; memoria con backup previo) ---
const UNINSTALL_LISTS = {
  harness: PART_HARNESS,
  memoria: [...PART_MEMORIA, STATE_DIR],
  autoskills: ['.agents'],
};

async function uninstallCmd(targetDir, projectName, part, dry, force) {
  const list = part === 'all' ? [...new Set(Object.values(UNINSTALL_LISTS).flat())] : UNINSTALL_LISTS[part];
  const present = list.filter((item) => existsSync(join(targetDir, item)));
  step(`Desinstalar '${projectName}' --part ${part}`);
  if (!present.length) { info('Nada que desinstalar (sin archivos del harness).'); return; }
  info(`Alcance: ${present.join(', ')}`);
  if (dry) { info('[dry-run] no se borró nada en disco'); return; }
  if (!force) {
    // Sin TTY no hay quien confirme: se dice en vez de fingir un "Cancelado" con exit 0.
    if (!process.stdin.isTTY) {
      err('Desinstalar necesita confirmación y esta sesión no es interactiva: reejecuta con --force.');
      die(EXIT.CONFIRMA);
    }
    const yes = await confirm(`  ¿Borrar ${present.length} ítems del harness en '${targetDir}'? [s/N] `);
    if (!yes) { info('Cancelado (usa --force para no preguntar): no se borró nada.'); die(EXIT.CONFIRMA); }
  }
  if (part === 'memoria' || part === 'all') {
    // Memoria: backup previo OBLIGATORIO (doBackup aborta con exit 4 si falla).
    // Se copia FUERA del target: el backup interno se borraría con .advisor/.
    const memPresent = UNINSTALL_LISTS.memoria.filter((item) => existsSync(join(targetDir, item)));
    if (memPresent.length) {
      step('Backup previo obligatorio de memoria');
      const { file: memBackup } = doBackup(targetDir, memPresent, false);
      if (memBackup) {
        const ext = join(tmpdir(), `advisor-memoria-${Date.now()}.tgz`);
        copyFileSync(memBackup, ext);
        ok(`Copia seguridad externa (sobrevive al borrado): ${ext}`);
      }
    }
  }
  // Borrado explícito por lista (nunca rm -rf amplio, nunca .git).
  let n = 0;
  for (const item of present) {
    try {
      rmSync(join(targetDir, item), { recursive: true, force: true });
      n++;
    } catch (e) { warn(`No se pudo borrar ${item}: ${e.message}`); }
  }
  if (n < present.length) {
    err(`Desinstalación parcial: ${n}/${present.length} ítems borrados de '${targetDir}'.`);
    die(EXIT.PARCIAL);
  }
  ok(`Desinstalado --part ${part}: ${n}/${present.length} ítems`);
}

// --restore -------------------------------------------------------------------
function restoreCmd(targetDir, projectName, from, dry) {
  step(`Restaurar '${projectName}' desde backup`);
  if (!from) { err('--restore requiere --from <archivo.tgz> (advisor-|harness-).'); die(EXIT.USO); }
  const bf = isAbsolute(from) ? from : resolve(process.cwd(), from);
  if (!existsSync(bf)) { err(`Backup no encontrado: ${bf}`); die(EXIT.USO); }
  if (!BACKUP_RE.test(basename(bf))) {
    err(`Backup no válido: '${basename(bf)}' (se aceptan advisor-<ts>.tgz y harness-<ts>.tgz).`);
    die(EXIT.USO);
  }
  if (dry) { info(`[dry-run] tar -xzf ${bf} -C ${targetDir} (no se escribió nada)`); return; }
  mkdirSync(targetDir, { recursive: true });
  const r = spawnSync('tar', ['-xzf', bf, '-C', targetDir], { stdio: 'inherit' });
  if (r.error || r.status !== 0) { err(`Restauración falló (${spawnWhy(r)}; backup intacto en ${bf})`); die(EXIT.BACKUP); }
  ok(`Restaurado desde ${bf}`);
}

// Interactivo
async function promptStackItem(label, opts) {
  console.log(`  ${label}:`);
  opts.forEach((o, i) => console.log(`    ${i + 1}) ${o}`));
  console.log(`    ${opts.length + 1}) Otro... (escribir libre)`);
  console.log(`    ${opts.length + 2}) Saltar (dejar vacío)`);
  const val = (await ask(`  > Elegir [1-${opts.length}] o escribir: `)).trim();
  if (/^\d+$/.test(val)) {
    const n = parseInt(val, 10);
    if (n >= 1 && n <= opts.length) return opts[n - 1];
    return '';
  }
  return val;
}

const MODEL_AGENT = {
  MODEL_ADVISOR: 'advisor', MODEL_PLANNER: 'planner', MODEL_BUILDER: 'builder', MODEL_CRITIC: 'critic',
  MODEL_VERIFIER: 'verifier', MODEL_SUMMARIZER: 'summarizer', MODEL_EXPLORE: 'explore',
};
// Misma clase de caracteres que valida el motor del harness
// (templates/.opencode/scripts/routine-model.mjs → MODEL_RE).
const MODEL_RE = /^[A-Za-z0-9._:\/-]{1,80}$/;

// Un modelo mal escrito deja opencode.json inservible: se rechaza antes de
// escribir nada, con el nombre del agente y la regla en el mensaje.
function checkModelInputs(models) {
  for (const [key, value] of Object.entries(models)) {
    if (!value) continue; // vacío = heredar el modelo por defecto
    if (!MODEL_RE.test(value)) {
      err(`Modelo inválido para ${MODEL_AGENT[key] || key}: "${value}".`);
      err(`Se admiten letras, dígitos y los signos . _ : / - (máx. 80): ${MODEL_RE}`);
      die(EXIT.USO);
    }
  }
}

async function interactiveCreate() {
  requireInteractive();
  banner();
  console.log();
  step('Nuevo proyecto — ADVISOR 2.0 (solo por proyecto)');
  const rawDir = (await ask('  📁 Ruta del directorio del proyecto: ')).trim();
  if (!rawDir) { err('Ruta vacía.'); die(EXIT.USO); }
  const targetDir = resolveTarget(rawDir);
  const parent = dirname(targetDir);
  if (!existsSync(parent)) warn(`El directorio padre '${parent}' no existe. Lo crearé.`);

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    warn(`El directorio '${targetDir}' existe y no está vacío.`);
    const c = (await ask('  ¿Continuar y añadir el harness de todos modos? [s/N] ')).trim();
    if (!/^s$/i.test(c)) { info('Cancelado: no se escribió nada.'); die(EXIT.CONFIRMA); }
  }

  const defaultName = basename(targetDir);
  const projectName = (await ask(`  Nombre del proyecto [${defaultName}]: `)).trim() || defaultName;

  console.log();
  info('Stack (opcional — pre-rellena AGENTS.md y SKILL.md). Enter = saltar.');
  const STACK_DB = await promptStackItem('Base de datos', ['postgresql', 'sqlite', 'mysql', 'mariadb', 'mongodb']);
  const STACK_BACKEND = await promptStackItem('Backend', ['node/express', 'node/fastify', 'nextjs', 'python/fastapi', 'python/django', 'go']);
  const STACK_FRONTEND = await promptStackItem('Frontend', ['react/vite', 'nextjs', 'astro', 'sveltekit', 'vue/vite']);
  const STACK_AUTH = await promptStackItem('Autenticación', ['jwt', 'session', 'oauth2', 'cognito', 'auth0']);
  const STACK_VALIDATION = await promptStackItem('Validación', ['zod', 'valibot', 'joi', 'yup']);
  const STACK_DEPLOY = await promptStackItem('Deploy', ['docker', 'vercel', 'fly', 'railway', 'aws']);

  console.log();
  info('Modelos por subagente (opcional — heredar todos por defecto). cheap=verifier/summarizer/explore, strong=builder/planner/critic');
  const MODEL_CHOICE = (await ask('  ¿Modelos por defecto (heredar todos)? [recomendado]/personalizar: ')).trim();
  const models = {
    MODEL_ADVISOR: '', MODEL_PLANNER: '', MODEL_BUILDER: '', MODEL_CRITIC: '',
    MODEL_VERIFIER: '', MODEL_SUMMARIZER: '', MODEL_EXPLORE: '',
  };
  if (/^p/i.test(MODEL_CHOICE)) {
    const raw = (await ask('  Modelos coma-separados en orden (advisor,planner,builder,critic,verifier,summarizer,explore). Vacío = heredar: ')).trim();
    const parts = raw.split(',').map((s) => s.trim()).slice(0, 7);
    [models.MODEL_ADVISOR, models.MODEL_PLANNER, models.MODEL_BUILDER, models.MODEL_CRITIC, models.MODEL_VERIFIER, models.MODEL_SUMMARIZER, models.MODEL_EXPLORE] = parts;
    checkModelInputs(models);
  }

  console.log();
  step('Opciones finales');
  console.log('  🤖 Autoskills (skills según dependencias):');
  console.log('  1) En el proyecto (npx autoskills)   ← Recomendado');
  console.log('  2) Global (npm i -g autoskills)');
  console.log('  3) Saltar (las instalaré luego)');
  const AUTO_CHOICE = (await ask('  > [1-3]: ')).trim() || '1';
  const gitChoice = (await ask('  📦 Inicializar git + commit inicial? [S/n]: ')).trim();
  const DO_GIT = !/^[Nn]$/.test(gitChoice);

  console.log(`\n  ${C.bold}Resumen:${C.reset}`);
  console.log(`    Proyecto : ${projectName}`);
  console.log(`    Destino  : ${targetDir}`);
  console.log(`    Stack    : ${STACK_DB} | ${STACK_BACKEND} | ${STACK_FRONTEND} | auth=${STACK_AUTH} | val=${STACK_VALIDATION} | deploy=${STACK_DEPLOY}`);
  console.log(`    Autoskills: ${AUTO_CHOICE} | Git init: ${DO_GIT ? 'Sí' : 'No'}`);
  const go = (await ask('  ¿Continuar? [S/n]: ')).trim();
  if (/^[Nn]$/.test(go)) { info('Cancelado: no se escribió nada.'); die(EXIT.CONFIRMA); }

  installTail({
    projectName, targetDir, scope: 'all', dry: false, force: false, doGit: DO_GIT,
    autoChoice: AUTO_CHOICE, upgrade: false, backup: NO_BACKUP,
    STACK_DB, STACK_BACKEND, STACK_FRONTEND, STACK_AUTH, STACK_VALIDATION, STACK_DEPLOY,
    LANG_BACKEND: langBackend(STACK_BACKEND), ...models,
  });
}

// Única secuencia de escritura. Install, upgrade, interactivo y --quick entran
// por aquí: las diferencias son opciones explícitas, no ramas que se puedan
// desincronizar. La restauración de memoria/config se intenta siempre (en un
// install nuevo el backup viene vacío y es un no-op), así la asimetría
// install/upgrade no puede reaparecer.
function installTail(opts) {
  const { projectName, targetDir, scope, dry, force, doGit, autoChoice, upgrade, backup } = opts;
  const verb = upgrade ? 'actualizado' : 'generado';
  const partTag = scope === 'all' ? '' : ` (--part ${scope})`;

  if (dry) { dryRunSummary({ projectName, targetDir, scope, upgrade, backup }); return; }

  step(`${upgrade ? 'Actualizando' : 'Generando'} proyecto '${projectName}'${partTag}`);
  try {
    mkdirSync(targetDir, { recursive: true });
    if (scope === 'autoskills') info('--part autoskills: solo autoskills, sin render');
    else renderSelected(TEMPLATE_DIR, targetDir, buildVars(opts), scope);
    mkdirSync(join(targetDir, 'CHANGELOG'), { recursive: true });
    ensureStateDirs(targetDir, false);
  } catch (e) {
    err(`Escritura del harness incompleta en '${targetDir}': ${e.message}`);
    err(`Árbol a medias: revísalo o restaura con --restore --from <${STATE_DIR}/backups/*.tgz>.`);
    die(EXIT.PARCIAL);
  }
  if (!restorePreserved(targetDir, backup.file, backup.items)) {
    err(`Memoria/config NO restauradas tras ${verb} el harness en '${targetDir}'.`);
    die(EXIT.PARCIAL);
  }
  ok(`Harness ${verb}${partTag} (agents, commands, skills, memoria, scripts)`);
  if (doGit) gitInitAndCommit(targetDir, TEMPLATE_DIR, force);
  else warn('Git no inicializado (--git no).');
  if ((scope === 'all' || scope === 'autoskills') && autoChoice !== '3') handleAutoskills(autoChoice, targetDir);
  finish(projectName, targetDir);
}

function langBackend(stackBackend) {
  if (stackBackend.includes('python')) return 'python';
  if (stackBackend.includes('go')) return 'go';
  return 'typescript';
}

// Solo se expande un `~` inicial: "~algo" es una ruta relativa, no el home.
function resolveTarget(raw) {
  const t = raw.replace(/^~/, HOME);
  return isAbsolute(t) ? resolve(t) : resolve(process.cwd(), t);
}

// Tabla única de flags. `value` marca que consume valor; `enum` valida el
// dominio (y se refleja en el help); `bool` traduce sí/no a booleano;
// `immediate` corta el parseo (--help/--version/--interactive/--quick mandan
// sobre lo que venga después). De aquí se derivan el valor requerido, el texto
// de ayuda, la detección de flags desconocidos y qué tokens son valores de
// flag (y por tanto NUNCA pueden ser el directorio destino).
const FLAGS = [
  { name: 'quick', alias: 'y', immediate: true, help: 'happy path forzado (sin prompts; ignora los flags posteriores)' },
  { name: 'interactive', alias: 'i', immediate: true, help: 'forzar asistente interactivo (aunque el cwd esté vacío)' },
  { name: 'help', alias: 'h', immediate: true, help: 'esta ayuda' },
  { name: 'version', alias: 'v', immediate: true, help: 'versión del harness' },
  { name: 'dir', value: '<ruta>', help: 'directorio destino' },
  { name: 'name', value: '<nombre>', help: 'nombre del proyecto' },
  { name: 'stack-db', value: '<v>', help: 'base de datos (pre-rellena AGENTS.md)' },
  { name: 'stack-backend', value: '<v>', help: 'backend' },
  { name: 'stack-frontend', value: '<v>', help: 'frontend' },
  { name: 'stack-auth', value: '<v>', help: 'autenticación' },
  { name: 'stack-validation', value: '<v>', help: 'validación' },
  { name: 'stack-deploy', value: '<v>', help: 'deploy' },
  { name: 'autoskills', value: '<1|2|3>', enum: ['1', '2', '3'], help: '1=en proyecto (npx), 2=global (npm i -g), 3=omitir' },
  { name: 'git', value: '<yes|no>', bool: true, help: 'inicializar git + commit inicial' },
  { name: 'upgrade', help: 'actualizar un harness existente (alias de --part all; backup keep 5; no requiere --force)' },
  { name: 'part', value: '<p>', enum: PARTS, help: 'alcance modular: harness|memoria|autoskills|all (install/upgrade/uninstall)' },
  { name: 'status', help: 'estado read-only del harness (no escribe)' },
  { name: 'restore', help: 'restaurar un backup (requiere --from)' },
  { name: 'from', value: '<tgz>', help: 'backup a restaurar (advisor-<ts>.tgz o harness-<ts>.tgz)' },
  { name: 'uninstall', help: 'desinstalar el alcance de --part (pide confirmación sin --force; memoria con backup previo)' },
  { name: 'dry-run', help: 'simular: no escribe nada y no imprime el banner de éxito' },
  { name: 'force', help: 'sobrescribir destino no vacío / no preguntar confirmación / reemplazar un hook post-commit existente' },
];

const FLAG_BY_TOKEN = new Map();
for (const f of FLAGS) {
  FLAG_BY_TOKEN.set(`--${f.name}`, f);
  if (f.alias) FLAG_BY_TOKEN.set(`-${f.alias}`, f);
}

const TRUTHY = new Set(['s', 'si', 'sí', 'y', 'yes', 'true', '1', 'on']);
const FALSY = new Set(['n', 'no', 'false', '0', 'off']);

function flagLabel(f) {
  return f.alias ? `--${f.name}, -${f.alias}` : `--${f.name}`;
}

function helpFlags() {
  const width = Math.max(...FLAGS.map((f) => flagLabel(f).length + (f.value ? f.value.length + 1 : 0)));
  return FLAGS
    .map((f) => `  ${(flagLabel(f) + (f.value ? ` ${f.value}` : '')).padEnd(width)}  ${f.help}`)
    .join('\n');
}

function coerceValue(f, token, raw) {
  if (f.enum && !f.enum.includes(raw)) {
    err(`Flag ${token} inválido: '${raw}' (valores: ${f.enum.join('|')}).`);
    die(EXIT.USO);
  }
  if (f.bool) {
    const v = raw.toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    err(`Flag ${token} inválido: '${raw}' (usa yes|no).`);
    die(EXIT.USO);
  }
  return raw;
}

// Una sola pasada. Tras el primer flag immediate, los tokens siguientes ya no
// mandan: se leen (para no perder un --dir o el destino) pero no se validan.
// Un valor de flag se consume siempre como valor, así que jamás puede acabarse
// tomando por el directorio destino.
function parseArgs(args) {
  const values = Object.create(null);
  const positional = [];
  const unknown = [];
  let immediate = null;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    const f = FLAG_BY_TOKEN.get(token);
    if (!f) {
      (token.startsWith('-') ? unknown : positional).push(token);
      continue;
    }
    if (f.immediate && !immediate) immediate = f.name;
    if (!f.value) {
      if (!immediate) values[f.name] = true;
      continue;
    }
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      if (immediate) continue; // ya no manda: el flag immediate ganó
      err(`Flag ${token} requiere un valor ${f.value}.`);
      die(EXIT.USO);
    }
    values[f.name] = immediate ? next : coerceValue(f, token, next);
    i++;
  }
  return { values, positional, unknown, immediate };
}

function warnUnknown(unknown) {
  for (const u of unknown) warn(`Flag desconocido: ${u} (ignorada).`);
}

function missingTarget(scriptName) {
  err('Falta el directorio destino. Usa --dir <ruta> o pasa una ruta posicional.');
  showHelp(scriptName);
  die(EXIT.USO);
}

// ¿Esta operación necesita tar? Determina si su ausencia es fatal (exit 3).
function needsTar({ values, immediate }) {
  if (immediate || values['dry-run']) return false;
  if (values.restore) return true;
  if (values.upgrade) return values.part !== 'autoskills';
  if (values.uninstall) return !values.part || values.part === 'memoria' || values.part === 'all';
  return false;
}

function showHelp(scriptName) {
  console.log(`ADVISOR v${VERSION} — Harness de agentes + memoria persistente para opencode (solo por proyecto).

Uso rápido:
  ${scriptName}                     cwd vacío → genera directamente | cwd no vacío → asistente interactivo
  ${scriptName} --quick | -y        happy path forzado (aunque el cwd no esté vacío)
  ${scriptName} <ruta/proyecto>     no-interactivo (con flags)

Uso avanzado:
  ${scriptName} --version | --help | --interactive
  ${scriptName} <ruta/proyecto> --upgrade [--part harness|memoria|autoskills|all]  actualizar (backup keep 5, preserva memoria/config)
  ${scriptName} <ruta/proyecto> --status   estado read-only (no escribe)
  ${scriptName} <ruta/proyecto> --restore --from <advisor|harness>-<ts>.tgz  restaurar backup
  ${scriptName} <ruta/proyecto> --uninstall --part <harness|memoria|autoskills> [--force]  desinstalar (memoria exige backup previo)
  ${scriptName} <ruta/proyecto> --dry-run  simulación sin escribir

Flags (el destino es el primer token posicional; --dir lo fija explícitamente):
${helpFlags()}

Códigos de salida:
  0  éxito
  1  error de uso o validación: flag desconocido, valor fuera de dominio, falta --part,
     destino no vacío sin --force, --upgrade sin harness previo
  2  hace falta confirmación: sesión no interactiva donde se requiere, o confirmación rechazada
  3  falta una dependencia requerida (tar para --upgrade / --restore / --uninstall memoria)
  4  falló el backup/restauración con tar (el backup previo nunca se descarta)
  5  fallo parcial: se escribió algo y un paso posterior falló

Notas:
  - Sin TTY el asistente no arranca y --uninstall sin --force no borra: exit 2, usa los flags no interactivos.
  - --dry-run no escribe nada y nunca imprime el banner de "proyecto listo".
  - Solo se expande un '~' inicial; los valores de flag nunca se toman por destino.
  - Un hook post-commit existente se copia a .advisor/backups/hooks/ y solo se reemplaza con --force.

Estado: vivo en .advisor/.

Genera: .opencode/ (agents, commands, plans, skills, scripts), AGENTS.md,
PROJECT_STATE.md, SUMMARY.md, CHANGELOG/, .advisor/, .gitignore, skills-lock.json.

Instalación: solo por proyecto, sin binario global.
  npx advisor-harness@latest /ruta/proyecto
  node ./init.mjs /ruta/proyecto

FLUJO RECOMENDADO:
  1. npx advisor-harness@latest .   ('.' = carpeta actual; vacía → directo, con archivos → asistente)
  2. En el asistente: nombre → stack → modelos (por defecto o personalizar) → autoskills → git
  3. Dentro del proyecto: edita AGENTS.md y .opencode/skills/_project-docs/SKILL.md
  4. Arranca: opencode → /discover → /routine "configurar base del proyecto" → /doctor
`);
}

function cwdEmpty() {
  return !existsSync(process.cwd()) || readdirSync(process.cwd()).length === 0;
}

// Happy path sin prompts: defaults, modelos heredados, autoskills omitido (CI-safe), git init+commit.
function happyPath(targetDir = process.cwd()) {
  const projectName = basename(targetDir);
  banner();
  step(`Happy path — generando ADVISOR 2.0 en '.' (${targetDir})`);
  ok('Defaults aplicados (modelos heredados, sin stack).');
  ok('Autoskills: 3 (omitir) | Git init: Sí');
  installTail({
    projectName, targetDir, scope: 'all', dry: false, force: true, doGit: true,
    autoChoice: '3', upgrade: false, backup: NO_BACKUP,
  });
}

// Destino del happy path: --dir manda; si no, el primer token que no sea flag
// ni valor de flag — la tabla garantiza que un valor nunca se confunde con él.
function quickPath(p) {
  const raw = p.values.dir || p.positional[0] || '';
  const targetDir = raw ? resolveTarget(raw) : process.cwd();
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    warn(`Directorio no vacío — happy path forzado con --quick (${targetDir}).`);
  }
  happyPath(targetDir);
}

async function main() {
  requireNode();
  const args = process.argv.slice(2);
  const scriptName = basename(fileURLToPath(import.meta.url));

  // Un preflight por corrida, antes de cualquier escritura. --help y --version
  // no tocan disco, así que se resuelven sin exigir plantillas ni herramientas.
  if (args.length === 0) {
    preflight();
    if (cwdEmpty()) happyPath();
    else await interactiveCreate();
    return;
  }

  const p = parseArgs(args);
  if (p.immediate === 'help') { warnUnknown(p.unknown); showHelp(scriptName); return; }
  if (p.immediate === 'version') { warnUnknown(p.unknown); console.log(`ADVISOR v${VERSION}`); return; }

  preflight({ tar: needsTar(p) });

  if (p.immediate === 'interactive') { warnUnknown(p.unknown); await interactiveCreate(); return; }
  if (p.immediate === 'quick') { warnUnknown(p.unknown); quickPath(p); return; }

  const v = p.values;
  const targetRaw = v.dir || p.positional[0] || '';
  if (p.unknown.length) {
    for (const u of p.unknown) err(`Flag desconocido: '${u}' (usa --help para la lista de flags).`);
    if (!targetRaw) missingTarget(scriptName);
    die(EXIT.USO);
  }
  if (!targetRaw) missingTarget(scriptName);

  const TARGET_DIR = resolveTarget(targetRaw);
  const PROJECT_NAME = v.name || basename(TARGET_DIR);
  const scope = v.part || 'all';
  const force = v.force === true;
  const dry = v['dry-run'] === true;

  // --status es read-only y no exige nada más
  if (v.status) { statusCmd(TARGET_DIR, PROJECT_NAME); return; }
  if (v.restore) { restoreCmd(TARGET_DIR, PROJECT_NAME, v.from, dry); return; }
  if (v.uninstall) {
    if (!v.part) { err('--uninstall requiere --part <harness|memoria|autoskills|all>.'); die(EXIT.USO); }
    await uninstallCmd(TARGET_DIR, PROJECT_NAME, v.part, dry, force);
    return;
  }

  const isHarness = existsSync(join(TARGET_DIR, '.opencode')) || existsSync(join(TARGET_DIR, 'AGENTS.md'));
  if (existsSync(TARGET_DIR) && readdirSync(TARGET_DIR).length > 0 && !force && !dry) {
    if (v.upgrade && !isHarness) {
      // Sin harness previo: --upgrade no tiene sentido, y --force no autoriza a
      // borrar un proyecto ajeno. Es un error de uso, no una confirmación.
      err(`El directorio '${TARGET_DIR}' no es un proyecto advisor/harness (sin .opencode/ ni AGENTS.md). --upgrade requiere un harness previo; usa --force solo si quieres sobrescribir.`);
      die(EXIT.USO);
    }
    if (!v.upgrade && !v.part) {
      err(`El directorio '${TARGET_DIR}' existe y no está vacío. Usa --force para sobrescribir, --dry-run para simular, o --upgrade para actualizar un harness existente.`);
      die(EXIT.USO);
    }
    // install con --part sobre dir no vacío: se permite (alcance modular), avisa
    if (v.part && !v.upgrade) warn(`Install --part ${v.part} sobre directorio no vacío (alcance modular).`);
  }

  const common = {
    projectName: PROJECT_NAME, targetDir: TARGET_DIR, scope, dry, force,
    doGit: v.git === undefined ? true : v.git,
    autoChoice: v.autoskills || '1',
    LANG_BACKEND: langBackend(v['stack-backend'] || ''),
    STACK_DB: v['stack-db'] || '',
    STACK_BACKEND: v['stack-backend'] || '',
    STACK_FRONTEND: v['stack-frontend'] || '',
    STACK_AUTH: v['stack-auth'] || '',
    STACK_VALIDATION: v['stack-validation'] || '',
    STACK_DEPLOY: v['stack-deploy'] || '',
    // La CLI no tiene flags de modelo (solo el asistente interactivo los
    // rellena), así que aquí quedan vacíos y opencode.json hereda los modelos.
  };

  if (v.upgrade) {
    // --upgrade --part autoskills no toca el harness: sin backup que hacer.
    let backup = NO_BACKUP;
    if (scope !== 'autoskills') {
      step(`Actualizando harness en '${PROJECT_NAME}' --part ${scope} (backup keep 5)`);
      backup = doBackup(TARGET_DIR, BACKUP_ITEMS, dry);
    }
    installTail({ ...common, backup, upgrade: true });
    return;
  }

  installTail({ ...common, backup: NO_BACKUP, upgrade: false });
}

main().catch((e) => { err(e.message); console.error(e); die(EXIT.USO); });
