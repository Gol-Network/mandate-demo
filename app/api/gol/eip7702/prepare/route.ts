/**
 * Prepare the owner's EIP-7702 setup: the authorization for the reviewed
 * Biconomy Nexus 1.3.3 delegate and the canonical initialization that installs
 * the GOL core. Creates no authority and moves no funds; the owner has not
 * signed anything yet at this point.
 */
import type { PreparedEip7702Setup } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw } = await readJson<{ account?: string }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));
  const prepared: PreparedEip7702Setup = await getGol().prepareEip7702Setup(
    golProjectId(),
    account,
  );
  return NextResponse.json(prepared);
});
