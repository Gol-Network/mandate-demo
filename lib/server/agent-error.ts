/** A safe user message and small diagnostic for an AI stream failure. */

interface ProviderFailure {
  statusCode?: unknown;
  responseBody?: unknown;
}

export function agentErrorDetails(error: unknown): { code: string | null; status: number | null } {
  if (!error || typeof error !== "object") return { code: null, status: null };
  const failure = error as ProviderFailure;
  const status = typeof failure.statusCode === "number" ? failure.statusCode : null;
  let code: string | null = null;
  if (typeof failure.responseBody === "string") {
    try {
      const body = JSON.parse(failure.responseBody) as { error?: { code?: unknown } };
      code = typeof body.error?.code === "string" ? body.error.code : null;
    } catch {
      // Provider response bodies can be plain text. Do not show or log them.
    }
  }
  return { code, status };
}

export function agentErrorMessage(error: unknown): string {
  const { code, status } = agentErrorDetails(error);
  if (code === "model_not_found") {
    return "The agent's AI model is not enabled for this project. The demo operator needs to select an available model.";
  }
  if (code === "insufficient_quota") {
    return "The agent's AI project has no available API quota.";
  }
  if (status === 429) return "The agent's AI provider is rate limiting requests. Try again shortly.";
  if (status === 401) return "The agent's AI credential was rejected. Contact the demo operator.";
  if (status !== null && status >= 500) return "The agent's AI provider is unavailable. Try again shortly.";
  return "The agent could not complete that request. Try again or contact the demo operator.";
}
