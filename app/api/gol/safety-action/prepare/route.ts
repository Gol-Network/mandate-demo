/**
 * Prepare an owner safety action: pause, resume, or revoke a mandate.
 *
 * The core is never charged for these, by design. The owner signs in their own
 * wallet and the EOA sends the transaction; GOL only prepares and confirms.
 */
import type {
  PreparedMandateSafetyAction,
  SafetyActionName,
} from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

const ACTIONS: readonly SafetyActionName[] = ["pause", "resume", "revoke"];

export const POST = route(async (request: Request) => {
  const { account: raw, gasPolicyId, action, mandateId } = await readJson<{
    account?: string;
    gasPolicyId?: string;
    action?: string;
    mandateId?: string;
  }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));

  if (!ACTIONS.includes(action as SafetyActionName)) {
    return NextResponse.json({ error: { code: "unknown_safety_action" } }, { status: 400 });
  }

  // The policy must belong to this account. `prepareGasPolicySafetyAction` targets
  // any policy ID, so the ownership check is what stops acting on someone else's.
  const page = await getGol().listGasPolicies(golProjectId());
  const owned = page.data.some(
    (policy) =>
      policy.gasPolicyId.toLowerCase() === requireHex(gasPolicyId, "gas_policy_id").toLowerCase() &&
      policy.account.toLowerCase() === account.toLowerCase(),
  );
  if (!owned) {
    return NextResponse.json({ error: { code: "policy_not_owned" } }, { status: 403 });
  }

  const prepared: PreparedMandateSafetyAction = await getGol().prepareGasPolicySafetyAction(
    golProjectId(),
    requireHex(gasPolicyId, "gas_policy_id"),
    {
      action: action as SafetyActionName,
      ...(mandateId ? { mandateId: mandateId as `0x${string}` } : {}),
    },
  );
  return NextResponse.json(prepared);
});
