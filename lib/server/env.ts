/**
 * Environment access. Server-only values live in `lib/server/env.ts` and are
 * never imported by client components.
 *
 * Every getter fails with a `missing_env:<NAME>` message rather than passing
 * `undefined` downstream, so a missing variable surfaces as one clear line in
 * the server log instead of a confusing downstream failure.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`missing_env:${name}`);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value.trim();
}

/** Values safe to ship to the browser. Read directly in client components. */
export const publicEnv = {
  get privyAppId(): string {
    return process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  },
};

/** Server-only values. Import from a route handler or a `lib/server` module. */
export const serverEnv = {
  /** Public, but read on the server too so a missing value fails here. */
  get privyAppId(): string {
    return required("NEXT_PUBLIC_PRIVY_APP_ID");
  },
  /**
   * Reserved. Server-side access-token verification uses the public app ID and
   * Privy's JWKS. The secret is used only by the Privy user lookup that
   * confirms an account address belongs to the logged-in user.
   */
  get privyAppSecret(): string {
    return required("PRIVY_APP_SECRET");
  },
  get golApiKey(): string {
    return required("GOL_API_KEY");
  },
  get golProjectId(): string {
    return required("GOL_PROJECT_ID");
  },
  get golApiBaseUrl(): string {
    return optional("GOL_API_BASE_URL") ?? "https://api.gol.network";
  },
  get openaiApiKey(): string {
    return required("OPENAI_API_KEY");
  },
  get openaiModel(): string {
    return required("OPENAI_MODEL");
  },
  get agentPrivateKey(): string {
    return required("AGENT_PRIVATE_KEY");
  },
  get agentMaxChargeWei(): bigint {
    return BigInt(required("AGENT_MAX_CHARGE_WEI"));
  },
};
