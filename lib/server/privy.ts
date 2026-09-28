/**
 * Server-side Privy authentication for every API route.
 *
 * Two checks, both required:
 *
 *  1. The request carries a valid Privy access token for this app. Verified
 *     locally against Privy's JWKS for the app ID, so it is a signature check
 *     rather than a call to Privy on every request.
 *  2. The account address in the body is a wallet linked to that user. Without
 *     this, any logged-in demo visitor could point the server at somebody
 *     else's account, and the OpenAI key and the project's sponsored-setup
 *     quota would be exposed to anyone who can log in.
 *
 * Both fail closed. Nothing here reads or logs a token value.
 */
import { PrivyClient, verifyAccessToken } from "@privy-io/node";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { getAddress, isAddress } from "viem";
import { serverEnv } from "./env.ts";

const PRIVY_API_URL = "https://api.privy.io";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

// Cached across requests so the key set is fetched at most once an hour and a
// rotated key at most once every ten minutes. jose owns both budgets.
let jwks: JWTVerifyGetKey | undefined;
let privyClient: PrivyClient | undefined;

/**
 * Privy's JWKS for this app. Verification is a local signature check against
 * these keys, so it is not a call to Privy on every request and it fails
 * closed if Privy is unreachable and the cache is cold.
 *
 * `createPrivyAppJWKS` is not re-exported by `@privy-io/node`, so this builds
 * the same remote key set directly from jose.
 */
function getJwks(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(
    new URL(`${PRIVY_API_URL}/v1/apps/${serverEnv.privyAppId}/jwks.json`),
    { cacheMaxAge: 60 * 60 * 1000, cooldownDuration: 10 * 60 * 1000 },
  );
  return jwks;
}

function getPrivyClient(): PrivyClient {
  privyClient ??= new PrivyClient({
    appId: serverEnv.privyAppId,
    appSecret: serverEnv.privyAppSecret,
    apiUrl: PRIVY_API_URL,
  });
  return privyClient;
}

/** Reads the bearer token from the request. Throws when absent or malformed. */
function readBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) {
    throw new UnauthorizedError("missing_bearer_token");
  }
  return match[1].trim();
}

/**
 * Verifies the access token and returns the Privy user ID.
 * Throws UnauthorizedError on a missing, expired, or invalid token.
 */
export async function requireUser(request: Request): Promise<{ userId: string }> {
  const accessToken = readBearer(request);
  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken({
      access_token: accessToken,
      app_id: serverEnv.privyAppId,
      verification_key: getJwks(),
    });
  } catch {
    // Deliberately does not include the token or the underlying message.
    throw new UnauthorizedError("invalid_access_token");
  }
  if (payload.app_id !== serverEnv.privyAppId) {
    throw new UnauthorizedError("access_token_wrong_app");
  }
  return { userId: payload.user_id };
}

/**
 * Confirms the address is a wallet linked to this Privy user.
 *
 * This is a live Privy API call, so it runs only on routes that act on a
 * specific account rather than on every request.
 */
export async function requireOwnedAccount(
  request: Request,
  account: string,
): Promise<{ userId: string; account: `0x${string}` }> {
  const { userId } = await requireUser(request);
  if (!isAddress(account)) {
    throw new ForbiddenError("account_not_an_address");
  }
  const checksummed = getAddress(account);

  const user = await getPrivyClient().users()._get(userId);
  const linked = user.linked_accounts ?? [];
  const owned = linked.some(
    (entry) => "address" in entry && typeof entry.address === "string"
      ? entry.address.toLowerCase() === checksummed.toLowerCase()
      : false,
  );
  if (!owned) {
    throw new ForbiddenError("account_not_linked_to_user");
  }
  return { userId, account: checksummed };
}

/**
 * Rejects anything that is not a plain 32-byte hex string. Used for the
 * execution id, setup id, and other path parameters.
 */
export function requireHex(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new ForbiddenError(`${label}_not_hex`);
  }
  return value as `0x${string}`;
}
