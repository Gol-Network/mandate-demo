/**
 * Why an EIP-7702 authorization did not come back from the account it had to.
 *
 * `signPreparedEip7702Setup` recovers the authority from the signed tuple and
 * refuses anything that is not the owner, with one string:
 * `eip7702_authorization_signer_mismatch`. That is the right refusal, and it is
 * useless as a diagnosis, because a mismatch has at least five causes that need
 * five different fixes and the tuple alone does not say which one happened.
 *
 * The hash an authorization is signed over is
 * `keccak256(0x05 || rlp([chain_id, address, nonce]))`, so three of the five
 * causes are a disagreement about one of those three fields, and a wallet that
 * reports the tuple it signed makes all three checkable without any secret. The
 * remaining two are the signature itself: a different key, or an inverted
 * `yParity`.
 *
 * Privy returns the `address`, `chainId`, and `nonce` it signed for, so this
 * compares what was asked for against what the wallet says it signed, and then
 * recovers the signature locally to find out which of those is true. Recovery is
 * the ground truth and is checked first; the reported fields are only used to
 * explain a failure. A wallet that reports nothing useful is not treated as
 * evidence of anything.
 *
 * This is the demo's own instrumentation, not authority. It runs in the browser
 * over data the wallet already returned, it decides nothing, and it never sees a
 * key.
 */
import { recoverAuthorizationAddress } from "viem/utils";
import type { Address, Hex } from "viem";

/** What was asked of the wallet. `account` is who the answer has to be from. */
export interface AuthorizationAsked {
  account: Address;
  chainId: number;
  address: Address;
  nonce: number;
}

/** What a wallet handed back. Every field but the signature is optional on purpose. */
export interface AuthorizationSigned {
  address?: string;
  chainId?: number;
  nonce?: number;
  r: Hex;
  s: Hex;
  yParity?: number;
  v?: bigint | number | string;
}

/**
 * A named cause rather than a message, so a finding can be quoted in a report
 * and compared across runs instead of re-read.
 */
export type AuthorizationFinding =
  /** The signature recovers to the account. The tuple is good. */
  | "ok"
  /** Neither `yParity` nor a usable `v`. The SDK would have refused this too. */
  | "recovery_byte_missing"
  /** The tuple is right but the parity is flipped, so it recovers to the other address. */
  | "y_parity_looks_inverted"
  /** The wallet says it signed a different chain. The hash is chain-scoped. */
  | "wallet_signed_another_chain"
  /** The wallet says it signed a different nonce. The hash is nonce-scoped. */
  | "wallet_signed_another_nonce"
  /** The wallet says it signed a different delegate. The hash names the delegate. */
  | "wallet_signed_another_delegate"
  /**
   * The tuple matches on every field the wallet reported, the signature is
   * well-formed, and it still recovers to another account. That is a different
   * key, which in practice means the wallet signed with a wallet other than the
   * one the demo is holding.
   */
  | "wallet_signed_another_key";

export interface AuthorizationDiagnosis {
  finding: AuthorizationFinding;
  /** One sentence, safe to show on screen. Names the field where there is one. */
  detail: string;
  asked: AuthorizationAsked;
  /** What the wallet claimed, or nulls where it claimed nothing. */
  reported: { address: string | null; chainId: number | null; nonce: number | null };
  yParity: number | null;
  /** What the signature recovers to, with the parity used. */
  recovered: Address | null;
  /** What it recovers to with the parity flipped. Null only if recovery threw. */
  recoveredWithOtherParity: Address | null;
  matchesAccount: boolean;
}

const same = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;

/** `0` or `1` from whatever the wallet called the recovery byte. */
export function authorizationYParity(signed: AuthorizationSigned): number | null {
  if (signed.yParity === 0 || signed.yParity === 1) return signed.yParity;
  // `v` arrives as 27/28 from some providers and 0/1 from others, and as a
  // string from at least one. All four are the same bit.
  const raw = signed.v === undefined ? undefined : Number(signed.v);
  if (raw === 27 || raw === 0) return 0;
  if (raw === 28 || raw === 1) return 1;
  return null;
}

export async function diagnoseAuthorization(
  asked: AuthorizationAsked,
  signed: AuthorizationSigned,
): Promise<AuthorizationDiagnosis> {
  const reported = {
    address: typeof signed.address === "string" ? signed.address : null,
    chainId: typeof signed.chainId === "number" ? signed.chainId : null,
    nonce: typeof signed.nonce === "number" ? signed.nonce : null,
  };
  const base = { asked, reported, yParity: null as number | null };

  const yParity = authorizationYParity(signed);
  if (yParity === null) {
    return {
      ...base,
      finding: "recovery_byte_missing",
      detail:
        "The wallet returned a signature with neither a usable yParity nor a v of 0, 1, 27, or 28, so there is no way to tell which of the two signatures this is.",
      recovered: null,
      recoveredWithOtherParity: null,
      matchesAccount: false,
    };
  }

  const recover = async (parity: number): Promise<Address | null> => {
    try {
      return await recoverAuthorizationAddress({
        authorization: {
          chainId: asked.chainId,
          address: asked.address,
          nonce: asked.nonce,
          r: signed.r,
          s: signed.s,
          yParity: parity,
        },
      });
    } catch {
      return null;
    }
  };

  const recovered = await recover(yParity);
  const other = await recover(yParity === 0 ? 1 : 0);
  const matches = recovered !== null && same(recovered, asked.account);
  const matchesFlipped = other !== null && same(other, asked.account);

  const finish = (
    finding: AuthorizationFinding,
    detail: string,
  ): AuthorizationDiagnosis => ({
    ...base,
    yParity,
    finding,
    detail,
    recovered,
    recoveredWithOtherParity: other,
    matchesAccount: matches,
  });

  // Recovery first: it is what actually happened. The reported fields only come
  // into it to explain a failure, so a wallet that misreports but signs
  // correctly is still `ok`.
  if (matches) {
    return finish("ok", `The signature recovers to ${asked.account}, which is the owner.`);
  }
  if (matchesFlipped) {
    return finish(
      "y_parity_looks_inverted",
      "The signature recovers to the owner only with the recovery byte flipped, so the wallet reported the wrong parity rather than signing anything different.",
    );
  }
  if (reported.chainId !== null && reported.chainId !== asked.chainId) {
    return finish(
      "wallet_signed_another_chain",
      `The wallet says it signed for chain ${reported.chainId} and asked for chain ${asked.chainId}. The authorization hash covers the chain id, so a signature for one chain never recovers on another.`,
    );
  }
  if (reported.nonce !== null && reported.nonce !== asked.nonce) {
    return finish(
      "wallet_signed_another_nonce",
      `The wallet says it signed for nonce ${reported.nonce} and asked for nonce ${asked.nonce}. The authorization hash covers the nonce, so this signature is over a different message.`,
    );
  }
  if (reported.address !== null && !same(reported.address, asked.address)) {
    return finish(
      "wallet_signed_another_delegate",
      `The wallet says it delegated to ${reported.address} and asked to delegate to ${asked.address}. The delegate is inside the signed hash, so this signature is for a different delegation.`,
    );
  }
  return finish(
    "wallet_signed_another_key",
    `The wallet reported chain ${asked.chainId}, delegate ${asked.address}, and nonce ${asked.nonce}, and the signature is well-formed, but it recovers to ${
      recovered ?? "nothing"
    } rather than the owner. A well-formed signature over the right message from the wrong key is a different signing wallet, which is what happens when the wallet is not told which of the user's wallets to use.`,
  );
}
