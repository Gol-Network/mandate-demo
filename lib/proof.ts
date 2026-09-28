/**
 * On-chain proof decoding, in the browser, over public Base Sepolia RPC.
 *
 * The point of this module is that the evidence does not depend on GOL. Every
 * fact shown here is read from a transaction receipt by viem, filtered to logs
 * emitted by the GOL core address that `getGasConfiguration` reported, and decoded
 * from the event ABI. GOL's API view is shown next to it so any disagreement is
 * visible rather than hidden.
 *
 * Client-safe: no server imports, no secrets.
 */
import type { Address, Hex, Log } from "viem";
import { decodeEventLog, formatUnits, parseAbi } from "viem";

/**
 * Refusal codes, copied from the contracts.
 *
 * Source: `contracts/src/libraries/RefusalCodes.sol` at the profile 4 source
 * commit `c60ce8c` (bundle source `76a30ee`). Treat any code not listed here as
 * unknown rather than guessing at its meaning.
 */
export const REFUSAL_CODES: Readonly<Record<number, string>> = Object.freeze({
  0: "none",
  // Mandate lifecycle and pre-dispatch. The core never charges for these.
  1: "mandate_unknown",
  2: "mandate_not_active",
  3: "mandate_not_started",
  4: "mandate_expired",
  5: "mandate_paused",
  6: "mandate_revoked",
  7: "root_revoked",
  8: "ancestor_not_active",
  9: "agent_not_authorized",
  10: "replay_detected",
  11: "request_expired",
  12: "execution_globally_paused",
  // Account integration.
  20: "account_integration_invalid",
  21: "account_profile_unsupported",
  22: "account_epoch_stale",
  23: "account_lane_unsupported",
  24: "full_control_not_supported",
  // Policy decoding.
  40: "unsupported_policy_version",
  41: "unsupported_rule",
  42: "malformed_policy",
  43: "malformed_request",
  44: "unsupported_action",
  45: "unsupported_schema_version",
  // Policy enforcement. Chargeable when the owner consented to bit 2.
  60: "action_not_allowed",
  61: "adapter_not_allowed",
  62: "target_not_allowed",
  63: "method_not_allowed",
  64: "asset_not_allowed",
  65: "recipient_not_allowed",
  66: "argument_not_allowed",
  67: "per_action_limit_exceeded",
  68: "budget_exceeded",
  69: "rate_limit_exceeded",
  70: "count_limit_exceeded",
  71: "native_value_not_allowed",
  72: "batch_limit_exceeded",
  // Owner operations.
  90: "owner_operation_not_allowed",
  91: "persistent_authority_not_allowed",
  92: "delegatecall_not_allowed",
  93: "self_call_not_allowed",
  // Reservation and delegation.
  110: "reservation_invalid",
  111: "delegation_depth_exceeded",
  112: "effect_mismatch",
});

/** Codes 1 to 24 are never charged to the owner, by design. */
export const isChargeableRefusal = (code: number): boolean => code >= 40;

export const refusalName = (code: number): string =>
  REFUSAL_CODES[code] ?? `unknown_refusal_${code}`;

/** The rule tag decoded to a name, where one is known. */
export const RULE_TAGS: Readonly<Record<number, string>> = Object.freeze({
  0x0010: "action_allowlist",
  0x0011: "capability_allowlist",
  0x0100: "asset_allowlist",
  0x0101: "asset_blocklist",
  0x0110: "recipient_allowlist",
  0x0111: "recipient_blocklist",
  0x0120: "target_allowlist",
  0x0121: "target_blocklist",
  0x0130: "selector_allowlist",
  0x0140: "native_value_limit",
  0x0200: "max_amount_per_action",
  0x0210: "lifetime_total",
  0x0220: "rolling_window",
  0x0230: "calendar_period",
});

export const ruleTagName = (tag: number): string =>
  RULE_TAGS[tag] ?? `unknown_rule_0x${tag.toString(16)}`;

/**
 * Event ABIs, from the contracts.
 * Source: `contracts/src/core/MandateCore.sol:111-170` and
 * `contracts/src/fees/GasReimbursement.sol:193-220`.
 * Only the fields this demo displays are declared; viem tolerates extra topics.
 */
const coreEvents = parseAbi([
  "event MandateActionExecuted(bytes32 indexed mandateId, bytes32 indexed rootId, address indexed agent, address indexed account, bytes32 actionId, uint32 actionTag, uint16 schemaVersion, uint8 mode, bytes32 effects, uint256 seq)",
  "event MandateActionRefused(bytes32 indexed mandateId, bytes32 indexed rootId, address indexed caller, address indexed account, bytes32 actionId, uint32 actionTag, uint8 mode, uint16 refusalCode, uint16 ruleTag, bytes32 refusingMandateId, uint256 attemptedValue, uint256 remainingHeadroom, uint16 policyVersion, uint256 seq)",
  "event MandatePaused(bytes32 indexed mandateId)",
  "event MandateResumed(bytes32 indexed mandateId)",
  "event MandateRevoked(bytes32 indexed mandateId)",
  "event MandateCreated(bytes32 indexed mandateId, address indexed account, address indexed agent)",
]);

const gasEvents = parseAbi([
  "event GasSettled(bytes32 indexed policyId, bytes32 indexed actionId, uint8 outcome, uint256 amountWei, uint256 paidWei)",
  "event GasPolicyCreated(bytes32 indexed policyId, bytes32 indexed mandateId, address indexed account)",
  "event GasPolicyRevoked(bytes32 indexed policyId)",
]);

/** ERC-20 Transfer, for the actual USDC movement. */
const erc20Events = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface DecodedEvent {
  name: string;
  args: Record<string, unknown>;
  /** Only for Transfer, to show the movement. */
  usdc?: string;
}

/** The USDC movement in a transaction, if any. */
export interface Movement {
  to: Address;
  amount: bigint;
  formatted: string;
  from: Address;
}

/** The proof for one transaction, assembled from its receipt. */
export interface TransactionProof {
  hash: Hex;
  /** True when the transaction was mined, whatever it decided. */
  mined: boolean;
  status: "success" | "reverted" | "unknown";
  blockNumber: bigint | null;
  /** Core events, decoded. */
  core: DecodedEvent[];
  /** Gas settlement events. */
  settlement: DecodedEvent[];
  /** Mandate owner controls, decoded. */
  controls: DecodedEvent[];
  /** USDC movements. */
  movements: Movement[];
  /** Convenience flags. */
  executed: boolean;
  refused: boolean;
  refusalCode: number | null;
  refusalName: string | null;
  ruleTag: number | null;
  ruleTagName: string | null;
  attemptedValue: bigint | null;
  remainingHeadroom: bigint | null;
  chargedWei: bigint | null;
  /** Where the fee for this transaction went. */
  settledOutcome: number | null;
}

const emptyProof = (hash: Hex): TransactionProof => ({
  hash,
  mined: false,
  status: "unknown",
  blockNumber: null,
  core: [],
  settlement: [],
  controls: [],
  movements: [],
  executed: false,
  refused: false,
  refusalCode: null,
  refusalName: null,
  ruleTag: null,
  ruleTagName: null,
  attemptedValue: null,
  remainingHeadroom: null,
  chargedWei: null,
  settledOutcome: null,
});

const sameAddress = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : false;

/**
 * viem types `args` loosely for a hand-written ABI string, so narrow it once here
 * rather than casting at every use.
 */
const argsOf = (event: { args?: unknown }): Record<string, unknown> =>
  (event.args ?? {}) as Record<string, unknown>;

const decodeAll = (logs: readonly Log[], abi: ReturnType<typeof parseAbi>, core: Address) => {
  const decoded: DecodedEvent[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, core)) continue;
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (!event.eventName) continue;
      decoded.push({ name: event.eventName, args: argsOf(event) });
    } catch {
      // An event this build does not know about is not an error. It is simply not
      // part of the proof shown here.
    }
  }
  return decoded;
};

/**
 * Builds the proof for one transaction from its receipt.
 *
 * `core` is the address from `getGasConfiguration`, so the filter is on the GOL
 * core itself rather than on anything the API said.
 */
export function buildProof(
  receipt: {
    transactionHash: Hex;
    status: "success" | "reverted";
    blockNumber: bigint | null;
    logs: readonly Log[];
  },
  options: { core: Address; usdc: Address; assetDecimals: number },
): TransactionProof {
  const proof = emptyProof(receipt.transactionHash);
  proof.mined = true;
  proof.status = receipt.status;
  proof.blockNumber = receipt.blockNumber;

  proof.core = decodeAll(receipt.logs, coreEvents, options.core);
  proof.settlement = decodeAll(receipt.logs, gasEvents, options.core);
  proof.controls = proof.core.filter((event) =>
    ["MandatePaused", "MandateResumed", "MandateRevoked", "MandateCreated"].includes(
      event.name,
    ),
  );
  // The action events are the ones the demo is about.
  proof.core = proof.core.filter(
    (event) => !proof.controls.includes(event),
  );

  for (const log of receipt.logs) {
    if (!sameAddress(log.address, options.usdc)) continue;
    try {
      const event = decodeEventLog({ abi: erc20Events, data: log.data, topics: log.topics });
      if (event.eventName !== "Transfer") continue;
      const args = argsOf(event);
      const from = args.from as Address;
      const to = args.to as Address;
      const value = args.value as bigint;
      if (value === 0n) continue;
      proof.movements.push({
        from,
        to,
        amount: value,
        formatted: `${formatUnits(value, options.assetDecimals)} USDC`,
      });
    } catch {
      // Not a USDC Transfer.
    }
  }

  const executed = proof.core.find((event) => event.name === "MandateActionExecuted");
  if (executed) {
    proof.executed = true;
  }

  const refused = proof.core.find((event) => event.name === "MandateActionRefused");
  if (refused) {
    proof.refused = true;
    const code = Number(refused.args.refusalCode ?? 0);
    const tag = Number(refused.args.ruleTag ?? 0);
    proof.refusalCode = code;
    proof.refusalName = refusalName(code);
    proof.ruleTag = tag;
    proof.ruleTagName = ruleTagName(tag);
    proof.attemptedValue = (refused.args.attemptedValue as bigint) ?? null;
    proof.remainingHeadroom = (refused.args.remainingHeadroom as bigint) ?? null;
  }

  const settled = proof.settlement.find((event) => event.name === "GasSettled");
  if (settled) {
    proof.settledOutcome = Number(settled.args.outcome ?? 0);
    proof.chargedWei = (settled.args.paidWei as bigint) ?? null;
  }

  return proof;
}

/** A one-line human summary, for the activity log. */
export function summarise(proof: TransactionProof): string {
  if (proof.executed) {
    const moved = proof.movements[0];
    return moved
      ? `Transferred ${moved.formatted}`
      : "Action executed, no USDC movement seen";
  }
  if (proof.refused) {
    const attempted =
      proof.attemptedValue === null ? "" : `, attempted ${proof.attemptedValue}`;
    return `Refused on-chain: ${proof.refusalName} (code ${proof.refusalCode}${attempted})`;
  }
  const control = proof.controls[0];
  if (control) return control.name;
  if (proof.status === "reverted") return "Transaction reverted";
  return "No mandate event found";
}
