import assert from "node:assert/strict";
import { test } from "node:test";
import { clearPendingApproval, loadPendingApproval, savePendingApproval } from "../lib/pending-approval.ts";

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear() { entries.clear(); },
    getItem(key) { return entries.get(key) ?? null; },
    key(index) { return [...entries.keys()][index] ?? null; },
    removeItem(key) { entries.delete(key); },
    setItem(key, value) { entries.set(key, value); },
  };
}

test("a submitted approval and its payee names survive a reload for the same owner", () => {
  const storage = memoryStorage();
  const owner = "0x1111111111111111111111111111111111111111";
  const pending = {
    draftId: "draft-1",
    txHash: `0x${"a".repeat(64)}` as `0x${string}`,
    contacts: [{ name: "Alice", address: "0x2222222222222222222222222222222222222222" }],
  };
  savePendingApproval(owner, pending, storage);
  assert.deepEqual(loadPendingApproval(owner.toUpperCase(), storage), pending);
  assert.equal(loadPendingApproval("0x3333333333333333333333333333333333333333", storage), null);
  clearPendingApproval(owner, storage);
  assert.equal(loadPendingApproval(owner, storage), null);
});

test("a damaged recovery hint cannot become a confirmation request", () => {
  const storage = memoryStorage();
  const owner = "0x1111111111111111111111111111111111111111";
  storage.setItem(`gol-demo.pending-approval.v1:${owner}`, JSON.stringify({
    draftId: "draft-1",
    txHash: "0x1234",
    contacts: [{ name: "Alice", address: "0x2222222222222222222222222222222222222222" }],
  }));
  assert.equal(loadPendingApproval(owner, storage), null);
});

test("damaged labels do not hide a submitted approval", () => {
  const storage = memoryStorage();
  const owner = "0x1111111111111111111111111111111111111111";
  storage.setItem(`gol-demo.pending-approval.v1:${owner}`, JSON.stringify({
    draftId: "draft-1",
    txHash: `0x${"a".repeat(64)}`,
    contacts: [{ name: "Alice", address: "not-an-address" }],
  }));
  assert.deepEqual(loadPendingApproval(owner, storage)?.contacts, []);
});
