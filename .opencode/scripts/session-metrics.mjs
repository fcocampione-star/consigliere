#!/usr/bin/env node
/**
 * Consigliere 1.0 (Advisor Harness) — session-metrics.mjs
 * Metricas de una sesion REAL de opencode: delegaciones por agente, iteraciones
 * y tokens. SOLO LECTURA: no escribe memoria ni disco y NUNCA persiste la
 * transcripcion (se parsea en memoria y se descarta).
 *
 * Fuentes:
 *   --from <export.json>   export ya volcado en disco (offline, determinista)
 *   --session <ses_id>     ejecuta el binario opencode y lee su export
 *                          (`export <id> --sanitize`, con fallback a
 *                           `session export <id> --sanitize` de la CLI v2)
 *                          `--no-sanitize` omite el redactado: la CLI v2 tapa
 *                          los inputs de las herramientas y entonces el agente
 *                          de cada delegacion sale como `unknown`.
 *
 * Binario: `ADVISOR_OPENCODE` -> PATH (con PATHEXT en win32). Sin binario se
 * sale con DEPENDENCIA (3) y se sugiere `--from`. La resolucion se memoiza y
 * NUNCA se usa `shell: true`.
 *
 * Formas de export aceptadas (tolerante: jamas lanza por una parte rara):
 *   v1  { info, messages: [ { info: { role, tokens }, parts: [...] } ] }
 *   v2  { info, messages: [ { type, agent, tokens, content: [...] } ] }
 * Partes: `parts` o `content`; se aceptan como herramienta `type` igual a
 * `tool`, `tool-invocation`, `tool_call`/`tool-call`/`toolCall` o cualquier
 * `tool*` que no sea result/output. Delegacion = herramienta `task` (v1) o
 * `subagent` (v2); agente = `state.input.subagent_type ?? .agent ?? .subagent`.
 *
 * Tokens: suma de `tokens` por mensaje de asistente (forma canonica). Si
 * NINGUN mensaje trae usage se usa el `info.tokens` de la sesion (la CLI v2 ya
 * no emite usage por mensaje) y se marca `source: 'session'`; si tampoco hay,
 * `{ available: false }` — nunca ceros fingidos.
 *
 * Uso:
 *   node .opencode/scripts/session-metrics.mjs --from <export.json> [--json]
 *   node .opencode/scripts/session-metrics.mjs --session <ses_id> [--json]
 *   node .opencode/scripts/session-metrics.mjs analyze --from <export.json> [--json]
 *
 * Exit: 0 ok · 1 uso/entrada invalida · 3 falta el binario opencode · 5 export
 * no parseable (truncado/parcial).
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { EXIT_CODES, exitUsage, fail, isMain, readText } from './lib/core.mjs';

// ── Constantes (exportadas para los tests) ───────────────────────────────────

/** Version del contrato de salida JSON. */
export const SCHEMA = 1;
/** Ids de sesion de opencode: `ses_` + 10..64 alfanumericos. */
export const SESSION_ID_RE = /^ses_[A-Za-z0-9]{10,64}$/;
/** Nombres de herramienta que representan una delegacion a un subagente. */
export const DELEGATION_TOOLS = Object.freeze(['task', 'subagent']);
const DELEGATION_SET = new Set(DELEGATION_TOOLS);
const TOOL_PART_TYPES = new Set(['tool', 'tool-invocation', 'tool_call', 'tool-call', 'toolCall']);
const MAX_BUFFER = 32 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 120000;

const USO = `Uso:
  node .opencode/scripts/session-metrics.mjs --from <export.json> [--json]
  node .opencode/scripts/session-metrics.mjs --session <ses_id> [--no-sanitize] [--json]
  node .opencode/scripts/session-metrics.mjs analyze --from <export.json> [--json]

  --from <archivo>   export de sesion ya volcado a disco (offline)
  --session <id>     ejecuta opencode y mide la sesion (binario: ADVISOR_OPENCODE o PATH)
  --no-sanitize      export sin redactar (necesario para ver el agente en la CLI v2;
                     la transcripcion se cuenta en memoria y NO se persiste)
  --json             salida maquina (schema ${SCHEMA})
  --help, -h         esta ayuda

Exit: 0 ok, 1 uso/entrada invalida, 3 falta el binario opencode, 5 export no parseable.`;

// ── Primitivas tolerantes (nunca lanzan) ─────────────────────────────────────

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Numero no negativo; acepta strings numericos y degrada a 0. */
function asNumber(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

/** `info` del mensaje en v1; el propio mensaje en v2 (que es plano). */
function messageInfo(message) {
  if (!isObject(message)) return {};
  return isObject(message.info) ? message.info : message;
}

/** Partes del mensaje: `parts` (v1) o `content` (v2). */
function messageParts(message) {
  if (!isObject(message)) return [];
  const info = messageInfo(message);
  for (const candidate of [message.parts, info.parts, message.content, info.content]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function messageRole(message) {
  const info = messageInfo(message);
  const role = typeof info.role === 'string' ? info.role : info.type;
  return typeof role === 'string' ? role.toLowerCase() : '';
}

/** Normaliza un objeto `tokens`; `null` si no hay usage declarado. */
function normalizeTokens(raw) {
  if (!isObject(raw)) return null;
  const cache = isObject(raw.cache) ? raw.cache : {};
  return {
    input: asNumber(raw.input),
    output: asNumber(raw.output),
    reasoning: asNumber(raw.reasoning),
    cache: { read: asNumber(cache.read), write: asNumber(cache.write) },
  };
}

function messageTokens(message) {
  const info = messageInfo(message);
  if (isObject(info.tokens)) return normalizeTokens(info.tokens);
  return isObject(message) ? normalizeTokens(message.tokens) : null;
}

function totalOf(tokens) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function partIsTool(part) {
  if (!isObject(part) || typeof part.type !== 'string') return false;
  if (TOOL_PART_TYPES.has(part.type)) return true;
  return part.type.startsWith('tool') && !/(result|output)$/i.test(part.type);
}

function partToolName(part) {
  for (const key of ['tool', 'toolName', 'name']) {
    const value = part[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function partInput(part) {
  for (const candidate of [part.state?.input, part.input, part.args]) {
    if (isObject(candidate)) return candidate;
  }
  return {};
}

/** Primer string no vacio de `input` (subagent_type -> agent -> subagent). */
function delegationAgent(input) {
  for (const key of ['subagent_type', 'agent', 'subagent']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unknown';
}

// ── Extraccion ───────────────────────────────────────────────────────────────

/**
 * Metricas de un export ya parseado. Puro y tolerante: devuelve lo que pueda
 * (cero delegaciones, `tokens.available:false`) en vez de lanzar.
 */
export function analyzeExport(data, source = { kind: 'memory', ref: null }) {
  const info = isObject(data?.info) ? data.info : (isObject(data?.session) ? data.session : {});
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  const counts = new Map();
  const bytes = new Map();
  const order = [];
  const usage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
  let usageMessages = 0;

  for (const message of messages) {
    const role = messageRole(message);
    if (role === '' || role === 'assistant') {
      const tokens = messageTokens(message);
      if (tokens) {
        usageMessages++;
        usage.input += tokens.input;
        usage.output += tokens.output;
        usage.reasoning += tokens.reasoning;
        usage.cache.read += tokens.cache.read;
        usage.cache.write += tokens.cache.write;
      }
    }
    for (const part of messageParts(message)) {
      if (!partIsTool(part)) continue;
      if (!DELEGATION_SET.has(partToolName(part))) continue;
      const input = partInput(part);
      const agent = delegationAgent(input);
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      counts.set(agent, (counts.get(agent) || 0) + 1);
      bytes.set(agent, (bytes.get(agent) || 0) + Buffer.byteLength(prompt, 'utf8'));
      order.push(agent);
    }
  }

  const delegations = {};
  const bytesByAgent = {};
  let totalBytes = 0;
  for (const [agent, count] of counts) {
    delegations[agent] = count;
    bytesByAgent[agent] = bytes.get(agent) || 0;
    totalBytes += bytesByAgent[agent];
  }

  const pairs = {};
  for (let i = 0; i + 1 < order.length; i++) {
    const key = `${order[i]}->${order[i + 1]}`;
    pairs[key] = (pairs[key] || 0) + 1;
  }

  let tokens;
  if (usageMessages > 0) {
    tokens = { available: true, source: 'messages', ...usage, total: totalOf(usage) };
  } else {
    const sessionTokens = normalizeTokens(info.tokens);
    tokens = sessionTokens
      ? { available: true, source: 'session', ...sessionTokens, total: totalOf(sessionTokens) }
      : { available: false };
  }

  return {
    schema: SCHEMA,
    source: { kind: String(source?.kind ?? 'memory'), ref: source?.ref ?? null },
    session: {
      id: typeof info.id === 'string' ? info.id : null,
      title: typeof info.title === 'string' ? info.title : null,
    },
    delegations,
    iterations: { total: order.length, pairs },
    prompts: { bytesByAgent, totalBytes },
    tokens,
    messages: messages.length,
  };
}

// ── Resolucion del binario opencode ──────────────────────────────────────────

let opencodeBin;
let opencodeResolved = false;

/**
 * Ruta del binario opencode: `ADVISOR_OPENCODE` (override explicito) -> PATH
 * (con PATHEXT en win32). Memoizada; `null` si no aparece.
 */
export function resolveOpencode() {
  if (opencodeResolved) return opencodeBin;
  opencodeResolved = true;
  const override = (process.env.ADVISOR_OPENCODE || '').trim();
  if (override) {
    opencodeBin = override;
    return opencodeBin;
  }
  // En win32 el ejecutable del PATH casi nunca lleva extension implicita: hay
  // que probar cada PATHEXT (opencode.cmd/opencode.exe).
  const exts = process.platform === 'win32'
    ? ['', ...String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  for (const dir of String(process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `opencode${ext}`);
      if (!existsSync(candidate)) continue;
      try { accessSync(candidate, constants.X_OK); } catch { continue; }
      opencodeBin = candidate;
      return opencodeBin;
    }
  }
  opencodeBin = null;
  return null;
}

// ── Fuente remota (CLI) ──────────────────────────────────────────────────────

const CONSEJO_FROM = (bin, id) => `Consejo: exporta a un archivo y usa --from:
  ${bin} session export ${id} --sanitize > f.json
  node .opencode/scripts/session-metrics.mjs --from f.json`;

/** ¿Tiene forma de export de sesión? v1/v2: objeto con `messages[]` o `info` objeto. */
function looksLikeExport(data) {
  return isObject(data) && (Array.isArray(data.messages) || isObject(data.info));
}

/**
 * Export de una sesion via CLI. Intenta la forma historica (`export`) y la de
 * la CLI v2 (`session export`); devuelve el primer JSON que parezca un export.
 * Sin binario -> exit 3; sin JSON parseable (truncacion en pipe) -> exit 5.
 */
export function exportSession(id, { sanitize = true } = {}) {
  const bin = resolveOpencode();
  if (!bin) {
    fail(
      'session-metrics',
      `no se encontro el binario "opencode" (ni ADVISOR_OPENCODE ni en PATH).\n${CONSEJO_FROM('opencode', id)}`,
      EXIT_CODES.DEPENDENCIA,
    );
  }
  const flags = sanitize ? ['--sanitize'] : [];
  const candidates = [
    ['export', id, ...flags],
    ['session', 'export', id, ...flags],
  ];
  let why = 'sin salida';
  for (const args of candidates) {
    const res = spawnSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: EXPORT_TIMEOUT_MS,
      shell: false,
      windowsHide: true,
    });
    if (res.error && res.error.code === 'ENOENT') {
      fail('session-metrics', `no se pudo ejecutar "${bin}": ${res.error.message}`, EXIT_CODES.DEPENDENCIA);
    }
    if (res.error) {
      why = `"${bin} ${args[0]}" fallo: ${res.error.message}`;
      continue;
    }
    const out = typeof res.stdout === 'string' ? res.stdout.trim() : '';
    if (!out) {
      const stderr = typeof res.stderr === 'string' ? res.stderr.trim().split('\n')[0] : '';
      why = `"${bin} ${args.join(' ')}" no devolvio JSON (exit ${res.status})${stderr ? `: ${stderr}` : ''}`;
      continue;
    }
    try {
      const data = JSON.parse(out);
      if (looksLikeExport(data)) return data;
      why = 'la salida no parece un export de sesion (se esperaba un objeto con "info"/"messages")';
    } catch (e) {
      why = `el export no es JSON parseable (truncado en el pipe?): ${e.message}`;
    }
  }
  if (/not found|no such|does not exist|unknown session/i.test(why)) {
    fail('session-metrics', `no se pudo exportar la sesion "${id}": ${why}`, EXIT_CODES.USO);
  }
  fail('session-metrics', `no se pudo obtener un export JSON de "${id}": ${why}\n${CONSEJO_FROM(bin, id)}`, EXIT_CODES.PARCIAL);
}

/** JSON a objeto de export; entrada invalida -> exit 5 (export parcial). */
function parsePayload(text, label) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail('session-metrics', `"${label}" no es JSON valido (truncado?): ${e.message}`, EXIT_CODES.PARCIAL);
  }
  if (!looksLikeExport(data)) {
    fail('session-metrics', `"${label}" no tiene forma de export de sesion (se esperaba un objeto con "info"/"messages")`, EXIT_CODES.PARCIAL);
  }
  return data;
}

// ── Salida de texto ──────────────────────────────────────────────────────────

function printReport(report) {
  const { source, session, delegations, iterations, prompts, tokens } = report;
  const agents = Object.keys(delegations);
  console.log(`session-metrics - fuente: ${source.kind}${source.ref ? ` (${source.ref})` : ''}`);
  console.log(`sesion: ${session.id ?? '(sin id)'}${session.title ? ` "${session.title}"` : ''} (${report.messages} mensajes)`);

  const rows = agents.map((agent) => [agent, String(delegations[agent]), String(prompts.bytesByAgent[agent] ?? 0)]);
  rows.push(['TOTAL', String(iterations.total), String(prompts.totalBytes)]);
  const head = ['agente', 'deleg.', 'prompt (B)'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  console.log(head.map((h, i) => h.padEnd(widths[i])).join('  ').trimEnd());
  for (const row of rows) {
    console.log(
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
        .join('  ')
        .trimEnd(),
    );
  }
  if (agents.length === 0) console.log('(sin delegaciones)');
  if (agents.length === 1 && agents[0] === 'unknown' && source.kind === 'session') {
    console.log('nota: --sanitize redacta los inputs; repite con --no-sanitize para medir los agentes (no persiste la transcripcion)');
  }

  const pairText = Object.entries(iterations.pairs).map(([key, count]) => `${key} ${count}`).join(', ');
  console.log(`iteraciones: ${iterations.total}${pairText ? ` (pares: ${pairText})` : ''}`);

  if (!tokens.available) {
    console.log('tokens: N/A (el export no incluye usage)');
    return;
  }
  const origen = tokens.source === 'session' ? 'uso de sesion; sin usage por mensaje' : 'suma de mensajes';
  console.log(
    `tokens: input ${tokens.input}, output ${tokens.output}, reasoning ${tokens.reasoning}, ` +
      `cache read ${tokens.cache.read}, cache write ${tokens.cache.write}, total ${tokens.total} (${origen})`,
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { help: false, json: false, from: null, session: null, sanitize: true };
  let i = 2;
  if (argv[i] === 'analyze') i++;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-sanitize') out.sanitize = false;
    else if (a === '--from' || a === '--session') {
      const value = argv[++i];
      if (value === undefined || value === '') exitUsage(`session-metrics: ${a} exige un valor\n${USO}`);
      if (a === '--from') out.from = value;
      else out.session = value;
    } else exitUsage(`session-metrics: argumento desconocido "${a}"\n${USO}`);
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  // `--help` por stdout y exit 0: pedir ayuda no es un error de uso.
  if (opts.help) {
    console.log(USO);
    return;
  }
  if (opts.from && opts.session) exitUsage(`session-metrics: --from y --session son excluyentes\n${USO}`);
  if (!opts.from && !opts.session) exitUsage(USO);

  let data;
  let source;
  if (opts.from) {
    const text = readText(opts.from, { fallback: null });
    if (text === null) fail('session-metrics', `no se pudo leer "${opts.from}" (no existe o no es un archivo legible)`, EXIT_CODES.USO);
    data = parsePayload(text, opts.from);
    source = { kind: 'file', ref: opts.from };
  } else {
    if (!SESSION_ID_RE.test(opts.session)) {
      fail('session-metrics', `id de sesion invalido "${opts.session}" (esperado ses_ + 10..64 alfanumericos)`, EXIT_CODES.USO);
    }
    data = exportSession(opts.session, { sanitize: opts.sanitize });
    source = { kind: 'session', ref: opts.session };
  }

  const report = analyzeExport(data, source);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

if (isMain(import.meta.url, process.argv[1])) main();
