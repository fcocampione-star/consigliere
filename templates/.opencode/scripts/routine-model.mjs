#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWED_AGENTS = ['advisor', 'planner', 'builder', 'verifier', 'critic', 'summarizer', 'explore'];
export const MODEL_RE = /^[A-Za-z0-9._:\/-]{1,80}$/;

export function validateAgent(agent) {
  return ALLOWED_AGENTS.includes(agent);
}

export function validateModel(model) {
  return MODEL_RE.test(model);
}

export function parseArgs(argv) {
  const overrides = {};
  let globalModel = null;
  let persist = false;
  let dryRun = false;
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--persist') {
      persist = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('--model-')) {
      let agent;
      let model;
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        agent = arg.slice('--model-'.length, eqIdx);
        model = arg.slice(eqIdx + 1);
      } else {
        agent = arg.slice('--model-'.length);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          errors.push(`Flag --model-${agent} requiere un valor`);
          continue;
        }
        model = next;
        i++;
      }
      if (!agent) {
        errors.push(`Flag --model- sin agente: ${arg}`);
        continue;
      }
      if (!validateAgent(agent)) {
        errors.push(`Agente no permitido: ${agent} (permitidos: ${ALLOWED_AGENTS.join(', ')})`);
        continue;
      }
      if (!model) {
        errors.push(`Modelo vacío para agente ${agent}`);
        continue;
      }
      if (!validateModel(model)) {
        errors.push(`Modelo inválido para ${agent}: "${model}" (regex ^[A-Za-z0-9._:/-]{1,80}$)`);
        continue;
      }
      overrides[agent] = model;
      continue;
    }
    if (arg.startsWith('--model=')) {
      const model = arg.slice('--model='.length);
      if (!model) {
        errors.push('Flag --model requiere un valor');
        continue;
      }
      if (!validateModel(model)) {
        errors.push(`Modelo global inválido: "${model}" (regex ^[A-Za-z0-9._:/-]{1,80}$)`);
        continue;
      }
      globalModel = model;
      continue;
    }
    if (arg === '--model') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        errors.push('Flag --model requiere un valor');
        continue;
      }
      if (!validateModel(next)) {
        errors.push(`Modelo global inválido: "${next}" (regex ^[A-Za-z0-9._:/-]{1,80}$)`);
        continue;
      }
      globalModel = next;
      i++;
      continue;
    }
  }

  return { globalModel, overrides, persist, dryRun, errors };
}

export function getEffectiveOverrides(parsed) {
  const effective = {};
  if (parsed.globalModel) {
    for (const agent of ALLOWED_AGENTS) {
      effective[agent] = parsed.globalModel;
    }
  }
  for (const [agent, model] of Object.entries(parsed.overrides)) {
    effective[agent] = model;
  }
  return effective;
}

export function mergeAtomically(configPath, effectiveOverrides) {
  const raw = readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  if (!config.agent || typeof config.agent !== 'object') config.agent = {};
  for (const [agent, model] of Object.entries(effectiveOverrides)) {
    if (!validateAgent(agent)) continue;
    if (!validateModel(model)) continue;
    const prev = config.agent[agent] && typeof config.agent[agent] === 'object' ? config.agent[agent] : {};
    config.agent[agent] = { ...prev, model };
  }
  const serialized = JSON.stringify(config, null, 2) + '\n';
  const tmp = configPath + '.tmp';
  writeFileSync(tmp, serialized, 'utf8');
  JSON.parse(readFileSync(tmp, 'utf8'));
  renameSync(tmp, configPath);
  return config;
}

function resolveConfigPath() {
  const ROOT = join(import.meta.dirname, '..', '..');
  const p1 = join(ROOT, 'opencode.json');
  if (existsSync(p1)) return p1;
  const p2 = join(ROOT, '.opencode', 'opencode.json');
  return p2;
}

function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
  const effective = getEffectiveOverrides(parsed);
  if (parsed.persist) {
    if (Object.keys(effective).length === 0) {
      console.error('❌ --persist requiere al menos un --model o --model-<agente>');
      process.exit(1);
    }
    const configPath = resolveConfigPath();
    if (parsed.dryRun) {
      console.log(`[dry-run] persist -> ${configPath}`);
      console.log(JSON.stringify(effective, null, 2));
      return;
    }
    try {
      mergeAtomically(configPath, effective);
      console.log(`✅ opencode.json actualizado: ${configPath}`);
      console.log(JSON.stringify(effective, null, 2));
    } catch (e) {
      console.error(`❌ persist falló: ${e.message}`);
      process.exit(1);
    }
  } else {
    if (Object.keys(effective).length === 0) {
      if (parsed.dryRun) {
        console.log('[dry-run] sin overrides');
      }
      return;
    }
    console.log(JSON.stringify(effective, null, 2));
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].slice(process.argv[1].lastIndexOf('/') + 1)) || process.argv[1]?.endsWith('routine-model.mjs')) {
  main();
}
