"use client";

/**
 * Privy signing test (work-order step 3).
 *
 * Runs the sponsored `nexus7702` setup with the Privy embedded EOA as the
 * owner, and records what Privy actually did. The point is the findings, not
 * the demo: whether Privy signs an EIP-7702 authorization for chain 84532 with
 * an explicit nonce, what recovery byte `secp256k1_sign` returns, what the
 * confirmation modals look like, and how long the hosted relayer takes to
 * confirm.
 *
 * The address, USDC, and ETH must be unchanged before and after.
 */

import {
  signPreparedEip7702Setup,
  type Eip7702Setup,
  type PreparedEip7702Setup,
} from "@gol/sdk";
import { useLogin, useSign7702Authorization, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_RPC_URL, BASESCAN_TX, shortAddress } from "@/lib/chain";
import {
  diagnoseAuthorization,
  type AuthorizationDiagnosis,
  type AuthorizationSigned,
} from "@/lib/authorization-diagnosis";
import { errorCode, golGet, golPost } from "@/lib/gol-client";
import { AuthorizationFinding } from "@/components/authorization-finding";
import {
  boundPrivyAuthorization,
  privyAuthorizationSigner,
  privyRawHashSigner,
  type RawHashProvider,
  type RawSignatureObservation,
} from "@/lib/privy-signers";
import { readRawSignature } from "@/lib/raw-signature";
import { providerChainId, walletChainId } from "@/lib/wallet-chain";

type GasConfiguration = {
  core: `0x${string}`;
  relayer: `0x${string}`;
  asset: { address: `0x${string}`; symbol: string; decimals: number };
  eip7702: { delegate: `0x${string}`; sponsorship: { available: boolean } };
  limits: { recommendedPerActionWei: string; maxPerActionWei: string; maxTotalWei: string };
};

type Balances = { eth: string; usdc: string };

type Finding = { at: string; label: string; detail: string };

const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function formatUnits(value: bigint, decimals: number, places = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export default function SpikePage() {
  const { login } = useLogin();
  const { wallets, ready } = useWallets();
  const { signAuthorization } = useSign7702Authorization();

  // `walletClientType` is optional in Privy's type, so matching on it alone would
  // silently find nothing and look like a failed login. Prefer the Privy wallet,
  // fall back to any linked wallet that can produce an EIP-1193 provider, and
  // surface what is actually there when neither matches.
  const { wallet, rejectedTypes } = useMemo(() => {
    const usable = wallets.filter((candidate) =>
      typeof candidate.getEthereumProvider === "function",
    );
    const privy = usable.find(
      (candidate) => candidate.walletClientType === "privy",
    );
    return {
      wallet: privy ?? usable[0],
      rejectedTypes: wallets.map(
        (candidate) => candidate.walletClientType ?? "unspecified",
      ),
    };
  }, [wallets]);
  const account = wallet?.address as `0x${string}` | undefined;

  // Privy's EIP-7702 signer pinned to this account, so a finding about a
  // recovered address can never be caused by signing with the wrong linked
  // wallet. See `boundPrivyAuthorization` for why that matters.
  const boundSignAuthorization = useMemo(
    () =>
      account
        ? boundPrivyAuthorization(signAuthorization, account)
        : () => Promise.reject(new Error("no_account")),
    [account, signAuthorization],
  );

  const [configuration, setConfiguration] = useState<GasConfiguration | null>(null);
  const [provider, setProvider] = useState<RawHashProvider | null>(null);
  const [balancesBefore, setBalancesBefore] = useState<Balances | null>(null);
  const [balancesAfter, setBalancesAfter] = useState<Balances | null>(null);
  const [prepared, setPrepared] = useState<PreparedEip7702Setup | null>(null);
  const [setup, setSetup] = useState<Eip7702Setup | null>(null);
  const [observations, setObservations] = useState<RawSignatureObservation[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diagnosis, setDiagnosis] = useState<AuthorizationDiagnosis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Set on mount rather than during render, so the render stays pure. Every
  // `note` call happens from an async handler after mount, so the ref is always
  // populated by the time it is read.
  const startedAt = useRef<number>(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const note = useCallback((label: string, detail: string) => {
    const seconds = ((Date.now() - startedAt.current) / 1000).toFixed(1);
    setFindings((previous) => [
      ...previous,
      { at: `${seconds}s`, label, detail },
    ]);
  }, []);

  const publicClient = useMemo(
    () => createPublicClient({ chain: BASE_SEPOLIA, transport: http(BASE_SEPOLIA_RPC_URL) }),
    [],
  );

  const readBalances = useCallback(
    async (address: `0x${string}`, config: GasConfiguration): Promise<Balances> => {
      const [eth, usdc] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: config.asset.address,
          abi: usdcAbi,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);
      return { eth: formatUnits(eth, 18), usdc: formatUnits(usdc, config.asset.decimals) };
    },
    [publicClient],
  );

  // Load the configuration once a wallet exists, then read the opening balances.
  useEffect(() => {
    if (!account || configuration) return;
    let cancelled = false;
    (async () => {
      try {
        const config = await golGet<GasConfiguration>("/api/gol/config");
        if (cancelled) return;
        setConfiguration(config);
        note(
          "config",
          `core ${shortAddress(config.core)} asset ${config.asset.symbol} delegate ${shortAddress(config.eip7702.delegate)} sponsorship ${config.eip7702.sponsorship.available}`,
        );
        const balances = await readBalances(account, config);
        if (cancelled) return;
        setBalancesBefore(balances);
        note("balances before", `ETH ${balances.eth}, USDC ${balances.usdc}`);
      } catch (caught) {
        if (!cancelled) setError(errorCode(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, configuration, note, readBalances]);

  // Privy's EIP-1193 provider for the embedded wallet.
  useEffect(() => {
    if (!wallet || provider) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await wallet.getEthereumProvider();
        if (!cancelled) setProvider(resolved);
      } catch (caught) {
        if (!cancelled) setError(errorCode(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, provider]);

  /**
   * The provider, on Base Sepolia.
   *
   * A fresh Privy embedded wallet starts on mainnet, and a type-4 transaction
   * sent to the wrong chain is refused by the wallet rather than relayed. Signing
   * is unaffected, which is why the setup signatures succeed on any chain and the
   * owner-paid transactions do not. Privy's own note applies: switching does not
   * update an existing provider, so the provider is fetched after the switch.
   */
  const ensureProvider = useCallback(async (): Promise<RawHashProvider> => {
    if (!wallet) throw new Error("no_embedded_wallet");
    if (provider && walletChainId(wallet.chainId) === BASE_SEPOLIA.id) return provider;
    if (walletChainId(wallet.chainId) !== BASE_SEPOLIA.id) {
      await wallet.switchChain(BASE_SEPOLIA.id);
    }
    const resolved = await wallet.getEthereumProvider();

    // The provider is what `eth_sendTransaction` compares the transaction
    // against, so it is what has to be confirmed. Privy refuses to switch to a
    // chain that is not configured, which is why `supportedChains` in
    // `app/providers.tsx` is load-bearing and not decoration.
    const chain = await providerChainId(resolved);
    if (chain !== BASE_SEPOLIA.id) {
      throw new Error(`wallet_not_on_base_sepolia:provider=${chain}`);
    }

    setProvider(resolved);
    return resolved;
  }, [provider, wallet]);

  const runPrepare = useCallback(async () => {
    if (!account) return;
    setBusy("prepare");
    setError(null);
    try {
      const result = await golPost<PreparedEip7702Setup>("/api/gol/eip7702/prepare", {
        account,
      });
      setPrepared(result);
      note(
        "prepare",
        `delegation ${result.delegation}, authorization ${result.authorization ? "required" : "not required"}, init hash ${result.initDataHash.slice(0, 10)}...`,
      );
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(null);
    }
  }, [account, note]);

  const runSignAndSubmit = useCallback(async () => {
    if (!account || !prepared) return;
    setBusy("sign");
    setError(null);
    const local: RawSignatureObservation[] = [];
    // Held so a refused authorization can be explained rather than only
    // reported. The SDK throws one string; this holds the tuple the wallet
    // returned so the page can name which of five causes it was.
    let signed: AuthorizationSigned | null = null;
    setDiagnosis(null);
    try {
      const resolved = await ensureProvider();

      // A raw-hash probe first, so the recovery byte is known and reported even
      // if the SDK rejects the signature before it reaches the chain. The SDK
      // asks for the same hash, so this doubles as the SDK's own signature.
      const raw = (await resolved.request({
        method: "secp256k1_sign",
        params: [prepared.initDataHash as Hex],
      })) as Hex;
      // Read the same signature the SDK is about to ask for, so the finding is
      // recorded even if the SDK refuses it later.
      const observation = await readRawSignature(
        raw,
        prepared.initDataHash as Hex,
        account,
      );
      local.push(observation);
      note(
        "secp256k1_sign",
        `last byte ${observation.rawByteHex} (${observation.rawByte}), read as ${observation.encoding}, reports parity ${
          observation.reportedYParity ?? "nothing usable"
        }, actual parity ${observation.derivedYParity}, byte agrees ${observation.byteAgrees}`,
      );

      const body = await signPreparedEip7702Setup(
        {
          ...(prepared.authorization
            ? {
                authorization: privyAuthorizationSigner(async (input) => {
                  const result = await boundSignAuthorization({
                    contractAddress: input.contractAddress,
                    chainId: input.chainId,
                    nonce: input.nonce,
                  });
                  signed = result;
                  return result;
                }),
              }
            : {}),
          initialization: privyRawHashSigner(resolved, account, local),
        },
        prepared,
        { account },
      );
      setObservations(local);
      note("sign", "SDK accepted both signatures and they recover to the account");

      setBusy("submit");
      const submitted = await golPost<Eip7702Setup>("/api/gol/eip7702/submit", {
        account,
        ...body,
      });
      setSetup(submitted);
      note(
        "submit",
        `setup ${submitted.id}, state ${submitted.state}, tx ${submitted.transactionHash ?? "pending"}`,
      );
    } catch (caught) {
      setObservations(local);
      setError(errorCode(caught));
      // A mismatch is the one refusal with more than one cause, and this page
      // exists to establish causes. Name it, log it, and show the numbers.
      if (signed && prepared.authorization) {
        const diagnosis = await diagnoseAuthorization(
          {
            account,
            chainId: BASE_SEPOLIA.id,
            address: prepared.authorization.address as `0x${string}`,
            nonce: Number(BigInt(prepared.authorization.nonce)),
          },
          signed,
        );
        setDiagnosis(diagnosis);
        note("authorization finding", `${diagnosis.finding}: ${diagnosis.detail}`);
      }
    } finally {
      setBusy(null);
    }
  }, [account, boundSignAuthorization, ensureProvider, note, prepared]);

  // Poll until the setup settles. The platform confirms at Base's `safe` head,
  // which on 2026-09-28 sat 77 to 99 blocks behind latest, so this can take
  // about ten minutes. It never blocks the page.
  useEffect(() => {
    if (!account || !setup) return;
    if (setup.state === "confirmed" || setup.state === "failed") return;
    const timer = setInterval(async () => {
      try {
        const next = await golPost<Eip7702Setup>("/api/gol/eip7702/status", {
          account,
          setupId: setup.id,
        });
        setSetup(next);
        if (next.state === "confirmed" || next.state === "failed") {
          note("setup settled", `state ${next.state}, tx ${next.transactionHash ?? "none"}`);
          if (configuration) {
            const balances = await readBalances(account, configuration);
            setBalancesAfter(balances);
            note("balances after", `ETH ${balances.eth}, USDC ${balances.usdc}`);
          }
        }
      } catch {
        // Keep polling. A transient status read is not a failure.
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [account, configuration, note, readBalances, setup]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Privy signing test</h1>
      <p className="mt-2 text-neutral-600">
        Sponsored EIP-7702 setup with the Privy embedded EOA as owner. The
        address, USDC, and ETH must not change.
      </p>

      {!ready ? (
        <p className="mt-6 text-neutral-500">Loading Privy...</p>
      ) : !wallet ? (
        <div className="mt-6 rounded-lg border border-neutral-300 bg-white p-6">
          <p>Not logged in. The demo owner is a Privy embedded wallet.</p>
          {rejectedTypes.length > 0 && (
            <p className="mt-2 font-mono text-xs text-amber-700">
              {wallets.length} wallet(s) linked but none usable:{" "}
              {rejectedTypes.join(", ")}
            </p>
          )}
          <button
            type="button"
            onClick={login}
            className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-white"
          >
            Log in with email
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="font-semibold">Owner</h2>
            <dl className="mt-2 space-y-1 font-mono text-sm">
              <div className="flex gap-2">
                <dt className="text-neutral-500">address</dt>
                <dd>{account}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-neutral-500">provider</dt>
                <dd>{provider ? "ready" : "pending"}</dd>
              </div>
            </dl>
          </section>

          {configuration && (
            <section className="rounded-lg border border-neutral-300 bg-white p-6 font-mono text-sm">
              <h2 className="font-sans font-semibold">Read from getGasConfiguration</h2>
              <dl className="mt-2 space-y-1">
                <div className="flex gap-2">
                  <dt className="text-neutral-500">core</dt>
                  <dd>{configuration.core}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-neutral-500">asset</dt>
                  <dd>
                    {configuration.asset.symbol} {configuration.asset.address} (
                    {configuration.asset.decimals} decimals)
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-neutral-500">relayer</dt>
                  <dd>{configuration.relayer}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-neutral-500">delegate</dt>
                  <dd>{configuration.eip7702.delegate}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-neutral-500">maxPerActionWei</dt>
                  <dd>{configuration.limits.maxPerActionWei}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="font-semibold">Balances</h2>
            <table className="mt-2 w-full font-mono text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1">when</th>
                  <th className="py-1">ETH</th>
                  <th className="py-1">USDC</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1">before</td>
                  <td>{balancesBefore?.eth ?? "-"}</td>
                  <td>{balancesBefore?.usdc ?? "-"}</td>
                </tr>
                <tr>
                  <td className="py-1">after</td>
                  <td>{balancesAfter?.eth ?? "-"}</td>
                  <td>{balancesAfter?.usdc ?? "-"}</td>
                </tr>
              </tbody>
            </table>
            {balancesBefore && balancesAfter && (
              <p
                className={`mt-2 text-sm ${
                  balancesBefore.eth === balancesAfter.eth &&
                  balancesBefore.usdc === balancesAfter.usdc
                    ? "text-emerald-700"
                    : "text-amber-700"
                }`}
              >
                {balancesBefore.eth === balancesAfter.eth &&
                balancesBefore.usdc === balancesAfter.usdc
                  ? "Unchanged, as expected."
                  : "Balances moved. The setup must not move funds."}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="font-semibold">Run</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={runPrepare}
                disabled={!configuration || busy !== null}
                className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
              >
                {busy === "prepare" ? "Preparing..." : "1. Prepare setup"}
              </button>
              <button
                type="button"
                onClick={runSignAndSubmit}
                disabled={!prepared || busy !== null}
                className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
              >
                {busy ? "Working..." : "2. Sign in Privy and submit"}
              </button>
            </div>

            {prepared && (
              <dl className="mt-4 space-y-1 font-mono text-xs">
                <div className="flex gap-2">
                  <dt className="text-neutral-500">delegation</dt>
                  <dd>{prepared.delegation}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-neutral-500">authorization</dt>
                  <dd>{prepared.authorization ? "owner must sign" : "not required"}</dd>
                </div>
                {prepared.authorization && (
                  <div className="flex gap-2">
                    <dt className="text-neutral-500">nonce</dt>
                    <dd>{prepared.authorization.nonce}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-neutral-500">initDataHash</dt>
                  <dd className="break-all">{prepared.initDataHash}</dd>
                </div>
              </dl>
            )}

            {setup && (
              <div className="mt-4 rounded-md bg-neutral-100 p-3 font-mono text-sm">
                <p>state: {setup.state}</p>
                {setup.transactionHash && (
                  <p>
                    tx:{" "}
                    <a
                      className="underline"
                      href={BASESCAN_TX(setup.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {setup.transactionHash}
                    </a>
                  </p>
                )}
                {setup.failureReason && (
                  <p className="text-red-700">{setup.failureReason}</p>
                )}
                <p className="text-xs text-neutral-500">
                  Confirms at Base&apos;s safe head, which lags latest. Polling
                  every 5s.
                </p>
              </div>
            )}
          </section>

          {diagnosis && <AuthorizationFinding diagnosis={diagnosis} />}

          {observations.length > 0 && (
            <section className="rounded-lg border border-neutral-300 bg-white p-6">
              <h2 className="font-semibold">Recovery byte findings</h2>
              <p className="mt-1 text-sm text-neutral-600">
                The byte is not trusted. For one hash and one <code>r || s</code>{" "}
                there are exactly two readings, and the one that recovers to the
                owner is the answer. The reported byte is shown next to it so the
                provider&apos;s encoding is a recorded fact rather than an
                assumption.
              </p>
              <table className="mt-2 w-full font-mono text-sm">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-1">last byte</th>
                    <th className="py-1">read as</th>
                    <th className="py-1">reported</th>
                    <th className="py-1">actual</th>
                    <th className="py-1">agrees</th>
                    <th className="py-1">handed on as</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((observation) => (
                    <tr key={`${observation.hash}-${observation.raw}`}>
                      <td>
                        {observation.rawByteHex} ({observation.rawByte})
                      </td>
                      <td>{observation.encoding}</td>
                      <td>
                        {observation.reportedYParity ?? "nothing usable"}
                      </td>
                      <td>{observation.derivedYParity}</td>
                      <td>{String(observation.byteAgrees)}</td>
                      <td>{observation.signature.slice(-2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="font-semibold">Log</h2>
            <ol className="mt-2 space-y-1 font-mono text-xs">
              {findings.map((finding, index) => (
                <li key={index} className="flex gap-3">
                  <span className="w-14 shrink-0 text-neutral-400">{finding.at}</span>
                  <span className="w-40 shrink-0 text-neutral-500">{finding.label}</span>
                  <span className="break-all">{finding.detail}</span>
                </li>
              ))}
            </ol>
            {error && (
              <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
