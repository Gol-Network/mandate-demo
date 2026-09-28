/**
 * Compile the owner's approval: the transfer mandate and its gas policy.
 *
 * Creates no authority and moves nothing. The owner has not signed anything yet
 * when this returns; the browser collects one `eth_signTypedData_v4` signature
 * afterwards and the EOA sends the transaction itself.
 */
import type { PrepareGasPolicyInput, PreparedGasPolicy } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

type Body = {
  account?: string;
  agent?: string;
  family?: string;
  recipients?: string[];
  maxPerActionBaseUnits?: string;
  maxTotalBaseUnits?: string;
  mandateValidFrom?: number;
  mandateExpiresAt?: number;
  maxPerActionWei?: string;
  maxTotalWei?: string;
  gasExpiresAt?: number;
  chargeableOutcomesMask?: number;
  /**
   * A fresh salt per approval. Without it, re-approving byte-identical terms
   * reproduces the same mandate ID and the core reverts `MandateAlreadyExists`
   * forever, because a revoked mandate's record is never cleared.
   */
  salt?: string;
};

export const POST = route(async (request: Request) => {
  const body = await readJson<Body>(request);
  const { account } = await requireOwnedAccount(request, String(body.account ?? ""));
  const projectId = golProjectId();

  // A per-approval salt when the caller did not supply one, so this route is safe
  // to call twice with identical terms.
  const salt =
    (body.salt as `0x${string}` | undefined) ??
    (`0x${crypto.randomUUID().replaceAll("-", "")}${"0".repeat(32)}` as `0x${string}`);

  const now = Math.floor(Date.now() / 1000);
  const input: PrepareGasPolicyInput = {
    account,
    family: (body.family ?? "nexus7702") as PrepareGasPolicyInput["family"],
    agent: body.agent as `0x${string}`,
    transfer: {
      recipients: (body.recipients ?? []) as `0x${string}`[],
      maxPerActionBaseUnits: String(body.maxPerActionBaseUnits),
      maxTotalBaseUnits: String(body.maxTotalBaseUnits),
    },
    mandate: {
      // A minute of backdating so the mandate is already valid when the owner's
      // transaction confirms, which can take minutes at Base's safe head.
      validFrom: Number(body.mandateValidFrom ?? now - 60),
      expiresAt: Number(body.mandateExpiresAt),
      // The window in which the owner may still send the approval. One hour.
      approvalExpiresAt: now + 3600,
      // A fresh salt per approval. Without one, re-approving byte-identical terms
      // reproduces the same mandate ID and the core reverts `MandateAlreadyExists`
      // forever, because a revoked mandate's record is never cleared.
      salt,
    },
    gas: {
      maxPerActionWei: String(body.maxPerActionWei),
      maxTotalWei: String(body.maxTotalWei),
      expiresAt: Number(body.gasExpiresAt),
      chargeableOutcomesMask: Number(body.chargeableOutcomesMask ?? 3),
    },
    relayer: { mode: "gol" },
  };

  const prepared: PreparedGasPolicy = await getGol().prepareGasPolicy(projectId, input);
  return NextResponse.json({ prepared, salt });
});
