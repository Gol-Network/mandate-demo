/**
 * Reading a raw secp256k1 signature from a wallet that will not say what it means.
 *
 * A signature over a raw 32-byte hash is `r || s || v`. The last byte is the
 * problem: the same bit of information is written four different ways by
 * different providers, and nothing in the 65 bytes says which one was used.
 *
 *  - `0` or `1`, which is `yParity` and what EIP-2 and viem call it;
 *  - `27` or `28`, the legacy `v`;
 *  - `0x00` or `0x80`, the parity in the **high bit**, which is what Privy's
 *    `secp256k1_sign` returned on 2026-09-28 and which its documentation does not
 *    describe. The demo refused it as `privy_raw_signature_bad_recovery_byte:80`.
 *
 * Guessing which encoding a provider uses is a table that is wrong until the day
 * it is not, and being wrong here is quiet: a wrong parity does not throw, it
 * recovers to a **different address**, and the failure surfaces somewhere else
 * entirely, or on chain.
 *
 * So the byte is not trusted at all. For a given hash and a given `r || s`, there
 * are exactly two mathematically valid readings, and exactly one of them recovers
 * to the signer. This module tries both and keeps the one that recovers to the
 * address the caller already knows. That is a decoding step, not a repair: it
 * cannot produce a signature that recovers to the owner unless the wallet really
 * signed that hash with that key, and a signature over some other hash, or from
 * some other key, still fails for both candidates and is refused.
 *
 * The output is always 65 bytes with `v` of 27 or 28, because that is the form
 * both viem and the on-chain initializer accept, and the caller is expected to
 * have the SDK check the result again before anything is submitted.
 */
import { recoverAddress } from "viem";
import type { Address, Hex } from "viem";

/** How the provider wrote the recovery bit, as far as the byte can be read. */
export type RecoveryByteEncoding =
  /** `0` or `1`. The usual EIP-2 `yParity`. */
  | "y_parity"
  /** `27` or `28`. The legacy `v`. */
  | "v_27_28"
  /** `0x80`, the parity in the high bit. Observed from Privy, undocumented. */
  | "parity_in_high_bit"
  /** Something else. Still decoded, because the byte is not what decides. */
  | "unrecognised";

/** Everything learned about one raw signature, for the record and for the screen. */
export interface RawSignatureReading {
  /** The hash that was signed. */
  hash: Hex;
  /** What the provider returned, byte for byte. */
  raw: Hex;
  /** How many bytes came back. 65 is the only length this reads. */
  length: number;
  /** The last byte, as hex, because `0x80` is the finding. */
  rawByteHex: string;
  rawByte: number;
  encoding: RecoveryByteEncoding;
  /** The parity the byte claims, or null when it claims nothing usable. */
  reportedYParity: 0 | 1 | null;
  /** The parity that actually recovers to `expected`. This is the answer. */
  derivedYParity: 0 | 1;
  /** Whether the byte told the truth. False is a finding, not a failure. */
  byteAgrees: boolean;
  /** 65 bytes with `v` of 27 or 28. What the caller hands on. */
  signature: Hex;
}

const parityFromByte = (byte: number): 0 | 1 | null => {
  if (byte === 0 || byte === 1) return byte;
  if (byte === 27 || byte === 28) return (byte - 27) as 0 | 1;
  // The high bit is the parity, and nothing else in the byte is used.
  if (byte === 0x00 || byte === 0x80) return byte === 0x80 ? 1 : 0;
  return null;
};

const encodingOf = (byte: number): RecoveryByteEncoding => {
  if (byte === 0 || byte === 1) return "y_parity";
  if (byte === 27 || byte === 28) return "v_27_28";
  if (byte === 0x80) return "parity_in_high_bit";
  return "unrecognised";
};

const to65 = (r: Hex, s: Hex, yParity: 0 | 1): Hex =>
  `${r}${s.slice(2)}${(27 + yParity).toString(16).padStart(2, "0")}` as Hex;

/**
 * Decides which of the two readings of `r || s` recovers to `expected`.
 *
 * Returns the raw signature when neither does, so the caller can see what it
 * recovers to rather than being told only that it failed.
 */
export async function readRawSignature(
  raw: Hex,
  hash: Hex,
  expected: Address,
): Promise<RawSignatureReading> {
  const body = raw.startsWith("0x") ? raw.slice(2) : raw;
  const length = body.length / 2;
  if (length !== 65) {
    throw new Error(`raw_signature_not_65_bytes:${length}`);
  }

  const r = `0x${body.slice(0, 64)}` as Hex;
  const s = `0x${body.slice(64, 128)}` as Hex;
  const rawByte = Number.parseInt(body.slice(128, 130), 16);
  const reportedYParity = parityFromByte(rawByte);

  const recovered: Record<0 | 1, Address | null> = { 0: null, 1: null };
  for (const parity of [0, 1] as const) {
    try {
      recovered[parity] = await recoverAddress({ hash, signature: { r, s, yParity: parity } });
    } catch {
      recovered[parity] = null;
    }
  }

  const matches = (parity: 0 | 1): boolean =>
    recovered[parity] !== null &&
    recovered[parity]!.toLowerCase() === expected.toLowerCase();

  if (!matches(0) && !matches(1)) {
    throw new Error(
      `raw_signature_recovers_to_neither_candidate:0=${recovered[0] ?? "none"},1=${
        recovered[1] ?? "none"
      },expected=${expected}`,
    );
  }

  // Both cannot match, so the order here only decides which one is reported if
  // something impossible has happened.
  const derivedYParity: 0 | 1 = matches(0) ? 0 : 1;

  return {
    hash,
    raw,
    length,
    rawByteHex: `0x${body.slice(128, 130)}`,
    rawByte,
    encoding: encodingOf(rawByte),
    reportedYParity,
    derivedYParity,
    byteAgrees: reportedYParity === null ? false : reportedYParity === derivedYParity,
    signature: to65(r, s, derivedYParity),
  };
}
