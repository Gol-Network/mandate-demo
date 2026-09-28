/**
 * The detected account family, its EIP-7702 delegation, and whether the core is
 * installed. This is what the owner page derives its state from, so the demo can
 * resume from any step.
 */
import type { AccountStatus } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw } = await readJson<{ account?: string }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));
  const status: AccountStatus = await getGol().getAccountStatus(
    golProjectId(),
    account,
  );
  return NextResponse.json(status);
});
