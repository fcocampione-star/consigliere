#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — doctor.mjs (health check programático, md+grep)
 * Uso: node .opencode/scripts/doctor.mjs [--json]
 * Capas: A) proyecto (puede dar ⚠️/❌) · B) infra regenerable (ℹ️, nunca error) · C) adopción stack
 * Exit: 0 ok, 1 warnings (capa A), 2 errors (capa A) — B/C nunca afectan el exit.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, isFresh } from './memory-index.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const UPGRADE_FIX = 'npx advisor-harness@latest . --upgrade';
const checks = [];
function add(name, status, detail, fix='') { checks.push({ name, status, detail, fix }); }

function lines(p) { try { return readFileSync(p,'utf8').split('\n').length; } catch { return 0; } }

// ── Capa A: proyecto (⚠️/❌ posibles) ─────────────────────────────────────
// 1 opencode.json (root opencode.json, fallback .opencode/opencode.json)
try {
  let p = join(ROOT,'opencode.json');
  if (!existsSync(p)) p = join(ROOT,'.opencode','opencode.json');
  const j = JSON.parse(readFileSync(p,'utf8'));
  if (j.default_agent==='advisor' && j.subagent_depth===2) add('opencode.json','✅','default_agent advisor depth 2');
  else add('opencode.json','⚠️','default_agent/subagent_depth inesperado','Revisa la config del proyecto');
  const b = j.agent?.builder?.permission?.bash;
  if (b && b['cat **/.env*']==='ask') add('bash harden','✅','deny+ask sensibles presentes');
  else add('bash harden','⚠️','falta harden v2.0 (cat **/.env* -> ask)', UPGRADE_FIX);
} catch(e){ add('opencode.json','❌',e.message, UPGRADE_FIX); }

// 2 memoria sizes
const ps = join(ROOT,'PROJECT_STATE.md');
const sm = join(ROOT,'SUMMARY.md');
if (existsSync(ps)) {
  const l = lines(ps);
  add('PROJECT_STATE.md', l<100?'✅':l<120?'⚠️':'❌', `${l} líneas (<100 ideal)`, l>=100?'/compact-state o /review':'');
  const c = readFileSync(ps,'utf8');
  const sec2 = (c.split('## 2.')[1]||'').split('## 3.')[0]||'';
  const s2lines = sec2.split('\n').filter(x=>x.trim()).length;
  if (s2lines>80) add('PROJECT_STATE §2','⚠️',`§2 ${s2lines} líneas (>80 compactar)`,'/compact-state');
}
if (existsSync(sm)) {
  const l = lines(sm);
  add('SUMMARY.md', l<150?'✅':l<180?'⚠️':'❌', `${l} líneas (<150)`, l>=150?'/rotate-memory':'');
  const c = readFileSync(sm,'utf8');
  if (!c.includes('topic:')) add('SUMMARY topic','⚠️','entradas sin topic: family/kebab','Usa /record con topic');
  else add('SUMMARY topic','✅','topic presente');
}

// 3 lock huérfano
const lock = join(ROOT,'.memory-lock');
if (existsSync(lock)) {
  try {
    const age = Date.now() - statSync(lock).mtimeMs;
    add('.memory-lock', age>300000?'❌':'⚠️', age>300000?`huérfano ${Math.round(age/1000)}s`:'lock activo','rmdir .memory-lock si huérfano');
  } catch { add('.memory-lock','⚠️','existe','rmdir .memory-lock'); }
} else add('.memory-lock','✅','sin lock (ok)');

// 4 dirs (estado vivo .advisor/)
for (const [label, vivo] of [['CHANGELOG','CHANGELOG'],['backups','.advisor/backups'],['chunks','.advisor/chunks']]) {
  if (existsSync(join(ROOT,vivo))) add(`dir ${label}`, '✅', `ok (${vivo})`);
  else add(`dir ${label}`, '⚠️', 'falta', 'mkdir -p '+vivo);
}

// ── Capa B: infra regenerable (ℹ️, nunca error; fix único --upgrade) ─────
// 5 hook post-commit
const hook = join(ROOT,'.git','hooks','post-commit');
if (existsSync(hook)) {
  try { const mode = statSync(hook).mode; add('hook post-commit', (mode & 0o111)?'✅':'ℹ️', 'instalado pero sin bit ejecutable (regenerable)', UPGRADE_FIX); }
  catch { add('hook post-commit','ℹ️','no legible (regenerable)', UPGRADE_FIX); }
} else add('hook post-commit','ℹ️','no instalado (regenerable)', UPGRADE_FIX);

// 6 skills loader cache (vivo)
const cacheVivo = join(ROOT,'.advisor','skill-registry.cache.json');
const cache = existsSync(cacheVivo) ? cacheVivo : null;
if (cache) {
  try { const j=JSON.parse(readFileSync(cache,'utf8')); add('skill cache', j.version===2?'✅':'ℹ️', `${j.entries?.length||0} skills cacheadas (vivo)`, j.version!==2?UPGRADE_FIX:''); }
  catch { add('skill cache','ℹ️','cache corrupta (regenerable)', UPGRADE_FIX); }
} else add('skill cache','ℹ️','sin cache (se genera en /discover)', UPGRADE_FIX);

// 7 scripts
for (const s of ['memory-index.mjs','memory-sync.mjs','doctor.mjs']) {
  const p = join(ROOT,'.opencode','scripts',s);
  add(`script ${s}`, existsSync(p)?'✅':'ℹ️', existsSync(p)?'presente':'falta (regenerable)', existsSync(p)?'':UPGRADE_FIX);
}

// 8 manifest derivado (regenerable, nunca error)
const manifestVivo = join(ROOT,'.advisor','memory-manifest.json');
const manifest = existsSync(manifestVivo) ? manifestVivo : null;
if (manifest) {
  try {
    const m = JSON.parse(readFileSync(manifest,'utf8'));
    const ml = lines(manifest);
    if (m.version===1 && Array.isArray(m.recent) && m.recent.length<=5 && ml<15)
      add('manifest', '✅', `${m.recent.length} recientes, ${ml} líneas (vivo)`);
    else add('manifest','ℹ️','estructura inesperada o ≥15 líneas (regenerable)', UPGRADE_FIX);
  } catch { add('manifest','ℹ️','manifest corrupto (regenerable)', UPGRADE_FIX); }
} else add('manifest','ℹ️','sin manifest (se genera en escritura)', UPGRADE_FIX);

// 9 index derivado (stale o ausente no bloquea: fallback md+grep)
const indexVivo = join(ROOT,'.advisor','memory-index.json');
const index = existsSync(indexVivo) ? indexVivo : null;
if (index) {
  try {
    const data = JSON.parse(readFileSync(index,'utf8'));
    if (data.version===1 && isFresh(data, fingerprint()))
      add('index', '✅', `${data.entries?.length||0} entries fresh (vivo)`);
    else add('index','ℹ️','índice desactualizado (regenerable)', UPGRADE_FIX);
  } catch { add('index','ℹ️','índice corrupto (regenerable)', UPGRADE_FIX); }
} else add('index','ℹ️','sin índice (search usa fallback md+grep)', UPGRADE_FIX);

// ── Capa C: adopción stack (solo informativo, sin fix) ───────────────────
const agents = join(ROOT,'AGENTS.md');
let sentinel = false;
try { sentinel = existsSync(agents) && readFileSync(agents,'utf8').includes('<!--ADOPTION-STACK-->'); } catch {}
if (sentinel) add('adopción stack','ℹ️','Stack sin editar — /routine para rellenar');
else add('adopción stack','✅','Stack editado (sentinel ausente)');

// Exit: solo capa A cuenta (B/C son regenerable/informativo, nunca error)
const hasError = checks.some(c=>c.status==='❌');
const hasWarn = checks.some(c=>c.status==='⚠️');
const json = process.argv.includes('--json');
if (json) console.log(JSON.stringify({ checks }, null, 2));
else {
  console.log('ADVISOR doctor — ' + (hasError?'❌ errores (capa proyecto)':hasWarn?'⚠️ warnings (capa proyecto)':'✅ ok'));
  console.log('| Check | Estado | Detalle | Fix |');
  console.log('|-------|--------|---------|-----|');
  for (const c of checks) console.log(`| ${c.name} | ${c.status} | ${c.detail} | ${c.fix} |`);
}
process.exit(hasError?2:hasWarn?1:0);