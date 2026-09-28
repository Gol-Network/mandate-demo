/**
 * Removing an EIP-7702 delegation from the owner's own wallet.
 *
 * **GOL has no undelegation API, and this module is not one.** It is the owner's
 * own key authority, exercised through the owner's own wallet, and it never asks
 * GOL for anything. GOL's role ends at noticing the account is delegated
 * somewhere it did not review and refusing it with
 * `account_integration_invalid`; what the owner does about that is the owner's
 * business, exactly as ADR 0019 puts it. That is also why the demo can offer this
 * without weakening anything: it cannot remove a delegation from an account
 * whose key it does not have, and the owner signs both steps.
 *
 * The mechanism, from the EIP itself (EIP-7702, "Set code transaction"):
 *
 *  1. The owner signs an authorization tuple `[chain_id, address, nonce]` for
 *     **`address = 0x0000000000000000000000000000000000000000`**. The spec's
 *     special case: "If address is 0x0000000000000000000000000000000000000000,
 *     do not write the delegation indicator. Clear the account's code." An
 *     authorization naming any other address installs that address as the
 *     account's code instead, which is the opposite of what is wanted here.
 *  2. A type-4 transaction carrying that tuple applies it. An authorization on
 *     its own does nothing; it only takes effect inside a transaction.
 *
 * Step 2 sends zero value to the owner's own address with empty calldata. That is
 * safe, and deliberately so: the authorization list is processed *before* the
 * transaction body runs, so by the time the self-send executes the account's code
 * is already gone and the call lands on a plain EOA. Even if it reverted, EIP-7702
 * does not roll the delegation back, so the clear would survive either way.
 *
 * The owner pays for this transaction. It is the owner's own key and the owner's
 * own nonce, and GOL's sponsored setup only covers the reviewed delegate, so
 * there is nothing for GOL to sponsor here.
 */
import { zeroAddress } from "viem";
import type { Address, Hex } from "viem";

/** Base Sepolia, pinned here so the tuple and the transaction cannot disagree. */
export const CLEAR_CHAIN_ID = 84532;

/**
 * The address an authorization must name to clear a delegation. This is the
 * spec's reset address, not a sentinel like `0xEeeE` from the early drafts, and
 * not "whatever address is empty": the EVM makes the zero address the clear.
 */
export const CLEAR_DELEGATION_ADDRESS = zeroAddress;

/** One signed authorization tuple, exactly the six fields a type-4 transaction takes. */
export interface ClearDelegationTuple {
  address: Address;
  chainId: number;
  nonce: number;
  yParity: number;
  r: Hex;
  s: Hex;
}

/**
 * What Privy's `signAuthorization` hands back, narrowed to what is forwarded.
 *
 * Privy returns more than the tuple (it may include `v`, and it repeats the
 * `address` it was asked for), and the extra fields are dropped rather than
 * forwarded: a wallet that is handed fields it did not expect, in a request about
 * a security-critical change, is a wallet that might apply a different one.
 */
export interface PrivySignedAuthorization {
  address: string;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: number;
}

/**
 * Checks the tuple the wallet returned is the one that was asked for, then
 * reduces it to the six fields.
 *
 * This is the check that makes the flow safe to run unattended on stage. The
 * address and the chain are both inside the signed payload, so a wallet that
 * signed a different one would clear nothing, or worse, would install a delegate
 * the owner never saw. Both failures are refused here rather than submitted.
 */
export function clearDelegationTuple(
  signed: PrivySignedAuthorization,
  chainId: number = CLEAR_CHAIN_ID,
): ClearDelegationTuple {
  if (signed.address.toLowerCase() !== CLEAR_DELEGATION_ADDRESS) {
    throw new Error("undelegation_wrong_address");
  }
  if (signed.chainId !== chainId) {
    throw new Error(`undelegation_wrong_chain:${signed.chainId}`);
  }
  return {
    address: CLEAR_DELEGATION_ADDRESS,
    chainId,
    nonce: signed.nonce,
    yParity: signed.yParity,
    r: signed.r,
    s: signed.s,
  };
}

/** The transaction the owner's wallet has to send. */
export interface ClearDelegationRequest {
  to: Address;
  value: bigint;
  data: Hex;
  authorizationList: readonly ClearDelegationTuple[];
}

/**
 * Builds the type-4 transaction: the tuple plus a zero-value self-send.
 *
 * `to` and `value` are not decoration. EIP-7702 requires a destination and a
 * non-empty authorization list, and the self-send is the cheapest call that
 * cannot do anything, which matters for a transaction whose whole purpose is to
 * carry one tuple.
 */
export function clearDelegationRequest(
  account: Address,
  tuple: ClearDelegationTuple,
): ClearDelegationRequest {
  return {
    to: account,
    value: 0n,
    data: "0x",
    authorizationList: [tuple],
  };
}
