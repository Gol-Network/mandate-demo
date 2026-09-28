"use client";

/**
 * The approval form: the one signature that creates the mandate and its gas
 * policy.
 *
 * The defaults are the live acceptance values, except the gas caps, which are
 * read from `getGasConfiguration` rather than written down, because GOL's
 * maximum moved by a factor of ten after those figures were recorded.
 *
 * The `chargeableOutcomesMask` checkbox is a real owner decision and is shown as
 * one. On means the owner pays network gas for attempts their own agent signed,
 * including the ones the mandate refused. Off means GOL absorbs those.
 */
import { useMemo, useState } from "react";
import { MandateContactsEditor, emptyContact } from "./mandate-contacts-editor";
import { contactAddresses, contactsAreValid, type Contact } from "@/lib/contacts";
import { shortAddress } from "@/lib/chain";

const SEVEN_DAYS = 7 * 86400;

export interface GasConfiguration {
  core: `0x${string}`;
  asset: { address: `0x${string}`; symbol: string; decimals: number };
  limits: { recommendedPerActionWei: string; maxPerActionWei: string; maxTotalWei: string };
}

export interface MandateFormValues {
  /** Per-transfer cap in USDC base units (6 decimals). */
  maxPerActionBaseUnits: string;
  /** Total budget in USDC base units. */
  maxTotalBaseUnits: string;
  maxPerActionWei: string;
  maxTotalWei: string;
  chargeableOutcomesMask: number;
  mandateExpiresAt: number;
  gasExpiresAt: number;
  contacts: Contact[];
}

export function MandateForm({
  configuration,
  agent,
  onSubmit,
  busy,
  error,
}: {
  configuration: GasConfiguration;
  agent: string;
  onSubmit: (values: MandateFormValues) => void;
  busy: boolean;
  error: string | null;
}) {
  const [maxPerActionWei, setMaxPerActionWei] = useState(configuration.limits.maxPerActionWei);
  const [maxTotalWei, setMaxTotalWei] = useState(configuration.limits.maxTotalWei);
  const [payForRefusals, setPayForRefusals] = useState(true);
  const [maxPerActionUsdc, setMaxPerActionUsdc] = useState("1");
  const [totalUsdc, setTotalUsdc] = useState("5");
  const [contacts, setContacts] = useState<Contact[]>([emptyContact(), emptyContact()]);

  const decimals = configuration.asset.decimals;
  const toBaseUnits = (input: string): bigint | null => {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
    if (!match) return null;
    const whole = match[1] ?? "0";
    const fraction = match[2] ?? "";
    if (fraction.length > decimals) return null;
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  };

  const perAction = toBaseUnits(maxPerActionUsdc);
  const total = toBaseUnits(totalUsdc);
  const contactsOk = contactsAreValid(contacts);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (perAction === null) list.push("Per-transfer amount is not a valid number.");
    if (total === null) list.push("Total budget is not a valid number.");
    if (perAction !== null && total !== null && perAction > total) {
      list.push("The per-transfer cap cannot be above the total budget.");
    }
    if (!contactsOk) list.push("Fix the payee table before approving.");
    try {
      BigInt(maxPerActionWei);
      BigInt(maxTotalWei);
    } catch {
      list.push("The gas caps must be whole numbers of wei.");
    }
    return list;
  }, [contactsOk, maxPerActionWei, maxTotalWei, perAction, total]);

  const ready = problems.length === 0 && !busy;

  const submit = () => {
    if (!ready || perAction === null || total === null) return;
    onSubmit({
      maxPerActionBaseUnits: perAction.toString(),
      maxTotalBaseUnits: total.toString(),
      maxPerActionWei,
      maxTotalWei,
      chargeableOutcomesMask: payForRefusals ? 3 : 1,
      mandateExpiresAt: Math.floor(Date.now() / 1000) + SEVEN_DAYS,
      gasExpiresAt: Math.floor(Date.now() / 1000) + SEVEN_DAYS,
      contacts,
    });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-neutral-300 bg-white p-5">
        <h2 className="font-semibold">What the agent may spend</h2>
        <p className="mt-1 text-sm text-neutral-600">
          {configuration.asset.symbol} on Base Sepolia, from your own wallet. The agent
          holds nothing of its own.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="block text-xs text-neutral-500">
              Per transfer ({configuration.asset.symbol})
            </span>
            <input
              value={maxPerActionUsdc}
              onChange={(event) => setMaxPerActionUsdc(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label>
            <span className="block text-xs text-neutral-500">
              Total budget ({configuration.asset.symbol})
            </span>
            <input
              value={totalUsdc}
              onChange={(event) => setTotalUsdc(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
            />
          </label>
        </div>
      </section>

      <MandateContactsEditor rows={contacts} onChange={setContacts} disabled={busy} />

      <section className="rounded-lg border border-neutral-300 bg-white p-5">
        <h2 className="font-semibold">Network gas you will pay</h2>
        <p className="mt-1 text-sm text-neutral-600">
          GOL&apos;s relayer sends each transfer and is repaid from your ETH in the same
          transaction, within these caps.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="block text-xs text-neutral-500">
              Per action (wei). GOL&apos;s maximum is{" "}
              {configuration.limits.maxPerActionWei}
            </span>
            <input
              value={maxPerActionWei}
              onChange={(event) => setMaxPerActionWei(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label>
            <span className="block text-xs text-neutral-500">Total (wei)</span>
            <input
              value={maxTotalWei}
              onChange={(event) => setMaxTotalWei(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
            />
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2">
          <input
            type="checkbox"
            checked={payForRefusals}
            onChange={(event) => setPayForRefusals(event.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">
              Also pay network gas for attempts my mandate refuses
            </span>
            <span className="block text-neutral-600">
              On pays for refusals too, so a refused transfer costs you gas and leaves a
              record on chain. Off means GOL absorbs the gas for refused attempts and no
              value moves either way.
            </span>
          </span>
        </label>
        <p className="mt-2 font-mono text-xs text-neutral-500">
          chargeableOutcomesMask {payForRefusals ? 3 : 1}
        </p>
      </section>

      <section className="rounded-lg border border-neutral-300 bg-white p-5">
        <h2 className="font-semibold">Approve</h2>
        <p className="mt-1 text-sm text-neutral-600">
          One signature, then your own wallet sends the transaction. Expires in 7 days.
          Agent: <span className="font-mono">{shortAddress(agent)}</span>
        </p>
        {problems.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-red-700">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
        >
          {busy ? "Waiting for your signature..." : "Sign mandate approval"}
        </button>
        {error && (
          <p className="mt-3 rounded-md bg-red-50 p-3 font-mono text-sm text-red-800">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

/** The prepared-policy input the browser sends to the server. */
export const formToRequest = (
  values: MandateFormValues,
  account: string,
  agent: string,
) => ({
  account,
  agent,
  family: "nexus7702",
  recipients: contactAddresses(values.contacts),
  maxPerActionBaseUnits: values.maxPerActionBaseUnits,
  maxTotalBaseUnits: values.maxTotalBaseUnits,
  maxPerActionWei: values.maxPerActionWei,
  maxTotalWei: values.maxTotalWei,
  chargeableOutcomesMask: values.chargeableOutcomesMask,
  mandateExpiresAt: values.mandateExpiresAt,
  gasExpiresAt: values.gasExpiresAt,
});
