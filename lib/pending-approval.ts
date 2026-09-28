import type { Contact } from "./contacts.ts";
import { contactsAreValid } from "./contacts.ts";

export interface PendingApproval {
  draftId: string;
  txHash: `0x${string}`;
  contacts: Contact[];
}

const prefix = "gol-demo.pending-approval.v1";
const keyFor = (account: string) => `${prefix}:${account.toLowerCase()}`;

// This is a recovery hint, never authority. The server checks the account,
// draft, project and on-chain transaction again during confirmation.
export function loadPendingApproval(account: string, storage: Storage = window.localStorage): PendingApproval | null {
  try {
    const raw = storage.getItem(keyFor(account));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.draftId !== "string" || !record.draftId ||
        typeof record.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(record.txHash)) return null;
    // Damaged labels cannot make us forget an already submitted transaction.
    // They are never authority and can safely be dropped.
    const contacts = Array.isArray(record.contacts) && contactsAreValid(record.contacts as Contact[])
      ? record.contacts as Contact[] : [];
    return { draftId: record.draftId, txHash: record.txHash as `0x${string}`, contacts };
  } catch {
    return null;
  }
}

export function savePendingApproval(account: string, pending: PendingApproval, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(keyFor(account), JSON.stringify(pending));
  } catch {
    // A disabled store cannot prevent transaction confirmation in this tab.
  }
}

export function clearPendingApproval(account: string, storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(keyFor(account));
  } catch {
    // The next read is still checked against the platform and chain.
  }
}
