/**
 * Tests for reading a raw secp256k1 signature. Real keys, real recovery.
 *
 * The case that matters is `0x80`. Privy's `secp256k1_sign` returned a 65-byte
 * signature whose last byte was `0x80` on 2026-09-28, and the demo refused it as
 * `privy_raw_signature_bad_recovery_byte:80` because it only knew 0/1 and 27/28.
 * Its documentation describes the return as a hex string and says nothing about
 * the last byte.
 *
 * These tests therefore do not assert one encoding. They assert the property that
 * makes the demo independent of the encoding: whatever byte a provider sends, the
 * result recovers to the signer, because the byte is never what decides. Each
 * encoding is exercised, and so is a byte that is simply wrong, which is the case
 * a table of encodings would fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAddress } from "viem";
import { readRawSignature } from "../lib/raw-signature.ts";

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

/**
 * A real signature over a real hash, as 65 bytes.
 *
 * `account.sign` returns hex by default, which is the same shape a provider
 * returns, so it is used directly rather than as an object.
 */
const signed = async (hash: Hex, by = OWNER): Promise<Hex> => by.sign({ hash });

/** Re-encodes a 65-byte signature with an arbitrary last byte, as a provider might. */
const withByte = (raw: Hex, byte: number): Hex =>
  `${raw.slice(2, 130)}${byte.toString(16).padStart(2, "0")}` as Hex;

/** The parity that actually recovers to the signer, read the honest way. */
const trueParity = async (raw: Hex, hash: Hex): Promise<0 | 1> => {
  for (const parity of [0, 1] as const) {
    const recovered = await recoverAddress({
      hash,
      signature: {
        r: `0x${raw.slice(2, 66)}` as Hex,
        s: `0x${raw.slice(66, 130)}` as Hex,
        yParity: parity,
      },
    });
    if (recovered.toLowerCase() === OWNER.address.toLowerCase()) return parity;
  }
  throw new Error("no parity recovers to the owner");
};

const HASH = keccak256(toHex("a hash the demo would ask the owner to sign"));

test("every known encoding of the recovery byte decodes to the same answer", async () => {
  const raw = await signed(HASH);
  const parity = await trueParity(raw, HASH);
  const encodings: [label: string, byte: number, reported: 0 | 1, name: string][] = [
    ["yParity 0", 0x00, 0, "y_parity"],
    ["yParity 1", 0x01, 1, "y_parity"],
    ["v 27", 0x1b, 0, "v_27_28"],
    ["v 28", 0x1c, 1, "v_27_28"],
    // The one Privy actually returned. 0x80 is the parity in the high bit.
    ["high bit", 0x80, 1, "parity_in_high_bit"],
  ];

  for (const [label, byte, reported, encoding] of encodings) {
    const reading = await readRawSignature(withByte(raw, byte), HASH, OWNER.address);
    assert.equal(reading.encoding, encoding, label);
    assert.equal(reading.reportedYParity, reported, label);
    // Whether the byte told the truth or not, the answer is the same.
    assert.equal(reading.derivedYParity, parity, label);
    const recovered = await recoverAddress({ hash: HASH, signature: reading.signature });
    assert.equal(recovered.toLowerCase(), OWNER.address.toLowerCase(), label);
  }
});

test("the signature handed on always uses v of 27 or 28", async () => {
  // viem accepts 0/1 and 27/28, but the on-chain initializer may accept only
  // 27/28, so the output form is fixed rather than passed through.
  for (const byte of [0x00, 0x01, 0x1b, 0x1c, 0x80]) {
    const reading = await readRawSignature(
      withByte(await signed(HASH), byte),
      HASH,
      OWNER.address,
    );
    const last = Number.parseInt(reading.signature.slice(-2), 16);
    assert.ok(last === 27 || last === 28, `expected 27 or 28, got ${last}`);
    assert.equal(reading.signature.length, 132);
  }
});

test("a byte that is simply wrong does not change the answer", async () => {
  // A table of encodings would fail here. Deriving the parity cannot: there are
  // two readings and only one of them is the signer, whatever the byte claims.
  const raw = await signed(HASH);
  const parity = await trueParity(raw, HASH);
  for (const byte of [0x02, 0x7f, 0x99, 0xff]) {
    const reading = await readRawSignature(withByte(raw, byte), HASH, OWNER.address);
    assert.equal(reading.encoding, "unrecognised", `byte ${byte}`);
    assert.equal(reading.reportedYParity, null, `byte ${byte}`);
    assert.equal(reading.byteAgrees, false, `byte ${byte}`);
    assert.equal(reading.derivedYParity, parity, `byte ${byte}`);
  }
});

test("a byte that lies is recorded as a disagreement, not obeyed", async () => {
  const raw = await signed(HASH);
  const parity = await trueParity(raw, HASH);
  const lying = withByte(raw, parity === 0 ? 0x1c : 0x1b);
  const reading = await readRawSignature(lying, HASH, OWNER.address);
  assert.equal(reading.byteAgrees, false);
  assert.equal(reading.derivedYParity, parity);
  const recovered = await recoverAddress({ hash: HASH, signature: reading.signature });
  assert.equal(recovered.toLowerCase(), OWNER.address.toLowerCase());
});

test("a signature over a different hash is refused, and the byte is irrelevant", async () => {
  const raw = await signed(HASH);
  await assert.rejects(
    () =>
      readRawSignature(
        withByte(raw, 0x80),
        keccak256(toHex("a different hash")),
        OWNER.address,
      ),
    /recovers_to_neither_candidate/,
  );
});

test("a signature from a different key is refused", async () => {
  await assert.rejects(
    async () =>
      readRawSignature(withByte(await signed(HASH, STRANGER), 0x80), HASH, OWNER.address),
    /recovers_to_neither_candidate/,
  );
});

test("the refusal names what each candidate recovers to", async () => {
  // The failure has to be diagnosable, because "it did not work" is what started
  // this. Both candidates are named, so the next run can see what the signature
  // actually is rather than being told only that it failed.
  const raw = withByte(await signed(HASH, STRANGER), 0x80);
  await assert.rejects(
    () => readRawSignature(raw, HASH, OWNER.address),
    (caught: unknown) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      assert.match(message, /^raw_signature_recovers_to_neither_candidate:0=0x[0-9a-fA-F]{40},1=0x[0-9a-fA-F]{40},expected=0x[0-9a-fA-F]{40}$/);
      // Neither candidate is the owner, which is the whole reason it failed.
      const [zero, one] = message
        .replace("raw_signature_recovers_to_neither_candidate:", "")
        .split(",expected=")[0]!
        .split(",");
      assert.ok(!zero!.endsWith(OWNER.address.slice(2).toLowerCase()));
      assert.ok(!one!.endsWith(OWNER.address.slice(2).toLowerCase()));
      return true;
    },
  );
});

test("a signature that is not 65 bytes is refused with its actual length", async () => {
  // The length is the finding when the length is wrong, so it is in the message.
  await assert.rejects(
    () => readRawSignature(`0x${"11".repeat(64)}` as Hex, HASH, OWNER.address),
    /raw_signature_not_65_bytes:64/,
  );
  await assert.rejects(
    () => readRawSignature(`0x${"11".repeat(66)}` as Hex, HASH, OWNER.address),
    /raw_signature_not_65_bytes:66/,
  );
});

test("the recorded reading carries the hash and the raw bytes for the report", async () => {
  const raw = withByte(await signed(HASH), 0x80);
  const reading = await readRawSignature(raw, HASH, OWNER.address);
  assert.equal(reading.hash, HASH);
  assert.equal(reading.raw, raw);
  assert.equal(reading.length, 65);
  assert.equal(reading.rawByteHex, "0x80");
  assert.equal(reading.rawByte, 128);
});
