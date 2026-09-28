/**
 * Contacts: the (name, address) pairs an owner enters when approving a mandate.
 *
 * The important asymmetry: **only the address goes on-chain.** A mandate's
 * recipient allowlist is a sorted set of addresses (`encodeTransferPolicy` in
 * `@gol/sdk` emits `rule(0x0110, addressSet(recipients))`). The name is demo
 * metadata that never leaves the browser except as a label, so it is not
 * authority and cannot widen anything.
 *
 * Two consequences worth relying on:
 *
 *  - Renaming a contact needs no new approval. Only adding, removing, or
 *    replacing an address does, because only the address is hashed into the
 *    policy.
 *  - Names must be unique and addresses must be unique, so name resolution is
 *    deterministic. An ambiguous name is a demo failure, so it is rejected at
 *    entry rather than resolved by guessing.
 *
 * This module is pure and client-safe. The server imports it to resolve names
 * from browser-supplied data, which it treats as untrusted.
 */
import { getAddress, isAddress } from "viem";

/** A single owner-entered payee. */
export interface Contact {
  /** Owner-chosen label. Unique within a mandate. Demo metadata only. */
  name: string;
  /**
   * The on-chain payee, as typed. Deliberately a plain `string`: while the owner
   * is still typing this is not yet an address, and the type should not claim it
   * is. `contactAddresses` is the narrowing point, and it throws rather than
   * coercing.
   */
  address: string;
}

/** The protocol limit, and the API schema limit, are both 1 to 16. */
export const MIN_CONTACTS = 1;
export const MAX_CONTACTS = 16;

/** Why a contact list cannot be approved. */
export type ContactProblem =
  | { kind: "too_few"; count: number }
  | { kind: "too_many"; count: number }
  | { kind: "empty_name"; index: number }
  | { kind: "bad_address"; index: number; value: string }
  | { kind: "duplicate_address"; index: number; address: string; firstIndex: number }
  | { kind: "duplicate_name"; index: number; name: string; firstIndex: number };

/** Case-insensitive, whitespace-collapsed comparison key. */
const fold = (value: string) => value.trim().toLowerCase();

/**
 * Validates a contact list against everything the approval will reject anyway,
 * so the owner sees the problem before signing rather than after.
 *
 * The on-chain and API limits are authoritative; this exists to report them
 * clearly. A clean result here is not a guarantee the approval will succeed.
 */
export function validateContacts(rows: readonly Contact[]): ContactProblem[] {
  const problems: ContactProblem[] = [];

  if (rows.length < MIN_CONTACTS) {
    problems.push({ kind: "too_few", count: rows.length });
  }
  if (rows.length > MAX_CONTACTS) {
    problems.push({ kind: "too_many", count: rows.length });
  }

  const byAddress = new Map<string, number>();
  const byName = new Map<string, number>();

  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (name === "") {
      problems.push({ kind: "empty_name", index });
    } else {
      const key = fold(name);
      const first = byName.get(key);
      if (first === undefined) byName.set(key, index);
      else problems.push({ kind: "duplicate_name", index, name, firstIndex: first });
    }

    const raw = row.address?.trim() ?? "";
    if (!isAddress(raw)) {
      problems.push({ kind: "bad_address", index, value: raw });
      return;
    }
    // Compare on the numeric value so checksum casing cannot smuggle a duplicate
    // past the check and then trip the SDK's `duplicate_policy_address`.
    const key = BigInt(raw).toString();
    const first = byAddress.get(key);
    if (first === undefined) byAddress.set(key, index);
    else problems.push({ kind: "duplicate_address", index, address: raw, firstIndex: first });
  });

  return problems;
}

export const contactsAreValid = (rows: readonly Contact[]): boolean =>
  validateContacts(rows).length === 0;

/** The addresses to send to `prepareGasPolicy`. Names are dropped here. */
export function contactAddresses(rows: readonly Contact[]): `0x${string}`[] {
  if (!contactsAreValid(rows)) {
    throw new Error("invalid_contacts");
  }
  return rows.map((row) => getAddress(row.address.trim()));
}

/** A contact that has been checked and normalized, safe to hand to the chain. */
export interface ResolvedContact {
  name: string;
  address: `0x${string}`;
}

/** What a name-or-address string resolved to. */
export type Resolution =
  | { kind: "contact"; contact: ResolvedContact; matchedOn: "name" | "address" }
  | { kind: "raw_address"; address: `0x${string}` }
  | { kind: "unknown_name"; name: string }
  | { kind: "ambiguous_name"; name: string; addresses: `0x${string}`[] }
  | { kind: "unresolvable"; value: string };

/**
 * Resolves what a person said into an address, deterministically.
 *
 * Order matters and is fixed: an exact address wins over a name, because a
 * contact could legitimately be named after a hex string. Names are matched
 * case-insensitively after trimming. Anything that is neither a known contact
 * nor a valid address comes back unresolved rather than being guessed at.
 *
 * `raw_address` is deliberately a separate outcome from `contact`: the caller
 * needs to be able to tell the user that a payee is outside their mandate, and
 * that distinction is the demo's whole point.
 */
export function resolvePayee(
  rows: readonly Contact[],
  input: string,
): Resolution {
  const value = input.trim();
  if (value === "") return { kind: "unresolvable", value };

  if (isAddress(value)) {
    const numeric = BigInt(value).toString();
    const byAddress = rows.find((row) => BigInt(row.address) === BigInt(numeric));
    if (byAddress) {
      return {
        kind: "contact",
        contact: { name: byAddress.name, address: getAddress(byAddress.address) },
        matchedOn: "address",
      };
    }
    return { kind: "raw_address", address: getAddress(value) };
  }

  const key = fold(value);
  const byName = rows.filter((row) => fold(row.name) === key);
  if (byName.length === 1) {
    const contact = byName[0]!;
    return {
      kind: "contact",
      contact: { name: contact.name.trim(), address: getAddress(contact.address) },
      matchedOn: "name",
    };
  }
  if (byName.length > 1) {
    return {
      kind: "ambiguous_name",
      name: value,
      addresses: byName.map((row) => getAddress(row.address)),
    };
  }

  // Not an address and not a known name. Report it as an unknown name so the
  // agent can ask, rather than passing junk to the chain.
  return { kind: "unknown_name", name: value };
}

/** The addresses in this mandate. Used to tell the user what is out of scope. */
export function mandateAddresses(rows: readonly Contact[]): Set<string> {
  return new Set(
    rows
      .filter((row) => isAddress(row.address?.trim() ?? ""))
      .map((row) => BigInt(row.address.trim()).toString()),
  );
}

/** Is this address one the owner approved? Comparison is numeric, not textual. */
export function isInMandate(approved: ReadonlySet<string>, address: string): boolean {
  return isAddress(address) && approved.has(BigInt(address).toString());
}
