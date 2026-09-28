/**
 * The GOL server client. Server-only: it holds the project API key.
 *
 * One client per process. `@gol/sdk/server` is imported dynamically-safe here
 * because route handlers are always server-side.
 */
import { GolApiClient } from "@gol/sdk/server";
import { serverEnv } from "./env";

let client: GolApiClient | undefined;

export function getGol(): GolApiClient {
  if (!client) {
    client = new GolApiClient({
      baseUrl: serverEnv.golApiBaseUrl,
      apiKey: serverEnv.golApiKey,
    });
  }
  return client;
}

export const golProjectId = (): string => serverEnv.golProjectId;
