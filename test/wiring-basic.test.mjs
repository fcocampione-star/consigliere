#!/usr/bin/env node
/**
 * test/wiring-basic.test.mjs — wiring básico del harness (estático) + ciclo mínimo de memoria.
 *
 * NO cubre: el CLI opencode v2 real (→ test/e2e-harness-v2.test.mjs); el comportamiento interno de
 * loader/skill-search (→ tests unitarios propios); el detalle fino de rotación (→ memory-rotate*);
 * el ciclo completo de 3 capas de memoria (fuera de alcance aquí). Solo: forma del wiring md/json,
 * existencia de scripts citados y UN ciclo rotate→search→timeline→get→stats sobre un espejo en tmpdir.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { suite, test, assert, eq, match, includes, tmpdir, cleanup, runAll } from './harness.mjs';
import { makeProject, summaryWithEntries } from './fixtures.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const AGENTS_DIR = join(REPO_ROOT, '.opencode', 'agents');
const COMMANDS_DIR = join(REPO_ROOT, '.opencode', 'commands');
const SCRIPTS_DIR = join(REPO_ROOT, '.opencode', 'scripts');

const AGENTS = ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier'];
const COMMANDS = ['compact-state', 'discover', 'doctor', 'modo', 'record', 'review', 'rotate-memory', 'routine', 'skill-capture'];
const LEAVES = ['builder', 'verifier', 'critic', 'summarizer', 'explore'];

// Frontmatter delgado: el bloque entre el primer `---` y el siguiente. NO es un parser YAML.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}

// Escapes de un escalar YAML entre comillas dobles, limitado a los que el
// frontmatter usa de verdad (`\\` → `\`, `\"` → `"`). NO es un parser YAML
// completo: solo normaliza las claves para que la paridad con el JSON del
// template compare el PATRÓN semántico (en el md el backslash va escapado).
function yamlUnescape(s) {
  return String(s).replace(/\\(["\\])/g, '$1');
}

// Pares `"patrón": efecto` de un bloque anidado a 2 espacios (`bash:`, `task:`).
// Extractor tolerante a comillas: toma el texto crudo entre la primera y la última comilla,
// igual que queda la clave tras JSON.parse del template, y decodifica los escapes
// de un escalar YAML entre comillas dobles (`"del /f /s C:\\*"` → `del /f /s C:\*`).
// NO parsea YAML completo.
function blockPairs(fm, key) {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s{2}${key}:\\s*$`).test(l));
  if (start === -1) return null;
  const baseIndent = /^(\s*)/.exec(lines[start])[1].length;
  const pairs = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (/^(\s*)/.exec(line)[1].length <= baseIndent) break;
    // Claves con o sin comillas: bash las lleva siempre ("*": deny); task usa Identifiers pelados (explore: allow).
    const m = /^(?:"(.*)"|([A-Za-z0-9_.*-]+)):\s*(allow|deny|ask)\s*$/.exec(line.trim());
    if (m) pairs[m[1] !== undefined ? yamlUnescape(m[1]) : m[2]] = m[3];
  }
  return pairs;
}

const agentMd = (name) => readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');

// ── Suite 1: wiring · agents ────────────────────────────────────────────────
suite('wiring · agents');

test('existen EXACTAMENTE los 7 agentes esperados', () => {
  const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  eq([...files].sort(), [...AGENTS].sort(), 'los 7 agentes, ni uno más ni uno menos');
});

test('advisor: mode primary + bash deny "*" con UNA excepción (routine-model.mjs, que existe)', () => {
  const fm = frontmatter(agentMd('advisor'));
  includes(fm, 'mode: primary', 'advisor es el agente primario');
  const bash = blockPairs(fm, 'bash');
  eq(bash, { '*': 'deny', 'node .opencode/scripts/routine-model.mjs*': 'allow' }, 'deny por defecto + única allowlist');
  assert(existsSync(join(SCRIPTS_DIR, 'routine-model.mjs')), 'el script de la excepción existe');
});

test('hojas del pipeline con task: deny (builder, verifier, critic, summarizer, explore)', () => {
  for (const name of LEAVES) {
    match(frontmatter(agentMd(name)), /^ {2}task: deny\s*$/m, `${name}.md declara task: deny`);
  }
});

test('excepción planner→explore allow (subagent_depth: 2), el resto deny', () => {
  const task = blockPairs(frontmatter(agentMd('planner')), 'task');
  eq(task, { '*': 'deny', explore: 'allow' }, 'solo planner puede delegar, y solo en explore');
});

test('advisor delega (allow) en los otros 6 agentes', () => {
  const task = blockPairs(frontmatter(agentMd('advisor')), 'task');
  eq(task['*'], 'ask', 'por defecto pide permiso');
  for (const name of AGENTS.filter((a) => a !== 'advisor')) {
    eq(task[name], 'allow', `advisor puede delegar en ${name}`);
  }
});

// ── Suite 2: wiring · commands ──────────────────────────────────────────────
suite('wiring · commands');

test('existen EXACTAMENTE los 9 comandos esperados', () => {
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  eq([...files].sort(), [...COMMANDS].sort(), 'los 9 comandos, ni uno más ni uno menos');
});

test('cada comando declara subtask: true y un agent: que existe en .opencode/agents', () => {
  for (const name of COMMANDS) {
    const fm = frontmatter(readFileSync(join(COMMANDS_DIR, `${name}.md`), 'utf8'));
    match(fm, /^subtask: true\s*$/m, `${name}.md es subtask`);
    const m = /^agent: (\S+)\s*$/m.exec(fm);
    assert(m, `${name}.md declara agent:`);
    assert(existsSync(join(AGENTS_DIR, `${m[1]}.md`)), `${name}.md → agent ${m[1]} existe en .opencode/agents`);
  }
});

test('todo script .opencode/scripts/*.mjs citado en un comando existe (skill-search y skill-scaffold incluidos)', () => {
  const cited = new Set();
  for (const name of COMMANDS) {
    const text = readFileSync(join(COMMANDS_DIR, `${name}.md`), 'utf8');
    for (const ref of text.match(/\.opencode\/scripts\/[A-Za-z0-9._/-]+\.mjs/g) || []) cited.add(ref);
  }
  assert(cited.has('.opencode/scripts/skill-search.mjs'), 'skill-search.mjs aparece citado');
  assert(cited.has('.opencode/scripts/skill-scaffold.mjs'), 'skill-scaffold.mjs aparece citado');
  // 6 rutas literales distintas: el catálogo entre llaves de doctor.md ({memory-index,...}.mjs) no es una ruta citada.
  assert(cited.size >= 6, `hay una cantidad razonable de scripts citados (${cited.size})`);
  for (const ref of cited) {
    assert(existsSync(join(REPO_ROOT, ref)), `el script citado existe: ${ref}`);
  }
});

// ── Suite 3: wiring · template-parity (sin CLI) ─────────────────────────────
suite('wiring · template-parity');

const TEMPLATE = JSON.parse(readFileSync(join(REPO_ROOT, 'templates', 'opencode.json'), 'utf8'));

test('template: default_agent advisor + subagent_depth 2 + exactamente los 7 agentes', () => {
  eq(TEMPLATE.default_agent, 'advisor', 'default_agent');
  eq(TEMPLATE.subagent_depth, 2, 'subagent_depth (único nivel extra permitido: planner→explore)');
  eq(Object.keys(TEMPLATE.agent).sort(), [...AGENTS].sort(), 'agent con exactamente los 7');
});

test('template: cada model es un placeholder {{MODEL_*}} (sin modelo concreto en la plantilla)', () => {
  for (const [name, cfg] of Object.entries(TEMPLATE.agent)) {
    match(cfg.model, /^\{\{MODEL_[A-Z]+\}\}$/, `model de ${name} es placeholder`);
  }
});

test('paridad bash md↔json: advisor, planner y explore (allowlist read-only / excepción única)', () => {
  for (const name of ['advisor', 'planner', 'explore']) {
    const md = blockPairs(frontmatter(agentMd(name)), 'bash');
    eq(md, TEMPLATE.agent[name].permission.bash, `bash de ${name}: md == permission.bash del template`);
  }
});

test('paridad bash md↔json: builder y summarizer (harden: allow + deny irreparable + ask sensibles)', () => {
  for (const name of ['builder', 'summarizer']) {
    const md = blockPairs(frontmatter(agentMd(name)), 'bash');
    eq(md, TEMPLATE.agent[name].permission.bash, `bash de ${name}: md == permission.bash del template`);
  }
});

test('invariante repo-dev: .gitignore ancla el opencode.json raíz (la pública vive en templates/)', () => {
  const gi = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  match(gi, /^\/opencode\.json\s*$/m, '.gitignore ignora el config raíz con el patrón anclado /opencode.json');
});

test('invariante repo-dev: opencode.json raíz presente, 7 agentes, cero placeholders y --check fresco', () => {
  const cfgPath = join(REPO_ROOT, 'opencode.json');
  assert(existsSync(cfgPath), 'falta la opencode.json raíz de este repo — genera con `npm run dev:config`');
  const raw = readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(raw);
  eq(Object.keys(cfg.agent).sort(), [...AGENTS].sort(), 'la config dev tiene exactamente los 7 agentes');
  for (const [name, c] of Object.entries(cfg.agent)) eq(c.model, '', `model de ${name} heredado ("") en la config dev`);
  assert(!/\{\{/.test(raw), 'sin placeholders {{...}} pendientes en la config dev');
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'dev-config.mjs'), '--check'], { encoding: 'utf8', windowsHide: true, input: '', timeout: 15000 });
  eq(r.status, 0, `dev-config --check sale 0 (stdout: ${(r.stdout || '').trim()} stderr: ${(r.stderr || '').trim()})`);
});

// ── Suite 4: memory · ciclo-mínimo (tmpdir hermético, SOLO el espejo) ───────
suite('memory · ciclo-mínimo');

// Espejo byte-idéntico (patrón de test/memory-index.test.mjs): se ejecuta el ESPEJO, nunca
// los scripts del repo — así `join(scriptDir,'..','..')` (DEFAULT_ROOT) resuelve al tmpdir
// y el repo real (su memoria y su .advisor/) queda intacto.
const MIRROR_FILES = ['memory-rotate.mjs', 'memory-index.mjs', 'memory-stats.mjs', 'memory-lock.mjs'];
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];
const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

function mirror() {
  const dir = tmpdir('advisor-wiring');
  TEMPS.push(dir);
  const dst = join(dir, '.opencode', 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const f of MIRROR_FILES) copyFileSync(join(SCRIPTS_DIR, f), join(dst, f));
  mkdirSync(join(dst, 'lib'), { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(SCRIPTS_DIR, 'lib', f), join(dst, 'lib', f));
  return dir;
}

function runMirror(dir, script, args) {
  const r = spawnSync(process.execPath, [join(dir, '.opencode', 'scripts', script), ...args], {
    encoding: 'utf8', windowsHide: true, input: '', timeout: 15000,
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('el espejo es byte-idéntico a los scripts del repo', () => {
  const dir = mirror();
  for (const f of MIRROR_FILES) {
    eq(readFileSync(join(dir, '.opencode', 'scripts', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, f), 'utf8'), `${f} sin modificar`);
  }
  for (const f of LIB_FILES) {
    eq(readFileSync(join(dir, '.opencode', 'scripts', 'lib', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, 'lib', f), 'utf8'), `lib/${f} sin modificar`);
  }
});

test('rotate --json: exit 0, rota exactamente 1 (la más antigua, semana 2026-08-31), SUMMARY conserva la más nueva', () => {
  const dir = mirror();
  makeProject(dir);
  summaryWithEntries(dir, 2); // fechas fijas: 2026-09-06 y 2026-09-05 (semana del lunes 2026-08-31)
  const r = runMirror(dir, 'memory-rotate.mjs', ['rotate', '--json']);
  eq(r.status, 0, 'rotate --json sale 0');
  const result = JSON.parse(r.out);
  // Campos reales del JSON de rotate (memory-rotate.mjs report/result): moved[{date,title,monday,file,dedup}]
  eq(result.command, 'rotate', 'comando en el resultado');
  eq(result.moved.length, 1, 'rota exactamente 1 entrada');
  eq(result.moved[0].date, '2026-09-05', 'la archivada es la más antigua');
  eq(result.moved[0].monday, '2026-08-31', 'semana (lunes) destino');
  eq(result.moved[0].dedup, false, 'sin dedup en ciclo limpio');
  assert(existsSync(join(dir, 'CHANGELOG', '2026-08-31.md')), 'CHANGELOG/2026-08-31.md creado');
  const summary = readFileSync(join(dir, 'SUMMARY.md'), 'utf8');
  includes(summary, 'Entrada fixture 1', 'SUMMARY conserva la más nueva');
  assert(!summary.includes('Entrada fixture 2'), 'SUMMARY ya no tiene la archivada');
  assert(!existsSync(join(dir, '.memory-lock')), 'sin .memory-lock huérfano tras la rotación');
});

test('search --json sobre el espejo devuelve ≥1 hit; timeline y get <id> salen 0 con "fixture" en stdout', () => {
  const dir = mirror();
  makeProject(dir);
  summaryWithEntries(dir, 2);
  eq(runMirror(dir, 'memory-rotate.mjs', ['rotate', '--json']).status, 0, 'rotación previa ok');
  const s = runMirror(dir, 'memory-index.mjs', ['search', 'fixture', '--json']);
  eq(s.status, 0, 'search --json sale 0');
  const hits = JSON.parse(s.out);
  assert(Array.isArray(hits) && hits.length >= 1, 'al menos un hit');
  const hit = hits.find((h) => h.title === 'Entrada fixture 1');
  assert(hit && hit.id, 'la entrada conservada en SUMMARY es buscable');
  const t = runMirror(dir, 'memory-index.mjs', ['timeline', hit.id]);
  eq(t.status, 0, 'timeline sale 0');
  includes(t.out, 'fixture', 'timeline muestra la entrada');
  const g = runMirror(dir, 'memory-index.mjs', ['get', hit.id]);
  eq(g.status, 0, 'get sale 0');
  includes(g.out, 'fixture', 'get vuelca la entrada');
});

test('stats sobre el CHANGELOG rotado: exit 0 y JSON con contenido', () => {
  const dir = mirror();
  makeProject(dir);
  summaryWithEntries(dir, 2);
  eq(runMirror(dir, 'memory-rotate.mjs', ['rotate', '--json']).status, 0, 'rotación previa ok');
  const r = runMirror(dir, 'memory-stats.mjs', ['lines', join(dir, 'CHANGELOG', '2026-08-31.md')]);
  eq(r.status, 0, 'stats lines sale 0');
  const stats = JSON.parse(r.out);
  assert(stats.count > 0, `el CHANGELOG rotado tiene contenido (${stats.count} líneas no vacías)`);
  assert(String(stats.file).endsWith('2026-08-31.md'), 'stats apuntó al archivo rotado');
});

await runAll();
