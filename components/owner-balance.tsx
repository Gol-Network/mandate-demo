"use client";

/**
 * What the owner has to pay for, read from the chain.
 *
 * The split is not obvious from the demo and it is the thing most likely to waste
 * a live run, because the two halves behave differently:
 *
 *  - **The sponsored setup is free.** GOL relays it at GOL's cost, within a daily
 *    per-project limit. A wallet with nothing in it can be set up, which is
 *    exactly how a zero-balance wallet gets far enough to need funding.
 *  - **The approval is not free.** The owner signs typed data and sends a real
 *    transaction that the EOA pays for itself.
 *  - **Each transfer is prepaid by the relayer and repaid inline from the owner's
 *    ETH**, bounded by the mandate's own gas caps. The quote fails unless the
 *    balance covers the accepted maximum at the moment of the transfer, so the
 *    floor is a per-transfer maximum rather than a running total.
 *
 * The floor comes from `getGasConfiguration` at runtime, never from a constant
 * here, and the two are shown separately because they are different obligations:
 * one is a transaction the owner sends, the other is a reserve that has to still
 * be there later.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_RPC_URL } from "@/lib/chain";

const BASE_SEPOLIA_FAUCET = "https://portal.cdp.coinbase.com/products/faucet";

const publicClient = createPublicClient({
  chain: BASE_SEPOLIA,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

const eth = (wei: bigint): string => formatEther(wei).slice(0, 8);

export function OwnerBalance({
  account,
  /** The mandate's per-action gas cap, the floor a transfer needs. */
  perActionWei,
}: {
  account: Address;
  perActionWei: bigint;
}) {
  const [wei, setWei] = useState<bigint | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  const read = useCallback(async () => {
    try {
      setWei(await publicClient.getBalance({ address: account }));
      setUnreadable(false);
    } catch {
      // An RPC that will not answer is not evidence that the balance is zero.
      setUnreadable(true);
    }
  }, [account]);

  useEffect(() => {
    // Reading the balance is the point of mounting, and the only thing it does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read();
  }, [read]);

  const floor = perActionWei;
  const short = wei !== null && wei < floor;

  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">What you have to pay for</h2>
        <button
          type="button"
          onClick={() => void read()}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600"
        >
          Refresh
        </button>
      </div>

      <dl className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-neutral-500">your ETH: </dt>
          <dd className="inline">{unreadable ? "unreadable" : wei === null ? "..." : eth(wei)}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">floor per transfer: </dt>
          <dd className="inline">{eth(floor)} ETH</dd>
        </div>
      </dl>

      <p className="mt-2 text-sm text-neutral-600">
        The setup above was sponsored by GOL and cost you nothing. Approving a mandate is a
        transaction your own wallet sends and pays for, and every transfer the agent asks for
        is prepaid by the relayer and repaid from this same ETH, so the balance has to still be
        here when the transfer happens.
      </p>

      {short && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm">
          This is below the floor for one transfer, so a transfer would be refused before
          anything is sent. Roughly 0.003 to 0.005 ETH is enough for a demo run.{" "}
          <a className="underline" href={BASE_SEPOLIA_FAUCET} target="_blank" rel="noreferrer">
            Get some from a Base Sepolia faucet
          </a>
          , then refresh.
        </p>
      )}
    </section>
  );
}
