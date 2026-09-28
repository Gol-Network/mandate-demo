/**
 * Executions for one of this account's gas policies, newest first.
 *
 * The proof panel pairs each of these with the on-chain receipt, and this route
 * only ever returns records for a policy the authenticated user owns.
 */
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw, gasPolicyId, limit } = await readJson<{
    account?: string;
    gasPolicyId?: string;
    limit?: number;
  }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));
  const policyId = requireHex(gasPolicyId, "gas_policy_id");

  const page = await getGol().listGasPolicies(golProjectId());
  const owned = page.data.some(
    (policy) =>
      policy.gasPolicyId.toLowerCase() === policyId.toLowerCase() &&
      policy.account.toLowerCase() === account.toLowerCase(),
  );
  if (!owned) {
    return NextResponse.json({ error: { code: "policy_not_owned" } }, { status: 403 });
  }

  const executions = await getGol().listGasExecutions(golProjectId(), {
    limit: Math.min(Number(limit ?? 20), 100),
  });
  return NextResponse.json({
    data: executions.data.filter(
      (execution) =>
        typeof execution.gasPolicyId === "string" &&
        execution.gasPolicyId.toLowerCase() === policyId.toLowerCase(),
    ),
  });
});
