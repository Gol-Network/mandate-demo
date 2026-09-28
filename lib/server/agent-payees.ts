/**
 * Agent-side payee resolution. Server-only.
 *
 * The contact list arrives from the browser with each chat request, so it is
 * **untrusted input**. This module re-validates it with the same pure rules the
 * owner page used, drops anything malformed, and then resolves a name or address
 * to a single address.
 *
 * The resolution is done in code, never by the model. The model is told which
 * contacts exist and picks one by name; the address that gets signed is always
 * the one this module returns for a validated contact, or a raw address the user
 * typed. The model cannot invent a payee, because an invented string fails
 * `resolvePayee` and the tool refuses.
 *
 * Nothing here is authority. `isInMandate` is used only to tell the user in
 * advance that a payee is outside their mandate; the core remains the only
 * enforcement point, and it will refuse on-chain.
 */
// Relative, like the other files in this directory, and carrying the extension
// so Node's built-in TypeScript stripping resolves it under `pnpm test` as well
// as under Next.
import {
  isInMandate,
  mandateAddresses,
  resolvePayee,
  validateContacts,
  type Contact,
  type Resolution,
} from "../contacts.ts";
import { isAddress } from "viem";

/** Bound on what a browser may send, so a large body cannot be used to bloat work. */
const MAX_SUBMITTED_CONTACTS = 64;

/**
 * Parses and re-validates browser-supplied contacts.
 * Returns only the rows that are individually well formed and non-duplicating.
 */
export function parseSubmittedContacts(input: unknown): Contact[] {
  if (!Array.isArray(input)) return [];
  const rows: Contact[] = [];
  for (const entry of input.slice(0, MAX_SUBMITTED_CONTACTS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const address = typeof record.address === "string" ? record.address : "";
    if (name.trim() === "" || !isAddress(address.trim())) continue;
    rows.push({ name: name.trim(), address: address.trim() });
  }
  // Reuse the owner's rules so the agent sees exactly the list the owner saw.
  // If the browser sent something contradictory, trust none of it.
  return validateContacts(rows).length === 0 ? rows : [];
}

export interface ResolvedPayee {
  /** The address to prepare the transfer for. */
  address: `0x${string}`;
  /** A display label for the agent's reply, when one is known. */
  label: string | null;
  /** True when the payee is one the owner approved in this mandate. */
  inMandate: boolean;
}

/** A resolution the agent cannot act on, phrased for the model's reply. */
export interface UnresolvablePayee {
  problem:
    | "unknown_name"
    | "ambiguous_name"
    | "not_an_address"
    | "no_contacts";
  message: string;
  addresses?: `0x${string}`[];
}

/**
 * Turns "Alice", "0xabc...", or nonsense into a single address, or an
 * explanation the agent can read back to the user.
 */
export function resolveForAgent(
  submitted: unknown,
  said: string,
): ResolvedPayee | UnresolvablePayee {
  const contacts = parseSubmittedContacts(submitted);
  if (contacts.length === 0 && said.trim() === "") {
    return {
      problem: "no_contacts",
      message:
        "The owner has no saved payees, and no payee was named. Ask who to pay.",
    };
  }

  const approved = mandateAddresses(contacts);
  const resolution: Resolution = resolvePayee(contacts, said);

  switch (resolution.kind) {
    case "contact":
      return {
        address: resolution.contact.address,
        label: resolution.contact.name,
        inMandate: isInMandate(approved, resolution.contact.address),
      };
    case "raw_address":
      return {
        address: resolution.address,
        label: null,
        // Deliberately allowed through. The owner can ask for a payee outside
        // their mandate; the core refuses it on-chain, and that refusal is the
        // proof. The agent says so rather than blocking it.
        inMandate: isInMandate(approved, resolution.address),
      };
    case "ambiguous_name":
      return {
        problem: "ambiguous_name",
        message: `"${resolution.name}" matches more than one saved payee. Ask the owner for the address.`,
        addresses: resolution.addresses,
      };
    case "unknown_name":
      return {
        problem: "unknown_name",
        message: `"${resolution.name}" is not a saved payee name and is not an address. Ask the owner to add it in the mandate form, or to give an address.`,
      };
    case "unresolvable":
      return {
        problem: "not_an_address",
        message: "No payee was named.",
      };
  }
}

/** True when a result is a usable payee rather than a problem to report. */
export function isResolved(
  value: ResolvedPayee | UnresolvablePayee,
): value is ResolvedPayee {
  return "address" in value;
}
