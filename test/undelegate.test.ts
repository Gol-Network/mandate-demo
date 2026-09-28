/**
 * Tests for removing an EIP-7702 delegation. Pure logic, no chain and no wallet.
 *
 * The load-bearing fact is the address. EIP-7702 clears a delegation when the
 * authorization names `0x0000000000000000000000000000000000000000`, and does
 * something else entirely for any other address: it installs that address as the
 * account's code. Getting this wrong in the other direction - signing for
 * `0xEeeE...`, which is what early drafts of the EIP used, or for a helper
 * address someone thought was a sentinel - would leave the account delegated to
 * something nobody reviewed, which is the exact state this feature exists to
 * leave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLEAR_CHAIN_ID,
  CLEAR_DELEGATION_ADDRESS,
  clearDelegationRequest,
  clearDelegationTuple,
  type PrivySignedAuthorization,
} from "../lib/undelegate.ts";

const ACCOUNT = "0x2A9Eb1Df30D2b0a6b0d0a4bF1dE3f2E9D8aE118" as const;

const signed = (over: Partial<PrivySignedAuthorization> = {}): PrivySignedAuthorization => ({
  address: CLEAR_DELEGATION_ADDRESS,
  chainId: CLEAR_CHAIN_ID,
  nonce: 7,
  r: `0x${"11".repeat(32)}`,
  s: `0x${"22".repeat(32)}`,
  yParity: 0,
  ...over,
});

test("the reset address is the zero address", () => {
  assert.equal(CLEAR_DELEGATION_ADDRESS, "0x0000000000000000000000000000000000000000");
});

test("the signed tuple is forwarded as the six fields a type-4 transaction takes", () => {
  const tuple = clearDelegationTuple(signed());
  assert.deepEqual(tuple, {
    address: "0x0000000000000000000000000000000000000000",
    chainId: 84532,
    nonce: 7,
    yParity: 0,
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`,
  });
  assert.deepEqual(Object.keys(tuple).sort(), ["address", "chainId", "nonce", "r", "s", "yParity"]);
});

test("a tuple for any other address is refused rather than submitted", () => {
  // The wallet was asked for one address and signed another. Forwarding it would
  // install a delegate nobody reviewed, which is the state being removed.
  for (const address of [
    "0x0000000000000000000000000000000000777A2f2",
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0x000000000000000000000000000000000000dEaD",
  ]) {
    assert.throws(
      () => clearDelegationTuple(signed({ address })),
      /undelegation_wrong_address/,
      `expected ${address} to be refused`,
    );
  }
});

test("case does not decide whether the address is the reset address", () => {
  assert.doesNotThrow(() => clearDelegationTuple(signed({ address: "0x0000000000000000000000000000000000000000" })));
});

test("a tuple for another chain is refused", () => {
  // chain_id is inside the signed payload, so a signature made for another chain
  // can never clear this one. Refusing it here says so plainly instead of
  // letting the transaction be mined and silently do nothing.
  assert.throws(
    () => clearDelegationTuple(signed({ chainId: 8453 })),
    /undelegation_wrong_chain:8453/,
  );
});

test("the clear is a zero-value self-send carrying one tuple", () => {
  const request = clearDelegationRequest(ACCOUNT, clearDelegationTuple(signed()));
  assert.equal(request.to, ACCOUNT);
  assert.equal(request.value, 0n);
  assert.equal(request.data, "0x");
  assert.equal(request.authorizationList.length, 1);
  assert.equal(request.authorizationList[0]?.address, CLEAR_DELEGATION_ADDRESS);
});

test("a zero nonce is carried through rather than treated as absent", () => {
  // The tuple's nonce must equal the account's nonce on chain, and a fresh
  // account is at zero. Dropping it as falsy would make the transaction a no-op.
  const request = clearDelegationRequest(ACCOUNT, clearDelegationTuple(signed({ nonce: 0 })));
  assert.equal(request.authorizationList[0]?.nonce, 0);
});
