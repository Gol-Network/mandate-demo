/**
 * Executions for one of this account's gas policies, newest first.
 *
 * The proof panel pairs each of these with the on-chain receipt, and this route
 * only ever returns records for a policy the authenticated user owns.
 */
import { NextResponse } from "next/server";
import { executionView } from "@/lib/execution-view";
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

  const pageLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit as number, 50)) : 20;
  const gol = getGol();
  const projectId = golProjectId();
  const executions = await gol.listGasExecutions(projectId, { limit: 100 });
  const matching = executions.data.filter(
    (execution) =>
      execution.account.toLowerCase() === account.toLowerCase() &&
      typeof execution.gasPolicyId === "string" &&
      execution.gasPolicyId.toLowerCase() === policyId.toLowerCase(),
  ).slice(0, pageLimit);

  // The list is a summary: it has actionTransactionHash, but no receipt. Fetch
  // details for the matched rows so the proof panel can compare GOL's outcome
  // with the independently decoded chain receipt. A transient detail failure
  // still leaves the summary and transaction link visible.
  const details = await Promise.all(matching.map(async (summary) => {
    try {
      const detail = await gol.getGasExecution(projectId, summary.id);
      if (detail.account.toLowerCase() !== account.toLowerCase() ||
          detail.gasPolicyId?.toLowerCase() !== policyId.toLowerCase()) return null;
      return executionView(detail);
    } catch {
      return executionView(summary);
    }
  }));
  return NextResponse.json({ data: details.filter((row) => row !== null) });
});
