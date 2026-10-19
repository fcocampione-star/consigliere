#!/usr/bin/env node
/**
 * test/eol-canonical.test.mjs — EOL canónico del render del instalador.
 *
 * Reglas del suite:
 *  - CERO dependencias: solo `node:*` + el micro-framework `test/harness.mjs`.
 *  - TODO ocurre en temporales (`tmpdir()` + suite final de `cleanup`, patrón del
 *    e2e: runAll() hace process.exit(), así que un finally a nivel de módulo NO
 *    corre de forma fiable). La copia del instalador y de templates/ se ENVENENA
 *    a propósito (CRLF y LF desnudos) para probar la REGLA, no el estado limpio
 *    del repo de desarrollo.
 *  - El pin: la regla de .gitattributes (`* text=auto eol=lf`; solo
 *    *.ps1/*.cmd/*.bat a CRLF) se APLICA AL ESCRIBIR (canonicalEol en init.mjs),
 *    así que el árbol instalado sale EOL-canonico INCLUSO si el working tree de
 *    quien empaqueta estaba sucio. Espejo behavior de `eol templates` en
 *    contract-tests.mjs: allí se custodia la FUENTE, aquí el DESTINO.
 *  - El commit inicial con git es silencioso de conversiones (`core.autocrlf=false`
 *    LOCAL + .gitattributes instalado): "LF will be replaced" NO puede aparecer en
 *    el happy path con `--git yes`, y el hook sale LF puro (no `copyFileSync` ciego).
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, eq, includes, tmpdir, cleanup, runAll } from './harness.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATES = join(REPO, 'templates');
const TIMEOUT_MS = 120000;
const CRLF_EXT_RE = /\.(ps1|cmd|bat)$/;

// Sustituye TODO fin de línea por CRLF (veneno uniforme).
const envenenarCrlf = (p) => {
  const s = readFileSync(p, 'utf8');
  writeFileSync(p, s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
};
// Sustituye TODO fin de línea por LF desnudo (veneno para las ext Windows-only).
const envenenarLf = (p) => {
  const s = readFileSync(p, 'utf8');
  writeFileSync(p, s.replace(/\r\n/g, '\n'), 'utf8');
};

function walk(base) {
  const out = [];
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) visit(f);
      else if (e.isFile()) out.push(f);
    }
  };
  visit(base);
  return out;
}

// Un fichero respeta la regla SI: ext Windows-only => CRLF puro (cero LF desnudos);
// el resto => cero bytes CR donde sea. `.git` (repo interno) va al margen: su
// contenido es de git, no del render.
function violacionesEol(base) {
  const bad = [];
  for (const f of walk(base)) {
    const rel = f.slice(base.length + 1);
    if (rel.startsWith('.git/') || rel === '.git') continue;
    const b = readFileSync(f);
    if (CRLF_EXT_RE.test(rel)) {
      for (let i = 0; i < b.length; i++) {
        if (b[i] === 0x0a && (i === 0 || b[i - 1] !== 0x0d)) { bad.push(`${rel}: LF desnudo (debe ser CRLF puro)`); break; }
      }
    } else if (b.includes(0x0d)) {
      bad.push(`${rel}: contiene CR (debe ser LF puro)`);
    }
  }
  return bad;
}

// Instalador como proceso hijo: MISMO perfil del resto de la suite (`input: ''` +
// stdin pipeado, timeout de seguridad, sin dependencias extra).
function instalar(initPath, target, git) {
  return spawnSync(process.execPath, [initPath, target, '--name', 'eol-demo', '--autoskills', '3', '--git', git ? 'yes' : 'no'], {
    input: '', encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
}

const hasGit = () => spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true }).status === 0;
const omitidos = [];
const omitir = (motivo) => { omitidos.push(motivo); console.log(`  [omitido] ${motivo}`); };

// ── Fixture: copia ENVENENADA de init.mjs + templates/ ───────────────────────
// Si la preparación falla, se sale con un error claro (el resto del suite no
// tiene sentido sin el veneno).
const base = tmpdir('eol-fixture'); // copia envenenada del instalador + templates
const cleanups = [base];
try {
  cpSync(INIT_SRC(), join(base, 'init.mjs'));
  cpSync(TEMPLATES, join(base, 'templates'), { recursive: true });
  const T = join(base, 'templates');
  envenenarCrlf(join(T, 'scripts', 'check-memory-limits.sh'));                       // .sh con CRLF: hook roto en POSIX
  envenenarLf(join(T, 'scripts', 'check-memory-limits.ps1'));                        // .ps1 con LF desnudo: al revés
  envenenarCrlf(join(T, 'AGENTS.md'));                                               // texto general
  envenenarCrlf(join(T, '.opencode', 'agents', 'advisor.md'));                       // texto del .opencode
  envenenarCrlf(join(T, '.opencode', 'hooks', 'post-commit-memory-rotate.sh'));      // el hook, el más delicado
  envenenarCrlf(join(T, 'gitignore'));                                               // template renombrado (TEMPLATE_RENAME)
} catch (e) {
  cleanup(cleanups);
  console.error(`fixture no preparado: ${e.message}`);
  process.exit(1);
}

function INIT_SRC() {
  return fileURLToPath(new URL('../init.mjs', import.meta.url));
}

suite('eol-canonical · el render aplica el EOL de .gitattributes');

test('árbol instalado sale EOL-canónico aunque la fuente venga envenenada de CRLF/LF', () => {
  const target = tmpdir('eol-instalado');
  cleanups.push(target);
  const r = instalar(join(base, 'init.mjs'), target, false);
  eq(r.status, 0, `instalación con templates envenenados no salió 0:\n${(r.stderr || '')}\n${(r.stdout || '')}`);
  const bad = violacionesEol(target);
  eq(bad, [], 'TODOS los ficheros instalados deben respetar el EOL canónico (LF, CRLF solo ps1/cmd/bat)');
  // Sanity del escaneo: el árbol instalado no puede "pasar" por trivialidad.
  const n = walk(target).filter((f) => !f.slice(target.length + 1).startsWith('.git/')).length;
  assert(n > 20, `el escaneo debe cubrir el árbol real (solo ${n} ficheros)`);
  // La normalización no rompe el render: los placeholders siguen sustituyéndose.
  const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
  includes(agents, 'eol-demo', 'AGENTS.md renderiza el nombre (la normalización EOL no rompe el render)');
  assert(!agents.includes('{{PROJECT_NAME}}'), `AGENTS.md conserva el placeholder sin sustituir: ${agents.slice(0, 200)}`);
  // Y .gitattributes aterriza con la convención que declara la decisión.
  const attrs = readFileSync(join(target, '.gitattributes'), 'utf8');
  includes(attrs, '* text=auto eol=lf', '.gitattributes instalado declara la convención EOL');
  includes(attrs, '*.ps1 text eol=crlf', '.gitattributes instalado protege las ext Windows-only');
});

test('--git yes: commit inicial silencioso (sin "LF will be replaced") y hook LF puro', () => {
  if (!hasGit()) { omitir('git ausente: el commit inicial no corre en esta máquina'); return; }
  const target = tmpdir('eol-git');
  cleanups.push(target);
  const r = instalar(join(base, 'init.mjs'), target, true);
  eq(r.status, 0, `instalación con --git yes no salió 0:\n${(r.stderr || '')}\n${(r.stdout || '')}`);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  assert(!out.includes('LF will be replaced'), `el commit inicial imprime avisos de conversión EOL:\n${out.slice(0, 400)}`);
  assert(existsSync(join(target, '.git', 'hooks', 'post-commit')), 'el hook post-commit quedó instalado');
  eq(violacionesEol(join(target, '.git', 'hooks')), [], 'el hook instalado por installGitHook sale LF puro (no copyFileSync ciego)');
});

suite('eol-canonical · limpieza');

test('borra fixture y los dos proyectos temp (veneno incluido)', () => {
  cleanup(cleanups);
  for (const p of cleanups) assert(!existsSync(p), `residuo temporal: ${p}`);
});

if (omitidos.length) {
  console.log('— omitidos de esta corrida:');
  for (const o of omitidos) console.log(`   · ${o}`);
}

await runAll();
