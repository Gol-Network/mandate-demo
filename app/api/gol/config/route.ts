/**
 * The project's live gas configuration: core and router addresses, the transfer
 * asset, the relayer, the reviewed EIP-7702 delegate, and the gas caps.
 *
 * The browser needs these to read balances and to filter receipt logs to the
 * core's own events, and the project API key must stay on the server, so the
 * browser reads them through this route rather than calling GOL directly.
 */
import type { GasConfiguration } from "@gol/sdk";
import { NextResponse } from "next/server";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireUser } from "@/lib/server/privy";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  await requireUser(request);
  const configuration: GasConfiguration = await getGol().getGasConfiguration(
    golProjectId(),
  );
  return NextResponse.json(configuration);
});
