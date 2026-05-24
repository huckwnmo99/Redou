import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "../..");
const DEFAULT_PROJECT_ID = "redou_golden_path_test";
const DEFAULT_PORT_BASE = 55420;
const DEFAULT_TARGET_ROOT = path.join(os.tmpdir(), "redou-golden-path-supabase");
const START_EXCLUDE_SERVICES = [
  "realtime",
  "storage-api",
  "imgproxy",
  "mailpit",
  "postgres-meta",
  "studio",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
];

export function getDisposableSupabasePorts(basePort = DEFAULT_PORT_BASE) {
  return {
    shadow: basePort,
    api: basePort + 1,
    db: basePort + 2,
    studio: basePort + 3,
    inbucket: basePort + 4,
    analytics: basePort + 7,
    inspector: basePort + 8,
    pooler: basePort + 9,
  };
}

export function getDisposableSupabaseStartExcludes() {
  return START_EXCLUDE_SERVICES.join(",");
}

export function buildDisposableSupabaseConfig({
  sourceConfig,
  projectId = DEFAULT_PROJECT_ID,
  ports = getDisposableSupabasePorts(),
}) {
  let section = "";
  const lines = sourceConfig.split(/\r?\n/).map((line) => {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      return line;
    }

    if (/^\s*project_id\s*=/.test(line)) {
      return `project_id = "${projectId}"`;
    }
    if (section === "api" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.api}`;
    }
    if (section === "db" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.db}`;
    }
    if (section === "db" && /^\s*shadow_port\s*=/.test(line)) {
      return `shadow_port = ${ports.shadow}`;
    }
    if (section === "db.pooler" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.pooler}`;
    }
    if (section === "db.seed" && /^\s*enabled\s*=/.test(line)) {
      return "enabled = false";
    }
    if (section === "db.seed" && /^\s*sql_paths\s*=/.test(line)) {
      return "sql_paths = []";
    }
    if (section === "studio" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.studio}`;
    }
    if (section === "studio" && /^\s*api_url\s*=/.test(line)) {
      return `api_url = "http://127.0.0.1:${ports.api}"`;
    }
    if (section === "inbucket" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.inbucket}`;
    }
    if (section === "auth" && /^\s*site_url\s*=/.test(line)) {
      return `site_url = "http://127.0.0.1:${ports.api}"`;
    }
    if (section === "auth" && /^\s*additional_redirect_urls\s*=/.test(line)) {
      return `additional_redirect_urls = ["http://127.0.0.1:${ports.api}"]`;
    }
    if (section === "auth.external.google" && /^\s*enabled\s*=/.test(line)) {
      return "enabled = false";
    }
    if (section === "auth.external.google" && /^\s*client_id\s*=/.test(line)) {
      return 'client_id = ""';
    }
    if (section === "auth.external.google" && /^\s*secret\s*=/.test(line)) {
      return 'secret = ""';
    }
    if (section === "edge_runtime" && /^\s*inspector_port\s*=/.test(line)) {
      return `inspector_port = ${ports.inspector}`;
    }
    if (section === "analytics" && /^\s*port\s*=/.test(line)) {
      return `port = ${ports.analytics}`;
    }
    return line;
  });

  return `${lines.join("\n").replace(/\r/g, "")}\n`;
}

export function parseSupabaseStatusEnv(output) {
  const env = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function ensureSafeTargetRoot(targetRoot) {
  const resolved = path.resolve(targetRoot);
  const tempRoot = path.resolve(os.tmpdir());
  const lowerResolved = resolved.toLowerCase();
  const lowerTemp = tempRoot.toLowerCase();

  if (!lowerResolved.startsWith(`${lowerTemp.toLowerCase()}${path.sep}`)) {
    throw new Error(`Refusing to manage Supabase test workdir outside temp directory: ${resolved}`);
  }
  if (!path.basename(resolved).toLowerCase().includes("redou")) {
    throw new Error(`Refusing to manage suspicious Supabase test workdir: ${resolved}`);
  }
  if (lowerResolved.includes(`${path.sep.toLowerCase()}v3${path.sep.toLowerCase()}`)) {
    throw new Error(`Refusing to manage repository workdir as disposable target: ${resolved}`);
  }

  return resolved;
}

async function prepareDisposableProject({
  repoRoot = REPO_ROOT,
  targetRoot = DEFAULT_TARGET_ROOT,
  projectId = DEFAULT_PROJECT_ID,
  portBase = DEFAULT_PORT_BASE,
} = {}) {
  const safeTargetRoot = ensureSafeTargetRoot(targetRoot);
  const targetSupabaseDir = path.join(safeTargetRoot, "supabase");
  const sourceSupabaseDir = path.join(repoRoot, "supabase");
  const ports = getDisposableSupabasePorts(portBase);

  if (existsSync(safeTargetRoot)) {
    await rm(safeTargetRoot, { recursive: true, force: true });
  }
  await mkdir(path.join(targetSupabaseDir, "migrations"), { recursive: true });

  await cp(
    path.join(sourceSupabaseDir, "migrations"),
    path.join(targetSupabaseDir, "migrations"),
    { recursive: true },
  );
  await writeFile(path.join(targetSupabaseDir, "seed.sql"), "", "utf8");

  const sourceConfig = await readFile(path.join(sourceSupabaseDir, "config.toml"), "utf8");
  const testConfig = buildDisposableSupabaseConfig({ sourceConfig, projectId, ports });
  await writeFile(path.join(targetSupabaseDir, "config.toml"), testConfig, "utf8");

  return {
    ports,
    projectId,
    targetRoot: safeTargetRoot,
    targetSupabaseDir,
    workdir: safeTargetRoot,
  };
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  console.log(`[golden-path] ${printable}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? DESKTOP_ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    const stdout = result.stdout ? `\n${result.stdout}` : "";
    throw new Error(`${printable} failed with exit code ${result.status}${stdout}${stderr}`);
  }
  return result;
}

function runNpmIntegration(env) {
  if (process.platform === "win32") {
    run("cmd", ["/c", "npm", "run", "test:integration"], { cwd: DESKTOP_ROOT, env });
  } else {
    run("npm", ["run", "test:integration"], { cwd: DESKTOP_ROOT, env });
  }
}

export async function runGoldenPathSupabaseIntegration({
  keep = false,
  targetRoot = process.env.REDOU_TEST_SUPABASE_WORKDIR || DEFAULT_TARGET_ROOT,
  portBase = Number(process.env.REDOU_TEST_SUPABASE_PORT_BASE || DEFAULT_PORT_BASE),
  projectId = process.env.REDOU_TEST_SUPABASE_PROJECT_ID || DEFAULT_PROJECT_ID,
} = {}) {
  const project = await prepareDisposableProject({ targetRoot, portBase, projectId });
  let started = false;

  try {
    run("supabase", [
      "start",
      "--workdir",
      project.workdir,
      "-x",
      getDisposableSupabaseStartExcludes(),
    ]);
    started = true;

    run("supabase", [
      "db",
      "reset",
      "--workdir",
      project.workdir,
      "--local",
      "--no-seed",
      "--yes",
    ]);

    const status = run("supabase", [
      "status",
      "--workdir",
      project.workdir,
      "-o",
      "env",
    ], { capture: true });
    const supabaseEnv = parseSupabaseStatusEnv(`${status.stdout}\n${status.stderr}`);
    if (!supabaseEnv.API_URL || !supabaseEnv.SERVICE_ROLE_KEY) {
      throw new Error("Unable to read API_URL and SERVICE_ROLE_KEY from Supabase status output");
    }

    runNpmIntegration({
      ...process.env,
      REDOU_TEST_SUPABASE_URL: supabaseEnv.API_URL,
      REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY: supabaseEnv.SERVICE_ROLE_KEY,
      REDOU_TEST_SCHEMA_PROVENANCE: "migrations",
    });
  } finally {
    if (started && !keep) {
      try {
        run("supabase", [
          "stop",
          "--workdir",
          project.workdir,
          "--no-backup",
        ]);
      } catch (err) {
        console.warn(`[golden-path] failed to stop disposable Supabase target: ${err.message}`);
      }
    } else if (keep) {
      console.log(`[golden-path] keeping disposable Supabase target at ${project.workdir}`);
    }
  }
}

function parseArgs(argv) {
  return {
    keep: argv.includes("--keep"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = parseArgs(process.argv.slice(2));
  runGoldenPathSupabaseIntegration(args).catch((err) => {
    console.error(`[golden-path] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
