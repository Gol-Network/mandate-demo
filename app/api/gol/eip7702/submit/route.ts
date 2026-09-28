/**
 * Hand the owner-signed setup to GOL's hosted relayer, which sends the single
 * type-4 transaction at GOL's cost within the project's daily sponsorship
 * limit. The owner's address, USDC, and ETH do not change.
 */
import type { Eip7702Setup, SubmitEip7702SetupInput } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount } from "@/lib/server/privy";
import { readJson, route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const body = await readJson<{
    account?: string;
    authorization?: SubmitEip7702SetupInput["authorization"];
    initSignature?: string;
  }>(request);
  const { account } = await requireOwnedAccount(request, String(body.account ?? ""));
  const setup: Eip7702Setup = await getGol().submitEip7702Setup(
    golProjectId(),
    account,
    {
      authorization: body.authorization ?? null,
      initSignature: body.initSignature as `0x${string}`,
    },
  );
  return NextResponse.json(setup, { status: 202 });
});
