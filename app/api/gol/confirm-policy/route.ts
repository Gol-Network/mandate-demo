/**
 * Confirm the approval once the owner's transaction is mined.
 *
 * Returns `included` after a canonical Alchemy RPC check, then `confirmed`
 * when GOL's selected settlement head catches up.
 */
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw, draftId, transactionHash } = await readJson<{
    account?: string;
    draftId?: string;
    transactionHash?: string;
  }>(request);
  await requireOwnedAccount(request, String(raw ?? ""));
  const result = await getGol().confirmGasPolicy(
    golProjectId(),
    String(draftId ?? ""),
    requireHex(transactionHash, "transaction_hash"),
  );
  return NextResponse.json(result, { status: result.status === "confirmed" ? 200 : 202 });
});
