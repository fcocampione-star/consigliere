#!/usr/bin/env node
/**
 * contract-tests.mjs — Contract tests anti-drift + invariantes del harness Advisor 2.0.
 * Uso: node .opencode/scripts/contract-tests.mjs
 * Exit: 0 = PASS, 1 = algún invariante roto.
 *
 * SOLO raíz (NO se espeja en templates/): es un test de desarrollo, como memory-rotate.test.mjs.
 * Sin dependencias externas. Los asserts son por PRESENCIA/INVARIANTE (no líneas exactas ni fechas).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');
const TPL = join(ROOT, 'templates');

const failures = [];
const warnings = [];
const passes = [];
const fail = (name, msg) => failures.push(`${name}: ${msg}`);
const warn = (name, msg) => warnings.push(`${name}: ${msg}`);
const pass = (name, msg = '') => passes.push(msg ? `${name} — ${msg}` : name);
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const sha = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Marcadores ADVISOR:ENTRIES en SUMMARY.md (raíz + plantilla)
// ─────────────────────────────────────────────────────────────────────────────
function checkMarkers(name, rel) {
  const txt = read(join(ROOT, rel));
  if (txt === null) return fail(name, `no existe ${rel}`);
  const start = (txt.match(/ADVISOR:ENTRIES:START/g) || []).length;
  const end = (txt.match(/ADVISOR:ENTRIES:END/g) || []).length;
  if (start !== 1 || end !== 1) return fail(name, `${rel}: START=${start} END=${end} (esperado 1/1)`);
  if (txt.indexOf('ADVISOR:ENTRIES:START') > txt.indexOf('ADVISOR:ENTRIES:END'))
    return fail(name, `${rel}: END antes de START`);
  pass(name, rel);
}
checkMarkers('marcadores SUMMARY', 'SUMMARY.md');
checkMarkers('marcadores templates/SUMMARY', 'templates/SUMMARY.md');

// ─────────────────────────────────────────────────────────────────────────────
// 2. Hook post-commit: sin perl / sed -i / flock (fuera de comentarios) y usa el motor Node
// ─────────────────────────────────────────────────────────────────────────────
function checkHook(name, rel) {
  const txt = read(join(ROOT, rel));
  if (txt === null) return fail(name, `no existe ${rel}`);
  const code = txt.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const bad of [/\bperl\b/, /sed\s+-i\b/, /\bflock\b/]) {
    if (bad.test(code)) return fail(name, `${rel}: usa ${bad} fuera de comentarios`);
  }
  if (!/memory-rotate\.mjs/.test(txt)) return fail(name, `${rel}: no referencia memory-rotate.mjs`);
  pass(name, rel);
}
checkHook('hook post-commit', '.opencode/hooks/post-commit-memory-rotate.sh');
checkHook('hook post-commit (template)', 'templates/.opencode/hooks/post-commit-memory-rotate.sh');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Paridad de espejo raíz ↔ templates/ (con allowlist de divergencias por diseño)
// ─────────────────────────────────────────────────────────────────────────────
// El conjunto espejo se deriva por convención: todo archivo de la raíz que también
// existe en templates/ a la misma ruta relativa. Para ese conjunto exigimos hashes
// idénticos, salvo las divergencias explícitamente allowlisted aquí abajo.
//
// Allowlist (divergencias POR DISEÑO — documentadas):
const ALLOW_DIVERGENCE = {
  '.gitignore':
    'raíz añade ignores de runtime (.advisor/.migrated, manifest, chunks, .agents) + opencode.json anclado; la plantilla usa opciones comentadas.',
  '.opencode/agents/advisor.md':
    'raíz nombra "consigliere"; la plantilla usa el placeholder {{PROJECT_NAME}}.',
  '.opencode/commands/doctor.md':
    'variante del repo dev (plana); la plantilla es la variante instalable consolidada.',
  '.opencode/scripts/doctor.mjs':
    'variante dev (checks planos, fixes locales); la plantilla es la variante instalable por capas A/B/C.',
  '.opencode/skills/_project-docs/SKILL.md':
    'raíz es específica del proyecto (consigliere, comandos dev); la plantilla es genérica con placeholders.',
  'AGENTS.md':
    'raíz describe este repo; la plantilla usa placeholders {{STACK_*}}/{{DEV_COMMANDS}} + sentinel ADOPTION-STACK.',
  'opencode.json':
    'config dev de la raíz (gitignored) con {{MODEL_*}} resueltos a cadena vacía; la plantilla conserva los placeholders.',
  'PROJECT_STATE.md':
    'memoria viva del proyecto vs plantilla limpia (memoria no se espeja 1:1).',
  'SUMMARY.md':
    'memoria viva (entradas históricas) vs plantilla con bloque vacío.',
  'scripts/check-memory-limits.sh':
    'divergencia de mensaje: raíz recomienda `memory-sync buildManifest`, la plantilla `npx --upgrade` (pendiente de alinear).',
  'skills-lock.json':
    'lock de autoskills por repo (raíz con skills pinneadas) vs base vacía de la plantilla.',
};
// Archivos presente solo en la raíz y no espejados a propósito:
const ROOT_ONLY_EXACT = new Set([
  '.gitattributes',
  '.opencode/.gitignore',
  '.opencode/scripts/memory-rotate.test.mjs',
  '.opencode/scripts/contract-tests.mjs',
  '.opencode/scripts/version-check.mjs',
  'LICENSE',
  'README.md',
  'init.cmd',
  'init.mjs',
  'init.ps1',
  'init.sh',
  'package.json',
]);
const ROOT_ONLY_PREFIXES = [
  // `CHANGELOG/` = memoria viva ya archivada (capa 2), nunca se espeja.
  'CHANGELOG/',
  // `test/` = suite de tests del repo (harness, fixtures, agregador): desarrollo
  // puro, no se instala por proyecto ni forma parte del harness publicable.
  'test/',
];
// Archivos presente solo en templates/ y no espejados a propósito:
const TEMPLATE_ONLY_EXACT = new Set(['opencode.json']);

// Lock de memoria y su debris (`.memory-lock`, `.memory-lock.stale.<pid>`): no es
// contenido versionable y un lock/transitorio de un test no debe contaminar el run.
const LOCK_DEBRIS = '.memory-lock';
// `.github/` son workflows de CI: raiz-only por definicion, nunca espejadas a templates/.
const SKIP_WALK = new Set(['.git', 'node_modules', '.advisor', '.agents', '.github', LOCK_DEBRIS]);
function walk(base, rel = '', skip = new Set()) {
  const out = [];
  let entries;
  try { entries = readdirSync(join(base, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (skip.has(e.name) || e.name.startsWith(LOCK_DEBRIS)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(base, r, skip));
    else out.push(r);
  }
  return out;
}
const rootFiles = walk(ROOT, '', new Set([...SKIP_WALK, 'templates'])).sort();
const tplFiles = walk(TPL).sort();
const rootSet = new Set(rootFiles);
const tplSet = new Set(tplFiles);

// Lectura + hash tolerante a fallos: un archivo ilegible (permisos, dir con el
// mismo nombre) debe REPORTAR un fallo del contrato, no reventar con un stack.
const shaOrNull = (p) => { try { return sha(p); } catch { return null; } };

let mirrorChecked = 0;
for (const r of rootFiles) {
  if (!tplSet.has(r)) continue;
  mirrorChecked++;
  const a = shaOrNull(join(ROOT, r));
  const b = shaOrNull(join(TPL, r));
  if (a === null || b === null) { fail('paridad espejo', `${r}: ilegible (raíz: ${a === null ? 'error' : 'ok'}, templates: ${b === null ? 'error' : 'ok'})`); continue; }
  if (a === b) continue;
  if (r in ALLOW_DIVERGENCE) continue;
  fail('paridad espejo', `${r} difiere de templates/${r} y no está en la allowlist`);
}
pass('paridad espejo', `${mirrorChecked} archivos espejo verificados`);

for (const r of rootFiles) {
  if (tplSet.has(r)) continue;
  if (ROOT_ONLY_EXACT.has(r) || ROOT_ONLY_PREFIXES.some((p) => r.startsWith(p))) continue;
  // Un archivo solo-raíz NO catalogado es drift silencioso (nadie lo espeja y
  // nadie lo declaró excepción): falla el contrato, no solo avisa.
  fail('espejo', `archivo solo-raíz no catalogado: ${r} (¿debe espejarse?)`);
}
for (const r of tplFiles) {
  if (rootSet.has(r)) continue;
  if (TEMPLATE_ONLY_EXACT.has(r)) continue;
  warn('espejo', `archivo solo-template no catalogado: ${r}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. commit-ask: los commits se proponen (ask), nunca automáticos
// ─────────────────────────────────────────────────────────────────────────────
const GIT_PATTERNS = ['git commit*', 'git amend*', 'git push*'];
try {
  const cfg = JSON.parse(read(join(TPL, 'opencode.json')));
  for (const agent of ['builder', 'summarizer']) {
    const bash = cfg.agent?.[agent]?.permission?.bash;
    for (const pat of GIT_PATTERNS) {
      if (!bash || bash[pat] !== 'ask') fail('commit-ask', `templates/opencode.json ${agent}.${pat} debe ser ask (es ${bash && bash[pat]})`);
    }
  }
  const vbash = cfg.agent?.verifier?.permission?.bash;
  for (const pat of GIT_PATTERNS) {
    if (vbash && vbash[pat] === 'allow') fail('commit-ask', `verifier.${pat} no debe ser allow`);
  }
  pass('commit-ask', 'templates/opencode.json builder+summarizer ask');
} catch (e) {
  fail('commit-ask', `templates/opencode.json: ${e.message}`);
}
for (const rel of ['.opencode/agents/summarizer.md', 'templates/.opencode/agents/summarizer.md']) {
  const t = read(join(ROOT, rel));
  if (t === null) { fail('commit-ask', `no existe ${rel}`); continue; }
  for (const pat of GIT_PATTERNS) {
    if (!t.includes(`"${pat}": ask`)) fail('commit-ask', `${rel} falta "${pat}": ask`);
  }
}
pass('commit-ask', 'summarizer.md (raíz+template) git */amend/push = ask');

// ─────────────────────────────────────────────────────────────────────────────
// 5. Campos de entrada de sesión: nº canónico real y consistencia docs/plantilla
// ─────────────────────────────────────────────────────────────────────────────
// Fuente canónica: el bloque de plantilla de entrada en `.opencode/agents/summarizer.md`.
const CANONICAL_FIELDS = ['Goal', 'Discoveries', 'Accomplished', 'Next', 'Files', 'Verificación'];
function entryFields(text) {
  if (!text) return null;
  const m = text.match(/```markdown\r?\n([\s\S]*?)```/);
  if (!m) return null;
  return [...m[1].matchAll(/\*\*([A-Za-zÁÉÍÓÚáéíóúÑñ]+):\*\*/g)].map((x) => x[1]);
}
const canon = entryFields(read(join(ROOT, '.opencode/agents/summarizer.md')));
if (!canon) {
  fail('campos sesión', 'summarizer.md: no se encontró el bloque de entrada ```markdown');
} else {
  const canonCount = canon.length;
  if (canonCount !== CANONICAL_FIELDS.length || !CANONICAL_FIELDS.every((f) => canon.includes(f)))
    fail('campos sesión', `canónico inesperado [${canon.join(', ')}] (esperado ${CANONICAL_FIELDS.join(', ')})`);
  else pass('campos sesión', `canónico = ${canonCount} campos (${canon.join('/')})`);

  for (const rel of ['templates/.opencode/agents/summarizer.md', 'SUMMARY.md', 'templates/SUMMARY.md', '.opencode/plans/MEMORY-SYSTEM.md', 'templates/.opencode/plans/MEMORY-SYSTEM.md']) {
    const f = entryFields(read(join(ROOT, rel)));
    if (!f) { fail('campos sesión', `${rel}: sin bloque de entrada`); continue; }
    if (f.length !== canonCount || !CANONICAL_FIELDS.every((x) => f.includes(x)))
      fail('campos sesión', `${rel}: [${f.join(', ')}] ≠ canónico (${canonCount})`);
  }

  const DOC_COUNT_FILES = [
    'AGENTS.md', 'templates/AGENTS.md',
    '.opencode/plans/MEMORY-SYSTEM.md', 'templates/.opencode/plans/MEMORY-SYSTEM.md',
    '.opencode/skills/_project-docs/SKILL.md', 'templates/.opencode/skills/_project-docs/SKILL.md',
    '.opencode/agents/summarizer.md', 'templates/.opencode/agents/summarizer.md',
    '.opencode/commands/routine.md', 'templates/.opencode/commands/routine.md',
    'README.md',
  ];
  for (const rel of DOC_COUNT_FILES) {
    const t = read(join(ROOT, rel));
    if (t === null) continue;
    for (const m of t.matchAll(/(\d+)\s+campos/g)) {
      if (Number(m[1]) !== canonCount) fail('campos sesión', `${rel}: dice "${m[0]}" pero el canónico es ${canonCount}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Drift documental: `grep+perl` (usar md+grep) y legacy `.consigliere/` no intencional
// ─────────────────────────────────────────────────────────────────────────────
const allMarkdown = [
  ...rootFiles.filter((r) => r.endsWith('.md')).map((r) => ({ label: r, path: join(ROOT, r) })),
  ...tplFiles.filter((r) => r.endsWith('.md')).map((r) => ({ label: `templates/${r}`, path: join(TPL, r) })),
];
// Exenciones intencionales: memoria (histórico/decisión) y docs que mencionan la ELIMINACIÓN del legacy.
const LEGACY_EXEMPT = new Set([
  'PROJECT_STATE.md',
  'templates/PROJECT_STATE.md',
  'SUMMARY.md',
  '.opencode/plans/MEMORY-SYSTEM.md',
  'templates/.opencode/plans/MEMORY-SYSTEM.md',
]);
const LEGACY_PREFIXES = ['CHANGELOG/'];
for (const { label, path } of allMarkdown) {
  const t = read(path);
  if (t === null) continue;
  if (/(grep\+perl|grep \+ perl)/.test(t)) fail('drift-doc', `${label}: contiene grep+perl (usar md+grep)`);
  if (/\.consigliere/.test(t) && !LEGACY_EXEMPT.has(label) && !LEGACY_PREFIXES.some((p) => label.startsWith(p)))
    fail('drift-doc', `${label}: referencia legacy .consigliere/ no intencional`);
}
if (!failures.some((f) => f.startsWith('drift-doc')))
  pass('drift-doc', 'sin grep+perl ni legacy .consigliere/ no intencional');

// ─────────────────────────────────────────────────────────────────────────────
// 7. doctor: nº de checks ≥ mínimo razonable + `node --check` de los scripts
// ─────────────────────────────────────────────────────────────────────────────
const DOCTOR_MIN_CHECKS = 10;
try {
  const doctor = read(join(ROOT, '.opencode/scripts/doctor.mjs'));
  if (doctor === null) fail('doctor', 'falta .opencode/scripts/doctor.mjs');
  else {
    const checkCount = (doctor.match(/\badd\(/g) || []).length - 1; // -1 por la definición de add()
    if (checkCount < DOCTOR_MIN_CHECKS) fail('doctor', `solo ${checkCount} checks (< ${DOCTOR_MIN_CHECKS})`);
    else pass('doctor', `${checkCount} checks programáticos (≥ ${DOCTOR_MIN_CHECKS})`);
  }
} catch (e) { fail('doctor', e.message); }

// Lista DERIVADA del walk (no una lista fija): todo `.mjs` bajo `.opencode/` en
// la raíz y bajo `templates/.opencode/`, más los `.mjs` de raíz que quedan fuera
// de `.opencode/` (init.mjs). Así un script nuevo se valida sin tocar este test.
// Allowlist: vacía hoy — quien no pase `--check` se arregla, no se exime.
const SCRIPTS_TO_CHECK = [
  ...rootFiles.filter((r) => r.startsWith('.opencode/') && r.endsWith('.mjs')),
  ...tplFiles.filter((r) => r.startsWith('.opencode/') && r.endsWith('.mjs')).map((r) => `templates/${r}`),
  'init.mjs',
];
for (const rel of SCRIPTS_TO_CHECK) {
  try {
    if (!existsSync(join(ROOT, rel))) { fail('node --check', `falta ${rel}`); continue; }
    const res = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { encoding: 'utf8' });
    if (res.error) { fail('node --check', `${rel}: ${res.error.message}`); continue; }
    if (res.status !== 0) fail('node --check', `${rel}: ${(res.stderr || '').trim().split('\n')[0]}`);
  } catch (e) {
    fail('node --check', `${rel}: ${e.message}`);
  }
}
pass('node --check', `${SCRIPTS_TO_CHECK.length} scripts`);

// ─────────────────────────────────────────────────────────────────────────────
// Reporte
// ─────────────────────────────────────────────────────────────────────────────
console.log(`CONTRACT TESTS — ${failures.length ? `❌ ${failures.length} fallo(s)` : '✅ PASS'}`);
for (const p of passes) console.log(`  ✅ ${p}`);
for (const w of warnings) console.log(`  ⚠️  ${w}`);
for (const f of failures) console.log(`  ❌ ${f}`);
process.exit(failures.length ? 1 : 0);
