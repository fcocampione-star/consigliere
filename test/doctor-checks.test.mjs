/**
 * test/doctor-checks.test.mjs — regla de severidad compartida entre las dos
 * variantes de `doctor.mjs` + robustez de la tabla markdown.
 *
 * REGLA que este archivo existe para hacer cumplir:
 *   Las dos copias (raíz y templates) pueden diferir en QUÉ checks corren,
 *   nunca en la SEVERIDAD de un check que ambas corren. Si divergieran, el
 *   mismo repo diagnosticado desde dos rutas daría exit codes distintos.
 *
 * Por que NO basta con correr los dos doctor reales: cada copia resuelve su
 * ROOT desde `import.meta.dirname/../..`, así que la de raíz diagnostica este
 * repo y la de templates diagnostica el árbol `templates/` — con estado de
 * disco distinto (líneas de PROJECT_STATE, CHANGELOG/, .advisor/…). Comparar
 * eso mide el ESTADO, no la CLASIFICACIÓN. Aquí se monta un estado IDENTICO en
 * dos sandboxes (uno con los scripts de raíz, otro con los de templates) y se
 * comparan los estados de los checks compartidos.
 *
 * Por que hijo y no import: doctor.mjs no exporta nada y ejecuta los checks +
 * `process.exit` en el cuerpo del módulo.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, tmpdir, cleanup, runAll } from './harness.mjs';

const REPO = join(import.meta.dirname, '..');
const SCRIPTS = join(REPO, '.opencode', 'scripts');
const TPL_SCRIPTS = join(REPO, 'templates', '.opencode', 'scripts');
const MAX_BUFFER = 16 * 1024 * 1024;

// Cierre transitivo de doctor.mjs: memory-index (+ memory-rotate), memory-lock
// y memory-stats. Cada variante se copia CON SU PROPIO cierre, byte a byte.
const CLOSURE = ['memory-index.mjs', 'memory-lock.mjs', 'memory-rotate.mjs', 'memory-stats.mjs'];
// Biblioteca compartida que los scripts del CLOSURE importan desde lib/.
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];

// Vocabulario de estados (escapes para no depender de la codificacion).
const S_OK = '\u2705';
const S_WARN = '\u26a0\ufe0f';
const S_ERR = '\u274c';
const S_INFO = '\u2139\ufe0f';
const STATUS = [S_OK, S_WARN, S_ERR, S_INFO];
const CLAVES_CHECK = ['detail', 'fix', 'name', 'status'];

// Checks que ambas variantes deben correr SIEMPRE (núcleo compartido). Es lo
// que da sentido a "misma severidad": sin núcleo compartido la regla no
// comprobaría nada.
const NUCLEO = [
  'opencode.json', 'bash harden', 'PROJECT_STATE.md', 'SUMMARY.md', 'SUMMARY topic',
  '.memory-lock', 'skill cache', 'hook post-commit', 'manifest', 'index',
  'review_after', 'script doctor.mjs', 'script memory-index.mjs', 'dir CHANGELOG',
];

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

// ── Fixtures ────────────────────────────────────────────────────────────────

const OPENCODE_OK = JSON.stringify({
  default_agent: 'advisor',
  subagent_depth: 2,
  agent: { builder: { permission: { bash: { 'cat **/.env*': 'ask' } } } },
}, null, 2);

const STATE_OK = [
  '# PROJECT_STATE — fixture',
  '',
  '## 1. Fase actual',
  '',
  '| Fase | Estado |',
  '|------|--------|',
  '| Boot | ✅ |',
  '',
  '## 2. Decisiones de diseño (append-only, consolidadas, con review_after)',
  '',
  '- Decisión A [topic: test/a] review_after: 2099-12-31',
  '- Decisión B [topic: test/b] review_after: 2099-12-31',
  '',
  '## 4. Índice de historial archivado (CAPA 2)',
  '',
  '| Semana | Archivo | Resumen |',
  '|--------|---------|---------|',
  '| (aún sin historial) | — | — |',
  '',
].join('\n');

const SUMMARY_OK = [
  '# Session Log',
  '',
  '<!-- ADVISOR:ENTRIES:START -->',
  '',
  '## 2026-09-06 - Entrada fixture',
  '',
  'topic: test/fixture',
  '**Goal:** algo',
  '',
  '<!-- ADVISOR:ENTRIES:END -->',
  '',
].join('\n');

const CACHE_OK = JSON.stringify({ version: 2, generatedAt: '2026-01-01T00:00:00.000Z', entries: [{ name: 'x', path: 'p', mtime: 1, size: 1, source: 'proyecto', description: 'd' }] }, null, 2);
const MANIFEST_OK = JSON.stringify({ version: 1, recent: [], stale: [] }, null, 2);

// Escenario: el estado de disco que se monta en el sandbox. `omit` quita
// ficheros; `put` escribe ficheros con contenido explicito.
const ESCENARIOS = {
  sano: {},
  'sin-derivados': { omit: ['cache', 'manifest', 'index', 'changelog'] },
  'derivados-corruptos': {
    put: {
      cache: '{ esto no es json',
      manifest: '<<< roto >>>',
      index: '<<< roto >>>',
    },
  },
  'cache-version-vieja': { put: { cache: JSON.stringify({ version: 1, entries: [] }, null, 2) } },
  'falta-un-script': { omit: ['memory-sync.mjs'] },
  'project-state-ii-grande': { state: STATE_OK.replace('## 4. Índice', `${Array.from({ length: 90 }, (_, i) => `- Decisión ${i} [topic: test/x${i}] review_after: 2099-12-31`).join('\n')}\n\n## 4. Índice`) },
  'lock-huerfano': { lockAge: 86400 },
  'opencode-json-invalido': { opencode: '{ "default_agent": | }' },
};

function montar(dir, esc) {
  mkdirSync(join(dir, '.opencode', 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.advisor'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), esc.opencode ?? OPENCODE_OK, 'utf8');
  writeFileSync(join(dir, 'PROJECT_STATE.md'), esc.state ?? STATE_OK, 'utf8');
  writeFileSync(join(dir, 'SUMMARY.md'), esc.summary ?? SUMMARY_OK, 'utf8');
  const omit = esc.omit ?? [];
  if (!omit.includes('changelog')) mkdirSync(join(dir, 'CHANGELOG'), { recursive: true });
  for (const d of ['backups', 'chunks']) mkdirSync(join(dir, '.advisor', d), { recursive: true });
  const put = esc.put ?? {};
  if (!omit.includes('cache')) writeFileSync(join(dir, '.advisor', 'skill-registry.cache.json'), put.cache ?? CACHE_OK, 'utf8');
  if (!omit.includes('manifest')) writeFileSync(join(dir, '.advisor', 'memory-manifest.json'), put.manifest ?? MANIFEST_OK, 'utf8');
  if (!omit.includes('index')) writeFileSync(join(dir, '.advisor', 'memory-index.json'), put.index ?? JSON.stringify({ version: 1, entries: [] }, null, 2), 'utf8');
  if (esc.lockAge) {
    const lock = join(dir, '.memory-lock');
    mkdirSync(lock, { recursive: true });
    const t = (Date.now() - esc.lockAge * 1000) / 1000;
    utimesSync(lock, t, t);
  }
  return join(dir, '.opencode', 'scripts', 'doctor.mjs');
}

// Sandbox con el cierre de UNA variante (raiz o templates), byte identico.
function sandbox(label, variante) {
  const dir = tmpdir(`advisor-doctor-${label}-${variante}`);
  TEMPS.push(dir);
  const src = variante === 'raiz' ? SCRIPTS : TPL_SCRIPTS;
  const doctor = montar(dir, ESCENARIOS[label]);
  for (const f of [...CLOSURE, 'doctor.mjs']) {
    if (ESCENARIOS[label].omit?.includes(f)) continue;
    copyFileSync(join(src, f), join(join(dir, '.opencode', 'scripts'), f));
  }
  // Los scripts del CLOSURE importan la biblioteca compartida de `.opencode/scripts/lib/`,
  // asi que el sandbox tiene que traerla: sin ella doctor.mjs no arranca.
  const lib = join(dir, '.opencode', 'scripts', 'lib');
  mkdirSync(lib, { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(src, 'lib', f), join(lib, f));
  return doctor;
}

function run(doctor, args = []) {
  const res = spawnSync(process.execPath, [doctor, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  assert(!res.error, `spawn de doctor.mjs fallo: ${res.error && res.error.message}`);
  assert(res.signal === null, `doctor.mjs no deberia morir por senal (fue ${res.signal})`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

const checksDe = (out) => {
  const parsed = JSON.parse(out);
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'la raiz del JSON debe ser un objeto');
  assert(Array.isArray(parsed.checks), 'checks debe ser un array');
  return parsed.checks;
};
const porNombre = (checks) => new Map(checks.map((c) => [c.name, c.status]));

// Una fila de la tabla markdown, partida por pipes NO escapados: asi una celda
// con `|` escapado como `\|` no rompe las cuatro columnas.
function celdas(fila) {
  return fila.replace(/\\\|/g, '\u0000').split('|').slice(1, -1).map((c) => c.trim().replace(/\u0000/g, '|'));
}
const filas = (out) => out.split(/\r?\n/).filter((l) => l.startsWith('| ') && STATUS.some((s) => l.includes(s)));

// ── Regla: un check compartido, una severidad ───────────────────────────────

suite('doctor: severidad compartida entre variantes');

for (const [label, esc] of Object.entries(ESCENARIOS)) {
  test(`"${label}": todo check compartido tiene la MISMA severidad en raiz y templates`, () => {
    const raiz = checksDe(run(sandbox(label, 'raiz'), ['--json']).out);
    const tpl = checksDe(run(sandbox(label, 'tpl'), ['--json']).out);
    const a = porNombre(raiz);
    const b = porNombre(tpl);
    const compartidos = [...a.keys()].filter((n) => b.has(n));
    assert(compartidos.length > 0, 'las dos variantes deben compartir al menos un check');
    for (const n of compartidos) eq(b.get(n), a.get(n), `severidad del check compartido "${n}"`);
    // Solo lo compartido: los checks propios de una variante son legitimos.
    const soloRaiz = [...a.keys()].filter((n) => !b.has(n));
    const soloTpl = [...b.keys()].filter((n) => !a.has(n));
    assert(soloRaiz.length + soloTpl.length <= 2, `divergencia de conjunto inesperada (raiz: ${soloRaiz.join(',')} | tpl: ${soloTpl.join(',')})`);
  });

  test(`"${label}": con el MISMO estado, las dos variantes dan el MISMO exit code`, () => {
    const a = run(sandbox(label, 'raiz'), ['--json']);
    const b = run(sandbox(label, 'tpl'), ['--json']);
    eq(b.code, a.code, 'el exit code no puede depender de que copia del doctor se ejecuto');
    assert([0, 1, 2].includes(a.code), `exit code fuera de contrato: ${a.code}`);
    const esperado = checksDe(a.out).some((c) => c.status === S_ERR) ? 2
      : checksDe(a.out).some((c) => c.status === S_WARN) ? 1 : 0;
    eq(a.code, esperado, 'el exit code sale de los estados de sus propios checks');
  });
}

suite('doctor: nucleo compartido y forma documentada');

test('ambas variantes corren el nucleo de checks compartido', () => {
  const a = porNombre(checksDe(run(sandbox('sano', 'raiz'), ['--json']).out));
  const b = porNombre(checksDe(run(sandbox('sano', 'tpl'), ['--json']).out));
  for (const n of NUCLEO) {
    assert(a.has(n), `la variante raiz debe correr el check "${n}"`);
    assert(b.has(n), `la variante templates debe correr el check "${n}"`);
  }
});

test('cada check lleva name/status/detail/fix con los tipos y el vocabulario documentados', () => {
  for (const v of ['raiz', 'tpl']) {
    const r = run(sandbox('sano', v), ['--json']);
    for (const c of checksDe(r.out)) {
      eq(Object.keys(c).sort(), CLAVES_CHECK, `claves del check ${c.name} (${v})`);
      assert(typeof c.name === 'string' && c.name.length > 0, 'name no vacio');
      assert(typeof c.detail === 'string' && c.detail.length > 0, `detail no vacio en ${c.name} (${v})`);
      assert(typeof c.fix === 'string', `fix es string en ${c.name} (${v})`);
      assert(STATUS.includes(c.status), `status fuera de vocabulario en ${c.name} (${v}): ${JSON.stringify(c.status)}`);
    }
  }
});

test('el escenario sano no produce errores en ninguna variante (info y ok)', () => {
  for (const v of ['raiz', 'tpl']) {
    const r = run(sandbox('sano', v), ['--json']);
    const errores = checksDe(r.out).filter((c) => c.status === S_ERR).map((c) => c.name);
    eq(errores, [], `checks en error (${v}): ${errores.join(', ')}`);
    eq(r.code, 0, `harness sano (${v}) sale con 0`);
  }
});

test('un artefacto derivado ausente NO degrada el exit code (regenerable = informativo)', () => {
  const a = run(sandbox('sin-derivados', 'raiz'), ['--json']);
  const b = run(sandbox('sin-derivados', 'tpl'), ['--json']);
  const porDefecto = (out) => checksDe(out).filter((c) => ['skill cache', 'manifest', 'index'].includes(c.name));
  for (const [v, out] of [['raiz', a.out], ['tpl', b.out]]) {
    for (const c of porDefecto(out)) eq(c.status, S_INFO, `${c.name} ausente es informativo en ${v}`);
  }
  eq(b.code, a.code, 'la ausencia de cache/manifest/indice no cambia el exit code entre variantes');
});

test('un script que falta es informativo y no un error bloqueante en ambas variantes', () => {
  for (const v of ['raiz', 'tpl']) {
    const checks = checksDe(run(sandbox('falta-un-script', v), ['--json']).out);
    const c = checks.find((x) => x.name === 'script memory-sync.mjs');
    assert(c, 'el check del script ausente debe seguir apareciendo');
    eq(c.status, S_INFO, `script ausente = informativo en ${v}`);
    const code = run(sandbox('falta-un-script', v), ['--json']).code;
    neq(code, 2, `un script regenerable no puede llevar el harness a exit 2 (${v})`);
  }
});

test('un lock huerfano es error en AMBAS variantes (no solo en la copia estricta)', () => {
  for (const v of ['raiz', 'tpl']) {
    const r = run(sandbox('lock-huerfano', v), ['--json']);
    const c = checksDe(r.out).find((x) => x.name === '.memory-lock');
    assert(c, 'el check del lock debe aparecer');
    eq(c.status, S_ERR, `lock huerfano = error en ${v}`);
    eq(r.code, 2, `lock huerfano sale con 2 en ${v}`);
  }
});

test('PROJECT_STATE §2 sobredimensionado coincide en severidad entre variantes', () => {
  const a = porNombre(checksDe(run(sandbox('project-state-ii-grande', 'raiz'), ['--json']).out));
  const b = porNombre(checksDe(run(sandbox('project-state-ii-grande', 'tpl'), ['--json']).out));
  assert(a.has('PROJECT_STATE §2') && b.has('PROJECT_STATE §2'), 'el check de §2 debe dispararse con 90 decisiones');
  eq(b.get('PROJECT_STATE §2'), a.get('PROJECT_STATE §2'), 'misma severidad para §2 sobredimensionado');
});

// ── Tabla markdown: un `|` en un detalle no puede romperla ──────────────────
// Con opencode.json inválido cuyo token ofensor es `|`, el detalle del check
// opencode.json lleva un pipe crudo. Sin escaparlo, la fila se parte en más de
// cuatro celdas y el modelo lee columnas fantasma.
suite('doctor: tabla markdown a prueba de pipes');

test('un detalle con pipe se escapa en la tabla y la fila sigue teniendo 4 columnas', () => {
  for (const v of ['raiz', 'tpl']) {
    const doctor = sandbox('opencode-json-invalido', v);
    const texto = run(doctor);
    const fila = filas(texto.out).find((l) => l.startsWith('| opencode.json '));
    assert(fila, `debe salir la fila de opencode.json (${v})`);
    match(fila, /\\\|/, `el pipe del detalle va escapado como \\| en la tabla (${v})`);
    const c = celdas(fila);
    eq(c.length, 4, `cuatro columnas pese al pipe del detalle (${v})`);
    eq(c[0], 'opencode.json', 'columna Check');
    eq(c[1], S_ERR, 'columna Estado');
    assert(c[2].includes('|'), 'la celda Detalle conserva el pipe como contenido');
  }
});

test('el JSON conserva el detalle CRUDO (el escapado es solo de la tabla)', () => {
  for (const v of ['raiz', 'tpl']) {
    const c = checksDe(run(sandbox('opencode-json-invalido', v), ['--json']).out).find((x) => x.name === 'opencode.json');
    assert(c, 'el check opencode.json debe estar en el JSON');
    assert(c.detail.includes('|'), `el JSON no debe escapar el detalle (${v}): ${c.detail}`);
  }
});

test('una fila por check en la tabla, en el mismo orden que el JSON', () => {
  for (const v of ['raiz', 'tpl']) {
    const doctor = sandbox('sano', v);
    const checks = checksDe(run(doctor, ['--json']).out);
    const filasTexto = filas(run(doctor).out);
    eq(filasTexto.length, checks.length, `una fila por check (${v})`);
    for (const [i, f] of filasTexto.entries()) {
      const c = celdas(f);
      eq(c.length, 4, `cuatro celdas en la fila ${i + 1} (${v})`);
      eq(c[0], checks[i].name, `nombre de la fila ${i + 1} (${v})`);
      eq(c[1], checks[i].status, `estado de la fila ${i + 1} (${v})`);
    }
  }
});

test('un flag desconocido no activa el modo JSON ni cambia el exit code', () => {
  for (const v of ['raiz', 'tpl']) {
    const doctor = sandbox('sano', v);
    const a = run(doctor);
    const b = run(doctor, ['--verbose']);
    eq(b.code, a.code, `mismo exit code (${v})`);
    eq(b.out, a.out, `misma salida (${v})`);
  }
});

test('doctor es de solo lectura: dos corridas seguidas dan salida identica', () => {
  for (const v of ['raiz', 'tpl']) {
    const doctor = sandbox('sano', v);
    eq(run(doctor, ['--json']).out, run(doctor, ['--json']).out, `salida estable (${v})`);
  }
});

test('las dos copias de doctor.mjs siguen siendo ficheros distintos (no se fusionaron)', () => {
// La regla es "misma severidad en checks compartidos", NO "fichero identico":
  // la variante de templates corre un check extra (adopción stack) y usa fixes
  // propios, así que el par sigue divergiendo por diseño.
  const raiz = readFileSync(join(SCRIPTS, 'doctor.mjs'), 'utf8');
  const tpl = readFileSync(join(TPL_SCRIPTS, 'doctor.mjs'), 'utf8');
  neq(raiz, tpl, 'las dos copias no deben convertirse en el mismo fichero');
  // Un mismo check puede aparecer en dos ramas (if/else), asi que se deduplica.
  const extra = (txt) => [...new Set([...txt.matchAll(/add\('([^']+)'/g)].map((m) => m[1]))];
  const soloTpl = extra(tpl).filter((n) => !extra(raiz).includes(n));
  eq(soloTpl, ['adopción stack'], 'la plantilla conserva su check propio de adopción stack');
});

await runAll();