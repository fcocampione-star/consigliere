#!/usr/bin/env node
/**
 * test/e2e-harness-v2.test.mjs — E2E extremo a extremo del harness
 * (consigliere + memoria persistente) contra el CLI OpenCode v2.
 *
 * Todo corre en UN solo proyecto temporal instalado de verdad con init.mjs:
 *
 *  1. Instalación (`node init.mjs <tmp>`): árbol base, opencode.json válido
 *     con los 7 agentes, modelos heredados ('') y bash harden V1.
 *  2. GATE 0 EMPÍRICO (PROJECT_STATE §3) con `opencode debug config` /
 *     `opencode debug agents` sobre la config V1 del harness:
 *       - `default_agent`, `instructions` y el mapa `agent.*` se resuelven.
 *       - `permission.bash{patrón:efecto}` (V1) se NORMALIZA a
 *         `permissions[]` ({action:'shell', resource, effect}) sin perder
 *         NINGUNA regla deny/ask del bash harden.
 *       - `subagent_depth` NO llega a la config resuelta: v2 la hace strip
 *         en silencio. Comportamiento v2 documentado con probes en 2.0.32:
 *         NO emite warnings por claves desconocidas (ni con
 *         --print-logs --log-level trace), así que la señal fuerte del gate
 *         es QUÉ subsiste en la config resuelta, no los logs.
 *  3. Memoria persistente, ciclo /record completo con los motores reales
 *     instalados: rotate (protección corroborada: la entrada más nueva
 *     SIEMPRE queda live, nunca deja SUMMARY vacío) → index (search →
 *     timeline → get, incluye decisiones de §2) → sync export/import
 *     (idempotente, dedup por id) → stats (monday/lines) → tokens → lock
 *     (acquire → busy → status → release con token → free) → doctor verde.
 *  4. Skills: loader list/search/chunk (válido e inválido → exit 1),
 *     scaffold dry-run (no escribe) y skill-search --offline (best-effort).
 *  5. Ciclo de vida: `--upgrade` sobre el MISMO proyecto (memoria sentinela
 *     intacta, AGENTS regenerado, modelo fundido) y roundtrip final en el
 *     CLI v2: el modelo fundido es visible en la config resuelta.
 *
 * Reglas herméticas (compartidas con init.test.mjs):
 *  - TODO en temporales (`tmpdir()` + `cleanup()`); nunca este repo.
 *  - Hijos spawnSync + stdin vacío + timeout. Sin red, sin LLM, sin git init.
 *  - Los tests del CLI v2 solo corren si `opencode --version` ≥ 2.0.0 está
 *     disponible; si no, se OMITEN (no fallan): CI 3×OS sin CLI ejercita
 *     igualmente las suites herméticas. Override: ADVISOR_TEST_OPENCODE.
 *  - `debug config`/`debug agents` NO piden modelos ni tocan el servicio
 *     (probes): por eso son seguros en la suite.
 *  - Las fechas de rotación NO se calculan en el test: el lunes "de hoy" lo
 *     declara el motor (`memory-stats monday <hoy>`, mondayOf UTC único),
 *     así que la suite no duplica el algoritmo ni es sensible al día de la
 *     semana en que corra.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  suite, test, assert, eq, match, includes, tmpdir, cleanup, runAll,
} from './harness.mjs';

// ── Rutas derivadas de ESTE archivo (nunca absolutas a un host) ─────────────
const INIT = fileURLToPath(new URL('../init.mjs', import.meta.url));
const TEST_REOPENCODE = (process.env.ADVISOR_TEST_OPENCODE || '').trim();
const TIMEOUT_INIT = 120000;
const TIMEOUT_CLI = 90000;

// Marcadores de la región de entradas EXACTOS del motor (memory-stats.mjs).
const ENTRIES_START = '<!-- ADVISOR:ENTRIES:START -->';
const ENTRIES_END = '<!-- ADVISOR:ENTRIES:END -->';

// ── Omitidos (estilo init.test.mjs: se reportan y eşecutan el resto) ────────
const omitidos = [];
function omitir(motivo) {
  omitidos.push(motivo);
  console.log(`  [omitido] ${motivo}`);
}

// ── Utilidades ─────────────────────────────────────────────────────────────
function leer(p) {
  return readFileSync(p, 'utf8');
}
function escribir(p, txt) {
  writeFileSync(p, txt, 'utf8');
}
function existe(p) {
  return existsSync(p);
}
function cola(s, n = 400) {
  const t = String(s ?? '').trimEnd();
  return t.length <= n ? t : `${t.slice(0, n)}...`;
}
// ANSI de la consola Windows/CI fuera antes de comparar salidas.
function sinAnsi(s) {
  return String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}
function salida(res, ctx, n = 600) {
  return `${ctx}: exit=${res.status}\n${cola(`${res.stdout}\n${res.stderr}`, n)}`;
}

// Instala con init.mjs como hijo (stdin vacío: nada cuelga por prompt).
function instalar(args, cwd) {
  const r = spawnSync(process.execPath, [INIT, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    timeout: TIMEOUT_INIT,
    maxBuffer: 16 * 1024 * 1024,
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const res = {
    status: r.status, signal: r.signal, error: r.error,
    stdout: sinAnsi(r.stdout || ''), stderr: sinAnsi(r.stderr || ''),
  };
  res.out = sinAnsi(`${r.stdout || ''}${r.stderr || ''}`);
  assert(!r.error, `init.mjs no arrancó (${args.join(' ')}): ${r.error && r.error.message}`);
  assert(!r.signal, `init.mjs murió por señal ${r.signal} (${args.join(' ')})`);
  return res;
}

// Motor del harness instalado en el proyecto temporal: SIEMPRE la copia del
// temp (los scripts resuelven su raíz desde import.meta.dirname, no del cwd).
function motor(proyecto, relScript, args, timeout = TIMEOUT_CLI) {
  const r = spawnSync(process.execPath, [join(proyecto, ...relScript.split('/')), ...args], {
    env: process.env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    input: '',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return {
    status: r.status, signal: r.signal, error: r.error,
    stdout: sinAnsi(r.stdout || ''), stderr: sinAnsi(r.stderr || ''),
  };
}

function jsonDe(res, ctx) {
  assert(res.status === 0, salida(res, `${ctx} debe salir 0`));
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`${ctx}: salida no es JSON válido (${e.message}):\n${cola(res.stdout, 600)}`);
  }
}

// ── CLI opencode v2 (win32: los shims .cmd exigen terminal via cmd.exe) ─────
function resolverCLI() {
  const candidatos = TEST_REOPENCODE ? [TEST_REOPENCODE]
    : process.platform === 'win32' ? ['opencode.cmd'] : ['opencode'];
  for (const bin of candidatos) {
    const argsWin = ['/d', '/s', '/c', bin, '--version'];
    const r = process.platform === 'win32'
      ? spawnSync('cmd.exe', argsWin, { encoding: 'utf8', timeout: 30000, windowsHide: true, input: '' })
      : spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000, input: '' });
    if (r.error || r.status !== 0) continue;
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(sinAnsi(`${r.stdout}${r.stderr}`));
    if (m) return { bin, major: Number(m[1]), version: `${m[1]}.${m[2]}.${m[3]}` };
  }
  return null;
}
const CLI = resolverCLI();

function v2(proyecto, args) {
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', CLI.bin, ...args], {
        cwd: proyecto,
        env: process.env, encoding: 'utf8', timeout: TIMEOUT_CLI, windowsHide: true,
        input: '', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
      })
    : spawnSync(CLI.bin, args, {
        cwd: proyecto,
        env: process.env, encoding: 'utf8', timeout: TIMEOUT_CLI,
        input: '', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
      });
  return {
    status: r.status, signal: r.signal, error: r.error,
    stdout: sinAnsi(r.stdout || ''), stderr: sinAnsi(r.stderr || ''),
  };
}
function jsonV2(res, ctx) {
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`${ctx}: salida no es JSON (${e.message}):\n${cola(res.stdout, 800)}`);
  }
}
// Característica v2 procesada con probes: `debug agents`/`debug config` hablan
// con el background service GLOBAL compartido entre procesos del mismo
// usuario; bajo carga concurrente puede sociar el cwd y responder SOLO con
// los agentes builtin (sin los 7 del harness de .opencode/agents/). La
// detección es determinista (¿falta 'advisor'?) y el reintento es acotado:
// transiente del servicio, no del contrato — las aserciones siguen siendo estrictas.
function esVistaBuiltin(agentes) {
  return !Array.isArray(agentes) || !agentes.some((a) => a.id === 'advisor');
}
function v2AgentsConReintentos(proyecto) {
  let vista = null;
  for (let i = 0; i < 5; i++) {
    const r = v2(proyecto, ['debug', 'agents']);
    eq(r.status, 0, salida(r, 'debug agents'));
    vista = jsonV2(r, 'debug agents');
    if (!esVistaBuiltin(vista)) return vista;
    // Transiente: backoff fijo pequeño y re-invoca (nada debe persistir).
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},400)'], { timeout: 10000, windowsHide: true });
  }
  assert(!esVistaBuiltin(vista), `debug agents no resolvió los agentes del harness tras 5 intentos (vista SOLO builtin: ${cola((vista || []).map((a) => a.id).join(','), 200)})`);
  return vista;
}
// Documento `<proyecto>/opencode.json` dentro de la lista de fuentes resueltas.
function docProyecto(docs, proyecto) {
  const colaRuta = join(proyecto, 'opencode.json').replace(/\\/g, '/').toLowerCase();
  const doc = docs.find((d) => {
    const ruta = String(d.path || '').replace(/\\/g, '/').toLowerCase();
    return ruta.endsWith(colaRuta) && ruta === colaRuta;
  });
  assert(doc && doc.info, `debug config no resolvió el opencode.json del proyecto (${colaRuta}): ${cola(JSON.stringify(docs), 300)}`);
  return doc.info;
}
// Misma race de probes que `debug agents`, pero en la VISTA de config: el
// servicio global puede resolver el proyecto sin el doc del temp o sin los
// agentes fundidos (builder sin `model` — hallazgo bajo el agregador). El
// reintento acota el transiente y las aserciones de contrato quedan IGUALES de
// estrictas: solo se re-invoca cuando la vista está incompleta (¿doc del
// proyecto presente? ¿builder en la vista?). Si tras agotar los intentos el
// contenido sigue incompleto, se falla con el motivo diagnóstico, y los pines
// estrictos ({model, providerID}) corren igual sobre la última vista.
function vistaConfigValida(docs, proyecto, exigeModelo = false) {
  try {
    const info = docProyecto(docs, proyecto);
    const a = info.agents || {};
    const completa = ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier']
      .every((id) => a[id]);
    // exigeModelo solo para el roundtrip (post-upgrade): la firma {model,providerID}
    // fundida no existe ANTES del upgrade y ahí la vista completa bastaría.
    return completa && (!exigeModelo || a.builder.model !== undefined);
  } catch {
    return false; // sin doc del proyecto en esta vista: vista incompleta
  }
}
function v2ConfigConReintentos(proyecto, exigeModelo = false) {
  let docs = null;
  for (let i = 0; i < 5; i++) {
    const r = v2(proyecto, ['debug', 'config']);
    eq(r.status, 0, salida(r, 'debug config'));
    docs = jsonV2(r, 'debug config');
    if (vistaConfigValida(docs, proyecto, exigeModelo)) return { docs, r }; // r = último intento, para los pins de stderr de los tests
    // Transiente: backoff fijo pequeño y re-invoca (idéntico a debug agents).
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},400)'], { timeout: 10000, windowsHide: true });
  }
  assert(vistaConfigValida(docs, proyecto, exigeModelo), `debug config no resolvió vista completa tras 5 intentos (¿transiente del servicio o cambió el contrato v2?): ${cola(JSON.stringify(docs), 300)}`);
}

// ── Proyecto temporal ÚNICO: toda la E2E corre en él ───────────────────────
const BASE = tmpdir('advisor-e2e-v2');
const PROYECTO = join(BASE, 'proyecto');
const OPCFG = join(PROYECTO, 'opencode.json');
const MARCADOR = `E2E-V2-MARCADOR-${Math.random().toString(36).slice(2, 8)}`;
const MODELO_E2E = 'anthropic/claude-sonnet-4-5'; // id de forma válida (no requiere entitlement para PARSEAR)

// Entrada formato 1.0 (topic + review_after + 6 campos canónicos del summarizer).
function entradaFormato(date, title) {
  return [
    `## ${date} - ${title}`,
    '',
    'topic: e2e/harness-v2',
    'review_after: 2099-12-31',
    `**Goal:** ${MARCADOR}`,
    '**Discoveries:** sin hallazgos.',
    '**Accomplished:** ciclo e2e del harness.',
    '**Next:** revisar la rotación.',
    '**Files:** `git log --oneline -5`.',
    '**Verificación:** e2e-harness-v2.',
    '',
  ].join('\n');
}
function sembrar(proyecto, entradas) {
  const p = join(proyecto, 'SUMMARY.md');
  const txt = leer(p);
  assert(txt.includes(ENTRIES_START) && txt.includes(ENTRIES_END), 'SUMMARY instalado debe traer la región de entradas');
  escribir(p, txt.replace(ENTRIES_START, `${ENTRIES_START}\n${entradas.join('\n')}`));
}
// Fecha desplazada n días (ISO UTC).
function dias(iso, n) {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}
const hoyISO = () => new Date().toISOString().slice(0, 10);
// Lunes del motor (salida PLANA, sin JSON): sin lógica duplicada en el test.
function mondayOfMotor(proyecto, isoDate) {
  const r = motor(proyecto, '.opencode/scripts/memory-stats.mjs', ['monday', isoDate]);
  assert(r.status === 0, salida(r, `memory-stats monday ${isoDate}`));
  const m = /^\d{4}-\d{2}-\d{2}$/m.exec(r.stdout);
  assert(m, `monday debe imprimir una fecha ISO (${cola(r.stdout, 120)})`);
  return m[0];
}
// Lunes del CHANGELOG semanal que dejó la rotación (dir listado; motor escribió).
function cambioSemanal(proyecto) {
  const files = readdirSync(join(proyecto, 'CHANGELOG'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  assert(files.length >= 1, 'debe existir un CHANGELOG semanal creado por rotate');
  return files[files.length - 1].replace(/\.md$/, '');
}
// ids que imprime `search` (misma forma que parsea memory-index.test.mjs).
const lineIds = (out) => out.split('\n').filter((l) => l.startsWith('- '))
  .map((l) => (/^- (.*?) \[/.exec(l) || [])[1]).filter(Boolean);

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · instalación real del harness');

test('init.mjs instala el árbol base completo con los 7 agentes (harness de verdad en temp)', () => {
  const res = instalar([PROYECTO, '--name', 'e2e-v2-demo', '--autoskills', '3', '--git', 'no']);
  eq(res.status, 0, salida(res, 'instalación e2e'));
  for (const rel of [
    'opencode.json', 'AGENTS.md', 'PROJECT_STATE.md', 'SUMMARY.md', 'skills-lock.json', '.gitignore',
    '.opencode/agents/advisor.md', '.opencode/scripts/doctor.mjs', '.opencode/scripts/memory-index.mjs',
    '.opencode/scripts/memory-rotate.mjs', '.opencode/skills/_skill-loader/loader.mjs',
    'scripts/check-memory-limits.sh',
  ]) {
    assert(existe(join(PROYECTO, ...rel.split('/'))), `falta ${rel} en el árbol instalado → ${cola(res.out, 300)}`);
  }
  for (const rel of ['CHANGELOG', '.advisor', '.advisor/backups', '.advisor/chunks']) {
    assert(existe(join(PROYECTO, ...rel.split('/'))), `falta el directorio ${rel}/`);
  }
  const cfg = JSON.parse(leer(OPCFG));
  eq(Object.keys(cfg.agent || {}).sort(), ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier'], 'los 7 agentes del pipeline');
  eq(cfg.default_agent, 'advisor', 'default_agent del harness');
  eq(cfg.subagent_depth, 2, 'subagent_depth==2 en el archivo (contrato one-level + planner→explore)');
  match(cfg.instructions.join(','), /AGENTS\.md/, 'instructions trae AGENTS.md');
  for (const [id, def] of Object.entries(cfg.agent)) {
    eq(def.mode, id === 'advisor' ? 'primary' : 'subagent', `mode de ${id}`);
    eq(def.model, '', `${id} hereda modelo ({{MODEL_*}} → '')`);
  }
  const bash = cfg.agent.builder.permission.bash;
  eq(bash['*'], 'allow', 'bash harden: por defecto allow');
  eq(bash['git push*'], 'ask', 'bash harden: git push → ask');
  eq(bash['git commit*'], 'ask', 'bash harden: git commit → ask');
  eq(bash['rm -rf /*'], 'deny', 'bash harden: rm -rf / → deny');
  eq(bash['cat **/.env*'], 'ask', 'bash harden: .env → ask');
  eq(bash['cat ~/.ssh/*'], 'ask', 'bash harden: ssh → ask');
});

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · Gate 0 empírico — config del harness contra CLI OpenCode v2');

// Gate común: sin CLI (o major≠2) la suite empírica se omite sin ensuciar.
function gate() {
  if (!CLI) {
    omitir('CLI opencode ausente (probe --version): suites herméticas corren igualmente');
    return false;
  }
  if (CLI.major !== 2) {
    throw new Error(`drift: el Gate 0 empírico está escrito para CLI v2 y hay opencode v${CLI.version}; revisa las aserciones (PROJECT_STATE §3) antes de actualizar`);
  }
  return true;
}

test('debug config: default_agent, instructions y los 7 agentes resueltos, stderr VACÍO', () => {
  if (!gate()) return;
  const { docs, r } = v2ConfigConReintentos(PROYECTO);
  eq(r.stderr.trim(), '', `debug config no debe escribir en stderr (v2 ${CLI.version}): ${cola(r.stderr, 200)}`);
  const info = docProyecto(docs, PROYECTO);
  eq(info.default_agent, 'advisor', 'default_agent sobrevive en v2');
  eq(info.instructions, ['AGENTS.md'], 'instructions resuelto');
  eq(
    Object.keys(info.agents || {}).sort(),
    ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier'],
    'map agent.* (V1) → agents (v2) con los 7',
  );
  eq(info.agents.advisor.mode, 'primary', 'advisor primary');
  for (const id of ['planner', 'builder', 'verifier', 'critic', 'summarizer', 'explore']) {
    eq(info.agents[id].mode, 'subagent', `${id} subagent`);
  }
  // PIN de comportamiento v2 2.0.32 (strip silencioso): si una v2 futura
  // empezara a consumir subagent_depth, hay que migrar el harness (§3).
  eq(info.subagent_depth, undefined, 'v2 confirma: subagent_depth NO llega a la config resuelta (strip silencioso)');
});

test('v2 normaliza permission.bash{} → permissions[] SIN perder ninguna regla deny/ask', () => {
  if (!gate()) return;
  const { docs } = v2ConfigConReintentos(PROYECTO);
  const cfg = JSON.parse(leer(OPCFG)); // fuente de verdad: lo que escribió el harness
  const info = docProyecto(docs, PROYECTO);
  for (const id of ['builder', 'summarizer']) {
    const esperado = Object.entries(cfg.agent[id].permission.bash)
      .map(([resource, effect]) => `shell|${resource}|${effect}`).sort();
    const resuelto = (info.agents[id].permissions || [])
      .map((p) => `${p.action}|${p.resource}|${p.effect}`).sort();
    eq(resuelto, esperado, `bash harden de ${id}: V1 perm.bash → v2 permissions[] sin pérdida`);
  }
});

test('debug agents: 7 agentes del pipeline + permisos resueltos (hojas task: deny, advisor sin edit/shell)', () => {
  if (!gate()) return;
  const agentes = v2AgentsConReintentos(PROYECTO);
  const de = (id) => agentes.find((a) => a.id === id);
  for (const id of ['advisor', 'planner', 'builder', 'verifier', 'critic', 'summarizer', 'explore']) {
    assert(de(id), `debug agents debe resolver a ${id} del harness → ${cola(agentes.map((a) => a.id).join(','), 200)}`);
  }
  const permiso = (a, action, resource, effect) =>
    (a.permissions || []).some((p) => p.action === action && p.resource === resource && p.effect === effect);
  eq(de('advisor').mode, 'primary', 'advisor primario (Tab)');
  assert(permiso(de('critic'), 'subagent', '*', 'deny'), 'critic (hoja): subagent * → deny');
  assert(permiso(de('explore'), 'subagent', '*', 'deny'), 'explore (hoja): subagent * → deny');
  assert(permiso(de('planner'), 'subagent', 'explore', 'allow'), 'planner→explore (depth 2): allow');
  assert(permiso(de('advisor'), 'edit', '*', 'deny'), 'advisor coordinador puro: edit deny');
  assert(permiso(de('advisor'), 'shell', '*', 'deny'), 'advisor coordinador puro: shell deny');
  assert(permiso(de('summarizer'), 'shell', 'git push*', 'ask'), 'summarizer: bash harden aplicado también en frontmatter');
});

test('v2 tolera claves extrañas: strip silencioso, sin ERROR ni stderr', () => {
  if (!gate()) return;
  const backup = leer(OPCFG);
  try {
    const cfg = JSON.parse(backup);
    cfg.clave_bogus_e2e = 'x';
    escribir(OPCFG, JSON.stringify(cfg, null, 2));
    const { docs, r } = v2ConfigConReintentos(PROYECTO);
    eq(r.stderr.trim(), '', 'sin warnings/pesares por claves desconocidas (pinned 2.0.32)');
    const info = docProyecto(docs, PROYECTO);
    eq(info.clave_bogus_e2e, undefined, 'las claves desconocidas no llegan al resolved');
  } finally {
    escribir(OPCFG, backup);
  }
});

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · memoria persistente (rotate → index → sync → stats → tokens → lock → doctor)');

test('doctor sobre el proyecto recién instalado: exit 0 (informativos permitidos, sin ❌)', () => {
  const d = motor(PROYECTO, '.opencode/scripts/doctor.mjs', []);
  eq(d.status, 0, salida(d, 'doctor inicial'));
});

test('rotate: 2 entradas de la semana pasada → mueve la MÁS VIEJA, preserva live la nueva', () => {
  const lunesHoy = mondayOfMotor(PROYECTO, hoyISO()); // el motor declara su "lunes de hoy"
  sembrar(PROYECTO, [
    entradaFormato(dias(lunesHoy, -1), `Entrada live ${MARCADOR}`),   // la más nueva → queda live
    entradaFormato(dias(lunesHoy, -6), `Entrada vieja ${MARCADOR}`),  // la más vieja → se rota
  ]);
  const r = motor(PROYECTO, '.opencode/scripts/memory-rotate.mjs', ['rotate', '--json']);
  eq(r.status, 0, salida(r, 'rotate --json'));
  const out = jsonDe(r, 'rotate --json');
  eq(out.command, 'rotate');
  eq(out.moved.length, 1, `debe mover EXACTAMENTE 1 (protección: nunca archiva la más nueva ni deja SUMMARY vacío) → ${JSON.stringify(out.moved)}`);
  includes(out.moved[0].title, MARCADOR);
  match(out.moved[0].title, /Entrada vieja/, 'la movida es la MÁS VIEJA de las dos');
  eq(out.changelog.length, 1, 'se appendea el CHANGELOG semanal');
  eq(out.summaryWritten, true, 'SUMMARY reescrito');
  eq(out.stateUpdated.length, 1, 'PROJECT_STATE §4 indexado con la semana archivada');

  const mondaySem = cambioSemanal(PROYECTO);
  const changelog = leer(join(PROYECTO, 'CHANGELOG', `${mondaySem}.md`));
  includes(changelog, MARCADOR, 'la entrada archivada conserva su contenido (incl. marcador)');
  match(changelog, /## \d{4}-\d{2}-\d{2} - Entrada vieja/, 'heading de la entrada archivada');

  const summary = leer(join(PROYECTO, 'SUMMARY.md'));
  includes(summary, `Entrada live ${MARCADOR}`, 'la MÁS NUEVA sigue live (protección anti-SUMMARY-vacío)');
  assert(!summary.includes(`Entrada vieja ${MARCADOR}`), 'la vieja ya no debe estar en SUMMARY');
  includes(leer(join(PROYECTO, 'PROJECT_STATE.md')), mondaySem, '§4 de PROJECT_STATE indexa la semana archivada');

  // Idempotencia: re-rotate → 0 movidas + explicación (única entrada protegida).
  const r2 = motor(PROYECTO, '.opencode/scripts/memory-rotate.mjs', ['rotate', '--json']);
  eq(jsonDe(r2, 'rotate re-run').moved.length, 0, 're-rotate no mueve nada');
  assert((jsonDe(r2, 're-run warnings').warnings || []).some((w) => w.includes('Protección')), 'el re-run explica la protección');
});

test('memory-index: search → timeline → get del ciclo md+grep real (post-rotate)', () => {
  const s = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['search', MARCADOR]);
  eq(s.status, 0, salida(s, 'search'));
  const ids = lineIds(s.stdout);
  assert(ids.length >= 2, `debe indexar las 2 entradas (live + archivada) → ${cola(s.stdout, 200)}`);

  // El flujo documentado (search → timeline → get) sobre la ENTRADA ARCHIVADA:
  // el CHANGELOG semanal es memoria de primera clase para el índice.
  const semanaArchivada = `## `; void semanaArchivada;
  const idArchivada = ids.find((id) => id.includes('entrada-vieja')) || ids[0];
  const t = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['timeline', idArchivada]);
  eq(t.status, 0, salida(t, 'timeline'));
  const g = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['get', idArchivada]);
  eq(g.status, 0, salida(g, 'get'));
  includes(g.stdout, MARCADOR, 'get imprime el CUERPO (no solo heading)');
  match(g.stdout, /## \d{4}-\d{2}-\d{2}/, 'get muestra el heading de la entrada');
  match(g.stdout, /topic: e2e\/harness-v2/, 'get conserva el topic del formato 1.0');

  const l = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['list', '--json']);
  eq(l.status, 0, salida(l, 'list --json'));
  // `list --json` imprime el array raíz de entradas (no un objeto envoltorio).
  const entradas = JSON.parse(l.stdout);
  assert(Array.isArray(entradas) && entradas.length >= 2, `list expone el índice completo (${entradas.length})`);
  assert(entradas.some((e) => e.source === 'SUMMARY.md'), 'el índice incluye SUMMARY.md');
  assert(entradas.some((e) => String(e.source).startsWith('CHANGELOG/')), 'el índice incluye el CHANGELOG rotado');
  assert(entradas.some((e) => e.source === 'PROJECT_STATE.md §2'), 'el índice incluye las decisiones §2');
});

test('memory-index también indexa decisiones nuevas de PROJECT_STATE §2 (el parser es seccional)', () => {
  const p = join(PROYECTO, 'PROJECT_STATE.md');
  const marca = `DECISION-E2E-${Math.random().toString(36).slice(2, 8)}`;
  // Las decisiones se indexan DESDE la sección §2 (stateDecisions es
  // seccional): el bullet se inserta DENTRO de §2, no al final del archivo.
  const txt = leer(p);
  const head = txt.indexOf('## 2.');
  assert(head >= 0, `el PROJECT_STATE instalado debe tener §2 (${head})`);
  const finSeccion = txt.indexOf('\n## 3.', head);
  escribir(p, `${txt.slice(0, finSeccion)}- Decisión e2e ${marca} [topic: e2e/decision] review_after: 2099-12-31\n${txt.slice(finSeccion)}`);
  const s = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['search', marca]);
  eq(s.status, 0, salida(s, 'search decisión'));
  const ids = lineIds(s.stdout);
  assert(ids.length >= 1, `la decisión de §2 debe indexarse → ${cola(s.stdout, 200)}`);
  const g = motor(PROYECTO, '.opencode/scripts/memory-index.mjs', ['get', ids[0]]);
  eq(g.status, 0, salida(g, 'get decisión'));
  includes(g.stdout, marca, 'get trae la línea de la decisión');
});

test('memory-sync: export escribe chunks+manifest; import reimporta IDEMPOTENTE (dedup por id)', () => {
  const ex = motor(PROYECTO, '.opencode/scripts/memory-sync.mjs', ['export']);
  eq(ex.status, 0, salida(ex, 'export'));
  assert(existe(join(PROYECTO, '.advisor', 'chunks')) && existe(join(PROYECTO, '.advisor', 'memory-manifest.json')), 'export deja .advisor/chunks/ + memory-manifest.json');
  const st = motor(PROYECTO, '.opencode/scripts/memory-sync.mjs', ['status']);
  eq(st.status, 0, salida(st, 'status'));
  const im = motor(PROYECTO, '.opencode/scripts/memory-sync.mjs', ['import']);
  eq(im.status, 0, salida(im, 'import'));

  const weekly = join(PROYECTO, 'CHANGELOG', `${cambioSemanal(PROYECTO)}.md`);
  const heads = () => (leer(weekly).match(/^## /gm) || []).length;
  const antes = heads();
  const im2 = motor(PROYECTO, '.opencode/scripts/memory-sync.mjs', ['import']);
  eq(im2.status, 0, salida(im2, 'import 2º'));
  eq(heads(), antes, 'import repetido NO duplica entradas de CHANGELOG (dedup por id)');
});

test('memory-stats: monday consigo mismo y lines NO rebasa los límites (100/150)', () => {
  const l = mondayOfMotor(PROYECTO, hoyISO());
  eq(mondayOfMotor(PROYECTO, l), l, 'monday del lunes del motor es idempotente');
  const st = jsonDe(motor(PROYECTO, '.opencode/scripts/memory-stats.mjs', ['lines']), 'memory-stats lines');
  assert(Number.isFinite(st.count), `count numérico (${st.count})`);
  eq(st.file, join(PROYECTO, 'SUMMARY.md'), 'lines evalúa el SUMMARY del proyecto');
  assert(st.count < 150, `SUMMARY contentLines (${st.count}) < límite 150`);
  eq(st.marked, true, 'el SUMMARY instalado trae marcadores');
});

test('memory-tokens compare --json: estimador read-only con números coherentes', () => {
  const out = jsonDe(motor(PROYECTO, '.opencode/scripts/memory-tokens.mjs', ['compare', '--scenario', 'spec-lite', '--json']), 'tokens compare');
  eq(out.scenario, 'spec-lite');
  assert(out.leaves >= 1 && Number.isFinite(out.leaves), `leaves positivo (${out.leaves})`);
  assert(out.baseline > 0 && out.advisor > 0, 'baseline y advisor positivos');
  assert(out.advisor < out.baseline, `advisor (${out.advisor}) < baseline (${out.baseline}): el ahorro es el punto`);
});

test('memory-lock: acquire → busy → status → release (sin token: not-owner) → con token → free', () => {
  const j = jsonDe(motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['acquire']), 'lock acquire');
  eq(j.acquired, true, 'primer acquire: adquirido');
  assert(j.token && j.owner && j.owner.pid > 0, 'devuelve token + owner (pid)');
  assert(existe(join(PROYECTO, '.memory-lock')), 'el lock es un directorio mkdir-atómico');

  const busy = motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['acquire']);
  eq(busy.status, 1, salida(busy, '2º acquire sale 1 (busy)'));
  match(busy.stderr, /lock busy/, 'busy lo declara');
  const s = jsonDe(motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['status']), 'lock status');
  eq(s.held, true, 'status held con dueño vivo');

  const bad = motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['release']);
  eq(bad.status, 1, salida(bad, 'release SIN token sale 1 (not-owner)'));
  match(bad.stderr, /not-owner/, 'explica que no es el dueño');

  const rel = motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['release', '--token', j.token]);
  eq(rel.status, 0, salida(rel, 'release con token'));
  // `status` en estado LIBRE imprime texto plano ('free'), no JSON:contrato.
  const fin = motor(PROYECTO, '.opencode/scripts/memory-lock.mjs', ['status']);
  eq(fin.status, 0, salida(fin, 'lock status final'));
  match(fin.stdout.trim(), /^free$/, 'status libre imprime `free`');
  assert(!existe(join(PROYECTO, '.memory-lock')), 'sin lock huérfano (regla anti-concurrencia)');
});

test('doctor tras TODO el churn de memoria: sigue en verde', () => {
  const d = motor(PROYECTO, '.opencode/scripts/doctor.mjs', []);
  eq(d.status, 0, salida(d, 'doctor post-churn'));
});

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · skills (loader, scaffold, search)');

test('loader list cataloga las 3 skills internas (cache fingerprint)', () => {
  const r = motor(PROYECTO, '.opencode/skills/_skill-loader/loader.mjs', ['list']);
  eq(r.status, 0, salida(r, 'loader list'));
  for (const id of ['_project-docs', '_sdd-lite', '_skill-loader']) {
    includes(r.stdout, id, `loader list debe catalogar ${id}`);
  }
});

test('loader search encuentra por término; chunk válido carga; chunk INEXISTENTE es exit 1 controlado', () => {
  const s = motor(PROYECTO, '.opencode/skills/_skill-loader/loader.mjs', ['search', 'spec']);
  eq(s.status, 0, salida(s, 'loader search'));
  includes(s.stdout, '_sdd-lite', 'search "spec" encuentra la skill de specs');

  const c = motor(PROYECTO, '.opencode/skills/_skill-loader/loader.mjs', ['chunk', '_sdd-lite', 'patterns']);
  eq(c.status, 0, salida(c, 'loader chunk patterns'));
  assert(c.stdout.trim().length > 0, 'el chunk patterns devuelve contenido');

  const bad = motor(PROYECTO, '.opencode/skills/_skill-loader/loader.mjs', ['chunk', '_sdd-lite', 'chunk-inexistente']);
  eq(bad.status, 1, salida(bad, 'chunk inválido → exit 1 controlado'));
  match(bad.stderr, /no tiene chunks/, 'el mensaje nombra el chunk ausente y los válidos');
});

test('skill-scaffold dry-run: exit 0 y NO escribe en .agents/skills/', () => {
  const r = motor(PROYECTO, '.opencode/scripts/skill-scaffold.mjs', ['demo-e2e-skill', '--description', 'dry-run de e2e']);
  eq(r.status, 0, salida(r, 'scaffold dry-run'));
  assert(!existe(join(PROYECTO, '.agents', 'skills', 'demo-e2e-skill')), 'dry-run no escribe (solo --write)');
  includes(r.stdout, 'demo-e2e-skill', 'el dry-run muestra el esqueleto propuesto');
});

test('skill-search --offline: best-effort exit 0 (sin cache regenerable sin red)', () => {
  const r = motor(PROYECTO, '.opencode/scripts/skill-search.mjs', ['skyscraper', '--offline']);
  eq(r.status, 0, salida(r, 'skill-search offline'));
});

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · ciclo de vida --upgrade + roundtrip config contra CLI v2');

// tar es requisito del backup previo obligatorio de --upgrade; igual orden
// de resolución que init.mjs (root-only: duplicar la lógica no viola el
// contrato anti-drift — paridad espejo raíz↔templates, test/ no espeja).
function resolveTar() {
  const override = (process.env.ADVISOR_TAR || '').trim();
  const candidatos = override ? [override]
    : process.platform === 'win32'
      ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), 'tar']
      : ['tar'];
  for (const bin of candidatos) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

test('--upgrade: backup previo + memoria sentinela INTACTA + AGENTS regenerado + model fundido', () => {
  if (!resolveTar()) { omitir('tar ausente: --upgrade exige backup previo obligatorio'); return; }
  // Sentinelas: memoria del usuario (PRESERVAR) + edición de AGENTS.md (regar).
  const sentinela = `SENTINELA-E2E-${Math.random().toString(36).slice(2, 8)}`;
  escribir(join(PROYECTO, 'PROJECT_STATE.md'), `${leer(join(PROYECTO, 'PROJECT_STATE.md'))}\n${sentinela}\n`);
  escribir(join(PROYECTO, 'AGENTS.md'), `${leer(join(PROYECTO, 'AGENTS.md'))}\n<!-- REGAR-ESTO -->\n`);
  const cfg = JSON.parse(leer(OPCFG));
  cfg.agent.builder.model = MODELO_E2E;
  escribir(OPCFG, `${JSON.stringify(cfg, null, 2)}\n`);

  const r = instalar([PROYECTO, '--upgrade', '--autoskills', '3', '--git', 'no'], BASE);
  eq(r.status, 0, salida(r, '--upgrade', 900));

  includes(leer(join(PROYECTO, 'PROJECT_STATE.md')), sentinela, 'PROJECT_STATE.md (memoria) debe PRESERVARSE');
  includes(leer(join(PROYECTO, 'CHANGELOG', `${cambioSemanal(PROYECTO)}.md`)), MARCADOR, 'el CHANGELOG rotado sobrevive al upgrade (memoria real)');
  assert(!leer(join(PROYECTO, 'AGENTS.md')).includes('REGAR-ESTO'), 'AGENTS.md debe REGENERARSE (config, no memoria)');
  const nuevo = JSON.parse(leer(OPCFG));
  eq(nuevo.agent.builder.model, MODELO_E2E, '--upgrade funde tu model: por agente');
  eq(nuevo.default_agent, 'advisor', 'y regenera default_agent desde la plantilla');
  const backups = readdirSync(join(PROYECTO, '.advisor', 'backups'));
  assert(backups.length >= 1, `backup previo obligatorio en .advisor/backups/ (hay ${backups.length})`);
  const d = motor(PROYECTO, '.opencode/scripts/doctor.mjs', []);
  eq(d.status, 0, salida(d, 'doctor tras upgrade'));
});

test('roundtrip final CLI v2: el modelo fundido sigue VISIBLE en la config resuelta', () => {
  if (!gate()) return;
  const { docs } = v2ConfigConReintentos(PROYECTO, true); // exige el model fundido en la vista (transiente del servicio)
  const info = docProyecto(docs, PROYECTO);
  // PIN de normalización v2: el `model` "proveedor/modelo" se descompone en
  // {model, providerID} en la config resuelta (2.0.32). Si una v2 futura
  // vuelve al string crudo, esta aserción lo marca para actualizar.
  const modelo = info.agents.builder.model;
  const esperado = { model: MODELO_E2E.split('/')[1], providerID: MODELO_E2E.split('/')[0] };
  eq(modelo, esperado, 'el model fundido sobrevive al parseo v2 (normalizado a {model, providerID})');
  eq(info.default_agent, 'advisor', 'roundtrip: default_agent del proyecto upgraded');
  const a = v2AgentsConReintentos(PROYECTO);
  eq(a.length > 0, true, 'debug agents tras upgrade: la vista es válida');
  assert(a.some((x) => x.id === 'builder'), 'los agentes siguen resolviéndose tras el upgrade');
});

// ════════════════════════════════════════════════════════════════════════════
suite('e2e · limpieza');

test('borra el proyecto temporal completo (memoria + lock incluidos)', () => {
  cleanup(BASE);
  assert(!existe(PROYECTO), 'el proyecto temporal debe desaparecer entero');
});

if (omitidos.length) {
  console.log('— omitidos de esta corrida:');
  for (const o of omitidos) console.log(`   · ${o}`);
}

await runAll();
