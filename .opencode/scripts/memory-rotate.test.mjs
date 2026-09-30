#!/usr/bin/env node
/**
 * Regresión de memory-rotate.mjs (F1b) — sin dependencias, cross-platform.
 *
 * Cubre: B1 (parser fence-aware), B2 (fallback no archiva el pie), B3
 * (normalización de blancos al anexar 2+ entradas), B4 (dedup por fecha+título
 * normalizado, sin falso positivo por prefijo), B5 (orden descendente/warning),
 * B6 (--root test-only documentado) y la regresión clave (rotación normal,
 * idempotencia, dry-run, cap --max, entrada única protegida, separadores
 * `:`/`|`, migrate-markers idempotente, lock sin huérfano, sin `.tmp`, CRLF).
 *
 * Uso: node .opencode/scripts/memory-rotate.test.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ENGINE = new URL('./memory-rotate.mjs', import.meta.url);
const { rotate, migrateMarkers, parseRegion, hasEntry, scanEntryHeads } = await import(ENGINE.href);
const { acquireLock, releaseLock, listStaleDirs } = await import(new URL('./memory-lock.mjs', import.meta.url).href);

const START = '<!-- ADVISOR:ENTRIES:START -->';
const END = '<!-- ADVISOR:ENTRIES:END -->';
const BASE = join(tmpdir(), 'advisor-rotate-test-' + process.pid + '-' + Date.now());

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function fresh(n) { const d = join(BASE, n); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; }
function E(date, title, body) { return `## ${date} — ${title}\n\ntopic: arch/x\n**Goal:** ${body}\n**Verificación:** ok\n`; }
function state() { return '## 4. Índice\n\n| Semana | Archivo | Resumen |\n|--------|---------|---------|\n| (aún sin historial) | — | — |\n\n## 5. Patrones\n'; }
function summary(entries, footer) { return ['# Session Log', '', START, '', ...entries, '', END, '', footer || '', ''].join('\n'); }
const FOOTER = ['---', '', '## Índice de historial archivado (CAPA 2)', '', '| Semana (lunes) | Archivo |', '|----------------|---------|', '| (aún sin historial) | — |', ''].join('\n');
function snap(d) {
  return {
    summary: readFileSync(join(d, 'SUMMARY.md'), 'utf8'),
    state: existsSync(join(d, 'PROJECT_STATE.md')) ? readFileSync(join(d, 'PROJECT_STATE.md'), 'utf8') : '',
    files: existsSync(join(d, 'CHANGELOG')) ? readdirSync(join(d, 'CHANGELOG')).sort() : [],
  };
}
function tmpResidual(d) {
  const out = [];
  const walk = (p) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f); else if (n.endsWith('.tmp')) out.push(f); } };
  if (existsSync(d)) walk(d);
  return out;
}

try {
  // ---------- B1: parser fence-aware ----------
  {
    const region = ['', '## 2024-02-01 — C', '', '```js', '## 2020-01-01 — Fake', 'const x = 1;', '```', '', '## 2024-01-15 — Real', ''].join('\n');
    const p = parseRegion(region);
    check('B1 fence ``` + lenguaje: fake no capturado', !p.entries.some((e) => e.date === '2020-01-01'), JSON.stringify(p.entries.map((e) => e.date)));
    check('B1 entrada contenedora no partida (fence completo)', p.entries[0].text.includes('## 2020-01-01') && p.entries[0].text.includes('```js') && p.entries[0].text.includes('```'));
    const t = ['', '## 2024-02-01 — C', '', '~~~', '## 2020-01-01 — Fake', '~~~', '', '## 2024-01-10 — Real', ''].join('\n');
    const pt = parseRegion(t);
    check('B1 fence ~~~: fake no capturado', !pt.entries.some((e) => e.date === '2020-01-01'), JSON.stringify(pt.entries.map((e) => e.date)));
    const long = ['', '## 2024-02-01 — C', '', '````', '## 2020-01-01 — Fake', '```', '````', '', '## 2024-01-05 — Real', ''].join('\n');
    const pl = parseRegion(long);
    check('B1 cierre exige longitud >= apertura (````  vs ```)', !pl.entries.some((e) => e.date === '2020-01-01'), JSON.stringify(pl.entries.map((e) => e.date)));
    const outside = ['', '## 2024-02-01 — A', '', '```', 'code', '```', '', '## 2024-01-10 — Real fuera', ''].join('\n');
    const po = parseRegion(outside);
    check('B1 heading real FUERA de fence sí cuenta', po.entries.some((e) => e.date === '2024-01-10'));
    check('B1 scanEntryHeads exportado es fence-aware', scanEntryHeads(['```', '## 2020-01-01 — X', '```', '## 2024-01-01 — Y'].join('\n')).length === 1);
  }

  // ---------- B2: fallback con pie NO estándar ----------
  {
    const d = fresh('b2');
    const raw = ['# Session Log', '', E('2024-01-15', 'A', 'a'), E('2024-01-08', 'B', 'b'), E('2024-01-01', 'C', 'c'), '> Nota final personalizada', '', '## Historial', 'algo', ''].join('\n');
    writeFileSync(join(d, 'SUMMARY.md'), raw);
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d });
    const s = snap(d);
    check('B2 advisory migrate-markers presente', (r.advisory || '').includes('migrate-markers'), r.advisory);
    check('B2 pie NO archivado', s.summary.includes('> Nota final personalizada') && s.summary.includes('## Historial'));
    const lost = s.files.some((f) => readFileSync(join(d, 'CHANGELOG', f), 'utf8').includes('Nota final') || readFileSync(join(d, 'CHANGELOG', f), 'utf8').includes('## Historial'));
    check('B2 sin pérdida: pie no aparece en CHANGELOG', !lost);
  }

  // ---------- B3: 2+ entradas al mismo CHANGELOG ----------
  {
    const d = fresh('b3');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-17', 'New', 'n'), E('2024-01-03', 'Wed', 'c1'), E('2024-01-02', 'Tue', 'c2')], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    rotate({ root: d });
    const c = readFileSync(join(d, 'CHANGELOG', '2024-01-01.md'), 'utf8');
    check('B3 sin dobles blancos (0 ocurrencias de \\n\\n\\n)', !/\n\n\n/.test(c), JSON.stringify(c.slice(0, 200)));
  }

  // ---------- B4: dedup fecha+título (no prefijo) ----------
  {
    const existing = `## 2024-01-02 — ${'Refactor motor de rotacion de memoria prefijo comun largo XYZABCDEFGHIJKLMNOPQRSTUVW'}\n`;
    const a = { date: '2024-01-01', title: 'Refactor motor de rotacion de memoria prefijo comun largo XYZABCDEFGHIJKLMNOPQRSTUVW' };
    check('B4 título igual, fecha distinta → no dedup', hasEntry(existing, a) === false);
    const existing2 = `## 2024-01-01: ${a.title}\n`;
    check('B4 mismo id separador-agnóstico → dedup', hasEntry(existing2, a) === true);
  }

  // ---------- B5: orden ascendente → warning + protege la más nueva ----------
  {
    const { parseRegion: pr } = await import(ENGINE.href);
    const d = fresh('b5');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-01', 'Old', 'o'), E('2024-01-08', 'Mid', 'm'), E('2024-01-15', 'New', 'n')], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d });
    check('B5 warning ascendente', r.warnings.some((w) => w.includes('ascendente')), JSON.stringify(r.warnings));
    check('B5 no archiva la más nueva', !r.moved.some((m) => m.date === '2024-01-15'), JSON.stringify(r.moved.map((m) => m.date)));
    check('B5 parseRegion exportado', typeof pr === 'function');
  }

  // ---------- B6: --root test-only / lock documentado ----------
  {
    const src = readFileSync(ENGINE, 'utf8');
    check('B6 docstring/--help: --root test-only', /--root.*TEST-ONLY/i.test(src) || /TEST-ONLY[\s\S]*--root/i.test(src));
    check('B6 lock sobre raíz del script, no --root', /lock[\s\S]*raíz del repo del propio script/i.test(src));
  }

  // ---------- Regresión clave ----------
  {
    const d = fresh('normal');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-15', 'S3', 'c3'), E('2024-01-08', 'S2', 'c2'), E('2024-01-01', 'S1', 'c1')], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d });
    const s = snap(d);
    check('normal rota 2 (la más nueva protegida)', r.moved.length === 2, JSON.stringify(r.moved.map((m) => m.date)));
    check('normal lunes por entrada', s.files.join(',') === '2024-01-01.md,2024-01-08.md', s.files.join(','));
    check('normal pie/índice intactos', s.summary.includes('## Índice de historial archivado') && s.summary.includes('| (aún sin historial) | — |'));
    check('normal §4 bien formada', s.state.includes('| 2024-01-01 | 2024-01-01.md |') && /## 4\.[\s\S]*\n\n## 5\./.test(s.state));
    const a = snap(d);
    const r2 = rotate({ root: d });
    const b = snap(d);
    check('idempotencia: 2ª byte-idéntica', JSON.stringify(a) === JSON.stringify(b) && r2.moved.length === 0);
    check('sin .tmp residuales', tmpResidual(d).length === 0);
  }
  {
    const d = fresh('dry');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-15', 'S3', 'c3'), E('2024-01-08', 'S2', 'c2'), E('2024-01-01', 'S1', 'c1')], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const before = JSON.stringify(snap(d));
    const r = rotate({ root: d, dryRun: true });
    check('dry-run sin escritura', before === JSON.stringify(snap(d)) && r.moved.length === 2 && r.summaryWritten === false);
  }
  {
    const d = fresh('over150');
    const big = Array.from({ length: 40 }, (_, i) => 'l' + i).join('\n');
    const ents = [];
    for (let i = 1; i <= 6; i++) ents.push(E(`2024-01-0${i}`, 'E' + i, big));
    writeFileSync(join(d, 'SUMMARY.md'), summary(ents, FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d, max: 2 });
    check('>150 con --max: rota a lo sumo max', r.moved.length === 2 && r.warnings.some((w) => w.includes('Cap --max')));
  }
  {
    const d = fresh('single');
    const big = Array.from({ length: 200 }, (_, i) => 'l' + i).join('\n');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-01', 'Solo', big)], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d });
    check('única entrada >150 protegida', r.moved.length === 0 && r.warnings.some((w) => w.includes('única entrada')));
  }
  {
    const d = fresh('dedup');
    mkdirSync(join(d, 'CHANGELOG'), { recursive: true });
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-15', 'New', 'n'), E('2024-01-01', 'Old', 'o')], FOOTER));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    writeFileSync(join(d, 'CHANGELOG', '2024-01-01.md'), '# Changelog 2024-01-01\n\n> x\n\n' + E('2024-01-01', 'Old', 'o').trim() + '\n');
    const r = rotate({ root: d });
    const c = readFileSync(join(d, 'CHANGELOG', '2024-01-01.md'), 'utf8');
    check('dedup no duplica', (c.match(/## 2024-01-01 — Old/g) || []).length === 1 && r.moved.some((m) => m.dedup));
  }
  {
    const d = fresh('seps');
    const s = ['# S', '', START, '', '## 2024-01-15 | Pipe', '', 'c1', '', '## 2024-01-08 — Dash', '', 'c2', '', '## 2024-01-01: Colon', '', 'c3', '', END, '', FOOTER, ''].join('\n');
    writeFileSync(join(d, 'SUMMARY.md'), s);
    writeFileSync(join(d, 'PROJECT_STATE.md'), state());
    const r = rotate({ root: d });
    check('separadores : y | detectados', r.moved.some((m) => m.title === 'Colon') && r.moved.some((m) => m.title === 'Dash'), JSON.stringify(r.moved.map((m) => m.title)));
  }
  {
    const d = fresh('migrate');
    const s = ['# S', '', '## 2024-01-15 — A', '', 'a', '', '## 2024-01-01 — B', '', 'b', '', '> Cuando registres progreso', '', '> Topic upsert'].join('\n');
    writeFileSync(join(d, 'SUMMARY.md'), s);
    const r1 = migrateMarkers({ root: d });
    const a = readFileSync(join(d, 'SUMMARY.md'), 'utf8');
    const r2 = migrateMarkers({ root: d });
    check('migrate-markers cambia e idempotente', r1.changed === true && r2.alreadyMarked === true && a === readFileSync(join(d, 'SUMMARY.md'), 'utf8'));
  }
  {
    const d = fresh('crlf');
    writeFileSync(join(d, 'SUMMARY.md'), summary([E('2024-01-15', 'S3', 'c3'), E('2024-01-08', 'S2', 'c2'), E('2024-01-01', 'S1', 'c1')], FOOTER).replace(/\n/g, '\r\n'));
    writeFileSync(join(d, 'PROJECT_STATE.md'), state().replace(/\n/g, '\r\n'));
    const r = rotate({ root: d });
    check('CRLF: rota igual (cross-platform)', r.moved.length === 2, 'moved=' + r.moved.length);
  }

  // ---------- Lock: busy / no-owner sin huérfano ----------
  {
    const staleBefore = listStaleDirs().length;
    const l1 = acquireLock();
    check('lock: adquirido', l1.acquired === true);
    const l2 = acquireLock();
    check('lock: segundo acquire → busy', l2.acquired === false && l2.reason === 'busy');
    // Suplanta el owner por uno ajeno para probar el rechazo por token/pid.
    const ownerPath = new URL('../../.memory-lock/owner.json', import.meta.url);
    writeFileSync(ownerPath, JSON.stringify({ pid: 999999, host: 'otro-host', ts: Date.now(), version: 1, token: 'foreign' }));
    const bad = releaseLock({ token: l1.token });
    check('lock: release ajeno token erróneo → not-owner', bad.released === false && bad.reason === 'not-owner', JSON.stringify(bad));
    const forced = releaseLock({ force: true });
    check('lock: --force libera lock ajeno', forced.released === true && forced.reason === 'forced');
    check('lock: sin lock residual ni stale nuevo', existsSync(new URL('../../.memory-lock', import.meta.url)) === false && listStaleDirs().length === staleBefore);
  }
} catch (e) {
  fail++;
  console.log('FAIL excepción no controlada :: ' + e.message);
} finally {
  rmSync(BASE, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
