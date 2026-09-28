import assert from "node:assert/strict";
import { test } from "node:test";
import { agentErrorDetails, agentErrorMessage } from "../lib/server/agent-error.ts";

test("an unavailable model gets an actionable message without leaking the provider response", () => {
  const error = {
    statusCode: 403,
    responseBody: JSON.stringify({
      error: { code: "model_not_found", message: "Project secret-project has no model access" },
    }),
  };
  assert.deepEqual(agentErrorDetails(error), { code: "model_not_found", status: 403 });
  assert.match(agentErrorMessage(error), /model is not enabled/);
  assert.doesNotMatch(agentErrorMessage(error), /secret-project/);
});

test("rate limits and unrecognised provider bodies remain safe to show", () => {
  assert.match(agentErrorMessage({ statusCode: 429 }), /rate limiting/);
  assert.deepEqual(agentErrorDetails({ statusCode: 400, responseBody: "secret text" }), {
    code: null,
    status: 400,
  });
  assert.doesNotMatch(agentErrorMessage({ responseBody: "secret text" }), /secret text/);
});
