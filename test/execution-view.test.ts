import assert from "node:assert/strict";
import { test } from "node:test";
import { executionView, hashesFromExecution } from "../lib/execution-view.ts";

const hash = "0x2370735ed418791f13b368e85e544f2a7833fb75d7bd06777db82c8dd1f10fbf";

test("a list summary can show a submitted execution before the detail is available", () => {
  assert.deepEqual(executionView({ id: "execution", state: "submitted", actionTransactionHash: hash }), {
    id: "execution",
    state: "submitted",
    transactionHashes: [hash],
    inclusion: null,
    receipt: null,
  });
});

test("a checked inclusion remains separate from financial settlement", () => {
  const view = executionView({
    id: "execution",
    state: "submitted",
    transactionHashes: [hash],
    inclusion: { state: "included", outcome: "success", transactionHash: hash },
  });
  assert.deepEqual(view.inclusion, { state: "included", outcome: "success", transactionHash: hash, finalizedAt: null });
  assert.equal(view.receipt, null);
  assert.equal(view.state, "submitted");
});

test("a detailed refusal keeps the receipt code as a number", () => {
  assert.deepEqual(executionView({
    id: "execution",
    state: "settled",
    transactionHashes: [hash],
    receipt: { outcome: "refusal", refusalCode: "67" },
  }).receipt, { outcome: "refusal", refusalCode: 67 });
});

test("malformed hashes and refusal codes cannot become explorer links or claims", () => {
  assert.deepEqual(hashesFromExecution({ id: "execution", state: "submitted", transactionHashes: ["0xbad"] }), []);
  assert.deepEqual(executionView({ id: "execution", state: "settled", receipt: {
    outcome: "refusal", refusalCode: "67garbage",
  } }).receipt, { outcome: "refusal", refusalCode: null });
});
