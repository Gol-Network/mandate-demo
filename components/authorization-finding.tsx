"use client";

/**
 * What the wallet actually signed, when it did not sign what was asked for.
 *
 * This is the demo's instrumentation, and it is deliberately blunt. An
 * authorization that does not recover to the owner is refused by the SDK with one
 * string, and a demo that only shows that string has learned nothing except that
 * something went wrong. This panel shows the five things that can cause it, says
 * which one happened, and prints the numbers behind that answer so the finding
 * can be checked against the chain rather than believed.
 *
 * It decides nothing. GOL's refusal is the authority and the chain is the record;
 * this only says which of five possibilities produced a local mismatch.
 */
import type { AuthorizationDiagnosis } from "@/lib/authorization-diagnosis";
import { CopyValue } from "./copy-address";

export function AuthorizationFinding({ diagnosis }: { diagnosis: AuthorizationDiagnosis }) {
  const { asked, reported, recovered, yParity } = diagnosis;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h3 className="font-semibold">
        {diagnosis.finding === "ok" ? "Authorization is correct" : "Authorization finding"}{" "}
        <code className="font-mono text-xs">{diagnosis.finding}</code>
      </h3>
      <p className="mt-1 text-sm">{diagnosis.detail}</p>

      <dl className="mt-3 grid gap-1 font-mono text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-neutral-500">asked: </dt>
          <dd className="inline break-all">
            chain {asked.chainId} nonce {asked.nonce} delegate {asked.address}
          </dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">wallet reported: </dt>
          <dd className="inline break-all">
            {reported.chainId === null && reported.nonce === null && reported.address === null
              ? "nothing, the wallet returned only a signature"
              : `chain ${reported.chainId ?? "?"} nonce ${reported.nonce ?? "?"} delegate ${
                  reported.address ?? "?"
                }`}
          </dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">recovered to: </dt>
          <dd className="inline">
            {recovered ? <CopyValue value={recovered} lead={10} tail={8} /> : "nothing"}
          </dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">with flipped parity: </dt>
          <dd className="inline">
            {diagnosis.recoveredWithOtherParity ? (
              <CopyValue value={diagnosis.recoveredWithOtherParity} lead={10} tail={8} />
            ) : (
              "nothing"
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">owner is: </dt>
          <dd className="inline">
            <CopyValue value={asked.account} lead={10} tail={8} />
          </dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">yParity used: </dt>
          <dd className="inline">{yParity ?? "none"}</dd>
        </div>
      </dl>
    </section>
  );
}
