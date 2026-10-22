#!/usr/bin/env node
/**
 * test/skill-capture.test.mjs — suite del CLI de skill-capture (espejo en tmpdir).
 *
 * Patrón runMirror (como wiring-basic): se ejecuta la copia BYTE-IDÉNTICA de los
 * scripts en tmpdir porque `allEntries` (memory-index) resuelve ROOT dos niveles
 * arriba de `import.meta.dirname` y no admite inyección — así el repo real (su
 * memoria y su .advisor/) queda intacto. Covers: derive-name, bloqueo `_*`,
 * dry-run por defecto (stdout, sin disco), --write, existente sin --force,
 * fail-closed (cero fuentes y topic solo-§3), parser `[topics:]` plural en §2 y
 * §3, prefijo/exacto + dedup, --summary/--json/--help y contenido consolidado.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { suite, test, assert, eq, includes, tmpdir, cleanup, runAll } from './harness.mjs';
import { makeProject, summaryWithEntries, FOOTER_MARK } from './fixtures.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCRIPTS_DIR = join(REPO_ROOT, '.opencode', 'scripts');

const SCRIPTS = ['skill-capture.mjs', 'skill-scaffold.mjs', 'memory-index.mjs', 'memory-stats.mjs', 'memory-rotate.mjs', 'memory-lock.mjs'];
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];
const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

// PROJECT_STATE de fixture: §2 con topic singular + plural, §3 con pendientes
// (singular Y plural — un pendiente cumple un topic que también tiene §2) y §5
// con una fila matcheable y otra que no. Estructura canónica del STATE real.
const STATE_FIXTURE = `# PROJECT_STATE — fixture (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Fixture de test.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fixture | Fixture de test | En curso |

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Decisión fixture A [topic: test/fixture-a] review_after: 2099-12-31
- Decisión topics plural [topics: test/plural-a, test/plural-b] review_after: 2099-12-31
- Decisión kit [topic: test/kit] review_after: 2099-12-31

---

## 3. Pendientes inmediatos

- [ ] Pendiente A [topic: test/pendiente]
- [ ] Pendiente plural [topics: test/plural-a]

---

## 4. Índice de historial archivado (CAPA 2)

> \`CHANGELOG/YYYY-MM-DD.md\` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| (aún sin historial) | — | — |

> Decisiones superadas: \`CHANGELOG/DECISIONS-ARCHIVE.md\`.

---

## 5. Patrones de código (Code Patterns)

> Memoria de "cómo se hace X aquí" — reutilizable por planner/builder/critic.

| Patrón | Archivo/Ejemplo | Descripción |
|--------|-----------------|-------------|
| test/kit-pattern | test/skill-capture.test.mjs | Patrón de la fixture para tests |
| shared-lib | .opencode/scripts/lib/{core,md,cache}.mjs | Núcleo sin deps |

---

## 6. Índices de búsqueda

- **Decisiones**: \`PROJECT_STATE.md §2\`.
`;

// CHANGELOG de fixture con el MISMO bloque que SUMMARY (id idéntico de
// memory-index según el heading): verifica el dedup por id cuando las dos capas
// aún contienen la misma entrada.
const CHANGELOG_FIXTURE = `# Changelog 2026-08-31

> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: \`git log\`.

## 2026-09-06 - Entrada fixture 1

topic: test/kit
review_after: 2099-12-31
**Goal:** duplicado para probar el dedup SUMMARY↔CHANGELOG.
**Discoveries:** sin hallazgos.
**Accomplished:** fixture de memoria.
**Next:** revisar el dedup.
**Files:** \`git log --oneline -5\`.
**Verificación:** pendiente.

## 2026-09-05 - Entrada archivada

topic: test/kit
review_after: 2099-12-31
**Goal:** entrada SOLO de CHANGELOG (única por id) para el label del encabezado.
**Discoveries:** sin hallazgos.
**Accomplished:** fixture de memoria.
**Next:** nada.
**Files:** \`git log --oneline -5\`.
**Verificación:** pendiente.

`;

const makeMirror = () => {
  const dir = tmpdir('advisor-capture');
  TEMPS.push(dir);
  const dst = join(dir, '.opencode', 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const f of SCRIPTS) copyFileSync(join(SCRIPTS_DIR, f), join(dst, f));
  mkdirSync(join(dst, 'lib'), { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(SCRIPTS_DIR, 'lib', f), join(dst, 'lib', f));
  return dir;
};

const makeFixture = () => {
  const dir = makeMirror();
  makeProject(dir);
  writeFileSync(join(dir, 'PROJECT_STATE.md'), STATE_FIXTURE, 'utf8');
  // 2 entradas con topic test/fixture → renombradas a test/kit (fixture del set completo)
  summaryWithEntries(dir, 2);
  const sumPath = join(dir, 'SUMMARY.md');
  writeFileSync(sumPath, readFileSync(sumPath, 'utf8').replace(/topic: test\/fixture/g, 'topic: test/kit'), 'utf8');
  writeFileSync(join(dir, 'CHANGELOG', '2026-08-31.md'), CHANGELOG_FIXTURE, 'utf8');
  return dir;
};

function runMirror(dir, args) {
  const r = spawnSync(process.execPath, [join(dir, '.opencode', 'scripts', 'skill-capture.mjs'), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    input: '',
    timeout: 15000,
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', json: (() => { try { return JSON.parse(r.stdout || ''); } catch { return null; } })() };
}

const count = (needle, hay) => hay.split(needle).length - 1;

suite('skill-capture · espejo');

test('el espejo es byte-idéntico a los scripts del repo (scripts + lib)', () => {
  const dir = makeMirror();
  for (const f of SCRIPTS) {
    eq(readFileSync(join(dir, '.opencode', 'scripts', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, f), 'utf8'), `${f} sin modificar`);
  }
  for (const f of LIB_FILES) {
    eq(readFileSync(join(dir, '.opencode', 'scripts', 'lib', f), 'utf8'), readFileSync(join(SCRIPTS_DIR, 'lib', f), 'utf8'), `lib/${f} sin modificar`);
  }
});

suite('skill-capture · nombre');

const NAME_DIR = () => makeFixture();

test('derive-name: último segmento del topic; --name override gana', () => {
  const dir = NAME_DIR();
  eq(runMirror(dir, ['test/kit', '--json']).json.name, 'kit', 'nombre derivado: kit');
  eq(runMirror(dir, ['test/kit', '--name', 'mi-skill', '--json']).json.name, 'mi-skill', '--name gana');
});

test('bloqueo de nombres: guion bajo y mayúsculas → exit 1 (uso), valida skill-scaffold', () => {
  const dir = NAME_DIR();
  eq(runMirror(dir, ['test/kit', '--name', 'mi_skill']).status, 1, 'mi_skill bloqueado');
  eq(runMirror(dir, ['test/kit', '--name', 'MiSkill']).status, 1, 'MiSkill bloqueado');
  eq(runMirror(dir, ['test/kit_x']).status, 1, 'segmento con _ bloqueado');
  assert(!existsSync(join(dir, '.opencode', 'skills')), 'nada escrito con nombre inválido');
});

test('sin topic: exit 1 con uso', () => {
  const dir = NAME_DIR();
  eq(runMirror(dir, []).status, 1, 'falta el topic → uso');
  eq(runMirror(dir, ['--json']).status, 1, 'falta el topic → uso (también con --json)');
});

suite('skill-capture · dry-run y escritura');

const DRY_DIR = () => makeFixture();

test('dry-run por defecto: solo stdout (consolidado), nunca crea el directorio', () => {
  const dir = DRY_DIR();
  const r = runMirror(dir, ['test/kit']);
  eq(r.status, 0, 'dry-run sale 0');
  includes(r.out, '## Fuentes consolidadas', 'encabezado de fuentes');
  includes(r.out, 'name: kit', 'frontmatter con el nombre derivado');
  assert(!existsSync(join(dir, '.opencode', 'skills')), 'el dry-run no crea .opencode/skills');
});

test('contenido consolidado: decisión §2 + patrón §5 + entradas (no esqueleto vacío)', () => {
  const dir = DRY_DIR();
  const r = runMirror(dir, ['test/kit']);
  includes(r.out, 'Decisión kit [topic: test/kit]', 'la decisión §2 del topic');
  includes(r.out, 'test/kit-pattern', 'el patrón §5 del topic');
  includes(r.out, 'Entrada fixture 1', 'la entrada de SUMMARY/CHANGELOG');
  includes(r.out, 'PROJECT_STATE §2 — 1 decisión (fuente primaria)', 'la §2 marcada como primaria');
  assert(!r.out.includes('(pendiente: contenido de decisiones)'), 'el chunk decisiones queda relleno');
  assert(!r.out.includes('(pendiente: contenido de entradas)'), 'el chunk entradas queda relleno');
});

test('--write escribe el SKILL.md en .opencode/skills/<name>/', () => {
  const dir = DRY_DIR();
  const r = runMirror(dir, ['test/kit', '--name', 'kit-capt', '--write']);
  eq(r.status, 0, '--write sale 0');
  const skill = join(dir, '.opencode', 'skills', 'kit-capt', 'SKILL.md');
  assert(existsSync(skill), 'SKILL.md escrito');
  const body = readFileSync(skill, 'utf8');
  includes(body, 'Decisión kit [topic: test/kit]', 'contenido real (no esqueleto)');
  assert(body !== '', 'contenido no vacío');
});

test('skill existente sin --force → exit 1; con --force → exit 0', () => {
  const dir = DRY_DIR();
  eq(runMirror(dir, ['test/kit', '--name', 'kit-capt', '--write']).status, 0, 'primera escritura');
  eq(runMirror(dir, ['test/kit', '--name', 'kit-capt', '--write']).status, 1, 'segunda sin --force: uso');
  eq(runMirror(dir, ['test/kit', '--name', 'kit-capt', '--write', '--force']).status, 0, 'con --force: ok');
});

test('--write --json describe lo escrito (written, target, bytes) y no imprime el contenido crudo', () => {
  const dir = DRY_DIR();
  const r = runMirror(dir, ['test/kit', '--name', 'kit-json', '--write', '--json']);
  eq(r.status, 0, '--write --json sale 0');
  eq(r.json && r.json.mode, 'write', 'mode write');
  eq(r.json && r.json.written, true, 'written: true');
  eq(r.json && r.json.name, 'kit-json', 'name en el JSON');
  assert(r.json && r.json.bytes > 0, 'bytes del contenido escrito');
  assert(r.json && String(r.json.target).includes(join('.opencode', 'skills', 'kit-json', 'SKILL.md')), 'target en el JSON');
});

suite('skill-capture · fail-closed y fuentes');

const FC_DIR = () => makeFixture();

test('topic sin fuentes consolidables (ni §2, ni §5, ni entradas) → exit 1 con uso', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['nada/leyendas']);
  eq(r.status, 1, 'uso por cero fuentes');
  includes(r.err, 'no tiene fuentes consolidables', 'mensaje fail-closed');
});

test('fail-closed: un topic que SOLO existe como pendiente §3 NO genera skill', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['test/pendiente']);
  eq(r.status, 1, 'solo-§3 → uso; los pendientes no rescatan el fail-closed');
  assert(!existsSync(join(dir, '.opencode', 'skills')), 'nada escrito');
});

test('[topics:] plural en §2: matchea cualquiera de los topics de la decisión', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['test/plural-a']);
  eq(r.status, 0, 'plural-a matchea la decisión plural');
  includes(r.out, 'Decisión topics plural', 'la decisión plural aparece una vez');
  includes(r.out, 'PROJECT_STATE §2 — 1 decisión (fuente primaria)', 'una sola decisión §2');
});

test('§3 pendiente añade la fuente marcada "(pendiente)" cuando hay fuente consolidable', () => {
  const dir = FC_DIR();
  // test/plural-a tiene §2 (decisión plural) Y §3 (pendiente plural) → ambos en el consolidado
  const r = runMirror(dir, ['test/plural-a']);
  includes(r.out, 'Pendiente plural', 'el ítem §3 consolidado');
  includes(r.out, '*(pendiente)*', 'marcado de pendiente');
  includes(r.out, 'PROJECT_STATE §3 — 1 pendiente', 'fuente §3 en el encabezado');
});

test('prefijo de categoría y topic exacto; JSON lista las fuentes consolidadas', () => {
  const dir = FC_DIR();
  const p = runMirror(dir, ['test', '--json']);
  eq(p.status, 0, 'prefijo de categoría sale 0');
  const labelsP = (p.json && p.json.sources || []).map((s) => s.label);
  assert(labelsP.some((l) => l.includes('PROJECT_STATE §2')), 'prefijo consolida las decisiones test/*');
  assert(labelsP.some((l) => l.includes('CHANGELOG/')), 'prefijo consolida las entradas de CHANGELOG');
  const d = runMirror(dir, ['test']);
  includes(d.out, 'Decisión kit [topic: test/kit]', 'el prefijo consolida el topic test/kit');
  const e = runMirror(dir, ['test/kit', '--json']);
  eq(e.status, 0, 'topic exacto sale 0');
  const labels = (e.json && e.json.sources || []).map((s) => s.label);
  assert(labels.some((l) => l.includes('PROJECT_STATE §2') && l.includes('fuente primaria')), 'fuente primaria en el JSON');
  assert(labels.some((l) => l.includes('PROJECT_STATE §5')), 'patrón §5 en el JSON');
  assert(labels.some((l) => l.includes('SUMMARY.md')), 'SUMMARY en el JSON');
  assert(labels.some((l) => l.includes('CHANGELOG/')), 'CHANGELOG en el JSON');
});

test('dedup por id en SUMMARY↔CHANGELOG: el bloque duplicado aparece UNA vez', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['test/kit']);
  eq(r.status, 0, 'test/kit sale 0');
  eq(count('Entrada fixture 1', r.out), 1, 'la entrada duplicada (SUMMARY + CHANGELOG con mismo id) queda una vez');
});

test('--summary N: cap por sección de origen (1 entradas → solo la primera tras score)', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['test/kit', '--summary', '1']);
  eq(r.status, 0, 'con --summary 1 sale 0');
  assert(!r.out.includes('Entrada fixture 2'), 'solo entra 1 entrada por sección');
  const bad = runMirror(dir, ['test/kit', '--summary', 'cero']);
  eq(bad.status, 1, '--summary inválido → uso');
});

test('--help muestra el uso en stdout con exit 0', () => {
  const dir = FC_DIR();
  const r = runMirror(dir, ['--help']);
  eq(r.status, 0, '--help sale 0');
  includes(r.out, 'Uso:', 'el help incluye el uso');
  includes(r.out, '--summary', 'el help documenta --summary');
});

test('chunks: inválido → uso; "pendientes" como chunk propio se rellena', () => {
  const dir = FC_DIR();
  const bad = runMirror(dir, ['test/kit', '--chunks', 'decisiones,ay!']);
  eq(bad.status, 1, 'chunk inválido → uso (valida skill-scaffold)');
  // test/plural-a tiene decisión §2 Y pendiente §3: con el chunk 'pendientes'
  // propio, el marcador no queda vacío.
  const custom = runMirror(dir, ['test/plural-a', '--chunks', 'decisiones,pendientes']);
  eq(custom.status, 0, 'chunks custom válidos');
  includes(custom.out, 'Pendiente plural', 'pendientes en su propio chunk');
  includes(custom.out, '*(pendiente)*', 'marcado de pendiente');
});

// FOOTER_MARK se importa para asegurar que la paridad del fixture con los
// marcadores reales del repo sigue vigente (misma ancla que observan los motores).
assert(FOOTER_MARK === '> Cuando registres', 'el FOOTER_MARK de fixtures sigue siendo la ancla real');

await runAll();
