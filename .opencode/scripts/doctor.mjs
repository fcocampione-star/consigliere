#!/usr/bin/env node
/**
 * ADVISOR 2.0 — doctor.mjs (health check programático, md+grep)
 * Uso: node .opencode/scripts/doctor.mjs [--json]
 * Códigos: 0 ok, 1 warnings, 2 errors
 */
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, isFresh } from './memory-index.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const checks = [];
function add(name, status, detail, fix='') { checks.push({ name, status, detail, fix }); }

function lines(p) { try { return readFileSync(p,'utf8').split('\n').length; } catch { return 0; } }

// 1 opencode.json (root opencode.json, fallback .opencode/opencode.json)
try {
  let p = join(ROOT,'opencode.json');
  if (!existsSync(p)) p = join(ROOT,'.opencode','opencode.json');
  const j = JSON.parse(readFileSync(p,'utf8'));
  if (j.default_agent==='advisor' && j.subagent_depth===2) add('opencode.json','✅','default_agent advisor depth 2');
  else add('opencode.json','⚠️','default_agent/subagent_depth inesperado','Revisa templates/opencode.json');
  const b = j.agent?.builder?.permission?.bash;
  if (b && b['cat **/.env*']==='ask') add('bash harden','✅','deny+ask sensibles presentes');
  else add('bash harden','⚠️','falta harden v2.0 (cat **/.env* -> ask)','Re-render init.mjs --upgrade');
} catch(e){ add('opencode.json','❌',e.message,'npx advisor-harness@latest . --upgrade'); }

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

// 3 hook
const hook = join(ROOT,'.git','hooks','post-commit');
if (existsSync(hook)) {
  try { statSync(hook); const mode = statSync(hook).mode; add('hook post-commit', (mode & 0o111)?'✅':'⚠️', existsSync(hook)?'instalado':'falta','chmod +x .git/hooks/post-commit'); } catch { add('hook post-commit','⚠️','no legible','reinstala con init.mjs --upgrade'); }
} else add('hook post-commit','⚠️','no instalado (revise .opencode/hooks/post-commit-memory-rotate.sh)','node init.mjs . --upgrade');

// 4 lock huérfano
const lock = join(ROOT,'.memory-lock');
if (existsSync(lock)) {
  try {
    const age = Date.now() - statSync(lock).mtimeMs;
    add('.memory-lock', age>300000?'❌':'⚠️', age>300000?`huérfano ${Math.round(age/1000)}s`:'lock activo','rmdir .memory-lock si huérfano');
  } catch { add('.memory-lock','⚠️','existe','rmdir .memory-lock'); }
} else add('.memory-lock','✅','sin lock (ok)');

// 5 skills loader cache (dual-path: .advisor/ primero, legacy .consigliere/ read-only)
const cache = existsSync(join(ROOT,'.advisor','skill-registry.cache.json'))
  ? join(ROOT,'.advisor','skill-registry.cache.json')
  : join(ROOT,'.consigliere','skill-registry.cache.json');
if (existsSync(cache)) {
  try { const j=JSON.parse(readFileSync(cache,'utf8')); add('skill cache', j.version===2?'✅':'⚠️', `${j.entries?.length||0} skills cacheadas (${cache.includes('.consigliere')?'legacy':'vivo'})`, j.version!==2?'node .opencode/skills/_skill-loader/loader.mjs refresh --force':''); } catch { add('skill cache','⚠️','cache corrupta','node .opencode/skills/_skill-loader/loader.mjs refresh --force'); }
} else add('skill cache','⚠️','sin cache (se genera en /discover)','node .opencode/skills/_skill-loader/loader.mjs refresh');

// 6 scripts
for (const s of ['memory-index.mjs','memory-sync.mjs','doctor.mjs']) {
  const p = join(ROOT,'.opencode','scripts',s);
  add(`script ${s}`, existsSync(p)?'✅':'❌', existsSync(p)?'presente':'falta','npx advisor-harness@latest . --upgrade');
}

// 7 dirs (dual-path estado: .advisor/ vivo, legacy .consigliere/ read-only)
for (const [label, vivo, legacy] of [['CHANGELOG','CHANGELOG',null],['backups','.advisor/backups','.consigliere/backups'],['chunks','.advisor/chunks','.consigliere/chunks']]) {
  const p = existsSync(join(ROOT,vivo)) ? vivo : (legacy && existsSync(join(ROOT,legacy)) ? legacy : vivo);
  const okDir = existsSync(join(ROOT,p));
  add(`dir ${label}`, okDir?'✅':'⚠️', okDir?`ok (${p})`:'falta','mkdir -p '+vivo);
}

// 8 manifest derivado (warning: regenerable, nunca error)
const manifest = existsSync(join(ROOT,'.advisor','memory-manifest.json'))
  ? join(ROOT,'.advisor','memory-manifest.json')
  : join(ROOT,'.consigliere','memory-manifest.json');
if (existsSync(manifest)) {
  try {
    const m = JSON.parse(readFileSync(manifest,'utf8'));
    const ml = lines(manifest);
    if (m.version===1 && Array.isArray(m.recent) && m.recent.length<=5 && ml<15)
      add('manifest', '✅', `${m.recent.length} recientes, ${ml} líneas (${manifest.includes('.consigliere')?'legacy':'vivo'})`);
    else add('manifest','⚠️','estructura inesperada o ≥15 líneas','node .opencode/scripts/memory-sync.mjs buildManifest');
  } catch { add('manifest','⚠️','manifest corrupto','node .opencode/scripts/memory-sync.mjs buildManifest'); }
} else add('manifest','⚠️','sin manifest (se genera en escritura)','node .opencode/scripts/memory-sync.mjs buildManifest');

// 9 index derivado (warning: stale o ausente no bloquea search, hay fallback md+grep)
const indexVivo = join(ROOT,'.advisor','memory-index.json');
const indexLegacy = join(ROOT,'.consigliere','memory-index.json');
const index = existsSync(indexVivo) ? indexVivo : indexLegacy;
if (existsSync(index)) {
  try {
    const data = JSON.parse(readFileSync(index,'utf8'));
    if (data.version===1 && isFresh(data, fingerprint()))
      add('index', '✅', `${data.entries?.length||0} entries fresh (${index.includes('.consigliere')?'legacy':'vivo'})`);
    else add('index','⚠️','índice desactualizado (stale)','node .opencode/scripts/memory-sync.mjs buildIndex');
  } catch { add('index','⚠️','índice corrupto','node .opencode/scripts/memory-sync.mjs buildIndex'); }
} else add('index','⚠️','sin índice (search usa fallback md+grep)','node .opencode/scripts/memory-sync.mjs buildIndex');

const hasError = checks.some(c=>c.status==='❌');
const hasWarn = checks.some(c=>c.status==='⚠️');
const json = process.argv.includes('--json');
if (json) console.log(JSON.stringify({ checks }, null, 2));
else {
  console.log('ADVISOR doctor — ' + (hasError?'❌ errores':hasWarn?'⚠️ warnings':'✅ ok'));
  console.log('| Check | Estado | Detalle | Fix |');
  console.log('|-------|--------|---------|-----|');
  for (const c of checks) console.log(`| ${c.name} | ${c.status} | ${c.detail} | ${c.fix} |`);
}
process.exit(hasError?2:hasWarn?1:0);
