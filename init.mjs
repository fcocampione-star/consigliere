#!/usr/bin/env node
/**
 * CONSIGLIERE — Harness de agentes + memoria persistente para opencode.
 * Instalador/generador cross-platform (Node 18+). Funciona en Linux, macOS y Windows.
 *
 * Uso:
 *   node init.mjs                          # modo interactivo
 *   node init.mjs --install-global         # instalar globalmente (copia a ~/.local/share)
 *   node init.mjs --uninstall-global       # desinstalar
 *   node init.mjs --version                # versión
 *   node init.mjs <ruta/proyecto> [flags]  # no-interactivo
 *   npx consigliere-init /ruta/proyecto    # vía npm
 */

import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const IS_WIN = platform() === 'win32';

// Rutas globales (paridad con init.sh / init.ps1)
const HOME = homedir();
const GLOBAL_BIN = IS_WIN
  ? join(HOME, '.local', 'bin', 'consigliere-init.mjs')
  : join(HOME, '.local', 'bin', 'consigliere-init');
const GLOBAL_SHARE = IS_WIN
  ? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'consigliere') : join(HOME, '.local', 'share', 'consigliere'))
  : join(HOME, '.local', 'share', 'consigliere');
const GLOBAL_TEMPLATES = join(GLOBAL_SHARE, 'templates');

// Template dir efectivo
function getTemplateDir() {
  // Si estamos en instalación global de npm, templates está junto a init.mjs
  const localTemplates = join(HERE, 'templates');
  if (existsSync(localTemplates)) return localTemplates;
  // Fallback: instalación global previa (~/.local/share)
  if (existsSync(GLOBAL_TEMPLATES)) return GLOBAL_TEMPLATES;
  return localTemplates;
}

const TEMPLATE_DIR = getTemplateDir();

// Colores
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m',
};
const info = (m) => console.log(`${C.cyan}ℹ️  ${m}${C.reset}`);
const ok = (m) => console.log(`${C.green}✅ ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}⚠️  ${m}${C.reset}`);
const err = (m) => console.log(`${C.red}❌ ${m}${C.reset}`);
const step = (m) => console.log(`\n${C.bold}▶ ${m}${C.reset}`);

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
${C.reset}${C.dim}  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v${VERSION})${C.reset}`);
}

// readline helper
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

// Render
function renderFile(src, dst, vars) {
  let content = readFileSync(src, 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    content = content.split(`{{${k}}}`).join(v ?? '');
  }
  writeFileSync(dst, content, 'utf8');
  // intentar +x si es script
  if (src.endsWith('.sh') || src.endsWith('.mjs') || src.endsWith('.ps1')) {
    try { chmodSync(dst, 0o755); } catch {}
  }
}

function renderTree(srcDir, dstDir, vars) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
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

// Git helpers
function installGitHook(repo, templateDir) {
  const src = join(templateDir, '.opencode', 'hooks', 'post-commit-memory-rotate.sh');
  const dst = join(repo, '.git', 'hooks', 'post-commit');
  if (existsSync(src)) {
    cpSync(src, dst);
    try { chmodSync(dst, 0o755); } catch {}
  }
}

function gitInitAndCommit(repo, templateDir) {
  if (!existsSync(join(repo, '.git'))) {
    spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'inherit' });
    installGitHook(repo, templateDir);
    spawnSync('git', ['add', '.'], { cwd: repo, stdio: 'inherit' });
    spawnSync('git', ['-c', 'user.name=CONSIGLIERE', '-c', 'user.email=consigliere@local', 'commit', '-q', '-m', 'chore: scaffold harness CONSIGLIERE'], { cwd: repo, stdio: 'inherit' });
    ok('Git + hook post-commit + commit inicial');
  } else {
    installGitHook(repo, templateDir);
    warn('Ya existía repo git; solo se instaló el hook.');
  }
}

function handleAutoskills(mode, dir) {
  const hasNode = spawnSync('node', ['--version'], { stdio: 'ignore' }).status === 0;
  if (mode === '2') {
    step('Instalando autoskills global');
    const r = spawnSync('npm', ['i', '-g', 'autoskills'], { stdio: 'inherit', shell: IS_WIN });
    if (r.status === 0) ok('autoskills global instalado');
    else warn('npm i -g autoskills falló');
  } else if (mode === '3') {
    info(`Autoskills omitido. Instálalas luego con: cd "${dir}" && npx autoskills`);
  } else {
    step('Instalando autoskills en el proyecto');
    if (!hasNode) { warn('Node no encontrado. Instala node y corre: npx autoskills'); return; }
    const r = spawnSync('npx', ['--yes', 'autoskills'], { cwd: dir, stdio: 'inherit', shell: IS_WIN });
    if (r.status === 0) ok('autoskills ejecutado');
    else warn('autoskills no corrió (¿falta package.json? Instálalo luego: npx autoskills)');
  }
}

function finish(projectName, targetDir) {
  console.log(`\n${C.green}═══════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}🎉  ¡Proyecto '${projectName}' listo en ${targetDir}!${C.reset}\n`);
  console.log(`${C.bold}Próximos pasos:${C.reset}`);
  console.log(`  1. cd ${targetDir}`);
  console.log(`  2. Edita AGENTS.md → completa el stack y los comandos dev`);
  console.log(`  3. Edita .opencode/skills/_project-docs/SKILL.md → URLs/shortcuts`);
  console.log(`  4. Opcional: rellena modelos en .opencode/opencode.json`);
  console.log(`  5. Si tienes package.json → npm install`);
  console.log(`  6. Arranca opencode → /routine "configurar base del proyecto"\n`);
}

// Instalación global
function installGlobal() {
  step('Instalando CONSIGLIERE globalmente (Node)');
  if (!existsSync(TEMPLATE_DIR)) { err(`No encuentro templates en '${TEMPLATE_DIR}'`); process.exit(1); }
  mkdirSync(dirname(GLOBAL_BIN), { recursive: true });
  mkdirSync(GLOBAL_SHARE, { recursive: true });
  cpSync(fileURLToPath(import.meta.url), GLOBAL_BIN);
  if (existsSync(GLOBAL_TEMPLATES)) rmSync(GLOBAL_TEMPLATES, { recursive: true, force: true });
  cpSync(TEMPLATE_DIR, GLOBAL_TEMPLATES, { recursive: true });
  try { chmodSync(GLOBAL_BIN, 0o755); } catch {}
  ok('Instalado globalmente.');
  ok(`Bin: ${GLOBAL_BIN}`);
  ok(`Templates: ${GLOBAL_TEMPLATES}`);
  const pathEnv = process.env.PATH || '';
  if (!pathEnv.includes(join(HOME, '.local', 'bin'))) {
    warn('~/.local/bin no está en PATH en esta sesión.');
    info('Añade manualmente: export PATH="$HOME/.local/bin:$PATH"  (o setx PATH en Windows)');
  }
}

function uninstallGlobal() {
  step('Desinstalando versión global');
  let removed = false;
  if (existsSync(GLOBAL_BIN)) { rmSync(GLOBAL_BIN, { force: true }); ok(`Eliminado: ${GLOBAL_BIN}`); removed = true; }
  if (existsSync(GLOBAL_SHARE)) { rmSync(GLOBAL_SHARE, { recursive: true, force: true }); ok(`Eliminado: ${GLOBAL_SHARE}`); removed = true; }
  if (!removed) info('No había instalación global.');
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

async function interactiveCreate() {
  banner();
  console.log();
  step('Nuevo proyecto — CONSIGLIERE');
  let targetDir = (await ask('  📁 Ruta del directorio del proyecto: ')).trim().replace(/^~/, HOME);
  if (!targetDir) { err('Ruta vacía.'); process.exit(1); }
  targetDir = isAbsolute(targetDir) ? resolve(targetDir) : resolve(process.cwd(), targetDir);
  const parent = dirname(targetDir);
  if (!existsSync(parent)) warn(`El directorio padre '${parent}' no existe. Lo crearé.`);

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    warn(`El directorio '${targetDir}' existe y no está vacío.`);
    const c = (await ask('  ¿Continuar y añadir el harness de todos modos? [s/N] ')).trim();
    if (!/^s$/i.test(c)) { info('Cancelado.'); process.exit(0); }
  }

  const defaultName = basename(targetDir);
  let projectName = (await ask(`  Nombre del proyecto [${defaultName}]: `)).trim() || defaultName;

  console.log();
  info('Stack (opcional — pre-rellena AGENTS.md y SKILL.md). Enter = saltar.');
  const STACK_DB = await promptStackItem('Base de datos', ['postgresql', 'sqlite', 'mysql', 'mariadb', 'mongodb']);
  const STACK_BACKEND = await promptStackItem('Backend', ['node/express', 'node/fastify', 'nextjs', 'python/fastapi', 'python/django', 'go']);
  const STACK_FRONTEND = await promptStackItem('Frontend', ['react/vite', 'nextjs', 'astro', 'sveltekit', 'vue/vite']);
  const STACK_AUTH = await promptStackItem('Autenticación', ['jwt', 'session', 'oauth2', 'cognito', 'auth0']);
  const STACK_VALIDATION = await promptStackItem('Validación', ['zod', 'valibot', 'joi', 'yup']);
  const STACK_DEPLOY = await promptStackItem('Deploy', ['docker', 'vercel', 'fly', 'railway', 'aws']);

  console.log();
  info('Modelos por subagente (opcional — déjalo vacío para heredar).');
  const MODEL_ORCHESTRATOR = (await ask('  Modelo [orchestrator] (Enter = heredar): ')).trim();
  const MODEL_PLANNER = (await ask('  Modelo [planner] (Enter = heredar): ')).trim();
  const MODEL_BUILDER = (await ask('  Modelo [builder] (Enter = heredar): ')).trim();
  const MODEL_CRITIC = (await ask('  Modelo [critic] (Enter = heredar): ')).trim();
  const MODEL_VERIFIER = (await ask('  Modelo [verifier] (Enter = heredar): ')).trim();
  const MODEL_SUMMARIZER = (await ask('  Modelo [summarizer] (Enter = heredar): ')).trim();
  const MODEL_EXPLORE = (await ask('  Modelo [explore] (Enter = heredar): ')).trim();

  let LANG_BACKEND = 'typescript';
  if (STACK_BACKEND.includes('python')) LANG_BACKEND = 'python';
  else if (STACK_BACKEND.includes('go')) LANG_BACKEND = 'go';

  console.log();
  step('Opciones finales');
  console.log('  🤖 Autoskills (skills según dependencias):');
  console.log('  1) En el proyecto (npx autoskills)   ← Recomendado');
  console.log('  2) Global (npm i -g autoskills)');
  console.log('  3) Saltar (las instalaré luego)');
  let AUTO_CHOICE = (await ask('  > [1-3]: ')).trim() || '1';
  const gitChoice = (await ask('  📦 Inicializar git + commit inicial? [S/n]: ')).trim();
  const DO_GIT = !/^[Nn]$/.test(gitChoice);

  console.log(`\n  ${C.bold}Resumen:${C.reset}`);
  console.log(`    Proyecto : ${projectName}`);
  console.log(`    Destino  : ${targetDir}`);
  console.log(`    Stack    : ${STACK_DB} | ${STACK_BACKEND} | ${STACK_FRONTEND} | auth=${STACK_AUTH} | val=${STACK_VALIDATION} | deploy=${STACK_DEPLOY}`);
  console.log(`    Autoskills: ${AUTO_CHOICE} | Git init: ${DO_GIT ? 'Sí' : 'No'}`);
  const go = (await ask('  ¿Continuar? [S/n]: ')).trim();
  if (/^[Nn]$/.test(go)) { info('Cancelado.'); process.exit(0); }

  createProject({ projectName, targetDir, STACK_DB, STACK_BACKEND, STACK_FRONTEND, STACK_AUTH, STACK_VALIDATION, STACK_DEPLOY, LANG_BACKEND, MODEL_ORCHESTRATOR, MODEL_PLANNER, MODEL_BUILDER, MODEL_VERIFIER, MODEL_CRITIC, MODEL_SUMMARIZER, MODEL_EXPLORE, AUTO_CHOICE, DO_GIT });
}

function createProject(opts) {
  const { projectName, targetDir, AUTO_CHOICE, DO_GIT } = opts;
  step(`Generando proyecto '${projectName}'`);
  mkdirSync(targetDir, { recursive: true });
  ok('Estructura base creada');

  const vars = {
    PROJECT_NAME: projectName,
    STACK_DB: opts.STACK_DB || '',
    STACK_BACKEND: opts.STACK_BACKEND || '',
    STACK_FRONTEND: opts.STACK_FRONTEND || '',
    STACK_AUTH: opts.STACK_AUTH || '',
    STACK_VALIDATION: opts.STACK_VALIDATION || '',
    STACK_DEPLOY: opts.STACK_DEPLOY || '',
    DEV_COMMANDS: '',
    MODEL_ORCHESTRATOR: opts.MODEL_ORCHESTRATOR || '',
    MODEL_PLANNER: opts.MODEL_PLANNER || '',
    MODEL_BUILDER: opts.MODEL_BUILDER || '',
    MODEL_VERIFIER: opts.MODEL_VERIFIER || '',
    MODEL_CRITIC: opts.MODEL_CRITIC || '',
    MODEL_SUMMARIZER: opts.MODEL_SUMMARIZER || '',
    MODEL_EXPLORE: opts.MODEL_EXPLORE || '',
    LANG_BACKEND: opts.LANG_BACKEND || 'typescript',
  };

  renderTree(TEMPLATE_DIR, targetDir, vars);
  mkdirSync(join(targetDir, 'CHANGELOG'), { recursive: true });
  ok('Harness generado (agents, commands, skills, memoria)');

  if (DO_GIT) gitInitAndCommit(targetDir, TEMPLATE_DIR);
  else warn('Git no inicializado.');

  if (AUTO_CHOICE !== '3') handleAutoskills(AUTO_CHOICE, targetDir);
  finish(projectName, targetDir);
}

// CLI parse
function showHelp(scriptName) {
  console.log(`CONSIGLIERE v${VERSION} — Harness de agentes + memoria persistente para opencode.

Uso:
  ${scriptName}                          modo interactivo
  ${scriptName} --install-global         instalar globalmente
  ${scriptName} --uninstall-global       desinstalar
  ${scriptName} --version | --help
  ${scriptName} <ruta/proyecto>          crear proyecto (con flags)

Flags (no-interactivo):
  --dir <ruta>              directorio destino
  --name <nombre>           nombre del proyecto
  --stack-db/-backend/-frontend/-auth/-validation/-deploy <v>
  --autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  --git <yes|no>            inicializar git
`);
}

async function main() {
  const args = process.argv.slice(2);
  const scriptName = basename(fileURLToPath(import.meta.url));

  if (!existsSync(TEMPLATE_DIR)) {
    err(`No encuentro templates en '${TEMPLATE_DIR}'.`);
    err('Si copiaste solo el binario, copia también la carpeta templates/.');
    process.exit(1);
  }

  if (args.length === 0) {
    await interactiveCreate();
    return;
  }

  // flags globales
  if (args[0] === '--install-global') { installGlobal(); return; }
  if (args[0] === '--uninstall-global') {
    const c = (await ask('  ¿Seguro? Esto borrará la instalación global. [s/N] ')).trim();
    if (!/^s$/i.test(c)) { warn('Cancelado.'); return; }
    uninstallGlobal(); return;
  }
  if (args[0] === '--version' || args[0] === '-v') { console.log(`CONSIGLIERE v${VERSION}`); return; }
  if (args[0] === '--help' || args[0] === '-h') { showHelp(scriptName); return; }

  // parse no-interactivo
  let TARGET_DIR = ''; let PROJECT_NAME = '';
  let STACK_DB = ''; let STACK_BACKEND = ''; let STACK_FRONTEND = '';
  let STACK_AUTH = ''; let STACK_VALIDATION = ''; let STACK_DEPLOY = '';
  let AUTO_CHOICE = '1'; let DO_GIT = true;
  let MODEL_ORCHESTRATOR = ''; let MODEL_PLANNER = ''; let MODEL_BUILDER = '';
  let MODEL_VERIFIER = ''; let MODEL_CRITIC = ''; let MODEL_SUMMARIZER = ''; let MODEL_EXPLORE = '';
  let LANG_BACKEND = 'typescript';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--dir': TARGET_DIR = args[++i]; break;
      case '--name': PROJECT_NAME = args[++i]; break;
      case '--stack-db': STACK_DB = args[++i]; break;
      case '--stack-backend': STACK_BACKEND = args[++i]; break;
      case '--stack-frontend': STACK_FRONTEND = args[++i]; break;
      case '--stack-auth': STACK_AUTH = args[++i]; break;
      case '--stack-validation': STACK_VALIDATION = args[++i]; break;
      case '--stack-deploy': STACK_DEPLOY = args[++i]; break;
      case '--autoskills': AUTO_CHOICE = args[++i]; break;
      case '--git': DO_GIT = args[++i] !== 'no'; break;
      case '--help': case '-h': showHelp(scriptName); return;
      case '--version': case '-v': console.log(`CONSIGLIERE v${VERSION}`); return;
      default:
        if (a.startsWith('--')) { warn(`Flag desconocido: ${a}`); }
        else TARGET_DIR = a;
    }
  }

  if (!TARGET_DIR) { err('Falta el directorio destino. Usa --dir <ruta> o pasa una ruta posicional.'); showHelp(scriptName); process.exit(1); }
  TARGET_DIR = TARGET_DIR.replace(/^~/, HOME);
  TARGET_DIR = isAbsolute(TARGET_DIR) ? resolve(TARGET_DIR) : resolve(process.cwd(), TARGET_DIR);
  if (!PROJECT_NAME) PROJECT_NAME = basename(TARGET_DIR);
  if (STACK_BACKEND.includes('python')) LANG_BACKEND = 'python';
  else if (STACK_BACKEND.includes('go')) LANG_BACKEND = 'go';

  step(`Generando proyecto '${PROJECT_NAME}'`);
  mkdirSync(TARGET_DIR, { recursive: true });
  const vars = {
    PROJECT_NAME, STACK_DB, STACK_BACKEND, STACK_FRONTEND, STACK_AUTH, STACK_VALIDATION, STACK_DEPLOY,
    DEV_COMMANDS: '', MODEL_ORCHESTRATOR, MODEL_PLANNER, MODEL_BUILDER, MODEL_VERIFIER, MODEL_CRITIC, MODEL_SUMMARIZER, MODEL_EXPLORE, LANG_BACKEND,
  };
  renderTree(TEMPLATE_DIR, TARGET_DIR, vars);
  mkdirSync(join(TARGET_DIR, 'CHANGELOG'), { recursive: true });
  ok('Harness generado');
  if (DO_GIT) gitInitAndCommit(TARGET_DIR, TEMPLATE_DIR);
  if (AUTO_CHOICE !== '3' && AUTO_CHOICE !== 'no') handleAutoskills(AUTO_CHOICE, TARGET_DIR);
  finish(PROJECT_NAME, TARGET_DIR);
}

main().catch((e) => { err(e.message); console.error(e); process.exit(1); });
