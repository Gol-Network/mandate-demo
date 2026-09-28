/**
 * The GOL action provider: the agent's only way to move money.
 *
 * AgentKit's built-in action providers (ERC-20 transfer, swap, faucet) move the
 * **agent wallet's own funds**. That would bypass the mandate entirely, so this
 * demo registers only this provider. The agent wallet therefore holds nothing
 * and needs no gas; every value movement is authorised by the owner's on-chain
 * mandate or refused by the core.
 *
 * Server-only. The agent's private key never leaves the chat route's closure and
 * is used only through `walletProvider.signTypedData`.
 */
import {
  ActionProvider,
  type Action,
  type EvmWalletProvider,
} from "@coinbase/agentkit";
import { signPreparedGasExecution, type AgentSigner } from "@gol/sdk";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { keccak256, type Address, type Hex } from "viem";
import { getGol, golProjectId } from "./gol.ts";
import { serverEnv } from "./env.ts";
import { isResolved, resolveForAgent } from "./agent-payees.ts";

/** What this provider is bound to for one owner's active policy. */
export interface GolBinding {
  account: Address;
  gasPolicyId: Hex;
  mandateId: Hex;
  /** The owner's contacts, re-validated on every call. Untrusted. */
  contacts: unknown;
}

/** The parts of a gas execution this demo reports. */
export interface ExecutionFacts {
  id: string;
  actionId: string;
  state: string;
  transactionHash: string | null;
  outcome: string | null;
  refusalCode: number | null;
}

/** A fresh 32-byte action id, which is also the idempotency key. */
const newActionId = (): Hex => keccak256(new Uint8Array(randomBytes(32)));

/** Refusal codes below this floor are never charged to the owner. */
const CHARGEABLE_REFUSAL_FLOOR = 40;

const formatUsdc = (baseUnits: bigint, decimals: number): string => {
  const base = 10n ** BigInt(decimals);
  const fraction = (baseUnits % base).toString().padStart(decimals, "0");
  return `${baseUnits / base}.${fraction}`;
};

/**
 * Parses "1", "1.5", "0.25" into 6-decimal base units with no float rounding.
 * Returns null for anything that is not a positive decimal amount.
 */
export function parseUsdcAmount(input: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  if (whole === "0" && fraction.replace(/0/g, "") === "") return null;
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

/**
 * Pulls out the fields the demo shows.
 *
 * `refusalCode` and `outcome` live on the receipt, and the transaction hash is
 * the first of `transactionHashes`, so this is the single place that knows the
 * execution response's shape.
 */
function factsFrom(
  execution: Record<string, unknown>,
): ExecutionFacts {
  const receipt = (execution.receipt ?? {}) as Record<string, unknown>;
  const hashes = (execution.transactionHashes ?? []) as unknown;
  const first = Array.isArray(hashes) ? (hashes[0] as string | undefined) : undefined;
  return {
    id: String(execution.id ?? ""),
    actionId: String(execution.actionId ?? ""),
    state: String(execution.state ?? "unknown"),
    transactionHash: first ?? null,
    outcome: (receipt.outcome as string | undefined) ?? null,
    refusalCode: (receipt.refusalCode as number | undefined) ?? null,
  };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asJson = (value: unknown): string => JSON.stringify(value);

/**
 * Builds the action provider bound to one owner's active gas policy.
 *
 * The provider depends only on `walletProvider.signTypedData`, so swapping the
 * agent's `ViemWalletProvider` for a Privy server wallet later needs no change
 * here.
 */
export function golActionProvider(
  walletProvider: EvmWalletProvider,
  binding: GolBinding,
  assetDecimals: number,
): ActionProvider<EvmWalletProvider> {
  class GolMandateProvider extends ActionProvider<EvmWalletProvider> {
    constructor() {
      super("gol_mandate_provider", []);
    }

    supportsNetwork(): boolean {
      return true;
    }

    getActions(): Action[] {
      return [mandateAction(), transferAction(), statusAction()];
    }
  }

  const signer: AgentSigner = {
    signTypedData: (typedData) => walletProvider.signTypedData(typedData),
  };

  /** A one-line description of a refusal, for the model's reply. */
  const explainRefusal = (code: number | null): string => {
    if (code === null) return "The core refused it for a reason the API did not name.";
    if (code === 65) return "That address is not one of the payees the owner approved.";
    if (code === 67) return "That amount is above the per-transfer cap the owner set.";
    if (code === 68) return "That amount is above the owner's total budget.";
    if (code === 64) return "That asset is not the one the owner approved.";
    return `The owner's mandate refused it, code ${code}.`;
  };

  function mandateAction(): Action {
    return {
      name: "get_mandate",
      description:
        "Read the owner's mandate: the payees they named, the per-transfer cap, the " +
        "total budget, and what is left. Call this when you are unsure what the " +
        "owner permitted.",
      schema: z.object({}),
      invoke: async () => {
        const payees = Array.isArray(binding.contacts)
          ? (binding.contacts as unknown[]).filter(
              (entry): entry is { name: string; address: string } =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as Record<string, unknown>).name === "string" &&
                typeof (entry as Record<string, unknown>).address === "string",
            )
          : [];
        return asJson({
          account: binding.account,
          mandateId: binding.mandateId,
          gasPolicyId: binding.gasPolicyId,
          payees: payees.map((payee) => ({
            name: payee.name,
            address: payee.address,
          })),
          note:
            "Only the payees the owner named may be paid. A transfer to any other " +
            "address is still sent and then refused on-chain, with a recorded " +
            "reason, so the owner can see it. Do not describe that as a success.",
        });
      },
    };
  }

  function transferAction(): Action {
    return {
      name: "transfer_usdc",
      description:
        "Send USDC to a payee. Give the payee as the owner's name for them, or as " +
        "an address. The amount is in USDC, for example 1 or 0.5. The owner's " +
        "mandate bounds what is allowed; if it refuses, the refusal is reported back " +
        "with its reason.",
      schema: z.object({
        to: z.string().describe("The owner's name for the payee, or an address"),
        amountUsdc: z.string().describe("Amount in USDC, for example 1 or 0.5"),
      }),
      invoke: async ({ to, amountUsdc }) => {
        // The payee is resolved in code, never by the model. An invented name
        // fails here, and the model is told to ask rather than guess.
        const payee = resolveForAgent(binding.contacts, to);
        if (!isResolved(payee)) {
          return asJson({
            ok: false,
            problem: payee.problem,
            message: payee.message,
            ...(payee.addresses ? { candidates: payee.addresses } : {}),
          });
        }

        const amount = parseUsdcAmount(amountUsdc, assetDecimals);
        if (amount === null) {
          return asJson({
            ok: false,
            problem: "bad_amount",
            message: `"${amountUsdc}" is not a positive USDC amount such as 1 or 0.5.`,
          });
        }

        const actionId = newActionId();
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const gol = getGol();
        const projectId = golProjectId();

        try {
          const prepared = await gol.prepareGasExecution(projectId, actionId, {
            mandateId: binding.mandateId,
            gasPolicyId: binding.gasPolicyId,
            recipient: payee.address,
            amountBaseUnits: amount.toString(),
            deadline,
          });

          const body = await signPreparedGasExecution(signer, prepared, {
            maxChargeWei: serverEnv.agentMaxChargeWei,
          });

          const execution = await gol.submitGasExecution(projectId, actionId, body);
          const facts = factsFrom(execution as unknown as Record<string, unknown>);

          return asJson({
            ok: true,
            ...facts,
            recipient: payee.address,
            label: payee.label,
            inMandate: payee.inMandate,
            amountUsdc: formatUsdc(amount, assetDecimals),
            chargeable: facts.refusalCode === null
              ? null
              : facts.refusalCode >= CHARGEABLE_REFUSAL_FLOOR,
            explain: facts.refusalCode === null ? null : explainRefusal(facts.refusalCode),
            tell_the_user:
              payee.inMandate === false
                ? `${payee.label ?? payee.address} is not one of the payees the owner approved, so the owner's mandate will refuse this on-chain.`
                : null,
          });
        } catch (error) {
          // GOL refused before sending anything, for example a paused mandate. No
          // transaction exists, so there is nothing on chain and nothing charged.
          return asJson({
            ok: false,
            stopped_before_sending: true,
            recipient: payee.address,
            label: payee.label,
            inMandate: payee.inMandate,
            amountUsdc: formatUsdc(amount, assetDecimals),
            message: messageOf(error),
            explain:
              "GOL stopped this before sending anything, so there is no transaction " +
              "and the owner was not charged. This is what a paused or revoked " +
              "mandate looks like from here.",
          });
        }
      },
    };
  }

  function statusAction(): Action {
    return {
      name: "get_transfer_status",
      description:
        "Check whether a transfer went through, was refused on-chain, or is still " +
        "settling. Settling can take a few minutes.",
      schema: z.object({
        executionId: z.string().describe("The execution id from a previous transfer"),
      }),
      invoke: async ({ executionId }) => {
        try {
          const execution = await getGol().getGasExecution(golProjectId(), executionId);
          const facts = factsFrom(execution as unknown as Record<string, unknown>);
          return asJson({
            ok: true,
            ...facts,
            explain: facts.refusalCode === null ? null : explainRefusal(facts.refusalCode),
            still_settling: !["collected", "uncollectable", "not_charged", "rejected_preflight"].includes(
              facts.state,
            ),
          });
        } catch (error) {
          return asJson({ ok: false, message: messageOf(error) });
        }
      },
    };
  }

  return new GolMandateProvider();
}


