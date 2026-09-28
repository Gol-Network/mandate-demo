/**
 * Poll a sponsored setup. The platform confirms at Base's `safe` head, which on
 * 2026-09-28 sat 77 to 99 blocks behind latest and advanced in jumps, so a
 * setup can take about ten minutes to confirm. The browser polls this route and
 * shows progress; it never blocks on a server-side wait.
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
