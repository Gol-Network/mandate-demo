/**
 * Tests for the owner page's state machine. Pure logic, no chain and no server.
 *
 * The case that matters most is the first one. GOL reports
 * `delegation: { delegate: null, reviewed: false }` for an EOA that has never
 * been delegated, because `reviewed` is about the delegate rather than about the
 * presence of one. Reading that as "delegated somewhere else" told a brand new
 * wallet it was compromised and refused to set it up. A brand new wallet is the
 * one case the demo must never get wrong, so it is pinned first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentDelegate, deriveStep, type AccountStatus, type Step } from "../lib/account-status.ts";

const ACCOUNT = "0x2A9Eb1Df30D2b0a6b0d0a4bF1dE3f2E9D8aE118";

const status = (over: Partial<AccountStatus> = {}): AccountStatus => ({
  account: ACCOUNT,
  family: null,
  profileId: null,
  implementation: null,
  implementationReviewed: false,
  configurationReviewed: false,
  coreInstalled: false,
  installEpoch: "0",
  gasPolicyNonce: "0",
  revocationNonce: "0",
  accountKind: "eoa",
  delegation: { delegate: null, reviewed: false, initialized: null },
  transactionCount: "0",
  blockNumber: "1",
  ...over,
});

const delegatedTo = (delegate: string, reviewed: boolean, initialized: boolean | null) =>
  status({
    accountKind: reviewed ? "delegated_eoa" : "delegated_eoa",
    family: reviewed ? "nexus7702" : null,
    implementationReviewed: reviewed,
    delegation: { delegate, reviewed, initialized },
  });

test("a brand new EOA with no delegation goes to setup, not to the refusal", () => {
  const fresh = status();
  assert.equal(fresh.delegation?.delegate, null);
  assert.equal(fresh.delegation?.reviewed, false);
  assert.equal(currentDelegate(fresh), null);
  assert.equal(deriveStep(fresh), "setup");
});

test("the same EOA read a moment later still goes to setup", () => {
  // Guards against a rule that only works for the first read.
  assert.equal(deriveStep(status(), "setup"), "setup");
  assert.equal(deriveStep(status(), "loading"), "setup");
});

test("delegated somewhere other than the reviewed delegate is refused, with the delegate named", () => {
  const stranger = delegatedTo("0x000000000000000000000000000000000000dEaD", false, null);
  assert.equal(deriveStep(stranger), "delegated-elsewhere");
  assert.equal(currentDelegate(stranger), "0x000000000000000000000000000000000000dEaD");
});

test("delegated to the zero address is a real delegation and is refused", () => {
  // `0x0` is not the EIP-7702 reset address. A designation pointing at the zero
  // address is code, it is not a cleared account, and GOL will not touch it.
  const zeroed = delegatedTo("0x0000000000000000000000000000000000000000", false, null);
  assert.equal(deriveStep(zeroed), "delegated-elsewhere");
});

test("delegated to the reviewed delegate and not initialised goes to initialise", () => {
  const reviewed = "0x0000000000000000000000000000000000777A2f2";
  assert.equal(deriveStep(delegatedTo(reviewed, true, false)), "initialise");
});

test("the core being installed wins over the delegation detail", () => {
  const installed = delegatedTo("0x0000000000000000000000000000000000777A2f2", true, true);
  assert.equal(deriveStep(status({ ...installed, coreInstalled: true })), "mandate");
});

test("a contract account has no delegation and is not treated as an EOA to set up", () => {
  // GOL refuses a contract account at prepare time, so the page must not claim it
  // is a wallet awaiting setup. It is left to surface the API's own refusal.
  const contract = status({ accountKind: "contract", delegation: null, coreInstalled: true });
  assert.equal(currentDelegate(contract), null);
  assert.equal(deriveStep(contract), "mandate");
});

test("a missing status is loading", () => {
  assert.equal(deriveStep(null), "loading");
});

test("polling never walks the owner back out of a confirmed approval", () => {
  // The one state that outranks a fresh read. A status read that races the
  // approval confirmation must not drop the owner into the form again.
  for (const held of ["active", "approval-pending"] as Step[]) {
    assert.equal(deriveStep(status(), held), held);
    assert.equal(deriveStep(delegatedTo("0x000000000000000000000000000000000000dEaD", false, null), held), held);
  }
});

test("every step the machine can report is one the page knows how to render", () => {
  const reachable: Step[] = [
    "loading",
    "setup",
    "delegated-elsewhere",
    "initialise",
    "setup-pending",
    "mandate",
    "approval-pending",
    "active",
  ];
  const observed = new Set<Step>([
    deriveStep(null),
    deriveStep(status()),
    deriveStep(delegatedTo("0x000000000000000000000000000000000000dEaD", false, null)),
    deriveStep(delegatedTo("0x0000000000000000000000000000000000777A2f2", true, false)),
    deriveStep(status({ coreInstalled: true })),
  ]);
  for (const step of observed) assert.ok(reachable.includes(step), `unknown step ${step}`);
});
