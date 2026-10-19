#!/usr/bin/env node
/**
 * test/dev-config.test.mjs — caracterización de `.opencode/scripts/dev-config.mjs`
 * (generador dev-only de la `opencode.json` local gitignored de este repo).
 *
 * Dos capas, sin depender del CLI de opencode:
 *  1. La PROPIEDAD DERIVADA de la transformación pura sobre la plantilla real:
 *     `templates/opencode.json` tiene 7 agentes y 7 placeholders `{{MODEL_*}}`,
 *     y el render los resuelve a "" sin dejar `{{` ni romper el JSON.
 *  2. Los MODOS del CLI (--check / --force / no-op / errores de uso) sobre un
 *     ESPEJO en tmpdir (patrón de doctor-checks/wiring-basic): se ejecuta la
 *     copia del temp, nunca la del repo, así el `opencode.json` real no se toca.
 *
 * El valor del test es el guardián anti-drift: la transformación está duplicada
 * respecto a `init.mjs` (que no es importable sin ejecutar el instalador), y la
 * única red que impide que esa copia derive es este contrato.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { suite, test, assert, eq, match, throws, tmpdir, cleanup, runAll } from './harness.mjs';
import { renderDevConfig } from '../.opencode/scripts/dev-config.mjs';

const REPO = join(import.meta.dirname, '..');
const SCRIPTS = join(REPO, '.opencode', 'scripts');
const TEMPLATE = join(REPO, 'templates', 'opencode.json');
const AGENTS = ['advisor', 'builder', 'critic', 'explore', 'planner', 'summarizer', 'verifier'];
const MODEL_RE = /\{\{MODEL_[A-Z_]+\}\}/g;

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

// ── Espejo en tmpdir: copia el script + su lib y una plantilla dada ─────────
function sandbox(templateText) {
  const dir = tmpdir('advisor-devconfig');
  TEMPS.push(dir);
  const scripts = join(dir, '.opencode', 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(join(SCRIPTS, 'dev-config.mjs'), join(scripts, 'dev-config.mjs'));
  copyFileSync(join(SCRIPTS, 'lib', 'core.mjs'), join(scripts, 'lib', 'core.mjs'));
  mkdirSync(join(dir, 'templates'), { recursive: true });
  writeFileSync(join(dir, 'templates', 'opencode.json'), templateText, 'utf8');
  return { dir, target: join(dir, 'opencode.json'), cli: join(scripts, 'dev-config.mjs') };
}

function run(cli, args = []) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, input: '', timeout: 15000 });
  assert(!r.error, `spawn dev-config.mjs falló: ${r.error && r.error.message}`);
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ── Suite 1: propiedad derivada sobre la plantilla REAL ─────────────────────
suite('dev-config · propiedad derivada');

test('templates/opencode.json declara exactamente 7 agentes y 7 placeholders {{MODEL_*}}', () => {
  const raw = readFileSync(TEMPLATE, 'utf8');
  const cfg = JSON.parse(raw);
  eq(Object.keys(cfg.agent).sort(), [...AGENTS].sort(), 'los 7 agentes de la plantilla');
  const hits = raw.match(MODEL_RE) || [];
  eq(hits.length, 7, 'siete placeholders {{MODEL_*}} (uno por agente, incl. advisor/planner)');
});

test('render: 7 agentes, cada model resuelto a "" y JSON válido sin ningún {{', () => {
  const rendered = renderDevConfig(readFileSync(TEMPLATE, 'utf8'));
  const cfg = JSON.parse(rendered);
  eq(Object.keys(cfg.agent).sort(), [...AGENTS].sort(), 'el render conserva exactamente los 7 agentes');
  for (const name of AGENTS) eq(cfg.agent[name].model, '', `model de ${name} = "" (heredar)`);
  assert(!/\{\{/.test(rendered), 'el render no deja placeholders pendientes');
  match(rendered, /\n$/, 'el render conserva el salto final de la plantilla');
});

test('render es el MISMO árbol que la plantilla salvo los model vaciados (no toca nada más)', () => {
  const tpl = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  const out = JSON.parse(renderDevConfig(readFileSync(TEMPLATE, 'utf8')));
  const sinModels = (cfg) => {
    const clone = JSON.parse(JSON.stringify(cfg));
    for (const a of Object.values(clone.agent)) a.model = '';
    return clone;
  };
  eq(out, sinModels(tpl), 'el render solo cambia agent.*.model a ""');
});

test('render normaliza EOL a LF (la plantilla puede llegar CRLF del working tree)', () => {
  const crlf = readFileSync(TEMPLATE, 'utf8').replace(/\n/g, '\r\n');
  const out = renderDevConfig(crlf);
  assert(!out.includes('\r'), 'ningún \\r en la salida');
  eq(JSON.parse(out).agent.builder.model, '', 'sigue siendo JSON válido tras normalizar');
});

test('render valida antes de devolver: plantilla rota o con placeholder ajeno lanza', () => {
  throws(() => renderDevConfig('{ esto no es json'), 'JSON inválido lanza');
  throws(() => renderDevConfig('{"a": "{{OTRO_VAR}}"}'), 'placeholder no-MODEL sin resolver lanza');
});

// ── Suite 2: modos del CLI sobre el espejo ──────────────────────────────────
suite('dev-config · modos CLI');

const TEMPLATE_TEXT = readFileSync(TEMPLATE, 'utf8');
const RENDERED = renderDevConfig(TEMPLATE_TEXT);

test('sin flags y sin destino: genera el config (exit 0) y es JSON válido sin {{', () => {
  const s = sandbox(TEMPLATE_TEXT);
  const r = run(s.cli);
  eq(r.status, 0, `exit 0 al generar (${r.err.trim()})`);
  assert(existsSync(s.target), 'la config se creó');
  const raw = readFileSync(s.target, 'utf8');
  eq(JSON.parse(raw).agent.verifier.model, '', 'model verifier heredado');
  assert(!/\{\{/.test(raw), 'sin placeholders pendientes');
});

test('sin flags con destino existente: NO-OP exit 0 (protege modelos personalizados)', () => {
  const s = sandbox(TEMPLATE_TEXT);
  const personalizado = JSON.stringify({ default_agent: 'advisor', subagent_depth: 2, agent: { builder: { model: 'anthropic/claude-x' } } }, null, 2) + '\n';
  writeFileSync(s.target, personalizado, 'utf8');
  const r = run(s.cli);
  eq(r.status, 0, 'no-op exit 0');
  eq(readFileSync(s.target, 'utf8'), personalizado, 'el config personalizado no se toca');
});

test('--force: regenera siempre desde la plantilla (pisa lo personalizado)', () => {
  const s = sandbox(TEMPLATE_TEXT);
  writeFileSync(s.target, '{ "personalizado": true }\n', 'utf8');
  const r = run(s.cli, ['--force']);
  eq(r.status, 0, 'exit 0');
  eq(readFileSync(s.target, 'utf8'), RENDERED, 'el config queda byte-idéntico al render de la plantilla');
});

test('--check: exit 0 solo con destino presente, JSON válido y sin {{', () => {
  const s = sandbox(TEMPLATE_TEXT);

  // a) ausente → 1
  eq(run(s.cli, ['--check']).status, 1, 'sin config --check falla');

  // b) JSON inválido → 1
  writeFileSync(s.target, '{ "default_agent": | }', 'utf8');
  eq(run(s.cli, ['--check']).status, 1, 'config inválida --check falla');

  // c) válido pero con placeholder pendiente → 1
  writeFileSync(s.target, '{"agent":{"builder":{"model":"{{MODEL_BUILDER}}"}}}\n', 'utf8');
  eq(run(s.cli, ['--check']).status, 1, 'placeholder pendiente --check falla');

  // d) fresco (el propio render) → 0
  writeFileSync(s.target, RENDERED, 'utf8');
  const ok = run(s.cli, ['--check']);
  eq(ok.status, 0, `config fresca --check ok (${ok.err.trim()})`);
});

test('--check no escribe: el destino queda intacto', () => {
  const s = sandbox(TEMPLATE_TEXT);
  writeFileSync(s.target, RENDERED, 'utf8');
  run(s.cli, ['--check']);
  eq(readFileSync(s.target, 'utf8'), RENDERED, '--check no modifica la config');
});

test('errores de uso: flag desconocido y --check+--force juntos salen 1 sin escribir', () => {
  const s = sandbox(TEMPLATE_TEXT);
  const desconocido = run(s.cli, ['--wat']);
  eq(desconocido.status, 1, 'flag desconocido → 1');
  const choca = run(s.cli, ['--check', '--force']);
  eq(choca.status, 1, '--check y --force son excluyentes → 1');
  assert(!existsSync(s.target), 'ningún error de uso escribe el destino');
});

test('--help sale 0 e imprime el uso por stdout', () => {
  const s = sandbox(TEMPLATE_TEXT);
  const r = run(s.cli, ['--help']);
  eq(r.status, 0, '--help exit 0');
  match(r.out, /Uso:/, 'imprime el uso');
});

await runAll();
