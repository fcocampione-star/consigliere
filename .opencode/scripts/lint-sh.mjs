#!/usr/bin/env node
/**
 * lint-sh.mjs — `bash -n` de los .sh de la raíz, resolviendo antes el intérprete.
 * Uso: node .opencode/scripts/lint-sh.mjs   (lo invoca `npm run lint:sh`)
 * Exit: 0 = sintaxis válida · 1/2 = el de `bash -n` (sintaxis / uso) · 3 = no hay bash.
 *
 * Por qué existe: en Windows el bash de Git for Windows NO está en el PATH de
 * cmd.exe (vive en `C:\Program Files\Git\bin\bash.exe`), así que el `bash -n` a
 * pelo del script npm moría con '"bash" no se reconoce como un comando' siendo
 * un problema de entorno, no de sintaxis del repo. Aquí el intérprete se
 * resuelve en orden: `ADVISOR_BASH` (override explícito) → `bash` del PATH →
 * rutas habituales de Git for Windows, y si no aparece ninguno se dice CÓMO
 * arreglarlo en vez de reventar con un ENOENT seco.
 *
 * En linux/macos el primer candidato (el `bash` del PATH) siempre gana y las
 * rutas de Windows ni se miran: el comportamiento es idéntico al de antes.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SH_FILES = ['init.sh', 'scripts/check-memory-limits.sh'];

// Raíces de instalación de Git for Windows. Solo se usan en win32: en unix el
// `bash` del PATH es la única fuente y estas rutas no existen.
const winRoots = () => [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA]
  .filter(Boolean)
  .flatMap((root) => [join(root, 'Git', 'bin', 'bash.exe'), join(root, 'Programs', 'Git', 'bin', 'bash.exe')]);

const override = (process.env.ADVISOR_BASH || '').trim();
// Un override explícito es una orden, no una sugerencia: si no arranca se dice,
// no se pasa al siguiente candidato en silencio.
const candidates = override ? [override] : ['bash', ...(process.platform === 'win32' ? winRoots() : [])];
const args = ['-n', ...SH_FILES.map((rel) => join(ROOT, rel))];
const tried = [];

for (const bash of candidates) {
  const res = spawnSync(bash, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error && res.error.code === 'ENOENT') { tried.push(bash); continue; }
  if (res.error) {
    console.error(`❌ lint:sh: no se pudo ejecutar ${bash}: ${res.error.message}`);
    process.exit(3);
  }
  console.log(`lint:sh → ${bash} -n ${SH_FILES.join(' ')}`);
  process.exit(res.status === null ? 1 : res.status);
}

console.error('❌ lint:sh: no se encontró un intérprete bash.');
if (override) {
  console.error(`   ADVISOR_BASH="${override}" no existe o no se puede ejecutar.`);
} else {
  console.error('   Candidatos probados:');
  for (const c of tried) console.error(`     - ${c}`);
  console.error('   Arreglo: instala Git for Windows (https://git-scm.com/download/win) — su bash ya está');
  console.error('   en "C:\\Program Files\\Git\\bin\\bash.exe" aunque no esté en el PATH — o añade bash al');
  console.error('   PATH, o define ADVISOR_BASH con la ruta completa al bash que quieras usar.');
}
process.exit(3);
