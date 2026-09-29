/**
 * Confirm a safety action once the owner's transaction is mined.
 *
 * Polled the same way as approval. `included` is provisional and `confirmed`
 * follows the selected settlement head.
 */
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw, gasPolicyId, action, mandateId, transactionHash } =
    await readJson<{
      account?: string;
      gasPolicyId?: string;
      action?: string;
      mandateId?: string;
      transactionHash?: string;
    }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));

  const page = await getGol().listGasPolicies(golProjectId());
  const policyId = requireHex(gasPolicyId, "gas_policy_id");
  const owned = page.data.some(
    (policy) =>
      policy.gasPolicyId.toLowerCase() === policyId.toLowerCase() &&
      policy.account.toLowerCase() === account.toLowerCase(),
  );
  if (!owned) {
    return NextResponse.json({ error: { code: "policy_not_owned" } }, { status: 403 });
  }

  const result = await getGol().confirmGasPolicySafetyAction(golProjectId(), policyId, {
    action: action as "pause" | "resume" | "revoke",
    transactionHash: requireHex(transactionHash, "transaction_hash"),
    ...(mandateId ? { mandateId: mandateId as `0x${string}` } : {}),
  });
  return NextResponse.json(result, { status: result.status === "confirmed" ? 200 : 202 });
});
