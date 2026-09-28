/**
 * Browser-side calls to this app's own GOL proxy routes.
 *
 * The browser never holds the GOL project API key. Every call carries the
 * logged-in user's Privy access token instead, which the server verifies.
 */
import { getAccessToken } from "@privy-io/react-auth";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error("not_logged_in");
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | T
    | null;
  if (!response.ok) {
    const detail = (payload as { error?: { code?: string; message?: string } })
      ?.error;
    const error = new Error(
      detail?.message ?? detail?.code ?? `request_failed:${response.status}`,
    );
    error.name = detail?.code ?? "request_failed";
    throw error;
  }
  return payload as T;
}

export async function golGet<T>(path: string): Promise<T> {
  return call<T>(path, { method: "GET", headers: await authHeaders() });
}

export async function golPost<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
}

/** The error code GOL or this app returned, for display. */
export function errorCode(error: unknown): string {
  if (error instanceof Error) return error.name || error.message;
  return String(error);
}
