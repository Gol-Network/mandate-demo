/**
 * Prepare the owner's approval: the transfer mandate and its gas policy.
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
  mandateExpiresAt?: number;
  maxPerActionWei?: string;
  maxTotalWei?: string;
  gasExpiresAt?: number;
  chargeableOutcomesMask?: number;
};

export const POST = route(async (request: Request) => {
  const body = await readJson<Body>(request);
  const { account } = await requireOwnedAccount(request, String(body.account ?? ""));
  const projectId = golProjectId();

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
      validFrom: now - 60,
      expiresAt: Number(body.mandateExpiresAt),
      // The window in which the owner may still send the approval. One hour.
      approvalExpiresAt: now + 3600,
      // No salt is sent. The platform generates a fresh random one per prepare
      // (`owner-service.ts`: `salt ??= toHex(randomBytes(32))`), which is exactly
      // what is needed: the salt is hashed into the mandate terms, so every
      // approval gets a distinct mandate ID. That is what makes re-approving safe
      // after a revoke. The core reverts `MandateAlreadyExists` for an ID whose
      // record still exists, and a revoked mandate's record is never cleared, so
      // reusing an ID would be permanently unusable. Generating it here as well
      // would be redundant, and a caller-supplied salt is deliberately not
      // forwarded: it would let a caller fix the ID.
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
  return NextResponse.json(prepared);
});
