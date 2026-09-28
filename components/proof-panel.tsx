"use client";

/**
 * The proof panel.
 *
 * Every claim the demo makes is shown twice: once as GOL's API reports it, and
 * once as decoded from the transaction receipt by viem over public Base Sepolia
 * RPC, filtered to logs from the GOL core address. The two are compared and any
 * disagreement is flagged rather than hidden.
 *
 * The point is that the evidence does not depend on GOL being reachable, or
 * honest. A refusal is a durable on-chain record, verifiable from public
 * infrastructure by anyone.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_RPC_URL, BASESCAN_TX, shortAddress } from "@/lib/chain";
import { golPost } from "@/lib/gol-client";
import {
  buildProof,
  isChargeableRefusal,
  summarise,
  type TransactionProof,
} from "@/lib/proof";

export interface ExecutionRow {
  id: string;
  state: string;
  transactionHashes: string[];
  receipt?: { outcome?: string; refusalCode?: number | null } | null;
  settledWei?: string | null;
  ledger?: { category: string; amountWei: string }[];
}

const client = createPublicClient({
  chain: BASE_SEPOLIA,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

const weiToEth = (wei: bigint | null): string =>
  wei === null ? "-" : `${(Number(wei) / 1e18).toFixed(9)} ETH`;

export function ProofPanel({
  account,
  gasPolicyId,
  core,
  usdc,
  assetDecimals,
}: {
  account: string;
  gasPolicyId: string;
  core: Address;
  usdc: Address;
  assetDecimals: number;
}) {
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [proofs, setProofs] = useState<Record<string, TransactionProof>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await golPost<{
        data?: ExecutionRow[];
        error?: { code?: string };
      }>("/api/gol/executions", { account, gasPolicyId });
      const rows = payload.data ?? [];
      setExecutions(rows);

      // Decode each execution's receipt independently of what the API said.
      const next: Record<string, TransactionProof> = {};
      for (const row of rows) {
        const hash = row.transactionHashes[0] as Hex | undefined;
        if (!hash) continue;
        try {
          const receipt = await client.waitForTransactionReceipt({ hash });
          next[row.id] = buildProof(
            {
              transactionHash: hash,
              status: receipt.status,
              blockNumber: receipt.blockNumber,
              logs: receipt.logs,
            },
            { core, usdc, assetDecimals },
          );
        } catch {
          // Not mined yet, or the public RPC is briefly unavailable. The row still
          // shows the API's view, and the receipt is picked up on the next poll.
        }
      }
      setProofs(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [account, assetDecimals, core, gasPolicyId, usdc]);

  useEffect(() => {
    // Polling on a timer is the intended pattern: the point is to pick up a
    // receipt that is not mined yet, since the platform settles minutes behind
    // the latest head. The rule being bent is only about setting the loading flag
    // synchronously on the first call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Proof</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        Each row shows what GOL says next to what the receipt actually contains, decoded
        from the GOL core&apos;s own events over public RPC.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">
          {error}
        </p>
      )}

      {executions.length === 0 && !error && (
        <p className="mt-4 text-sm text-neutral-500">No transfers yet.</p>
      )}

      <ul className="mt-4 space-y-4">
        {executions.map((row) => {
          const proof = proofs[row.id];
          const hash = row.transactionHashes[0];
          const apiCode = row.receipt?.refusalCode ?? null;
          const disagree =
            proof && apiCode !== null && proof.refusalCode !== null && proof.refusalCode !== apiCode;
          return (
            <li key={row.id} className="rounded-md border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{summarise(proof ?? placeholder(row))}</span>
                {hash && (
                  <a
                    className="font-mono text-xs underline"
                    href={BASESCAN_TX(hash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(hash, 10, 6)}
                  </a>
                )}
              </div>

              <dl className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline text-neutral-500">GOL: </dt>
                  <dd className="inline">
                    state {row.state}
                    {row.receipt?.outcome ? `, outcome ${row.receipt.outcome}` : ""}
                    {apiCode !== null ? `, refusal ${apiCode}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-neutral-500">receipt: </dt>
                  <dd className="inline">
                    {proof ? summarise(proof) : "not decoded yet"}
                  </dd>
                </div>
              </dl>

              {proof?.refused && (
                <div className="mt-2 rounded bg-amber-50 p-2 font-mono text-xs">
                  <p>
                    refusal {proof.refusalName} (code {proof.refusalCode}, rule{" "}
                    {proof.ruleTagName} 0x{proof.ruleTag?.toString(16)})
                  </p>
                  {proof.attemptedValue !== null && (
                    <p>
                      attempted {proof.attemptedValue} against remaining{" "}
                      {proof.remainingHeadroom} headroom
                    </p>
                  )}
                  <p>
                    owner charged: {isChargeableRefusal(proof.refusalCode ?? 0) ? "yes" : "no, "}
                    this code is never charged
                  </p>
                </div>
              )}

              {proof?.executed && (
                <div className="mt-2 rounded bg-emerald-50 p-2 font-mono text-xs">
                  <p>MandateActionExecuted</p>
                  {proof.movements.map((movement, index) => (
                    <p key={index}>
                      USDC {movement.formatted} {shortAddress(movement.from, 8, 4)} to{" "}
                      {shortAddress(movement.to, 8, 4)}
                    </p>
                  ))}
                </div>
              )}

              {proof?.chargedWei !== null && proof?.chargedWei !== undefined && (
                <p className="mt-2 font-mono text-xs text-neutral-600">
                  GasSettled: {weiToEth(proof.chargedWei)} repaid to the relayer inline
                </p>
              )}

              {disagree && (
                <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">
                  Disagreement: GOL reported refusal {apiCode} but the receipt says{" "}
                  {proof.refusalCode}. The receipt is authoritative.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Before a receipt is available, still show what the API reported. */
const placeholder = (row: ExecutionRow): TransactionProof =>
  ({
    hash: (row.transactionHashes[0] ?? "0x") as Hex,
    mined: false,
    status: "unknown",
    blockNumber: null,
    core: [],
    settlement: [],
    controls: [],
    movements: [],
    executed: false,
    refused: row.receipt?.refusalCode != null,
    refusalCode: row.receipt?.refusalCode ?? null,
    refusalName: null,
    ruleTag: null,
    ruleTagName: null,
    attemptedValue: null,
    remainingHeadroom: null,
    chargedWei: null,
    settledOutcome: null,
  }) satisfies TransactionProof;
