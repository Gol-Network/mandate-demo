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
import { useEffect, useState } from "react";
import { signPreparedSafetyAction, type PreparedMandateSafetyAction, type SafetyActionName } from "@gol/sdk";
import { BASESCAN_TX, shortAddress } from "@/lib/chain";
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
  const [signed, setSigned] = useState<{
    action: SafetyActionName;
    call: { to: `0x${string}`; data: `0x${string}` };
  } | null>(null);
  const [pending, setPending] = useState<{ action: SafetyActionName; hash: `0x${string}` } | null>(null);
  const [inclusion, setInclusion] = useState<string>("observing");

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
      setSigned({ action, call });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!signed || !ownerWallet) return;
    setBusy(signed.action);
    setError(null);
    try {
      const hash = await ownerWallet.sendTransaction(signed.call);
      setPending({ action: signed.action, hash });
      setInclusion("observing");
      setSigned(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!pending) return;
    let inFlight = false;
    const confirm = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await golPost<{ status: string }>("/api/gol/safety-action/confirm", {
          account,
          gasPolicyId: policy.gasPolicyId,
          mandateId: policy.mandateId,
          action: pending.action,
          transactionHash: pending.hash,
        });
        if (result.status === "confirmed") {
          setPending(null);
          setInclusion("observing");
          onDone(pending.action, pending.hash);
        } else if (result.status === "included") {
          setInclusion("included");
        } else if (result.status === "orphaned") {
          setInclusion("orphaned");
        } else if (result.status === "reverted" || result.status === "mismatch") {
          setPending(null);
          setInclusion(result.status);
          setError(result.status === "reverted"
            ? "The owner transaction reverted. The mandate did not change."
            : "The transaction did not perform the expected owner action.");
        }
      } catch (caught) {
        const code = caught instanceof Error ? caught.name : "";
        if (["invalid_request", "conflict", "not_found"].includes(code)) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setPending(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void confirm();
    const timer = setInterval(() => void confirm(), inclusion === "included" ? 10_000 : 1_000);
    return () => clearInterval(timer);
  }, [account, inclusion, onDone, pending, policy.gasPolicyId, policy.mandateId]);

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
            disabled={busy !== null || !ownerWallet || !!signed || !!pending}
            onClick={() => run("resume")}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy === "resume" ? "Resuming..." : "Resume"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy !== null || !ownerWallet || terminal || !!signed || !!pending}
            onClick={() => run("pause")}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === "pause" ? "Pausing..." : "Pause"}
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null || !ownerWallet || terminal || !!signed || !!pending}
          onClick={() => run("revoke")}
          className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-800 disabled:opacity-40"
        >
          {busy === "revoke" ? "Revoking..." : "Revoke"}
        </button>
      </div>

      {signed && (
        <div className="mt-4 rounded-md border border-neutral-300 p-3 text-sm">
          <p>Your {signed.action} signature is ready. Send the transaction from your wallet.</p>
          <div className="mt-3 flex gap-3">
            <button type="button" disabled={busy !== null} onClick={() => void send()}
              className="rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-40">
              Send {signed.action} transaction
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setSigned(null)}
              className="rounded-md border border-neutral-300 px-3 py-2 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      )}
      {pending && (
        <p className="mt-4 text-sm">
          {pending.action} sent. {inclusion === "included"
            ? "Included on Base Sepolia, pending safe-head confirmation."
            : inclusion === "orphaned"
              ? "The transaction left the current chain. Checking for re-inclusion."
              : "Checking for inclusion through Alchemy RPC."}{" "}
          <a href={BASESCAN_TX(pending.hash)} target="_blank" rel="noreferrer" className="font-mono underline">
            {shortAddress(pending.hash, 10, 6)}
          </a>
        </p>
      )}

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
