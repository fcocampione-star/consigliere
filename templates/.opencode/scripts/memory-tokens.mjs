#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-tokens.mjs
 * Estimador ESTATICO del ahorro potencial en tokens entre un flujo
 * `plan+build` sin memoria y el agente advisor con memoria persistente.
 *
 * Heuristica: 1 token ~= 4 caracteres (`chars/4`, con techo). Es un proxy
 * documentado, no facturacion real: varia por modelo/tokenizer. Cero
 * dependencias, solo lectura (nunca escribe memoria ni disco).
 *
 * Modelo:
 *   C_full  = PROJECT_STATE + SUMMARY completo + CHANGELOG + skills completas
 *   baseline(s) = (1 + hojas) * C_full + rework        (cada hoja recarga todo)
 *   advisor(s)  = state + k*ON_DEMAND + hojas*DELTA + chunks*CHUNK [+ SPEC]
 *   ahorro      = 1 - advisor / baseline
 *
 * Las constantes DELTA/ON_DEMAND/CHUNK/SPEC y la tabla SCENARIOS estan
 * documentadas abajo y se calibraron contra este repo (ver test/).
 *
 * Uso:
 *   node .opencode/scripts/memory-tokens.mjs measure [--json] [--root <dir>]
 *   node .opencode/scripts/memory-tokens.mjs compare --scenario direct|delegated|spec-lite [--json] [--root <dir>]
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { exitUsage, isMain, readText } from './lib/core.mjs';
import { listChangelog } from './lib/md.mjs';
import { entriesRegion } from './memory-stats.mjs';

// ── Constantes del modelo (exportadas para calibrar en tests) ───────────────

/** Caracteres por token de la heuristica (proxy, no facturacion). */
export const TOKENS_PER_CHAR = 4;
/** Coste de un prompt delegado con DELTAS (tarea+archivos+topic+spec-id). */
export const DELTA_TOKENS = 120;
/** Coste de una lectura on-demand (search -> timeline -> get). */
export const ON_DEMAND_TOKENS = 400;
/** Coste medio de un chunk de skill cargado bajo demanda. */
export const CHUNK_TOKENS = 150;
/** Coste de una spec-lite (<=650 palabras, ~650*4/3 tokens). */
export const SPEC_TOKENS = 867;

/**
 * Escenarios de routing (advisor.md 2): hojas del pipeline, lecturas
 * on-demand (k), chunks cargados, si hay spec-lite y fraccion de C_full
 * que el rework evitado ahorra (0 = sin rework modelado).
 */
export const SCENARIOS = Object.freeze({
  direct: Object.freeze({ leaves: 1, onDemand: 1, chunks: 1, spec: false, rework: 0 }),
  delegated: Object.freeze({ leaves: 5, onDemand: 2, chunks: 2, spec: false, rework: 0.5 }),
  'spec-lite': Object.freeze({ leaves: 6, onDemand: 2, chunks: 2, spec: true, rework: 0.2 }),
});

const CHUNK_RE = /<!--[ \t]*CHUNK:[ \t]*([A-Za-z0-9_-]+)[ \t]*-->([\s\S]*?)<!--[ \t]*\/CHUNK[ \t]*-->/g;

// ── Primitivas puras ─────────────────────────────────────────────────────────

/** Heuristica chars/4 con techo; ''/null -> 0. Determinista. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / TOKENS_PER_CHAR);
}

/** Chunks `<!-- CHUNK: nombre -->...<!-- /CHUNK -->` de un SKILL.md. */
export function parseChunks(text) {
  const src = String(text ?? '');
  const out = [];
  CHUNK_RE.lastIndex = 0;
  let m;
  while ((m = CHUNK_RE.exec(src)) !== null) {
    out.push({ name: m[1], chars: m[2].length, tokens: estimateTokens(m[2]) });
  }
  return out;
}

function fileStats(path) {
  const text = readText(path);
  return { chars: text.length, lines: text === '' ? 0 : text.split('\n').length, tokens: estimateTokens(text) };
}

/** Mide la memoria y las skills instaladas bajo `root` (solo lectura). */
export function measureRoot(root) {
  const dir = String(root ?? '');
  const stateText = readText(join(dir, 'PROJECT_STATE.md'));
  const summaryText = readText(join(dir, 'SUMMARY.md'));
  const state = { chars: stateText.length, tokens: estimateTokens(stateText) };
  const summaryFull = { chars: summaryText.length, tokens: estimateTokens(summaryText) };
  let summaryEntries = { chars: 0, tokens: 0, marked: false };
  try {
    const { region, marked } = entriesRegion(summaryText);
    summaryEntries = { chars: region.length, tokens: estimateTokens(region), marked };
  } catch {
    summaryEntries = { chars: 0, tokens: 0, marked: false };
  }
  const changelogFiles = listChangelog(join(dir, 'CHANGELOG'))
    .filter((n) => n !== 'DECISIONS-ARCHIVE.md')
    .sort()
    .map((name) => ({ name, ...fileStats(join(dir, 'CHANGELOG', name)) }));
  const changelog = { files: changelogFiles.length, tokens: changelogFiles.reduce((a, f) => a + f.tokens, 0) };

  const skills = [];
  const skillsDir = join(dir, '.opencode', 'skills');
  let names = [];
  try {
    names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch { names = []; }
  for (const name of names) {
    const p = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(p)) continue;
    const text = readText(p);
    skills.push({ name, tokens: estimateTokens(text), chunks: parseChunks(text) });
  }
  const skillsFull = skills.reduce((a, s) => a + s.tokens, 0);
  const full = state.tokens + summaryFull.tokens + changelog.tokens + skillsFull;
  return { state, summaryFull, summaryEntries, changelog, skills, totals: { skillsFull, full }, tokensPerChar: TOKENS_PER_CHAR };
}

/** Compara baseline vs advisor para un escenario sobre una medicion dada. */
export function compare(scenario, measured) {
  const cfg = SCENARIOS[String(scenario ?? '')];
  if (!cfg) throw new Error(`memory-tokens: escenario desconocido "${scenario}" (esperado ${Object.keys(SCENARIOS).join('|')})`);
  const m = measured ?? measureRoot(join(import.meta.dirname, '..', '..'));
  const full = m.totals.full;
  const rework = Math.round(full * cfg.rework);
  const baseline = (1 + cfg.leaves) * full + rework;
  const advisor =
    m.state.tokens +
    cfg.onDemand * ON_DEMAND_TOKENS +
    cfg.leaves * DELTA_TOKENS +
    cfg.chunks * CHUNK_TOKENS +
    (cfg.spec ? SPEC_TOKENS : 0);
  const savingPct = baseline > 0 ? Math.round((1 - advisor / baseline) * 1000) / 10 : 0;
  return { scenario: String(scenario), leaves: cfg.leaves, baseline, advisor, savingPct, rework, full };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { cmd: argv[2], json: false, root: null, scenario: null };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--root') out.root = argv[++i] ?? null;
    else if (a === '--scenario') out.scenario = argv[++i] ?? null;
    else if ((a === 'direct' || a === 'delegated' || a === 'spec-lite') && out.scenario === null) out.scenario = a;
    else exitUsage(`memory-tokens: argumento desconocido "${a}"\nUso:\n  node .opencode/scripts/memory-tokens.mjs measure [--json] [--root <dir>]\n  node .opencode/scripts/memory-tokens.mjs compare --scenario direct|delegated|spec-lite [--json] [--root <dir>]`);
  }
  return out;
}

function main() {
  const { cmd, json, root, scenario } = parseArgs(process.argv);
  const base = root ?? join(import.meta.dirname, '..', '..');
  if (cmd === 'measure') {
    const m = measureRoot(base);
    if (json) console.log(JSON.stringify({ root: base, ...m }, null, 2));
    else {
      console.log(`memory-tokens measure — raíz: ${base} (heurística chars/${TOKENS_PER_CHAR})`);
      console.log(`  PROJECT_STATE.md: ${m.state.tokens} tok`);
      console.log(`  SUMMARY.md: ${m.summaryFull.tokens} tok (entradas: ${m.summaryEntries.tokens} tok)`);
      console.log(`  CHANGELOG/: ${m.changelog.tokens} tok (${m.changelog.files} ficheros)`);
      for (const s of m.skills) console.log(`  skill ${s.name}: ${s.tokens} tok (${s.chunks.length} chunks)`);
      console.log(`  TOTAL C_full: ${m.totals.full} tok`);
    }
    return;
  }
  if (cmd === 'compare') {
    if (!scenario) exitUsage('memory-tokens: compare exige --scenario direct|delegated|spec-lite');
    const r = compare(scenario, measureRoot(base));
    if (json) console.log(JSON.stringify({ root: base, ...r }, null, 2));
    else {
      console.log(`memory-tokens compare --scenario ${r.scenario} (heurística chars/${TOKENS_PER_CHAR})`);
      console.log(`  baseline plan+build: ${r.baseline} tok (${r.leaves} hojas + rework ${r.rework})`);
      console.log(`  advisor con memoria: ${r.advisor} tok`);
      console.log(`  ahorro potencial: ${r.savingPct}%`);
    }
    return;
  }
  exitUsage('Uso:\n  node .opencode/scripts/memory-tokens.mjs measure [--json] [--root <dir>]\n  node .opencode/scripts/memory-tokens.mjs compare --scenario direct|delegated|spec-lite [--json] [--root <dir>]');
}

if (isMain(import.meta.url, process.argv[1])) main();
