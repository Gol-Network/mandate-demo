"use client";

import { useCallback, useEffect, useState } from "react";
import type { Contact } from "@/lib/contacts";
import { saveContacts } from "@/lib/contact-storage";
import { golPost } from "@/lib/gol-client";

/** A gas policy, as the owner page needs it. */
export interface PolicySummary {
  gasPolicyId: `0x${string}`;
  mandateId: `0x${string}`;
  status: "active" | "paused" | "revoked" | "expired" | "unavailable";
  maxPerActionWei: string;
  maxTotalWei: string;
  spentWei: string;
  remainingWei: string;
  expiresAt: number;
  chargeableOutcomesMask: number;
  approvalTransactionHash: string | null;
  revocationTransactionHash: string | null;
  agent: string;
}

const HINT_KEY = "gol-demo.policyHint";

const writeHint = (account: string, gasPolicyId: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${HINT_KEY}:${account.toLowerCase()}`, gasPolicyId);
  } catch {
    // A hint is an optimisation. Losing it costs one extra API read.
  }
};

const readHint = (account: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${HINT_KEY}:${account.toLowerCase()}`);
  } catch {
    return null;
  }
};

export function usePolicy(account: string | undefined) {
  const [raw, setRaw] = useState<{ account: string; data: PolicySummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<{ account: string; id: string | null } | null>(null);
  // No account means no policies, derived rather than cleared from an effect.
  const policies = account && raw?.account === account.toLowerCase() ? raw.data : [];

  const refresh = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const result = await golPost<{ data: PolicySummary[] }>("/api/gol/policies", {
        account,
      });
      setRaw({ account: account.toLowerCase(), data: result.data });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    // Fetching the policies on mount and after every owner action is the point:
    // the page derives its state from the API rather than from anything it
    // remembers, so a reload always shows the truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!account) return;
    // Browser storage only chooses among policies returned for this owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHint({ account: account.toLowerCase(), id: readHint(account) });
  }, [account]);

  // The policy the page acts on. An active one wins; a paused one is shown next so
  // the owner can resume it. Both are read from the API on every load, so a stale
  // cached hint can never make the page act on a policy that is not there.
  const hintedId = hint && hint.account === account?.toLowerCase() ? hint.id : null;
  const activePolicies = policies.filter((policy) => policy.status === "active");
  const pausedPolicies = policies.filter((policy) => policy.status === "paused");
  const active = activePolicies.find((policy) => policy.gasPolicyId === hintedId) ?? activePolicies[0] ?? null;
  const paused = pausedPolicies.find((policy) => policy.gasPolicyId === hintedId) ?? pausedPolicies[0] ?? null;
  const policy = active ?? paused;

  const remember = useCallback(
    (gasPolicyId: string) => {
      if (account) {
        writeHint(account, gasPolicyId);
        setHint({ account: account.toLowerCase(), id: gasPolicyId });
      }
    },
    [account],
  );

  return { policies, active, paused, policy, loading, error, refresh, remember };
}

export function useContacts(
  userId: string | undefined,
  gasPolicyId: string | undefined,
) {
  // Derived rather than stored: with no user or no policy there is nothing to
  // load, and deriving avoids clearing state from inside an effect.
  const key = userId && gasPolicyId ? `${userId}:${gasPolicyId}` : null;
  const [stored, setStored] = useState<{ key: string; rows: Contact[] } | null>(null);
  const contacts = stored !== null && stored.key === key ? stored.rows : [];

  const update = useCallback(
    (next: Contact[]) => {
      if (!userId || !gasPolicyId) return;
      setStored({ key: `${userId}:${gasPolicyId}`, rows: next });
      saveContacts(userId, gasPolicyId, next);
    },
    [gasPolicyId, userId],
  );

  return { contacts, setContacts: update };
}
