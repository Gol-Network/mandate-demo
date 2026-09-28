/**
 * The owner's account state, and the step it implies on the owner page.
 *
 * Pure on purpose: every state the page can be in is derived here from what GOL
 * reports, so it can be tested without a chain, a server, or a browser, and so
 * the page holds no rules of its own.
 *
 * **The rule that was wrong once, and must not be wrong again:** `reviewed` is
 * `false` for an account that has no delegation at all. GOL reports
 * `delegation: { delegate: null, reviewed: false, initialized: null }` for every
 * EOA, delegated or not, because `reviewed` means "this delegate is the reviewed
 * Nexus 1.3.3 delegate" and there is nothing to review. Reading that as
 * "delegated somewhere else" blocked a brand new wallet at the first step with
 * "delegate 0x0 reviewed false". Only a **non-null `delegate`** that is not the
 * reviewed delegate is an account delegated somewhere else.
 */
import type { AccountStatus } from "@gol/sdk";

/** GOL's own type for the detected account, re-exported so the page imports once. */
export type { AccountStatus };

export type Step =
  | "loading"
  | "setup"
  | "delegated-elsewhere"
  | "initialise"
  | "setup-pending"
  | "mandate"
  | "approval-pending"
  | "active";

/** The delegate, or null. Null means the account is not delegated at all. */
export function currentDelegate(status: AccountStatus | null): string | null {
  return status?.delegation?.delegate ?? null;
}

/**
 * Which step the page is on, given the last status and the step it is on now.
 *
 * `current` exists so polling cannot walk the owner backwards out of a confirmed
 * approval. It is the only state that outranks a fresh read.
 */
export function deriveStep(
  status: AccountStatus | null,
  current: Step = "loading",
): Step {
  if (!status) return "loading";
  if (current === "active" || current === "approval-pending") return current;

  const delegate = currentDelegate(status);

  // Delegated to something GOL did not review. GOL refuses it with
  // `account_integration_invalid` and will keep refusing until the owner
  // removes the delegation or restores the reviewed one.
  if (delegate && status.delegation?.reviewed !== true) return "delegated-elsewhere";

  if (status.coreInstalled) return "mandate";

  // Already delegated to the reviewed delegate, so the setup only has to install
  // the core and can reuse the delegation instead of asking for a new one.
  if (delegate && status.delegation?.initialized === false) return "initialise";

  return "setup";
}
