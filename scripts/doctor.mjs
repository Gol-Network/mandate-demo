/**
 * Checks `.env.local` and resolves the GOL project ID from the API key.
 *
 *   pnpm doctor
 *   pnpm doctor --write     also writes GOL_PROJECT_ID back into .env.local
 *
 * The project ID is the project's UUID, not the on-chain form. The SDK's
 * `contractProjectId` packs it into 32 bytes for the mandate terms, but the
 * platform does that itself, so the demo only ever needs the UUID.
 *
 * Nothing secret is printed. The key is read from the file, used in a request
 * header, and never echoed. Only the last four characters of the key hint are
 * shown, because that is what the platform itself returns.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))));
const ENV_PATH = join(ROOT, ".env.local");
const write = process.argv.includes("--write");

/** Minimal KEY=VALUE reader. Handles quotes, `#` comments, and blank lines. */
function parseEnv(contents) {
  const values = {};
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const REQUIRED = [
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "GOL_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "AGENT_PRIVATE_KEY",
];
const OPTIONAL_OK_EMPTY = [
  "GOL_PROJECT_ID",
  "GOL_API_BASE_URL",
  "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
];

if (!existsSync(ENV_PATH)) {
  console.error(".env.local not found. Create it with: cp .env.example .env.local");
  process.exit(1);
}

const env = parseEnv(readFileSync(ENV_PATH, "utf8"));

const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error("Missing or empty in .env.local:");
  for (const key of missing) console.error(`  ${key}`);
  console.error("");
  // The spike and the agent need different things, and saying so is more useful
  // than implying the first N of an arbitrary list.
  const spikeOnly = [
    "NEXT_PUBLIC_PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "GOL_API_KEY",
    "GOL_PROJECT_ID",
  ];
  const stillNeededForSpike = spikeOnly.filter(
    (key) => !env[key] || missing.includes(key),
  );
  if (stillNeededForSpike.length > 0) {
    console.error("The Privy signing test needs only these four:");
    for (const key of stillNeededForSpike) console.error(`  ${key}`);
    console.error("");
  }
  console.error("The OpenAI pair is only needed for the agent, not the spike.");
  process.exit(1);
}

console.log(".env.local looks complete.");
for (const key of OPTIONAL_OK_EMPTY) {
  console.log(`  ${env[key] ? key : `${key} (blank, using the default)`}`);
}

// The project ID is the one value we can resolve without asking.
const baseUrl = env.GOL_API_BASE_URL || "https://api.gol.network";
const headers = { accept: "application/json", authorization: `Bearer ${env.GOL_API_KEY}` };

async function call(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error;
    throw new Error(
      `${path} returned ${response.status}: ${detail?.message ?? detail?.code ?? "unknown"}`,
    );
  }
  return body;
}

let identity;
try {
  identity = await call("/v1/whoami");
} catch (error) {
  console.error("");
  console.error(`GOL_API_KEY was rejected. ${error.message}`);
  console.error("Check that it is a gol_test_ key with the scopes the demo needs:");
  console.error("  project:read accounts:read mandates:read mandates:write actions:submit");
  process.exit(1);
}

const { project, environment, apiKey } = identity;
console.log("");
console.log("GOL key accepted.");
console.log(`  project name   ${project.name}`);
console.log(`  project slug   ${project.slug}`);
console.log(`  environment    ${environment}`);
console.log(`  key hint       ...${apiKey.hint ?? "n/a"}`);
console.log(`  scopes         ${(apiKey.scopes ?? []).join(" ")}`);
console.log("");

if (!String(environment).startsWith("test")) {
  console.error(`This is a ${environment} key. Hosted gas needs a test key;`);
  console.error("a live key is refused with capability_unavailable.");
  process.exit(1);
}

const projectId = project.id;
if (env.GOL_PROJECT_ID && env.GOL_PROJECT_ID !== projectId) {
  console.error(`GOL_PROJECT_ID is set to ${env.GOL_PROJECT_ID} but the key belongs to`);
  console.error(`project ${projectId}. Those disagree, so requests would fail.`);
  process.exit(1);
}

if (!env.GOL_PROJECT_ID) {
  if (write) {
    const contents = readFileSync(ENV_PATH, "utf8");
    const updated = /^GOL_PROJECT_ID=/m.test(contents)
      ? contents.replace(/^GOL_PROJECT_ID=.*$/m, `GOL_PROJECT_ID=${projectId}`)
      : contents.replace(
          /^GOL_API_KEY=.*$/m,
          (line) => `${line}\nGOL_PROJECT_ID=${projectId}`,
        );
    writeFileSync(ENV_PATH, updated);
    console.log(`Wrote GOL_PROJECT_ID=${projectId} to .env.local.`);
  } else {
    console.log(`GOL_PROJECT_ID is not set. Add this line to .env.local:`);
    console.log("");
    console.log(`GOL_PROJECT_ID=${projectId}`);
    console.log("");
    console.log("Or re-run with --write and it will be filled in for you.");
  }
} else {
  console.log(`GOL_PROJECT_ID is set and matches the key.`);
}

// Confirm the hosted gas surface this demo depends on is actually reachable.
try {
  const configuration = await call(`/v1/projects/${projectId}/gas-configuration`);
  console.log("");
  console.log("Hosted gas is reachable for this project.");
  console.log(`  core            ${configuration.core}`);
  console.log(`  asset           ${configuration.asset.symbol} ${configuration.asset.address}`);
  console.log(`  relayer         ${configuration.relayer}`);
  console.log(`  delegate        ${configuration.eip7702.delegate}`);
  console.log(
    `  sponsorship     ${configuration.eip7702.sponsorship.available}, ` +
      `${configuration.eip7702.sponsorship.perProjectDailyLimit} per day`,
  );
  console.log(`  maxPerActionWei ${configuration.limits.maxPerActionWei}`);
} catch (error) {
  console.error("");
  console.error(`The key authenticated, but the gas configuration was refused.`);
  console.error(`  ${error.message}`);
  console.error("  The key most likely needs the project:read scope.");
  process.exit(1);
}

console.log("");
console.log("Ready. Start the dev server with: pnpm dev");
