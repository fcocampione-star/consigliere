#!/usr/bin/env node
/**
 * CONSIGLIERE 2.0 — Harness de agentes + memoria persistente para opencode.
 * Instalador/generador SOLO por proyecto (Node 18+). Sin instalación global.
 *
 * Uso:
 *   node init.mjs                          # modo interactivo
 *   npx consigliere-init /ruta/proyecto    # vía npm (recomendado)
 *   node init.mjs /ruta/proyecto [flags]   # no-interactivo
 *   node init.mjs --version | --help
 */

import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const VERSION = '2.0.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const IS_WIN = platform() === 'win32';

const HOME = homedir();
const TEMPLATE_DIR = join(HERE, 'templates');

const BACKUP_ITEMS = ['.opencode', 'AGENTS.md', 'PROJECT_STATE.md', 'SUMMARY.md', 'CHANGELOG', '.consigliere', 'opencode.json', '.gitignore', 'skills-lock.json', 'scripts'];
const PRESERVED = ['PROJECT_STATE.md', 'SUMMARY.md', 'opencode.json', 'AGENTS.md', '.gitignore'];

if (+process.versions.node.split('.')[0] < 18) { console.error(`❌ Node >=18 requerido. Actual: ${process.versions.node}`); process.exit(1); }

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
${C.reset}${C.dim}  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v${VERSION} · solo por proyecto)${C.reset}`);
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
    spawnSync('git', ['-c', 'user.name=CONSIGLIERE', '-c', 'user.email=consigliere@local', 'commit', '-q', '-m', 'chore: scaffold harness CONSIGLIERE 2.0'], { cwd: repo, stdio: 'inherit' });
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
  console.log(`${C.dim}Instalación 100% por proyecto — sin binario global. Actualiza con: npx consigliere@latest ${targetDir} --upgrade${C.reset}\n`);
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
  step('Nuevo proyecto — CONSIGLIERE 2.0 (solo por proyecto)');
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
  info('Modelos por subagente (opcional — déjalo vacío para heredar). cheap=verifier/summarizer/explore, strong=builder/planner/critic');
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
  mkdirSync(join(targetDir, '.consigliere', 'backups'), { recursive: true });
  mkdirSync(join(targetDir, '.consigliere', 'chunks'), { recursive: true });
  ok('Harness generado (agents, commands, skills, memoria, scripts)');

  if (DO_GIT) gitInitAndCommit(targetDir, TEMPLATE_DIR);
  else warn('Git no inicializado.');

  if (AUTO_CHOICE !== '3') handleAutoskills(AUTO_CHOICE, targetDir);
  finish(projectName, targetDir);
}

// CLI parse
function needValue(flag, val) {
  if (val === undefined || val.startsWith('--')) {
    err(`Flag ${flag} requiere un valor.`);
    process.exit(1);
  }
  return val;
}

function showHelp(scriptName) {
  console.log(`CONSIGLIERE v${VERSION} — Harness de agentes + memoria persistente para opencode (solo por proyecto).

Uso:
  ${scriptName}                          modo interactivo
  ${scriptName} --version | --help
  ${scriptName} <ruta/proyecto>          crear proyecto (con flags)
  ${scriptName} <ruta/proyecto> --upgrade  actualizar harness existente (backup keep 5, preserva memoria/config; no requiere --force)
  ${scriptName} <ruta/proyecto> --dry-run  simulación sin escribir
  ${scriptName} <ruta/proyecto> --force    sobrescribir destino no vacío

Flags (no-interactivo):
  --dir <ruta>              directorio destino
  --name <nombre>           nombre del proyecto
  --stack-db/-backend/-frontend/-auth/-validation/-deploy <v>
  --autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  --git <yes|no>            inicializar git
  --upgrade                 actualizar harness existente (backup keep 5, preserva memoria/config; no requiere --force)
  --dry-run                 no escribir, solo loguear
  --force                   sobrescribir destino no vacío (solo sin --upgrade)

Instalación: solo por proyecto, sin binario global.
  npx consigliere@latest /ruta/proyecto
  node ./init.mjs /ruta/proyecto
  bash ./init.sh --dir /ruta/proyecto
`);
}

async function main() {
  const major = +process.versions.node.split('.')[0];
  if (major < 18) { console.error(`❌ Node >=18 requerido. Actual: ${process.versions.node}`); process.exit(1); }
  const args = process.argv.slice(2);
  const scriptName = basename(fileURLToPath(import.meta.url));

  if (!existsSync(TEMPLATE_DIR)) {
    err(`No encuentro templates en '${TEMPLATE_DIR}'.`);
    err('Si clonaste el repo, ejecuta desde la raíz: node init.mjs /ruta/proyecto');
    process.exit(1);
  }

  if (args.length === 0) {
    await interactiveCreate();
    return;
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
  let UPGRADE = false;
  let DRY_RUN = false; let FORCE = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--dir': { if (i + 1 >= args.length) needValue(a, undefined); TARGET_DIR = needValue(a, args[++i]); break; }
      case '--name': { if (i + 1 >= args.length) needValue(a, undefined); PROJECT_NAME = needValue(a, args[++i]); break; }
      case '--stack-db': { if (i + 1 >= args.length) needValue(a, undefined); STACK_DB = needValue(a, args[++i]); break; }
      case '--stack-backend': { if (i + 1 >= args.length) needValue(a, undefined); STACK_BACKEND = needValue(a, args[++i]); break; }
      case '--stack-frontend': { if (i + 1 >= args.length) needValue(a, undefined); STACK_FRONTEND = needValue(a, args[++i]); break; }
      case '--stack-auth': { if (i + 1 >= args.length) needValue(a, undefined); STACK_AUTH = needValue(a, args[++i]); break; }
      case '--stack-validation': { if (i + 1 >= args.length) needValue(a, undefined); STACK_VALIDATION = needValue(a, args[++i]); break; }
      case '--stack-deploy': { if (i + 1 >= args.length) needValue(a, undefined); STACK_DEPLOY = needValue(a, args[++i]); break; }
      case '--autoskills': { if (i + 1 >= args.length) needValue(a, undefined); AUTO_CHOICE = needValue(a, args[++i]); break; }
      case '--git': { if (i + 1 >= args.length) needValue(a, undefined); const gv = needValue(a, args[++i]); DO_GIT = gv !== 'no'; break; }
      case '--upgrade': UPGRADE = true; break;
      case '--dry-run': DRY_RUN = true; break;
      case '--force': FORCE = true; break;
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

  const isHarness = existsSync(join(TARGET_DIR, '.opencode')) || existsSync(join(TARGET_DIR, 'AGENTS.md'));
  if (existsSync(TARGET_DIR) && readdirSync(TARGET_DIR).length > 0 && !FORCE && !DRY_RUN) {
    if (UPGRADE && isHarness) {
      // eximido: dir con harness previo → backup + render
    } else if (UPGRADE) {
      err(`El directorio '${TARGET_DIR}' no es un proyecto consigliere/harness (sin .opencode/ ni AGENTS.md). --upgrade requiere un harness previo; usa --force solo si quieres sobrescribir.`);
      process.exit(1);
    } else {
      err(`El directorio '${TARGET_DIR}' existe y no está vacío. Usa --force para sobrescribir, --dry-run para simular, o --upgrade para actualizar un harness existente.`);
      process.exit(1);
    }
  }

  let backupFile = '';
  let backupItems = [];
  if (UPGRADE) {
    backupItems = BACKUP_ITEMS.filter((item) => existsSync(join(TARGET_DIR, item)));
    if (backupItems.length === 0) {
      info('Sin harness previo que respaldar (directorio vacío/inexistente)');
    } else if (DRY_RUN) {
      info(`[dry-run] backup -> .consigliere/backups/harness-<ts>.tgz (keep 5): ${backupItems.join(', ')}`);
      const preview = PRESERVED.filter((p) => backupItems.includes(p));
      if (preview.length > 0) info(`[dry-run] restore -> ${preview.join(', ')}`);
    } else {
      step(`Actualizando harness en '${PROJECT_NAME}' (backup keep 5)`);
      const backupDir = join(TARGET_DIR, '.consigliere', 'backups');
      mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      backupFile = join(backupDir, `harness-${ts}.tgz`);
      const tar = spawnSync('tar', ['-czf', backupFile, '-C', TARGET_DIR, '--exclude=.consigliere/backups', '--exclude=.memory-lock', ...backupItems], { stdio: 'ignore' });
      if (tar.error || tar.status !== 0) {
        err(`Backup falló: ${backupFile}`);
        process.exit(1);
      }
      ok(`Backup: ${backupFile} (${backupItems.length} ítems)`);
      // prune keep 5 (solo harness-<ISO|compacto>; ambos formatos mjs/sh)
      try {
        const files = readdirSync(backupDir)
          .filter((f) => /^harness-(?:\d{4}-\d{2}-\d{2}T|\d{8}T)/.test(f))
          .sort()
          .reverse();
        for (const f of files.slice(5)) unlinkSync(join(backupDir, f));
      } catch {}
    }
  }

  if (DRY_RUN) {
    info(`[dry-run] would render ${TEMPLATE_DIR} -> ${TARGET_DIR} (project: ${PROJECT_NAME})`);
    info('[dry-run] no se escribió nada en disco');
    finish(PROJECT_NAME, TARGET_DIR);
    return;
  }

  step(`Generando proyecto '${PROJECT_NAME}'${UPGRADE ? ' (upgrade)' : ''}`);
  mkdirSync(TARGET_DIR, { recursive: true });
  const vars = {
    PROJECT_NAME, STACK_DB, STACK_BACKEND, STACK_FRONTEND, STACK_AUTH, STACK_VALIDATION, STACK_DEPLOY,
    DEV_COMMANDS: '', MODEL_ORCHESTRATOR, MODEL_PLANNER, MODEL_BUILDER, MODEL_VERIFIER, MODEL_CRITIC, MODEL_SUMMARIZER, MODEL_EXPLORE, LANG_BACKEND,
  };
  renderTree(TEMPLATE_DIR, TARGET_DIR, vars);
  mkdirSync(join(TARGET_DIR, 'CHANGELOG'), { recursive: true });
  mkdirSync(join(TARGET_DIR, '.consigliere', 'backups'), { recursive: true });
  mkdirSync(join(TARGET_DIR, '.consigliere', 'chunks'), { recursive: true });
  if (backupItems.length > 0 && backupFile) {
    const restored = PRESERVED.filter((f) => backupItems.includes(f));
    if (restored.length > 0) {
      const r = spawnSync('tar', ['-xzf', backupFile, '-C', TARGET_DIR, ...restored], { stdio: 'ignore' });
      if (r.error || r.status !== 0) warn(`Restauración de memoria/config falló (backup disponible en ${backupFile})`);
      else ok(`Memoria/config preservadas: ${restored.join(', ')}`);
    }
  }
  ok(`Harness ${UPGRADE ? 'actualizado' : 'generado'}`);
  if (DO_GIT) gitInitAndCommit(TARGET_DIR, TEMPLATE_DIR);
  if (AUTO_CHOICE !== '3' && AUTO_CHOICE !== 'no') handleAutoskills(AUTO_CHOICE, TARGET_DIR);
  finish(PROJECT_NAME, TARGET_DIR);
}

main().catch((e) => { err(e.message); console.error(e); process.exit(1); });
