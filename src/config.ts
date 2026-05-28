import {
  DEFAULT_AUDIT_STREAM_PATH,
  type ObserverConfig,
} from "./index.js";

/** Env-variable prefix for all Observer configuration knobs. */
export const ENV_PREFIX = "POSTERIA_OBSERVER_";

type KnobType = "string" | "boolean" | "object";

interface KnobDef {
  key: keyof ObserverConfig;
  type: KnobType;
  env: string;
  cliFlag: string;
}

const KNOBS: readonly KnobDef[] = [
  {
    key: "audit_stream_path",
    type: "string",
    env: `${ENV_PREFIX}AUDIT_STREAM_PATH`,
    cliFlag: "--audit-stream-path",
  },
  {
    key: "enable_anon_telemetry",
    type: "boolean",
    env: `${ENV_PREFIX}ENABLE_ANON_TELEMETRY`,
    cliFlag: "--enable-anon-telemetry",
  },
  {
    key: "host_metadata",
    type: "object",
    env: `${ENV_PREFIX}HOST_METADATA`,
    cliFlag: "--host-metadata",
  },
];

const KNOWN_KEYS: ReadonlySet<string> = new Set(KNOBS.map((k) => k.key));

export interface ConfigSources {
  /** Programmatic constructor options (lowest precedence). */
  programmatic?: Partial<ObserverConfig> & Record<string, unknown>;
  /** Environment bag; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** CLI argument vector (already sliced past node + script); defaults to `process.argv.slice(2)`. */
  argv?: string[];
  /** Warning sink; defaults to writing a line to stderr. */
  warn?: (message: string) => void;
}

function freshDefaults(): ObserverConfig {
  return {
    audit_stream_path: DEFAULT_AUDIT_STREAM_PATH,
    enable_anon_telemetry: false,
    host_metadata: {},
  };
}

function parseBoolean(
  raw: string,
  source: string,
  warn: (m: string) => void,
): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  warn(
    `[posteria-observer] ignoring ${source}: expected "true" or "false", got ${JSON.stringify(raw)}`,
  );
  return undefined;
}

function parseObject(
  raw: string,
  source: string,
  warn: (m: string) => void,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(`[posteria-observer] ignoring ${source}: expected valid JSON`);
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    warn(`[posteria-observer] ignoring ${source}: expected a JSON object`);
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function assignParsed(
  config: ObserverConfig,
  knob: KnobDef,
  raw: string,
  source: string,
  warn: (m: string) => void,
): void {
  if (knob.type === "string") {
    config[knob.key] = raw as never;
    return;
  }
  if (knob.type === "boolean") {
    const value = parseBoolean(raw, source, warn);
    if (value !== undefined) config[knob.key] = value as never;
    return;
  }
  const value = parseObject(raw, source, warn);
  if (value !== undefined) config[knob.key] = value as never;
}

function applyProgrammatic(
  config: ObserverConfig,
  programmatic: Record<string, unknown>,
  warn: (m: string) => void,
): void {
  for (const [key, value] of Object.entries(programmatic)) {
    if (!KNOWN_KEYS.has(key)) {
      warn(`[posteria-observer] unknown configuration key: ${JSON.stringify(key)}`);
      continue;
    }
    if (value !== undefined) config[key as keyof ObserverConfig] = value as never;
  }
}

function applyEnv(
  config: ObserverConfig,
  env: Record<string, string | undefined>,
  warn: (m: string) => void,
): void {
  for (const knob of KNOBS) {
    const raw = env[knob.env];
    if (raw !== undefined) {
      assignParsed(config, knob, raw, `env ${knob.env}`, warn);
    }
  }
  for (const name of Object.keys(env)) {
    if (!name.startsWith(ENV_PREFIX)) continue;
    if (KNOBS.some((knob) => knob.env === name)) continue;
    warn(`[posteria-observer] unknown configuration key: ${JSON.stringify(name)}`);
  }
}

function applyCli(
  config: ObserverConfig,
  argv: string[],
  warn: (m: string) => void,
): void {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const knob = KNOBS.find((k) => k.cliFlag === name);
    if (knob === undefined) continue;

    if (eq !== -1) {
      assignParsed(config, knob, token.slice(eq + 1), `flag ${name}`, warn);
      continue;
    }
    if (knob.type === "boolean") {
      config[knob.key] = true as never;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      warn(`[posteria-observer] ignoring flag ${name}: missing value`);
      continue;
    }
    assignParsed(config, knob, next, `flag ${name}`, warn);
    i++;
  }
}

/**
 * Resolve effective configuration from the three contract sources with
 * later-wins precedence: programmatic options < POSTERIA_OBSERVER_* env <
 * CLI flags. Unknown keys warn but never abort. The returned object is frozen.
 */
export function resolveConfig(
  sources: ConfigSources = {},
): Readonly<ObserverConfig> {
  const warn =
    sources.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  const env = sources.env ?? process.env;
  const argv = sources.argv ?? process.argv.slice(2);
  const programmatic = sources.programmatic ?? {};

  const config = freshDefaults();
  applyProgrammatic(config, programmatic, warn);
  applyEnv(config, env, warn);
  applyCli(config, argv, warn);

  return Object.freeze(config);
}
