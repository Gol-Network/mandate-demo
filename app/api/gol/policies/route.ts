/**
 * This account's gas policies.
 *
 * `listGasPolicies` has no account filter, so the browser cannot ask for "mine
 * only". This route filters on the authenticated user's own account, which also
 * means the browser never receives another project's records.
 */
import type { ListGasPoliciesResponse } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw } = await readJson<{ account?: string }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));
  const page: ListGasPoliciesResponse = await getGol().listGasPolicies(golProjectId());
  return NextResponse.json({
    data: page.data.filter((policy) => policy.account.toLowerCase() === account.toLowerCase()),
  });
});
