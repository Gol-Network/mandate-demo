/**
 * Confirm the approval once the owner's transaction is mined.
 *
 * Returns an `observing` status until the platform has seen the approval at the
 * Base head it settles at, which on 2026-09-28 was `safe`, some minutes behind
 * latest. The browser polls rather than waiting on the server.
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
  return NextResponse.json(result, { status: result.status === "observing" ? 202 : 200 });
});
