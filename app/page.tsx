"use client";

/**
 * The owner page: the whole state machine, derived rather than stored.
 *
 * Every state is read from the chain and the GOL API, so the page can be closed
 * and reopened at any point and will show the truth. The only things kept in
 * browser storage are a policy hint and the owner's contact names.
 *
 * The steps:
 *   1. not logged in              Privy login
 *   2. EOA with no delegation     sponsored EIP-7702 setup
 *   3. delegated elsewhere        blocked, the owner must clear it
 *   4. delegated, not initialised  initialisation only
 *   5. setup submitted            poll
 *   6. core installed, no policy  the approval form
 *   7. approval sent              poll
 *   8. active                     caps, controls, and proof
 */
import {
  signPreparedEip7702Setup,
  signPreparedGasPolicy,
  type Eip7702Setup,
  type PreparedEip7702Setup,
  type PreparedGasPolicy,
  type SafetyActionName,
} from "@gol/sdk";
import { useLogin, useSign7702Authorization, useUser, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { BASE_SEPOLIA, BASESCAN_TX, shortAddress } from "@/lib/chain";
import { golGet, golPost } from "@/lib/gol-client";
import { privyRawHashSigner, type RawHashProvider } from "@/lib/privy-signers";
import { usePolicy, type PolicySummary } from "@/lib/use-policy";
import {
  MandateForm,
  formToRequest,
  type GasConfiguration,
  type MandateFormValues,
} from "@/components/mandate-form";
import { OwnerControls, type OwnerWallet } from "@/components/owner-controls";
import { ProofPanel } from "@/components/proof-panel";

interface AccountStatus {
  account: string;
  family: string | null;
  coreInstalled: boolean;
  configurationReviewed: boolean;
  implementationReviewed: boolean;
  accountKind: "contract" | "eoa" | "delegated_eoa";
  delegation: {
    delegate: string | null;
    reviewed: boolean;
    initialized: boolean | null;
  } | null;
}

type FullConfiguration = GasConfiguration & {
  relayer: string;
  eip7702: { delegate: string; sponsorship: { available: boolean; perProjectDailyLimit: number } };
};

type Step =
  | "loading"
  | "setup"
  | "delegated-elsewhere"
  | "initialise"
  | "setup-pending"
  | "mandate"
  | "approval-pending"
  | "active";

export default function OwnerPage() {
  const { login } = useLogin();
  const { user } = useUser();
  const { wallets, ready } = useWallets();
  const { signAuthorization } = useSign7702Authorization();

  const wallet = useMemo(
    () => wallets.find((candidate) => candidate.walletClientType === "privy") ?? wallets[0],
    [wallets],
  );
  const account = wallet?.address as Address | undefined;

  const [configuration, setConfiguration] = useState<FullConfiguration | null>(null);
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<{ draftId: string; txHash: Hex } | null>(null);
  const [setup, setSetup] = useState<{ id: string; state: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useRef(0);

  const { policy, refresh, loading: policiesLoading } = usePolicy(account);

  // The configuration and the agent address are needed before anything else.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    (async () => {
      try {
        const [config, agentInfo] = await Promise.all([
          golGet<FullConfiguration>("/api/gol/config"),
          golGet<{ address: string }>("/api/gol/agent-address"),
        ]);
        if (!cancelled) {
          setConfiguration(config);
          setAgent(agentInfo.address);
        }
      } catch (caught) {
        if (!cancelled) setError(describe(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  // Account status drives the machine, but never walks back from "active".
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    (async () => {
      try {
        reload.current += 1;
        const next = await golPost<AccountStatus>("/api/gol/account-status", { account });
        if (cancelled) return;
        setStatus(next);
        setStep((current) => {
          if (current === "active" || current === "approval-pending") return current;
          if (next.delegation && !next.delegation.reviewed) return "delegated-elsewhere";
          if (next.coreInstalled) return "mandate";
          if (next.delegation?.delegate && next.delegation.initialized === false) {
            return "initialise";
          }
          return "setup";
        });
      } catch (caught) {
        if (!cancelled) setError(describe(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    // A live policy means the owner is past approval, whatever else is true.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (policy) setStep("active");
  }, [policy]);

  /**
   * Privy's EIP-1193 provider, wrapped as a viem wallet client for typed data and
   * transactions. Rebuilt per call because the provider is fetched per call.
   */
  const withWallet = useCallback(
    async <T,>(
      use: (client: ReturnType<typeof createWalletClient>) => Promise<T>,
    ): Promise<T> => {
      if (!wallet) throw new Error("no_embedded_wallet");
      const provider = (await wallet.getEthereumProvider()) as RawHashProvider;
      const client = createWalletClient({
        account: undefined,
        chain: BASE_SEPOLIA,
        transport: custom(provider as never),
      });
      return use(client);
    },
    [wallet],
  );

  const ownerWallet = useMemo<OwnerWallet | null>(
    () =>
      wallet
        ? {
            signTypedData: ((payload: never) =>
              withWallet((client) =>
                client.signTypedData({
                  account: undefined,
                  ...(payload as object),
                } as never),
              )) as OwnerWallet["signTypedData"],
            sendTransaction: ((call: { to: Address; data: Hex }) =>
              withWallet((client) => client.sendTransaction(call as never))) as OwnerWallet["sendTransaction"],
          }
        : null,
    [wallet, withWallet],
  );

  const runSetup = async () => {
    if (!account || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const provider = (await wallet.getEthereumProvider()) as RawHashProvider;
      const prepared = await golPost<PreparedEip7702Setup>("/api/gol/eip7702/prepare", {
        account,
      });
      const body = await signPreparedEip7702Setup(
        {
          ...(prepared.authorization
            ? {
                authorization: {
                  signAuthorization: (request: {
                    chainId: number;
                    address: Address;
                    nonce: number;
                  }) =>
                    signAuthorization({
                      contractAddress: request.address,
                      chainId: request.chainId,
                      nonce: request.nonce,
                    }),
                },
              }
            : {}),
          initialization: privyRawHashSigner(provider),
        },
        prepared,
        { account },
      );
      const submitted = await golPost<Eip7702Setup>("/api/gol/eip7702/submit", {
        account,
        ...(body as unknown as Record<string, unknown>),
      });
      setSetup({ id: submitted.id, state: submitted.state });
      setStep("setup-pending");
      setNote(
        "GOL's relayer is sending the setup at GOL's cost, within a daily limit of " +
          `${configuration?.eip7702.sponsorship.perProjectDailyLimit ?? 20} per project. ` +
          "It confirms at Base's safe head, which is behind the latest head, so this " +
          "can take about ten minutes. The page polls and does not block.",
      );
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const runApproval = async (values: MandateFormValues) => {
    if (!account || !agent) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await golPost<PreparedGasPolicy>(
        "/api/gol/prepare-policy",
        formToRequest(values, account, agent),
      );

      // The SDK recomputes every ID and digest, checks the relayer mode and the
      // caps against what the owner was shown, and only then asks for one
      // eth_signTypedData_v4 signature.
      const call = await signPreparedGasPolicy(
        { signTypedData: (payload) => ownerWallet!.signTypedData(payload as never) },
        prepared,
        {
          agent: agent as Address,
          recipients: values.contacts.map((contact) => contact.address as Address),
          maxPerActionBaseUnits: BigInt(values.maxPerActionBaseUnits),
          maxTotalBaseUnits: BigInt(values.maxTotalBaseUnits),
          maxGasPerActionWei: BigInt(values.maxPerActionWei),
          maxGasTotalWei: BigInt(values.maxTotalWei),
          chargeableOutcomesMask: values.chargeableOutcomesMask,
          relayer: { mode: "gol" },
        },
      );
      const txHash = await ownerWallet!.sendTransaction(call);
      setPending({ draftId: prepared.draftId, txHash });
      setStep("approval-pending");
      setNote(
        "Approval sent. GOL confirms at Base's safe head, which is behind the " +
          "latest head, so this can take several minutes.",
      );
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  // Poll the approval until GOL has seen it at the head it settles at.
  useEffect(() => {
    if (step !== "approval-pending" || !pending || !account) return;
    const timer = setInterval(async () => {
      try {
        const result = await golPost<{ status?: string }>("/api/gol/confirm-policy", {
          account,
          draftId: pending.draftId,
          transactionHash: pending.txHash,
        });
        if (result.status === "confirmed") {
          setPending(null);
          setStep("active");
          await refresh();
        }
      } catch {
        // Keep polling. A transient read is not a failure.
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [account, pending, refresh, step]);

  // Poll the sponsored setup the same way.
  useEffect(() => {
    if (step !== "setup-pending" || !setup || !account) return;
    const timer = setInterval(async () => {
      try {
        const next = await golPost<Eip7702Setup>("/api/gol/eip7702/status", {
          account,
          setupId: setup.id,
        });
        setSetup({ id: next.id, state: next.state });
        if (next.state === "confirmed") {
          setNote("The core is installed. You can approve a mandate now.");
          setStep("mandate");
        } else if (next.state === "failed") {
          setNote(`Setup failed: ${next.failureReason ?? "no reason given"}`);
        }
      } catch {
        // Keep polling.
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [account, setup, step]);

  if (!ready) {
    return <main className="p-10 text-neutral-500">Loading Privy...</main>;
  }

  if (!wallet || !account) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">GOL mandate demo</h1>
        <p className="mt-3 text-neutral-600">
          The owner is a Privy embedded wallet. GOL delegates it and installs its own
          core. The address, USDC, and ETH never change.
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Owner</h1>
        <span className="font-mono text-xs text-neutral-500">
          {shortAddress(account)} agent {agent ? shortAddress(agent) : "..."}
        </span>
      </header>

      {status && (
        <p className="mt-2 font-mono text-xs text-neutral-500">
          {status.accountKind} family {status.family ?? "unknown"} core{" "}
          {status.coreInstalled ? "installed" : "not installed"}
          {status.delegation
            ? `, delegate ${shortAddress(status.delegation.delegate ?? "0x0")} reviewed ${String(
                status.delegation.reviewed,
              )} initialised ${String(status.delegation.initialized)}`
            : ", no delegation"}
        </p>
      )}

      {note && <p className="mt-3 rounded-md bg-blue-50 p-3 text-sm">{note}</p>}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">{error}</p>
      )}

      <div className="mt-6 space-y-5">
        {(step === "setup" || step === "initialise") && (
          <section className="rounded-lg border border-neutral-300 bg-white p-5">
            <h2 className="font-semibold">Enable the agent</h2>
            <p className="mt-1 text-sm text-neutral-600">
              {step === "initialise"
                ? "This address is already delegated to the reviewed delegate, but the core is not installed. GOL installs it, reusing the existing delegation rather than asking for a new one."
                : "GOL delegates this address to the reviewed Biconomy Nexus 1.3.3 delegate and installs its core as the only executor. Two signatures. GOL pays for the transaction, within a daily limit."}
            </p>
            <button
              type="button"
              onClick={() => void runSetup()}
              disabled={busy}
              className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
            >
              {busy ? "Waiting for your signatures..." : "Sign and enable"}
            </button>
          </section>
        )}

        {step === "delegated-elsewhere" && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold">This address is delegated somewhere else</h2>
            <p className="mt-1 text-sm">
              GOL only supports delegation to the reviewed Nexus 1.3.3 delegate, and
              refuses anything else with <code>account_integration_invalid</code>. Clear
              the delegation in your own wallet first, then reload. This page cannot do
              it for you.
            </p>
          </section>
        )}

        {step === "setup-pending" && (
          <section className="rounded-lg border border-neutral-300 bg-white p-5">
            <h2 className="font-semibold">Setting up</h2>
            <p className="mt-1 text-sm text-neutral-600">
              GOL&apos;s relayer is sending the setup. State {setup?.state}. This page
              polls every 5 seconds and does not block.
            </p>
          </section>
        )}

        {step === "mandate" && configuration && agent && (
          <MandateForm
            configuration={configuration}
            agent={agent}
            onSubmit={(values) => void runApproval(values)}
            busy={busy}
            error={error}
          />
        )}

        {step === "approval-pending" && pending && (
          <section className="rounded-lg border border-neutral-300 bg-white p-5">
            <h2 className="font-semibold">Waiting for the approval to confirm</h2>
            <p className="mt-1 text-sm text-neutral-600">
              GOL confirms at Base&apos;s safe head, which is behind the latest head and
              advances in jumps. Polling every 5 seconds.
            </p>
            <a
              className="mt-2 inline-block font-mono text-xs underline"
              href={BASESCAN_TX(pending.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              {pending.txHash}
            </a>
          </section>
        )}

        {step === "active" && policy && configuration && (
          <>
            <PolicySummaryView policy={policy} />
            <OwnerControls
              policy={policy}
              account={account}
              ownerWallet={ownerWallet}
              onDone={(action: SafetyActionName, hash: string) => {
                setNote(`${action} sent. GOL confirms at the safe head, which lags.`);
                void refresh();
                if (action === "revoke") {
                  setPending({ draftId: "", txHash: hash as Hex });
                }
              }}
            />
            <ProofPanel
              account={account}
              gasPolicyId={policy.gasPolicyId}
              core={configuration.core as Address}
              usdc={configuration.asset.address as Address}
              assetDecimals={configuration.asset.decimals}
            />
          </>
        )}

        {policiesLoading && !policy && step !== "active" && (
          <p className="text-sm text-neutral-500">Looking for your mandate...</p>
        )}
      </div>

      <p className="mt-10 text-xs text-neutral-400">
        Signed in as {user?.email?.address ?? "unknown"}. Base Sepolia testnet only.
      </p>
    </main>
  );
}

const describe = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

function PolicySummaryView({ policy }: { policy: PolicySummary }) {
  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-5">
      <h2 className="font-semibold">Your mandate is {policy.status}</h2>
      <dl className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-neutral-500">gas cap per action: </dt>
          <dd className="inline">{policy.maxPerActionWei} wei</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">gas spent: </dt>
          <dd className="inline">{policy.spentWei} wei</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">gas remaining: </dt>
          <dd className="inline">{policy.remainingWei} wei</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">pays for refusals: </dt>
          <dd className="inline">{policy.chargeableOutcomesMask === 3 ? "yes" : "no"}</dd>
        </div>
        {policy.approvalTransactionHash && (
          <div className="sm:col-span-2">
            <dt className="inline text-neutral-500">approval: </dt>
            <dd className="inline">
              <a
                className="underline"
                href={BASESCAN_TX(policy.approvalTransactionHash)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(policy.approvalTransactionHash, 10, 6)}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
