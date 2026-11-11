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
import { agentPermissions, resolvePermission, frontmatterBlock } from '../.opencode/scripts/lib/md.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const AGENTS_DIR = join(REPO_ROOT, '.opencode', 'agents');
const COMMANDS_DIR = join(REPO_ROOT, '.opencode', 'commands');
const SCRIPTS_DIR = join(REPO_ROOT, '.opencode', 'scripts');

const AGENTS = ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier'];
const COMMANDS = ['compact-state', 'discover', 'doctor', 'modo', 'record', 'review', 'rotate-memory', 'routine', 'skill-capture'];
const LEAVES = ['builder', 'verifier', 'critic', 'summarizer', 'explore'];

// Subcomandos de solo lectura del advisor (argv cerrado en git-state.mjs): una
// entrada de bash EXACTA por subcomando, sin comodín (un glob permitiría
// `… status; rm -rf x` si opencode separa compuestos).
const GIT_STATE_SUBS = ['status', 'log', 'head', 'branch', 'diff-stat', 'ahead-behind', 'remote'];

// ÚNICA allow con comodín tolerada en el advisor, con justificación: la CLI de
// `routine-model.mjs` recibe ids de modelo LIBRES (`MODEL_RE`), 7 agentes y 4
// formas de flag, así que no existe un conjunto finito de entradas exactas.
// Cualquier OTRO `*` en una entrada allow hace fallar el test.
// `node init.mjs*` (instalador/upgrade) admite flags y rutas libres: segunda excepción.
const ALLOW_WILDCARDS = new Set(['node .opencode/scripts/routine-model.mjs *', 'node init.mjs *']);

// Frontmatter delgado: el bloque entre el primer `---` y el siguiente. NO es un parser YAML.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}

// Permisos nativos V2 del frontmatter (lista ordenada; gana la ÚLTIMA regla que casa).
// Parser y evaluador compartidos con doctor/contract-tests: lib/md.mjs.
const rulesOf = (name) => agentPermissions(agentMd(name));
const shellRules = (name) => rulesOf(name).filter((r) => r.action === 'shell');
const subagentRules = (name) => rulesOf(name).filter((r) => r.action === 'subagent');
const pairs = (rules) => Object.fromEntries(rules.map((r) => [r.resource, r.effect]));

// El advisor NO tiene lectura libre: su único acceso al repo es `read` y los
// trámites git-state; edit/glob/grep/webfetch quedan denegados.
const ADVISOR_DENEGADOS = ['edit', 'glob', 'grep', 'webfetch'];

const agentMd = (name) => readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');

// ── Suite 1: wiring · agents ────────────────────────────────────────────────
suite('wiring · agents');

test('existen EXACTAMENTE los 7 agentes esperados', () => {
  const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  eq([...files].sort(), [...AGENTS].sort(), 'los 7 agentes, ni uno más ni uno menos');
});

test('advisor: mode primary + shell deny "*" + 7 trámites git-state exactos + excepciones routine-model/init', () => {
  includes(frontmatterBlock(agentMd('advisor')), 'mode: primary', 'advisor es el agente primario');
  const esperado = { '*': 'deny', 'node .opencode/scripts/routine-model.mjs *': 'allow', 'node init.mjs *': 'allow' };
  for (const sub of GIT_STATE_SUBS) esperado[`node .opencode/scripts/git-state.mjs ${sub}`] = 'allow';
  eq(pairs(shellRules('advisor')), esperado, 'deny por defecto + trámites git-state exactos + excepciones');
  assert(existsSync(join(SCRIPTS_DIR, 'git-state.mjs')), 'el script de los trámites existe');
  assert(existsSync(join(SCRIPTS_DIR, 'routine-model.mjs')), 'el script de la excepción existe');
});

test('advisor: ninguna entrada allow de shell lleva "*" salvo las excepciones documentadas', () => {
  const rules = shellRules('advisor');
  const comodines = rules.filter((r) => r.effect === 'allow' && r.resource.includes('*')).map((r) => r.resource);
  assert(comodines.length > 0, 'la excepción documentada sigue declarada (si desaparece, retira ALLOW_WILDCARDS)');
  for (const k of comodines) {
    assert(ALLOW_WILDCARDS.has(k), `allow con "*" sin justificar: "${k}" (excepciones documentadas: ${[...ALLOW_WILDCARDS].join(', ')})`);
  }
  for (const sub of GIT_STATE_SUBS) {
    eq(resolvePermission(rules, 'shell', `node .opencode/scripts/git-state.mjs ${sub}`), 'allow', `git-state ${sub}: allow exacta`);
  }
});

test('orden de reglas (gana la última): "*" va PRIMERO en cada bloque shell y ningún allow posterior pisa un deny/ask', () => {
  for (const name of AGENTS) {
    const sh = shellRules(name);
    if (sh.length === 0) continue;
    eq(sh[0].resource, '*', `${name}: la regla ancha de shell abre el bloque`);
    sh.forEach((r, i) => {
      if (r.effect !== 'allow' || i === 0) return;
      // Un allow tras un deny/ask solo es seguro si NO es más ancho: no debe casar con el resource de ninguno anterior.
      for (const prev of sh.slice(1, i)) {
        if (prev.effect === 'allow') continue;
        assert(resolvePermission([r], 'shell', prev.resource.replace(/\*/g, 'x')) !== 'allow',
          `${name}: el allow "${r.resource}" (posición ${i}) pisa el ${prev.effect} "${prev.resource}"`);
      }
    });
  }
  const b = shellRules('builder'), s = shellRules('summarizer');
  for (const [nombre, rules] of [['builder', b], ['summarizer', s]]) {
    eq(resolvePermission(rules, 'shell', 'git push origin main'), 'ask', `${nombre}: git push → ask`);
    eq(resolvePermission(rules, 'shell', 'git commit -m x'), 'ask', `${nombre}: git commit → ask`);
    eq(resolvePermission(rules, 'shell', 'rm -rf /tmp'), 'deny', `${nombre}: rm -rf / → deny`);
    eq(resolvePermission(rules, 'shell', 'cat a/.env'), 'ask', `${nombre}: cat **/.env* → ask`);
    eq(resolvePermission(rules, 'shell', 'npm test'), 'allow', `${nombre}: shell general allow`);
  }
});

test('el escape de backslash de Windows llega íntegro (del /f /s C:\\*) en builder y summarizer', () => {
  for (const name of ['builder', 'summarizer']) {
    const res = shellRules(name).map((r) => r.resource);
    assert(res.includes('del /f /s C:\\*'), `${name}: "del /f /s C:\\*" presente tal cual`);
    assert(res.includes('Remove-Item* C:\\*'), `${name}: "Remove-Item* C:\\*" presente tal cual`);
  }
});

test('hojas del pipeline con subagent * → deny (builder, verifier, critic, summarizer, explore)', () => {
  for (const name of LEAVES) {
    eq(resolvePermission(rulesOf(name), 'subagent', 'planner'), 'deny', `${name} no delega`);
  }
});

test('excepción planner→explore allow (experimental.subagent_depth: 2), el resto deny', () => {
  eq(pairs(subagentRules('planner')), { '*': 'deny', explore: 'allow' }, 'solo planner puede delegar, y solo en explore');
});

test('advisor delega (allow) en los otros 6 agentes; general deny', () => {
  const rules = rulesOf('advisor');
  eq(resolvePermission(rules, 'subagent', 'otro-agente'), 'ask', 'por defecto pide permiso');
  for (const name of AGENTS.filter((a) => a !== 'advisor')) {
    eq(resolvePermission(rules, 'subagent', name), 'allow', `advisor puede delegar en ${name}`);
  }
  eq(resolvePermission(rules, 'subagent', 'general'), 'deny', 'el built-in general queda fuera del pipeline');
});

test('advisor sin lectura libre: edit/glob/grep/webfetch deny', () => {
  const rules = rulesOf('advisor');
  eq(resolvePermission(rules, 'read', 'x'), 'allow', 'read sigue autorizado (es su única ventana al contexto)');
  for (const key of ADVISOR_DENEGADOS) eq(resolvePermission(rules, key, 'x'), 'deny', `advisor sin ${key}: deny`);
});

test('marcador canon:parallel-fanout con su regla en advisor.md (raíz + template)', () => {
  for (const f of [join(AGENTS_DIR, 'advisor.md'), join(REPO_ROOT, 'templates', '.opencode', 'agents', 'advisor.md')]) {
    const txt = readFileSync(f, 'utf8');
    match(txt, /canon:parallel-fanout/, 'marcador presente');
    match(txt, /hasta \*\*4\*\* `explore`/, 'tope de fan-out declarado');
  }
});

// ── Suite 2: wiring · commands ──────────────────────────────────────────────
suite('wiring · commands');

test('existen EXACTAMENTE los 9 comandos esperados', () => {
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  eq([...files].sort(), [...COMMANDS].sort(), 'los 9 comandos, ni uno más ni uno menos');
});

test('cada comando declara subagent: true y un agent: que existe en .opencode/agents', () => {
  for (const name of COMMANDS) {
    const fm = frontmatter(readFileSync(join(COMMANDS_DIR, `${name}.md`), 'utf8'));
    match(fm, /^subagent: true\s*$/m, `${name}.md es subagent`);
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

test('template: default_agent advisor + experimental.subagent_depth 2 + exactamente los 7 agentes', () => {
  eq(TEMPLATE.default_agent, 'advisor', 'default_agent');
  eq(TEMPLATE.experimental.subagent_depth, 2, 'experimental.subagent_depth (único nivel extra permitido: planner→explore)');
  eq(TEMPLATE.subagent_depth, undefined, 'sin subagent_depth en la raíz (V2 lo ignora)');
  eq(Object.keys(TEMPLATE.agent).sort(), [...AGENTS].sort(), 'agent con exactamente los 7');
});

test('template: cada model es un placeholder {{MODEL_*}} (sin modelo concreto en la plantilla)', () => {
  for (const [name, cfg] of Object.entries(TEMPLATE.agent)) {
    match(cfg.model, /^\{\{MODEL_[A-Z]+\}\}$/, `model de ${name} es placeholder`);
  }
});

test('fuente única de permisos: el JSON del template solo lleva mode+model por agente y external_directory global', () => {
  for (const [name, cfg] of Object.entries(TEMPLATE.agent)) {
    eq(Object.keys(cfg).sort(), ['mode', 'model'], `agent.${name}: sin permisos en el JSON`);
  }
  eq(TEMPLATE.permissions, [{ action: 'external_directory', resource: '*', effect: 'ask' }], 'única regla global');
});

test('espejo de agentes: .opencode/agents == templates/.opencode/agents salvo el placeholder de nombre del advisor', () => {
  for (const name of AGENTS) {
    const raiz = readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
    const tpl = readFileSync(join(REPO_ROOT, 'templates', '.opencode', 'agents', `${name}.md`), 'utf8');
    eq(frontmatterBlock(tpl), frontmatterBlock(raiz), `frontmatter de ${name} idéntico en el espejo`);
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
  eq(cfg.experimental.subagent_depth, 2, 'la config dev lleva experimental.subagent_depth 2');
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
