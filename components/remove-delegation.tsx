"use client";

/**
 * Removing an EIP-7702 delegation the owner did not ask GOL for.
 *
 * GOL will not do this and is not asked to. GOL's sponsored setup covers exactly
 * one delegation, to the reviewed Nexus 1.3.3 delegate, and everything else is
 * refused with `account_integration_invalid`. What this component does is the
 * owner's own key authority, in the owner's own wallet, so the demo is not
 * holding a capability it has no business holding: it cannot clear a delegation
 * on an account whose key it does not have, and it never sees a key at all.
 *
 * Two owner prompts, both from Privy and both about the same thing:
 *
 *  1. sign an authorization naming the EIP-7702 reset address, then
 *  2. send the type-4 transaction that carries it.
 *
 * The owner pays for step 2 out of their own ETH. There is nothing for GOL to
 * sponsor, so the balance is read up front rather than letting the wallet fail
 * with `insufficient funds` after the owner has already approved a signature.
 *
 * The last step is deliberately not trusted. The component waits for the receipt
 * and then asks the page to re-read the account, so what the page shows next is
 * what the chain says rather than what this component hoped would happen.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_RPC_URL, BASESCAN_TX } from "@/lib/chain";
import {
  CLEAR_DELEGATION_ADDRESS,
  clearDelegationRequest,
  clearDelegationTuple,
  type ClearDelegationRequest,
  type PrivySignedAuthorization,
} from "@/lib/undelegate";
import { CopyValue } from "./copy-address";

const BASE_SEPOLIA_FAUCET = "https://portal.cdp.coinbase.com/products/faucet";

const publicClient = createPublicClient({
  chain: BASE_SEPOLIA,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

/** How often to look for the receipt, and how long to keep looking. */
const POLL_MS = 4000;
const POLL_ATTEMPTS = 30;

type Phase =
  | "idle"
  | "reading-balance"
  | "needs-gas"
  | "signing"
  | "signed"
  | "sending"
  | "pending"
  | "cleared"
  | "reverted"
  | "slow";

export function RemoveDelegation({
  account,
  delegate,
  signAuthorization,
  sendTransaction,
  onCleared,
}: {
  account: Address;
  delegate: Address;
  /** Privy's signer, already bound to `account` by the page. */
  signAuthorization: (input: {
    contractAddress: Address;
    chainId?: number;
    nonce?: number;
  }) => Promise<PrivySignedAuthorization>;
  sendTransaction: (request: ClearDelegationRequest) => Promise<Hex>;
  /**
   * Called once the receipt lands, with whether it succeeded. The page re-reads
   * the account from GOL either way, because a reverted transaction is not proof
   * that the delegation is still there and a successful one is not proof that
   * GOL agrees.
   */
  onCleared: (hash: Hex, ok: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("reading-balance");
  const [hash, setHash] = useState<Hex | null>(null);
  const [signedRequest, setSignedRequest] = useState<ClearDelegationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which of the two owner prompts failed, because the two failures mean
  // different things and only one of them is something the owner can fix here.
  const [failedAt, setFailedAt] = useState<"sign" | "send" | null>(null);

  /**
   * Whether the owner can pay for the transaction. Only the answer is kept: the
   * amount is not shown anywhere, and a balance that moves between the read and
   * the send is the wallet's problem to report, not a reason to hold a stale
   * number on screen.
   */
  const readBalance = useCallback(async () => {
    setPhase("reading-balance");
    try {
      setPhase((await publicClient.getBalance({ address: account })) > 0n ? "idle" : "needs-gas");
    } catch {
      // An RPC that will not answer is not evidence that the wallet is broke.
      // Let the owner try; the wallet is the one that decides.
      setPhase("idle");
    }
  }, [account]);

  useEffect(() => {
    // Reading the balance is the point of mounting, and the only thing that
    // happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void readBalance();
  }, [readBalance]);

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void (async () => {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash });
          if (cancelled) return;
          clearInterval(timer);
          setPhase(receipt.status === "success" ? "cleared" : "reverted");
          onCleared(hash, receipt.status === "success");
        } catch {
          // Not mined yet. Keep looking until the attempt budget runs out, then
          // leave the explorer link up rather than claiming a failure.
          if (!cancelled && attempts >= POLL_ATTEMPTS) setPhase("slow");
        }
      })();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hash, onCleared]);

  const remove = async () => {
    setError(null);
    setFailedAt(null);
    try {
      setPhase("signing");
      // `signAuthorization` arrives already bound to this account by the page, so
      // Privy cannot answer with a different wallet's key.
      const signed = await signAuthorization({
        contractAddress: CLEAR_DELEGATION_ADDRESS,
        chainId: BASE_SEPOLIA.id,
      });
      // Refuses a tuple that is not the one that was asked for, before a
      // transaction is built from it.
      const tuple = clearDelegationTuple(signed, BASE_SEPOLIA.id);
      setSignedRequest(clearDelegationRequest(account, tuple));
      setPhase("signed");
    } catch (caught) {
      setPhase("idle");
      setFailedAt((current) => current ?? "sign");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const sendReset = async () => {
    if (!signedRequest) return;
    setError(null);
    setFailedAt("send");
    setPhase("sending");
    try {
      setHash(await sendTransaction(signedRequest));
      setSignedRequest(null);
      setPhase("pending");
    } catch (caught) {
      setPhase("signed");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const busy = phase === "signing" || phase === "sending" || phase === "pending";
  const done = phase === "cleared";

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
      <h2 className="font-semibold">This address is delegated somewhere GOL did not review</h2>
      <p className="mt-1 text-sm">
        GOL supports delegation to one delegate only, the reviewed Biconomy Nexus 1.3.3, and
        refuses anything else with <code>account_integration_invalid</code>. This address points
        somewhere else:
      </p>
      <p className="mt-2">
        <CopyValue value={delegate} label="delegate" lead={10} tail={8} explorer />
      </p>
      <p className="mt-3 text-sm">
        You can remove the delegation yourself. EIP-7702 lets an account clear its own delegation
        by signing an authorization to the reset address and sending it, which puts the wallet
        back to a plain address with no code attached. Nothing moves: the address does not
        change, no USDC is touched, and no ETH is sent anywhere. GOL is not involved, this is
        your wallet signing rather than a GOL capability.
      </p>
      <p className="mt-2 text-sm text-neutral-700">
        It takes two approvals from Privy, and the second one is a transaction you pay for out
        of your own ETH on Base Sepolia, because GOL&apos;s sponsored setup only covers the
        reviewed delegate. Afterwards this page offers the sponsored setup again.
      </p>

      {phase === "needs-gas" && (
        <p className="mt-3 rounded-md bg-white p-3 text-sm">
          This address holds 0 ETH on Base Sepolia, so it cannot pay for the transaction.{" "}
          <a className="underline" href={BASE_SEPOLIA_FAUCET} target="_blank" rel="noreferrer">
            Get some from a Base Sepolia faucet
          </a>
          , then{" "}
          <button type="button" onClick={() => void readBalance()} className="underline">
            check again
          </button>
          .
        </p>
      )}

      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy || done || phase === "signed" || phase === "needs-gas" || phase === "reading-balance"}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {phase === "signing"
          ? "Approve the reset authorization..."
          : phase === "sending"
            ? "Approve the transaction..."
            : phase === "pending"
              ? "Waiting for the transaction..."
              : done
                ? "Delegation removed"
                : "Remove the delegation"}
      </button>

      {phase === "signed" && signedRequest && (
        <div className="mt-4 rounded-md bg-white p-3 text-sm">
          <p>The reset authorization is signed. Send the owner-paid transaction from your wallet.</p>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={() => void sendReset()}
              className="rounded-md bg-neutral-900 px-3 py-2 text-white">Send reset transaction</button>
            <button type="button" onClick={() => { setSignedRequest(null); setPhase("idle"); }}
              className="rounded-md border border-neutral-300 px-3 py-2">Cancel</button>
          </div>
        </div>
      )}

      {hash && (
        <p className="mt-3 text-sm">
          {phase === "cleared"
            ? "Cleared in transaction "
            : phase === "reverted"
              ? "Reverted: "
              : "Transaction "}
          <a className="font-mono text-xs underline" href={BASESCAN_TX(hash)} target="_blank" rel="noreferrer">
            {hash}
          </a>
          {phase === "reverted" && (
            <>
              {" "}
              A revert does not roll the delegation back, so check the account before assuming
              either outcome.
            </>
          )}
          {phase === "slow" && " This is taking longer than two minutes; the explorer has the result."}
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-md bg-white p-3 text-sm">
          <p className="font-mono text-red-800">{error}</p>
          <p className="mt-2 text-neutral-700">
            {failedAt === "sign" ? (
              <>
                Privy did not sign the reset authorization. A wallet is within its rights to
                refuse a delegation change, and this is the one part of the flow the demo
                cannot do without it: the tuple has to be signed by the owner&apos;s own key,
                so there is no version of this that skips the wallet. Clearing the delegation
                from whatever owns this address&apos;s EIP-7702 settings is the way around it.
              </>
            ) : (
              <>
                The signature was made, but the wallet did not return a transaction hash.
                Check its activity before retrying. A network error can leave the send outcome
                uncertain, and a second type-4 transaction could cost gas.
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
