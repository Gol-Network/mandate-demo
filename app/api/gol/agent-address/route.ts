/**
 * The agent's address, derived from `AGENT_PRIVATE_KEY` on the server.
 *
 * The owner page needs it to build the approval, because the agent is the
 * `agent` field in the owner's mandate. An address is public, so it is safe to
 * return. The key never leaves the server.
 */
import { NextResponse } from "next/server";
import { agentAddress } from "@/lib/server/agent-key";
import { requireUser } from "@/lib/server/privy";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  await requireUser(request);
  return NextResponse.json({ address: agentAddress() });
});
