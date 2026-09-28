"use client";

/**
 * Owner controls: pause, resume, revoke.
 *
 * Pause is offered first and is much cheaper than revoking, because revoking
 * means a new approval afterwards. That ordering is deliberate: pausing never
 * leaves the owner with no active authority, revoking first does.
 *
 * Each action needs one owner signature and the owner's own transaction. The
 * core is never charged for any of them, by design.
 */
import { useState } from "react";
import { signPreparedSafetyAction, type PreparedMandateSafetyAction, type SafetyActionName } from "@gol/sdk";
import { shortAddress } from "@/lib/chain";
import { golPost } from "@/lib/gol-client";
import type { PolicySummary } from "@/lib/use-policy";

/** The two wallet operations the SDK needs from Privy. */
export interface OwnerWallet {
  signTypedData: (payload: never) => Promise<`0x${string}`>;
  sendTransaction: (call: {
    to: `0x${string}`;
    data: `0x${string}`;
  }) => Promise<`0x${string}`>;
}

export function OwnerControls({
  policy,
  account,
  ownerWallet,
  onDone,
}: {
  policy: PolicySummary;
  account: string;
  ownerWallet: OwnerWallet | null;
  onDone: (action: SafetyActionName, txHash: string) => void;
}) {
  const [busy, setBusy] = useState<SafetyActionName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: SafetyActionName) => {
    if (!ownerWallet) return;
    setBusy(action);
    setError(null);
    try {
      const prepared = await golPost<
        PreparedMandateSafetyAction & { error?: { code?: string } }
      >("/api/gol/safety-action/prepare", {
        account,
        gasPolicyId: policy.gasPolicyId,
        action,
      });

      // The SDK recomputes the digest and checks the action and mandate before it
      // asks the wallet to sign, so a swapped payload fails here rather than
      // spending an owner signature on it.
      const call = await signPreparedSafetyAction(
        { signTypedData: (payload) => ownerWallet.signTypedData(payload as never) },
        prepared,
        { action, mandateId: policy.mandateId },
      );
      const hash = await ownerWallet.sendTransaction(call);
      onDone(action, hash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const paused = policy.status === "paused";
  const terminal = policy.status === "revoked" || policy.status === "expired";

  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-5">
      <h2 className="font-semibold">Owner controls</h2>
      <p className="mt-1 text-sm text-neutral-600">
        These work without the agent. Each is one signature and your own transaction,
        and the core never charges you for them.
      </p>
      <p className="mt-2 font-mono text-xs text-neutral-500">
        policy {shortAddress(policy.gasPolicyId)} status {policy.status}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {paused ? (
          <button
            type="button"
            disabled={busy !== null || !ownerWallet}
            onClick={() => run("resume")}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy === "resume" ? "Resuming..." : "Resume"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy !== null || !ownerWallet || terminal}
            onClick={() => run("pause")}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === "pause" ? "Pausing..." : "Pause"}
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null || !ownerWallet || terminal}
          onClick={() => run("revoke")}
          className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-800 disabled:opacity-40"
        >
          {busy === "revoke" ? "Revoking..." : "Revoke"}
        </button>
      </div>

      {terminal && (
        <p className="mt-3 text-sm text-neutral-600">
          This mandate is {policy.status}. A new approval is needed before the agent can
          act again.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
