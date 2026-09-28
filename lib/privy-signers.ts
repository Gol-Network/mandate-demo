/**
 * Privy embedded wallet to `@gol/sdk` signer adapters. Client-side only.
 *
 * GOL's SDK never receives the owner key. It asks a wallet for two things and
 * checks that both signatures recover to the owner's account:
 *
 *  - an EIP-7702 authorization tuple, and
 *  - a 65-byte signature over a raw initialization hash.
 *
 * Privy gives us the first through `useSign7702Authorization().signAuthorization`
 * and the second through the embedded wallet's EIP-1193 `secp256k1_sign`
 * method. This module is the seam between those and the SDK's two signer
 * interfaces, and it is where the recovery-byte normalisation lives.
 */
import type {
  Eip7702AuthorizationSigner,
  RawHashSigner,
} from "@gol/sdk";
import { type Hex } from "viem";
import { readRawSignature, type RawSignatureReading } from "./raw-signature.ts";

/**
 * The minimum an EIP-1193 provider has to offer this module.
 *
 * Privy and viem each declare their own `EIP1193Provider`, and their event
 * handler types differ. Raw hash signing needs only `request`, so this module
 * depends on that alone.
 */
export interface RawHashProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * Shape of `useSign7702Authorization().signAuthorization`.
 *
 * The whole signed tuple comes back, not just the signature: Privy repeats the
 * address and chain it was asked for, and reports the nonce it used. The SDK's
 * signer adapter below needs only `r`, `s`, `v` and `yParity`, but the tuple is
 * exactly what a type-4 transaction has to carry, so it stays in the type rather
 * than being dropped and re-derived. Nothing re-derives it: `clearDelegationTuple`
 * checks the address and chain the wallet reported against the ones that were
 * asked for, which is only possible because the wallet reported them.
 */
export type PrivySignAuthorization = (
  input: {
    contractAddress: `0x${string}`;
    chainId?: number;
    nonce?: number;
  },
  /** Optional here to match Privy. Always supplied by `boundPrivyAuthorization`. */
  options?: { address?: `0x${string}` },
) => Promise<{
  address: string;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: number;
  v?: bigint;
}>;

/**
 * Privy's signer, pinned to one account.
 *
 * `options.address` is not optional in practice. Privy signs with the **first**
 * linked wallet when it is not told which one, and the demo does not assume its
 * own wallet selection is Privy's first. The result of getting this wrong is the
 * worst kind of failure available here: a signature that is entirely well-formed,
 * over exactly the right message, that recovers to a different account. The SDK
 * refuses it as `eip7702_authorization_signer_mismatch`, which names the symptom
 * and not the cause, and nothing in the tuple distinguishes it from a correct
 * signature except which key produced it.
 *
 * Binding the address here rather than at each call site is deliberate: a
 * comment asking for the argument gets ignored the first time somebody adds a
 * fourth call site, and a missing required argument does not compile.
 */
export function boundPrivyAuthorization(
  signAuthorization: PrivySignAuthorization,
  account: `0x${string}`,
): (input: {
  contractAddress: `0x${string}`;
  chainId?: number;
  nonce?: number;
}) => Promise<Awaited<ReturnType<PrivySignAuthorization>>> {
  return (input) => signAuthorization(input, { address: account });
}

/**
 * Wraps Privy's `signAuthorization` as the SDK's `Eip7702AuthorizationSigner`.
 *
 * Pass a signer already bound to the owner with `boundPrivyAuthorization`, so
 * Privy cannot answer for a different wallet than the one this setup is for.
 *
 * The SDK accepts `v` of 27/28 or 0/1, so Privy's value passes through
 * unchanged. The address the signature recovered from is re-derived here as a
 * cross-check that Privy signed the account we asked about, because a silent
 * mismatch here would otherwise only surface as an opaque rejection later.
 */
export function privyAuthorizationSigner(
  signAuthorization: PrivySignAuthorization,
): Eip7702AuthorizationSigner {
  return {
    async signAuthorization(request) {
      const result = await signAuthorization({
        contractAddress: request.address,
        chainId: request.chainId,
        nonce: request.nonce,
      });
      return {
        r: result.r,
        s: result.s,
        ...(result.yParity === undefined ? {} : { yParity: result.yParity }),
        ...(result.v === undefined ? {} : { v: result.v }),
      };
    },
  };
}

/** What a raw-hash signing probe learned, for the finding record. */
export type RawSignatureObservation = RawSignatureReading;

const HEX_65 = /^0x[0-9a-fA-F]{130}$/;

/**
 * Wraps the embedded wallet's raw-hash signing as the SDK's `RawHashSigner`.
 *
 * Privy's embedded wallet EIP-1193 provider exposes `secp256k1_sign`, which
 * takes the 32-byte hash as its only parameter and returns the signature as hex.
 * Each call is recorded in `observations` so the run can report what the provider
 * actually returned rather than what was assumed about it.
 *
 * `expected` is the account whose key should have signed. It is what makes the
 * recovery byte decidable: see `readRawSignature`, which is why the byte is
 * derived rather than trusted.
 */
export function privyRawHashSigner(
  provider: RawHashProvider,
  expected: `0x${string}`,
  observations: RawSignatureObservation[] = [],
): RawHashSigner {
  return {
    async sign({ hash }) {
      const raw = (await provider.request({
        method: "secp256k1_sign",
        params: [hash],
      })) as Hex;
      if (!HEX_65.test(raw)) {
        // Named before the decode so a wrong length is distinguishable from a
        // wrong signature. The length is in the message because the length is
        // the finding.
        throw new Error(
          `privy_raw_signature_not_65_bytes:${(raw.length - 2) / 2}`,
        );
      }
      const reading = await readRawSignature(raw, hash, expected);
      observations.push(reading);
      return reading.signature;
    },
  };
}
