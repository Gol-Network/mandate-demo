"use client";

/**
 * The agent's chat page.
 *
 * The agent holds no funds and has exactly one capability: ask GOL to move USDC
 * from the owner's wallet, within the owner's mandate. Nothing else is
 * registered, so anything it cannot do it will say so rather than attempt.
 *
 * The owner's contacts travel with every request so names can be resolved on the
 * server. They are the owner's own labels, re-validated on arrival, and are never
 * authority.
 */
import { getAccessToken, useLogin, useUser, useWallets } from "@privy-io/react-auth";
import { useChat } from "ai/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BASESCAN_TX, shortAddress } from "@/lib/chain";
import { golGet } from "@/lib/gol-client";
import { loadContacts } from "@/lib/contact-storage";
import { usePolicy } from "@/lib/use-policy";
import { CopyValue } from "@/components/copy-address";
import { ProofPanel } from "@/components/proof-panel";
import { SignOutButton } from "@/components/sign-out-button";
import type { Contact } from "@/lib/contacts";

interface FullConfiguration {
  core: `0x${string}`;
  asset: { address: `0x${string}`; symbol: string; decimals: number };
}

async function authenticatedChatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your Privy session has ended. Sign in again before asking the agent to act.");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export default function AgentPage() {
  const { login } = useLogin();
  const { user } = useUser();
  const { wallets, ready } = useWallets();

  const wallet = useMemo(
    () => wallets.find((candidate) => candidate.walletClientType === "privy"),
    [wallets],
  );
  const account = wallet?.address as `0x${string}` | undefined;
  const { policy } = usePolicy(account);

  const [configuration, setConfiguration] = useState<FullConfiguration | null>(null);
  const [storedContacts, setStoredContacts] = useState<{ key: string; rows: Contact[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    golGet<FullConfiguration>("/api/gol/config")
      .then((config) => {
        if (!cancelled) setConfiguration(config);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  // The owner's payees, exactly as they entered them on the owner page. Read
  // from storage so the chat always reflects the latest names, even if the owner
  // edited them in another tab.
  useEffect(() => {
    // Read the owner's payees from storage on every policy change. The empty case
    // is derived below rather than stored, so nothing is cleared here. The write
    // is synchronous because localStorage is, and the rule assumes a network read.
    if (!user?.id || !policy) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredContacts({
      key: `${user.id}:${policy.gasPolicyId}`,
      rows: loadContacts(user.id, policy.gasPolicyId),
    });
  }, [policy, user?.id]);

  // Derived: with no user or policy there are no contacts to show.
  const visibleContacts = user?.id && policy &&
    storedContacts?.key === `${user.id}:${policy.gasPolicyId}` ? storedContacts.rows : [];

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/agent/chat",
    streamProtocol: "data",
    fetch: authenticatedChatFetch,
    body: {
      account: account ?? "",
      gasPolicyId: policy?.gasPolicyId ?? "",
      contacts: visibleContacts,
    },
  });

  if (!ready) return <main className="p-10 text-neutral-500">Loading Privy...</main>;

  if (!wallet || !account) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Agent</h1>
        <p className="mt-3 text-neutral-600">
          The agent can only move money from your own wallet, so it runs as you.
        </p>
        <button
          type="button"
          onClick={login}
          className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          Log in with email
        </button>
      </main>
    );
  }

  if (!policy) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">No mandate yet</h1>
        <p className="mt-3 text-neutral-600">
          The agent can only act inside a mandate. Approve one on the owner page first.
        </p>
        <Link className="mt-4 inline-block underline" href="/">
          Go to the owner page
        </Link>
      </main>
    );
  }

  if (policy.status !== "active") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Mandate is {policy.status}</h1>
        <p className="mt-3 text-neutral-600">
          {policy.status === "paused"
            ? "You have paused this mandate, so the agent cannot move anything. Resume it on the owner page."
            : `This mandate is ${policy.status}. Approve a new one on the owner page.`}
        </p>
        <p className="mt-3 text-sm text-neutral-500">
          While paused, an attempt is stopped by GOL before anything is sent: no
          transaction, and nothing charged.
        </p>
        <Link className="mt-4 inline-block underline" href="/">
          Go to the owner page
        </Link>
      </main>
    );
  }

  const names = visibleContacts.map((contact) => contact.name).filter(Boolean);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agent</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <CopyValue value={account} label="owner" explorer />
            <CopyValue value={policy.gasPolicyId} label="policy" lead={10} tail={6} />
          </div>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-3 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <p>
          The agent holds no funds. It can only ask GOL to send{" "}
          {configuration?.asset.symbol ?? "USDC"} from your wallet, to{" "}
          <strong>{names.length > 0 ? names.join(", ") : "the payees you have not set"}</strong>
          .
        </p>
        {names.length === 0 && (
          <p className="mt-1 text-amber-700">
            You have not named any payees. Add them on the owner page, or the agent will
            have to ask you for an address each time.
          </p>
        )}
      </section>

      {loadError && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{loadError}</p>
      )}

      <div className="mt-5 space-y-3">
        {messages.map((message) => {
          const hash = extractTxHash(message.content);
          return (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white"
                  : "max-w-[90%] rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm"
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {hash && (
                <a
                  className="mt-1 inline-block font-mono text-xs underline"
                  href={BASESCAN_TX(hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(hash, 10, 6)}
                </a>
              )}
            </div>
          );
        })}
        {isLoading && <p className="text-sm text-neutral-500">Thinking...</p>}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error.message}</p>
      )}

      <form onSubmit={handleSubmit} className="mt-5 flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder={names.length > 0 ? `pay ${names[0]} 1 USDC` : "pay 0x... 1 USDC"}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading || input.length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {configuration && (
        <div className="mt-8">
          <ProofPanel
            account={account}
            gasPolicyId={policy.gasPolicyId}
            core={configuration.core}
            usdc={configuration.asset.address}
            assetDecimals={configuration.asset.decimals}
          />
        </div>
      )}

      <p className="mt-8 text-xs text-neutral-400">
        Signed in as {user?.email?.address ?? "unknown"}. Base Sepolia testnet only.
      </p>
    </main>
  );
}

/** Pulls a transaction hash out of a reply so the owner can verify it themselves. */
function extractTxHash(text: string): string | null {
  return /0x[0-9a-fA-F]{64}/.exec(text)?.[0] ?? null;
}
