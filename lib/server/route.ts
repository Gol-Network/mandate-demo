/**
 * A thin wrapper for route handlers: consistent JSON errors and no leakage of
 * internals. GOL's own error `code` and `message` are passed through because the
 * demo needs to show them (for example `capability_unavailable` and
 * `account_integration_invalid`), and they are the user-facing explanation.
 */
import { NextResponse } from "next/server";
import { GolApiError, GolTransportError } from "@gol/sdk/server";
import { ForbiddenError, UnauthorizedError } from "./privy.ts";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return NextResponse.json(
      { error: { code: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof GolApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof GolTransportError) {
    return NextResponse.json(
      { error: { code: "gol_transport_error", message: error.message } },
      { status: 502 },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  // A `missing_env:NAME` failure is a configuration problem the operator needs
  // to see verbatim. Anything else is logged and reported generically.
  if (message.startsWith("missing_env:")) {
    console.error(`[gol-demo] ${message}`);
    return NextResponse.json({ error: { code: message } }, { status: 500 });
  }
  console.error("[gol-demo] unhandled route error", error);
  return NextResponse.json(
    { error: { code: "internal_error" } },
    { status: 500 },
  );
}

/** Wraps a handler so thrown errors become the JSON shape above. */
export function route<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}

/** Reads a JSON body, failing with a stable code on malformed input. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ForbiddenError("body_not_json");
  }
}
