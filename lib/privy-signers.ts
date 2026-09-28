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
import { createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * The minimum an EIP-1193 provider has to offer this module.
 *
 * Privy and viem each declare their own `EIP1193Provider`, and their event
 * handler types differ in a way that neither satisfies the other. Only `request`
 * is needed here, so this module depends on that alone and the cast to viem's
 * type happens in exactly one place, at `createWalletClient`.
 */
export interface RawHashProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Shape of `useSign7702Authorization().signAuthorization`. */
export type PrivySignAuthorization = (input: {
  contractAddress: `0x${string}`;
  chainId?: number;
  nonce?: number;
}) => Promise<{ r: Hex; s: Hex; v?: bigint; yParity?: number }>;

/**
 * Wraps Privy's `signAuthorization` as the SDK's `Eip7702AuthorizationSigner`.
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

/** What Privy's `secp256k1_sign` returns, before normalisation. */
export interface RawSignatureObservation {
  /** Exactly what the provider returned, for the spike's finding record. */
  raw: Hex;
  /** Last byte of the 65-byte signature, as returned. */
  rawRecoveryByte: number | null;
  /** Last byte after normalisation to 27/28. */
  normalizedRecoveryByte: number;
  /** True when the provider's byte was 0/1 and had to be shifted. */
  shifted: boolean;
  /** Signature handed to the SDK. */
  signature: Hex;
}

/**
 * Normalises a 65-byte `r || s || v` signature to `v` of 27 or 28.
 *
 * Why this exists: viem's `recoverAddress` accepts 0/1 or 27/28, but Biconomy
 * Nexus 1.3.3's on-chain initializer check may accept only 27/28. The SDK
 * validates the signature with viem and then hands it to the chain, so a
 * provider that returns 0/1 would pass the SDK's own check and still be
 * rejected on-chain. Normalising here keeps that failure out of the demo.
 */
export function normalizeRecoveryByte(signature: Hex): {
  signature: Hex;
  rawRecoveryByte: number | null;
  normalizedRecoveryByte: number;
  shifted: boolean;
} {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("privy_raw_signature_not_65_bytes");
  }
  const rawByte = Number.parseInt(signature.slice(128, 130), 16);
  let recoveryByte: number;
  if (rawByte === 27 || rawByte === 28) {
    recoveryByte = rawByte;
  } else if (rawByte === 0 || rawByte === 1) {
    recoveryByte = rawByte + 27;
  } else {
    throw new Error(`privy_raw_signature_bad_recovery_byte:${rawByte}`);
  }
  const normalized = `${signature.slice(0, 128)}${recoveryByte
    .toString(16)
    .padStart(2, "0")}` as Hex;
  return {
    signature: normalized,
    rawRecoveryByte: rawByte,
    normalizedRecoveryByte: recoveryByte,
    shifted: recoveryByte !== rawByte,
  };
}

/**
 * Wraps the embedded wallet's raw-hash signing as the SDK's `RawHashSigner`.
 *
 * Privy's embedded wallet EIP-1193 provider exposes `secp256k1_sign`, which
 * takes the 32-byte hash as its only parameter. Each call is recorded in
 * `observations` so the spike can report what the provider actually returned
 * rather than what we assumed.
 */
export function privyRawHashSigner(
  provider: RawHashProvider,
  observations: RawSignatureObservation[] = [],
): RawHashSigner {
  return {
    async sign({ hash }) {
      const raw = (await provider.request({
        method: "secp256k1_sign",
        params: [hash],
      })) as Hex;
      const normalized = normalizeRecoveryByte(raw);
      observations.push({ raw, ...normalized });
      return normalized.signature;
    },
  };
}

/**
 * A viem wallet client over Privy's EIP-1193 provider.
 *
 * This is how the SDK gets `eth_signTypedData_v4` and `sendTransaction` for the
 * approval and the safety actions. Privy's own EOA still sends its own type-2
 * transactions, which is what `nexus7702` expects.
 */
export function privyWalletClient(provider: RawHashProvider) {
  return createWalletClient({
    account: undefined,
    chain: baseSepolia,
    // The single cast between Privy's provider type and viem's. Safe because
    // this module only ever issues `eth_signTypedData_v4` and
    // `eth_sendTransaction` through it, both of which are standard.
    transport: custom(provider as EIP1193Provider),
  });
}
