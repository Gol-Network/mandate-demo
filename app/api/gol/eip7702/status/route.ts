/**
 * Poll a sponsored setup. `inclusion` is provisional; `confirmed` still waits
 * for GOL's selected settlement head.
 */
import type { Eip7702Setup } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const { account: raw, setupId } = await readJson<{
    account?: string;
    setupId?: string;
  }>(request);
  const { account } = await requireOwnedAccount(request, String(raw ?? ""));
  const setup: Eip7702Setup = await getGol().getEip7702Setup(
    golProjectId(),
    account,
    requireHex(setupId, "setup_id"),
  );
  return NextResponse.json(setup);
});
