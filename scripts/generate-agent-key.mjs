/**
 * Generates the agent's signing key, writes it to `.env.local`, and prints only
 * the derived address.
 *
 * The agent holds no funds, so this key is disposable. It is still a signing key
 * and must never be printed, pasted into chat, or committed, which is why the
 * key goes straight to the file and only the address reaches stdout.
 *
 *   node scripts/generate-agent-key.mjs
 *   node scripts/generate-agent-key.mjs --force   # replace an existing key
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENV_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env.local");
const ASSIGNMENT_LINE = /^AGENT_PRIVATE_KEY=/;
const GENERATED_COMMENT = "# The agent's signing key. Generated, never printed.";
const force = process.argv.includes("--force");

const readEnv = () => (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : null);

/**
 * The last non-empty `AGENT_PRIVATE_KEY` value in the file, or null.
 *
 * Last, not first: a freshly copied `.env.local` carries an empty placeholder
 * line, and reading the first match would always find that blank and miss a real
 * key written below it.
 */
function currentKey(contents) {
  if (contents === null) return null;
  let found = null;
  for (const line of contents.split("\n")) {
    if (!ASSIGNMENT_LINE.test(line)) continue;
    const value = line.slice("AGENT_PRIVATE_KEY=".length).trim();
    if (value !== "") found = value;
  }
  return found;
}

/**
 * Removes every existing assignment and the generated comment above it.
 *
 * Substitution is not enough. Replacing N matches with the assignment leaves N
 * lines all holding the same key, and which one a loader honours would then be
 * arbitrary. Removing them all and appending exactly one block converges the
 * file on a single key whatever state it was already in.
 */
function stripGenerated(contents) {
  return (
    contents
      .split("\n")
      .filter(
        (line) => !ASSIGNMENT_LINE.test(line) && line.trim() !== GENERATED_COMMENT,
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+$/, "") + "\n"
  );
}

const existing = currentKey(readEnv());

if (existing !== null && !force) {
  let address = "unreadable (malformed value)";
  try {
    address = privateKeyToAccount(
      existing.startsWith("0x") ? existing : `0x${existing}`,
    ).address;
  } catch {
    // Leave the placeholder text. Never echo the value back.
  }
  console.log(`AGENT_PRIVATE_KEY is already set in .env.local, address ${address}.`);
  console.log("Pass --force to replace it with a new key.");
  process.exit(0);
}

const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);

const base = stripGenerated(readEnv() ?? "");
writeFileSync(
  ENV_PATH,
  `${base}\n${GENERATED_COMMENT}\nAGENT_PRIVATE_KEY=${privateKey}\n`,
);

console.log("Wrote AGENT_PRIVATE_KEY to .env.local.");
console.log(`Agent address: ${address}`);
console.log("This key holds no funds. Fund the owner wallet, not this one.");
