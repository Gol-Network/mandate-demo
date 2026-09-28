/**
 * Tests for the pure logic the agent depends on. No chain, no server, no key.
 *
 * The amount parser matters most: it turns what a person said into 6-decimal base
 * units, and a mistake there either sends the wrong amount or produces a
 * submission the API rejects. It is done in integer arithmetic precisely so no
 * float rounding is involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsdcAmount } from "../lib/server/gol-action-provider.ts";
import { isChargeableRefusal, refusalName, ruleTagName, REFUSAL_CODES } from "../lib/proof.ts";

test("parses whole, decimal, and padded amounts exactly", () => {
  assert.equal(parseUsdcAmount("1", 6), 1_000_000n);
  assert.equal(parseUsdcAmount("0.5", 6), 500_000n);
  assert.equal(parseUsdcAmount("1.000001", 6), 1_000_001n);
  assert.equal(parseUsdcAmount("  2.25  ", 6), 2_250_000n);
  assert.equal(parseUsdcAmount("0.000001", 6), 1n);
  assert.equal(parseUsdcAmount("10", 6), 10_000_000n);
});

test("rejects anything that is not a positive amount of at most 6 decimals", () => {
  for (const bad of ["", "0", "0.0", "0.0000000", "-1", "1.2.3", "abc", "1e6", "1,5", "0x1"]) {
    assert.equal(parseUsdcAmount(bad, 6), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test("refuses more decimal places than the asset supports", () => {
  assert.equal(parseUsdcAmount("1.1234567", 6), null);
  assert.equal(parseUsdcAmount("1.123456", 6), 1_123_456n);
});

test("refusal codes match the contracts table", () => {
  // The three the demo depends on, from contracts/src/libraries/RefusalCodes.sol.
  assert.equal(refusalName(65), "recipient_not_allowed");
  assert.equal(refusalName(67), "per_action_limit_exceeded");
  assert.equal(refusalName(68), "budget_exceeded");
  assert.equal(refusalName(5), "mandate_paused");
  assert.equal(refusalName(0), "none");
});

test("an unknown refusal code is reported as unknown, not guessed", () => {
  assert.equal(refusalName(9999), "unknown_refusal_9999");
});

test("codes below 40 are never charged, which is the platform's own boundary", () => {
  // CHARGEABLE_REFUSAL_FLOOR = 40 in platform/src/gas/v3.ts.
  for (const code of [1, 5, 6, 12, 20, 24]) assert.equal(isChargeableRefusal(code), false);
  for (const code of [40, 64, 65, 67, 68, 90]) assert.equal(isChargeableRefusal(code), true);
});

test("rule tags the demo shows are named, unknown ones are not", () => {
  assert.equal(ruleTagName(0x0110), "recipient_allowlist");
  assert.equal(ruleTagName(0x0200), "max_amount_per_action");
  assert.equal(ruleTagName(0x0210), "lifetime_total");
  assert.equal(ruleTagName(0x9999), "unknown_rule_0x9999");
});

test("the refusal table is frozen so a caller cannot corrupt it", () => {
  assert.ok(Object.isFrozen(REFUSAL_CODES));
});
