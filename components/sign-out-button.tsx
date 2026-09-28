"use client";

/**
 * Sign out of Privy.
 *
 * The demo's state is the GOL API plus two namespaced browser-storage keys, so
 * signing out needs no cleanup to be correct: the access token goes, every API
 * call fails closed with `not_logged_in`, and the page falls back to the login
 * screen on its own. Nothing on-chain changes and no mandate is affected, which
 * is the point worth stating on the button's own row rather than in this comment.
 *
 * What signing out does not do is delete the owner's draft contacts or the cached
 * policy hint. Both are keyed by account or by Privy user ID, so one person
 * signing in on a shared browser cannot read another's, and deleting them on
 * sign-out would throw away work that the next sign-in would otherwise restore.
 */
import { useLogout } from "@privy-io/react-auth";
import { useState } from "react";

export function SignOutButton() {
  const { logout } = useLogout();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      // A failed sign-out leaves the session in place, which is the safe way for
      // it to fail. Say so rather than pretending the user is signed out.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 disabled:opacity-40"
      >
        {busy ? "Signing out..." : "Sign out"}
      </button>
      {failed && <span className="text-xs text-red-700">Sign out failed. Try again.</span>}
    </span>
  );
}
