/**
 * Tests for the authorization diagnosis. Real keys, real signatures, no mocks.
 *
 * Every case here is a way the signed tuple can fail to recover to the owner,
 * and each one needs a different fix. The point of the module is that they are
 * told apart rather than collapsed into one string, so the tests use a real
 * secp256k1 key to produce genuine signatures over genuine EIP-7702 hashes and
 * check which finding each fault produces.
 *
 * The wrong-key case is the one worth reading twice: the signature is perfectly
 * valid, over exactly the right message, and still recovers to somebody else.
 * That is indistinguishable from a corrupted signature by looking at the tuple
 * alone, and it is the only one of the five that a caller's bug can cause.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationYParity,
  diagnoseAuthorization,
  type AuthorizationAsked,
  type AuthorizationSigned,
} from "../lib/authorization-diagnosis.ts";

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const DELEGATE = "0x0000000000000000000000000000000000777A2f2" as const;
const OTHER_DELEGATE = "0x0000000000000000000000000000000000dEaD57" as const;

const asked = (over: Partial<AuthorizationAsked> = {}): AuthorizationAsked => ({
  account: OWNER.address,
  chainId: 84532,
  address: DELEGATE,
  nonce: 3,
  ...over,
});

/** A real signature over a real authorization hash, as a wallet would return it. */
const sign = async (
  account: typeof OWNER,
  request: { chainId: number; address: `0x${string}`; nonce: number },
): Promise<AuthorizationSigned> =>
  (await account.signAuthorization({
    contractAddress: request.address,
    chainId: request.chainId,
    nonce: request.nonce,
  })) as AuthorizationSigned;

test("a correct signature is ok and recovers to the owner", async () => {
  const signed = await sign(OWNER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), signed);
  assert.equal(diagnosis.finding, "ok");
  assert.equal(diagnosis.matchesAccount, true);
  assert.equal(diagnosis.recovered?.toLowerCase(), OWNER.address.toLowerCase());
});

test("the recovery byte is read from yParity, or from v in any of its four forms", () => {
  assert.equal(authorizationYParity({ r: "0x", s: "0x", yParity: 0 }), 0);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", yParity: 1 }), 1);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", v: 27n }), 0);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", v: 28n }), 1);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", v: 0 }), 0);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", v: "28" }), 1);
  assert.equal(authorizationYParity({ r: "0x", s: "0x" }), null);
  assert.equal(authorizationYParity({ r: "0x", s: "0x", v: 29 }), null);
});

test("a signature with no usable recovery byte is named as such", async () => {
  const signed = await sign(OWNER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), {
    r: signed.r,
    s: signed.s,
  });
  assert.equal(diagnosis.finding, "recovery_byte_missing");
  assert.equal(diagnosis.recovered, null);
});

test("an inverted yParity is told apart from a wrong key", async () => {
  // The signature is genuine and over the right message. Only the parity bit is
  // wrong, which is a provider reporting `v` as 0/1 where 27/28 was meant, or
  // the reverse. Without this case it would be reported as a different signer.
  const signed = await sign(OWNER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const flipped = { ...signed, yParity: signed.yParity === 0 ? 1 : 0 };
  const diagnosis = await diagnoseAuthorization(asked(), flipped);
  assert.equal(diagnosis.finding, "y_parity_looks_inverted");
  assert.equal(diagnosis.matchesAccount, false);
});

test("a signature over another chain is named, not guessed at", async () => {
  const signed = await sign(OWNER, { chainId: 1, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), signed);
  assert.equal(diagnosis.finding, "wallet_signed_another_chain");
  assert.match(diagnosis.detail, /chain 1/);
});

test("a signature over another nonce is named", async () => {
  const signed = await sign(OWNER, { chainId: 84532, address: DELEGATE, nonce: 4 });
  const diagnosis = await diagnoseAuthorization(asked(), signed);
  assert.equal(diagnosis.finding, "wallet_signed_another_nonce");
  assert.match(diagnosis.detail, /nonce 4/);
  assert.match(diagnosis.detail, /nonce 3/);
});

test("a signature over another delegate is named", async () => {
  const signed = await sign(OWNER, { chainId: 84532, address: OTHER_DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), signed);
  assert.equal(diagnosis.finding, "wallet_signed_another_delegate");
});

test("a valid signature from another key is a different wallet, not a bad signature", async () => {
  // The one fault a caller can cause: everything the wallet reported matches,
  // the signature is well-formed and over the right message, and it still
  // recovers to somebody else. Nothing in the tuple distinguishes this from a
  // correct signature except which key produced it.
  const signed = await sign(STRANGER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), signed);
  assert.equal(diagnosis.finding, "wallet_signed_another_key");
  assert.equal(diagnosis.recovered?.toLowerCase(), STRANGER.address.toLowerCase());
  assert.equal(diagnosis.matchesAccount, false);
  assert.match(diagnosis.detail, /signing wallet/);
});

test("a wallet that reports nothing is not treated as evidence", async () => {
  // Some providers return only the signature. Stripping the tuple fields must
  // not turn a wrong-key signature into a field mismatch, and must not invent
  // agreement either: it falls through to the only thing left, the recovery.
  const signed = await sign(STRANGER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), {
    r: signed.r,
    s: signed.s,
    yParity: signed.yParity,
  });
  assert.equal(diagnosis.finding, "wallet_signed_another_key");
  assert.deepEqual(diagnosis.reported, { address: null, chainId: null, nonce: null });
});

test("a wallet that misreports but signs correctly is still ok", async () => {
  // Recovery is the ground truth. If the signature is right, the answer is
  // right, whatever the wallet claimed about it.
  const signed = await sign(OWNER, { chainId: 84532, address: DELEGATE, nonce: 3 });
  const diagnosis = await diagnoseAuthorization(asked(), {
    ...signed,
    nonce: 99,
  });
  assert.equal(diagnosis.finding, "ok");
});

test("a garbage signature does not throw, it reports that it recovered to nothing", async () => {
  const diagnosis = await diagnoseAuthorization(asked(), {
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`,
    yParity: 0,
    address: DELEGATE,
    chainId: 84532,
    nonce: 3,
  });
  assert.equal(diagnosis.matchesAccount, false);
  assert.equal(diagnosis.finding, "wallet_signed_another_key");
});
