/**
 * Contact storage in the browser. Client-only.
 *
 * Contacts live in `localStorage`, not on the server, because the names are the
 * owner's own labels and there is no database in this demo. The server never
 * stores them: each chat request carries the list, and the server treats it as
 * untrusted input used only to resolve a name to an address.
 *
 * The key includes the Privy user ID so two people sharing a browser do not see
 * each other's contacts, and the gas policy ID so a re-approved mandate starts
 * from a clean slate rather than inheriting stale labels.
 */
import type { Contact } from "./contacts";
import { contactsAreValid } from "./contacts";

const PREFIX = "gol-demo.contacts.v1";

const keyFor = (userId: string, gasPolicyId: string) => `${PREFIX}:${userId}:${gasPolicyId}`;

/** Read the owner's contacts for one gas policy, or `[]` if absent or invalid. */
export function loadContacts(userId: string, gasPolicyId: string): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId, gasPolicyId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything that would fail approval is dropped rather than handed to the
    // approval form, so a hand-edited storage entry cannot wedge the page.
    if (!contactsAreValid(parsed as Contact[])) return [];
    return parsed as Contact[];
  } catch {
    return [];
  }
}

export function saveContacts(
  userId: string,
  gasPolicyId: string,
  rows: readonly Contact[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(userId, gasPolicyId), JSON.stringify(rows));
  } catch {
    // A full or disabled store is not worth breaking the page over. The contacts
    // are re-enterable, and the mandate itself is on-chain regardless.
  }
}

export function clearContacts(userId: string, gasPolicyId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId, gasPolicyId));
  } catch {
    // As above.
  }
}
