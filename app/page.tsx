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
 *   3. delegated elsewhere        the owner can remove it, or not
 *   4. delegated, not initialised  initialisation only
 *   5. setup submitted            poll
 *   6. core installed, no policy  the approval form
 *   7. approval sent              poll
 *   8. active                     caps, controls, and proof
 *
 * Which step applies is derived in `lib/account-status.ts`, not here, so the rules
 * can be tested without a wallet. This page only renders what that function says
 * and provides the two things it cannot: a wallet and a place to sign.
 */
import {
  signPreparedEip7702Setup,
  signPreparedGasPolicy,
  type OwnerSigner,
  type Eip7702Setup,
  type PreparedEip7702Setup,
  type PreparedGasPolicy,
  type SafetyActionName,
} from "@gol/sdk";
import { useLogin, useSign7702Authorization, useSignTypedData, useUser, useWallets } from "@privy-io/react-auth";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { currentDelegate, deriveStep, type AccountStatus, type Step } from "@/lib/account-status";
import {
  diagnoseAuthorization,
  type AuthorizationSigned,
  type AuthorizationDiagnosis,
} from "@/lib/authorization-diagnosis";
import { BASE_SEPOLIA, BASESCAN_TX, shortAddress } from "@/lib/chain";
import { golGet, golPost } from "@/lib/gol-client";
import { saveContacts } from "@/lib/contact-storage";
import { contactsAreValid } from "@/lib/contacts";
import { clearPendingApproval, loadPendingApproval, savePendingApproval, type PendingApproval } from "@/lib/pending-approval";
import { privyRawHashSigner, boundPrivyAuthorization, type RawHashProvider } from "@/lib/privy-signers";
import type { ClearDelegationRequest } from "@/lib/undelegate";
import { usePolicy, type PolicySummary } from "@/lib/use-policy";
import { providerChainId, walletChainId } from "@/lib/wallet-chain";
import { AuthorizationFinding } from "@/components/authorization-finding";
import { CopyValue } from "@/components/copy-address";
import {
  MandateForm,
  formToRequest,
  type GasConfiguration,
  type MandateFormValues,
} from "@/components/mandate-form";
import { OwnerBalance } from "@/components/owner-balance";
import { OwnerControls, type OwnerWallet } from "@/components/owner-controls";
import { ProofPanel } from "@/components/proof-panel";
import { RemoveDelegation } from "@/components/remove-delegation";
import { SignOutButton } from "@/components/sign-out-button";

type FullConfiguration = GasConfiguration & {
  relayer: string;
  eip7702: { delegate: string; sponsorship: { available: boolean; perProjectDailyLimit: number } };
};

export default function OwnerPage() {
  const { login } = useLogin();
  const { user } = useUser();
  const { wallets, ready } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  const { signTypedData } = useSignTypedData();

  const wallet = useMemo(
    () => wallets.find((candidate) => candidate.walletClientType === "privy"),
    [wallets],
  );
  const account = wallet?.address as Address | undefined;

  const [configuration, setConfiguration] = useState<FullConfiguration | null>(null);
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [note, setNote] = useState("");
  const [approvalIncluded, setApprovalIncluded] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [signedApproval, setSignedApproval] = useState<{
    account: Address;
    draftId: string;
    call: { to: Address; data: Hex };
    contacts: MandateFormValues["contacts"];
  } | null>(null);
  const [setup, setSetup] = useState<{ id: string; state: string; inclusion?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which of the five possible causes a bad EIP-7702 authorization had, when one
  // does. Null until a signature is refused.
  const [finding, setFinding] = useState<AuthorizationDiagnosis | null>(null);
  // Bumped to re-read the account from GOL. The only reason to do that on demand
  // is a change the page just made itself, so it is a counter rather than a flag.
  const [statusEpoch, setStatusEpoch] = useState(0);
  const reloadStatus = useCallback(() => setStatusEpoch((epoch) => epoch + 1), []);

  const { policy, refresh, loading: policiesLoading, remember } = usePolicy(account);

  useEffect(() => {
    // A changed Privy wallet must not inherit any in-memory approval or status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null);
    setSignedApproval(null);
    setStatus(null);
    setStep("loading");
  }, [account]);

  useEffect(() => {
    if (!account) return;
    if (policy) {
      clearPendingApproval(account);
      return;
    }
    const saved = loadPendingApproval(account);
    if (saved) {
      // localStorage is an external source that restores an in-flight approval.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(saved);
      setStep("approval-pending");
    }
  }, [account, policy]);

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
        const next = await golPost<AccountStatus>("/api/gol/account-status", { account });
        if (cancelled) return;
        setStatus(next);
        setStep((current) => deriveStep(next, current));
      } catch (caught) {
        if (!cancelled) setError(describe(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, statusEpoch]);

  useEffect(() => {
    // A live policy means the owner is past approval, whatever else is true.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (policy) setStep("active");
  }, [policy]);

  /**
   * Privy's EIP-1193 provider, wrapped as a viem wallet client for owner-paid
   * transactions. Rebuilt per call so a chain switch takes effect. Typed data
   * uses Privy's address-bound hook in `ownerWallet` below.
   *
   * Two things are not optional here, and both were found by running it:
   *
   *  - **`account`.** The owner address must be on the client so the transaction
   *    names the delegated EOA as its sender. Typed-data signing separately pins
   *    the same address in Privy's hook.
   *
   *  - **The chain.** Privy holds a wallet on one chain at a time, and
   *    `eth_sendTransaction` refuses with "The current chain of the wallet does not
   *    match the target chain", naming chain 1 against the expected 84532.
   *    Nothing about the demo is on mainnet, so the chain is stated on every
   *    request rather than assumed, and the provider is re-fetched afterwards
   *    because Privy's own note says a switch does not update an existing
   *    provider instance.
   *
   *    A switch is not sufficient on its own, which is worth recording because
   *    the first attempt did exactly this and still failed. Privy refuses to
   *    switch to a chain that has not been configured, and with no
   *    `supportedChains` the embedded wallet sits on mainnet with Base Sepolia
   *    unconfigured. `supportedChains` in `app/providers.tsx` is what makes the
   *    switch possible at all.
   *
   * Signatures are unaffected by the chain, which is why the sponsored setup
   * worked while the owner-paid approval did not: setup signatures went through
   * `secp256k1_sign`, which has no chain, and the relayer sent the transaction.
   */
  const withWallet = useCallback(
    async <T,>(
      use: (client: ReturnType<typeof createWalletClient>) => Promise<T>,
    ): Promise<T> => {
      if (!wallet || !account) throw new Error("no_embedded_wallet");
      if (walletChainId(wallet.chainId) !== BASE_SEPOLIA.id) {
        await wallet.switchChain(BASE_SEPOLIA.id);
      }
      const provider = (await wallet.getEthereumProvider()) as RawHashProvider;

      // Asked of the provider rather than of `wallet.chainId`, because that is
      // the number the wallet will compare the transaction against. A silent
      // disagreement here is the whole failure, and it is cheap to rule out.
      const providerChain = await providerChainId(provider);
      if (providerChain !== BASE_SEPOLIA.id) {
        throw new Error(
          `wallet_not_on_base_sepolia:wallet=${walletChainId(wallet.chainId)},provider=${providerChain}`,
        );
      }

      const client = createWalletClient({
        account,
        chain: BASE_SEPOLIA,
        transport: custom(provider as never),
      });
      return use(client);
    },
    [account, wallet],
  );

  const ownerWallet = useMemo<OwnerWallet | null>(
    () =>
      account
        ? {
            signTypedData: (async (payload: Parameters<OwnerSigner["signTypedData"]>[0]) => {
              // Privy's hook binds the signing wallet explicitly. Keep the wallet
              // prompt visible, so the owner sees the typed approval.
              const { signature } = await signTypedData(
                payload as Parameters<typeof signTypedData>[0],
                { address: account, uiOptions: { showWalletUIs: true } },
              );
              return signature as Hex;
            }) as OwnerWallet["signTypedData"],
            sendTransaction: ((call: { to: Address; data: Hex }) =>
              withWallet((client) => client.sendTransaction(call as never))) as OwnerWallet["sendTransaction"],
          }
        : null,
    [account, signTypedData, withWallet],
  );

  /**
   * Sends the type-4 transaction that carries a signed authorization to the
   * reset address. `from` is stated rather than left to the wallet's default: the
   * authorization was signed by this account's key, and a type-4 transaction
   * whose tuple belongs to a different authority would be mined and do nothing.
   */
  const sendClearTransaction = useCallback(
    async (request: ClearDelegationRequest): Promise<Hex> =>
      account
        ? withWallet((client) =>
            client.sendTransaction({ ...request, from: account } as never),
          )
        : Promise.reject(new Error("no_account")),
    [account, withWallet],
  );

  const handleDelegationCleared = useCallback(
    (hash: Hex, ok: boolean) => {
      setNote(
        ok
          ? `The clear transaction ${shortAddress(hash)} confirmed. Re-reading your account from the chain.`
          : `The clear transaction ${shortAddress(hash)} reverted. Re-reading your account to see what is actually there.`,
      );
      reloadStatus();
    },
    [reloadStatus],
  );

  // Privy's EIP-7702 signer, pinned to the owner. Privy signs with the first
  // linked wallet when it is not told which one, and a signature from another
  // wallet is well-formed yet recovers to a different account, which the SDK
  // refuses as a signer mismatch with no detail. Binding it here is what rules
  // that out.
  const boundSignAuthorization = useMemo(
    () =>
      account
        ? boundPrivyAuthorization(signAuthorization, account)
        : () => Promise.reject(new Error("no_account")),
    [account, signAuthorization],
  );

  const runSetup = async () => {
    if (!account || !wallet) return;
    setBusy(true);
    setError(null);
    setFinding(null);
    // Held so a refusal can be explained rather than only reported. The SDK
    // recovers the authority and throws one string; these two hold what was asked
    // for and what the wallet returned, so the page can say which of five causes
    // the mismatch was.
    let prepared: PreparedEip7702Setup | null = null;
    let signed: AuthorizationSigned | null = null;
    try {
      const provider = (await wallet.getEthereumProvider()) as RawHashProvider;
      prepared = await golPost<PreparedEip7702Setup>("/api/gol/eip7702/prepare", {
        account,
      });
      const body = await signPreparedEip7702Setup(
        {
          ...(prepared.authorization
            ? {
                authorization: {
                  signAuthorization: async (request: {
                    chainId: number;
                    address: Address;
                    nonce: number;
                  }) => {
                    // Bound to this account, so Privy cannot answer with a
                    // different linked wallet's key. See `boundPrivyAuthorization`.
                    const result = await boundSignAuthorization({
                      contractAddress: request.address,
                      chainId: request.chainId,
                      nonce: request.nonce,
                    });
                    signed = result;
                    return result;
                  },
                },
              }
            : {}),
          // The account is what makes the recovery byte decidable rather than
          // guessed. See `readRawSignature`.
          initialization: privyRawHashSigner(provider, account),
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
      // A mismatch means the signature recovered to some other account. Say
      // which of the five causes it was, using the tuple the wallet returned and
      // the tuple the API asked for.
      if (signed && prepared?.authorization) {
        setFinding(
          await diagnoseAuthorization(
            {
              account,
              chainId: BASE_SEPOLIA.id,
              address: prepared.authorization.address as Address,
              nonce: Number(BigInt(prepared.authorization.nonce)),
            },
            signed,
          ),
        );
      }
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
      setSignedApproval({ account, draftId: prepared.draftId, call, contacts: values.contacts });
      setNote("Signature complete. Review and send the approval transaction from your wallet.");
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const sendApproval = async () => {
    if (!account || !signedApproval || signedApproval.account.toLowerCase() !== account.toLowerCase() || !ownerWallet) return;
    setBusy(true);
    setError(null);
    try {
      const txHash = await ownerWallet.sendTransaction(signedApproval.call);
      const next = { draftId: signedApproval.draftId, txHash, contacts: signedApproval.contacts };
      savePendingApproval(account, next);
      setPending(next);
      setApprovalIncluded(false);
      setSignedApproval(null);
      setStep("approval-pending");
      setNote("Approval sent. Checking for inclusion on Base Sepolia.");
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOwnerActionDone = useCallback((action: SafetyActionName, hash: string) => {
    setNote(`${action} transaction ${shortAddress(hash)} confirmed at Base's safe head.`);
    void refresh();
  }, [refresh]);

  // Show checked inclusion promptly, then keep polling for durable confirmation.
  useEffect(() => {
    if (step !== "approval-pending" || !pending || !account) return;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await golPost<{ status?: string; policy?: { gasPolicyId: string } }>("/api/gol/confirm-policy", {
          account,
          draftId: pending.draftId,
          transactionHash: pending.txHash,
        });
        if (result.status === "included") {
          setApprovalIncluded(true);
          setNote("Approval included on Base Sepolia. This is provisional; GOL is checking the safe head.");
        }
        if (result.status === "orphaned") {
          setApprovalIncluded(false);
          setNote("The approval left the current Base Sepolia chain. GOL is checking for re-inclusion.");
        }
        if (result.status === "reverted" || result.status === "mismatch") {
          clearPendingApproval(account);
          setPending(null);
          setStep("mandate");
          setError(result.status === "reverted"
            ? "The approval transaction reverted. No mandate was approved."
            : "The transaction did not create the expected GOL approval.");
          return;
        }
        if (result.status === "confirmed") {
          if (result.policy?.gasPolicyId) {
            if (user?.id && contactsAreValid(pending.contacts)) {
              saveContacts(user.id, result.policy.gasPolicyId, pending.contacts);
            }
            remember(result.policy.gasPolicyId);
          }
          clearPendingApproval(account);
          setPending(null);
          setStep("active");
          await refresh();
        }
      } catch (caught) {
        // A network failure can recover. A rejected draft or reverted approval
        // cannot, and polling it forever would hide the actual problem.
        const code = caught instanceof Error ? caught.name : "";
        if (["invalid_request", "conflict", "not_found"].includes(code)) {
          clearPendingApproval(account);
          setPending(null);
          setStep("mandate");
          setError(describe(caught));
        }
      } finally { inFlight = false; }
    };
    void check();
    const timer = setInterval(() => void check(), approvalIncluded ? 10_000 : 1_000);
    return () => clearInterval(timer);
  }, [account, approvalIncluded, pending, refresh, remember, step, user?.id]);

  // Poll the sponsored setup the same way.
  const setupId = setup?.id;
  useEffect(() => {
    if (step !== "setup-pending" || !setupId || !account) return;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await golPost<Eip7702Setup & { inclusion?: string | null }>("/api/gol/eip7702/status", {
          account,
          setupId,
        });
        setSetup({ id: next.id, state: next.state, inclusion: next.inclusion });
        if (next.state === "confirmed") {
          setNote("The core is installed. You can approve a mandate now.");
          setStep("mandate");
        } else if (next.state === "failed") {
          setNote(`Setup failed: ${next.failureReason ?? "no reason given"}`);
        }
      } catch {
        // Keep polling.
      } finally { inFlight = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => clearInterval(timer);
  }, [account, setupId, step]);

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

  // The delegate, or null for an account that is not delegated at all. Null is
  // the normal case for a wallet that has never been set up, and it is not a
  // problem to report.
  const delegate = currentDelegate(status);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Owner</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <CopyValue value={account} label="owner" explorer />
            {agent ? (
              <CopyValue value={agent} label="agent" lead={8} tail={6} explorer />
            ) : (
              <span className="font-mono text-xs text-neutral-500">agent ...</span>
            )}
          </div>
        </div>
        <SignOutButton />
      </header>

      {status && (
        <p className="mt-3 font-mono text-xs text-neutral-500">
          {status.accountKind} family {status.family ?? "unknown"} core{" "}
          {status.coreInstalled ? "installed" : "not installed"}
          {delegate ? (
            <>
              {" "}
              delegate <CopyValue value={delegate} lead={8} tail={6} explorer /> reviewed{" "}
              {String(status.delegation?.reviewed)} initialised{" "}
              {String(status.delegation?.initialized)}
            </>
          ) : (
            ", not delegated"
          )}
        </p>
      )}

      {note && <p className="mt-3 rounded-md bg-blue-50 p-3 text-sm">{note}</p>}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">{error}</p>
      )}
      {finding && (
        <div className="mt-3">
          <AuthorizationFinding diagnosis={finding} />
        </div>
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

        {step === "delegated-elsewhere" && delegate && !status?.coreInstalled && (
          <RemoveDelegation
            key={account}
            account={account}
            delegate={delegate as Address}
            signAuthorization={boundSignAuthorization}
            sendTransaction={sendClearTransaction}
            onCleared={handleDelegationCleared}
          />
        )}

        {step === "delegated-elsewhere" && delegate && status?.coreInstalled && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold">This address is delegated somewhere GOL did not review</h2>
            <p className="mt-1 text-sm">
              GOL supports delegation to one delegate only, the reviewed Biconomy Nexus 1.3.3,
              and refuses anything else with <code>account_integration_invalid</code>. This
              address points somewhere else:{" "}
              <CopyValue value={delegate} lead={8} tail={6} explorer />
            </p>
            <p className="mt-2 text-sm">
              Removing the delegation is <strong>not</strong> the way out of this one, and
              the page will not offer it. An earlier setup is still recorded in this
              address&apos;s own storage, because changing the delegation does not clear
              storage, so a cleared account would be a plain EOA that still believes it
              is set up. ADR 0019 has the recovery: restore the reviewed delegate and the
              account picks up where it left off. The demo does not install delegates,
              so that is the owner&apos;s side to do, and this page will not walk them
              into a half-repaired account instead.
            </p>
          </section>
        )}

        {step === "setup-pending" && (
          <section className="rounded-lg border border-neutral-300 bg-white p-5">
            <h2 className="font-semibold">Setting up</h2>
            <p className="mt-1 text-sm text-neutral-600">
              GOL&apos;s relayer is sending the setup. State {setup?.state}.
              {setup?.inclusion === "included"
                ? " Included on Base Sepolia, pending safe-head confirmation."
                : setup?.inclusion === "orphaned"
                  ? " The setup left the current chain. GOL is checking for re-inclusion."
                  : setup?.inclusion === "reverted" || setup?.inclusion === "mismatch"
                    ? " The setup did not complete on-chain."
                    : " Checking for inclusion."}
              {" "}This page checks every second.
            </p>
          </section>
        )}

        {step === "mandate" && configuration && agent && (
          <>
            <OwnerBalance
              key={account}
              account={account}
              perActionWei={BigInt(configuration.limits.maxPerActionWei)}
            />
            {!signedApproval && <MandateForm
              configuration={configuration}
              agent={agent}
              onSubmit={(values) => void runApproval(values)}
              busy={busy}
              error={error}
            />}
            {signedApproval && (
              <section className="rounded-lg border border-neutral-300 bg-white p-5">
                <h2 className="font-semibold">Signature ready</h2>
                <p className="mt-2 text-sm text-neutral-600">
                  Send the signed approval from your wallet. This transaction uses your Base Sepolia ETH.
                </p>
                <div className="mt-4 flex gap-3">
                  <button type="button" disabled={busy} onClick={() => void sendApproval()}
                    className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">
                    {busy ? "Waiting for your wallet..." : "Send approval transaction"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setSignedApproval(null)}
                    className="rounded-md border border-neutral-300 px-4 py-2 disabled:opacity-40">Cancel</button>
                </div>
              </section>
            )}
          </>
        )}

        {step === "approval-pending" && pending && (
          <section className="rounded-lg border border-neutral-300 bg-white p-5">
            <h2 className="font-semibold">Approval status</h2>
            <p className="mt-1 text-sm text-neutral-600">
              {approvalIncluded
                ? "Included on Base Sepolia. GOL is still checking the safe head before final confirmation. Checking every 10 seconds."
                : "Checking for inclusion through Alchemy RPC. Checking every second."}
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
            {policy.status === "active" && (
              <section className="rounded-lg bg-neutral-900 p-5 text-white">
                <h2 className="font-semibold">Next: talk to the agent</h2>
                <p className="mt-1 text-sm text-neutral-200">
                  Ask the agent to send Base Sepolia USDC to a payee you approved. Its
                  transfers use this mandate, and the proof below shows what happened.
                </p>
                <Link
                  href="/agent"
                  className="mt-4 inline-block rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900"
                >
                  Open agent chat
                </Link>
              </section>
            )}
            <OwnerControls
              key={`${account}:${policy.gasPolicyId}`}
              policy={policy}
              account={account}
              ownerWallet={ownerWallet}
              onDone={handleOwnerActionDone}
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
