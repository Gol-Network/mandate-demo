/**
 * Tests for the contact model. Pure logic only, no chain and no server.
 *
 * These are the rules the owner page and the agent both depend on, so they are
 * worth pinning: a name that resolves to the wrong address, or a duplicate that
 * slips past and then trips the SDK's `duplicate_policy_address` at approval
 * time, would both fail in front of an audience.
 *
 * Run with `pnpm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactAddresses,
  contactsAreValid,
  isInMandate,
  MAX_CONTACTS,
  MIN_CONTACTS,
  mandateAddresses,
  resolvePayee,
  validateContacts,
  type Contact,
} from "../lib/contacts.ts";
import { parseSubmittedContacts, resolveForAgent, isResolved } from "../lib/server/agent-payees.ts";

const ALICE = "0x1111111111111111111111111111111111111111" as const;
const BOB = "0x2222222222222222222222222222222222222222" as const;
const CAROL = "0x3333333333333333333333333333333333333333" as const;

const contact = (name: string, address: string): Contact => ({ name, address });

test("limits are one to sixteen", () => {
  assert.equal(MIN_CONTACTS, 1);
  assert.equal(MAX_CONTACTS, 16);

  assert.deepEqual(
    validateContacts([]).map((problem) => problem.kind),
    ["too_few"],
  );

  // Seventeen rows reports the over-limit problem and every duplicate it also
  // contains, so assert on which problems appear rather than on a total.
  const overLimit = validateContacts(
    Array.from({ length: 17 }, () => contact("x", ALICE)),
  );
  const overKinds = new Set(overLimit.map((problem) => problem.kind));
  assert.ok(overKinds.has("too_many"));
  assert.ok(overKinds.has("duplicate_address"));
});

test("a single valid contact is enough", () => {
  assert.ok(contactsAreValid([contact("Alice", ALICE)]));
  assert.deepEqual(contactAddresses([contact("Alice", ALICE)]), [ALICE]);
});

test("rejects an empty name, a bad address, and both kinds of duplicate", () => {
  const problems = validateContacts([
    contact("", ALICE),
    contact("Bob", "0xnope"),
    contact("Alice", ALICE),
    contact("alice", BOB),
  ]);
  const kinds = problems.map((problem) => problem.kind);
  assert.ok(kinds.includes("empty_name"));
  assert.ok(kinds.includes("bad_address"));
  assert.ok(kinds.includes("duplicate_address"));
  assert.ok(kinds.includes("duplicate_name"));
});

test("duplicate detection is numeric, so checksum casing cannot smuggle one past", () => {
  const lower = ALICE.toLowerCase() as `0x${string}`;
  const problems = validateContacts([contact("Alice", ALICE), contact("Other", lower)]);
  assert.deepEqual(
    problems.map((problem) => problem.kind),
    ["duplicate_address"],
  );
});

test("contactAddresses refuses to build a list the approval would reject", () => {
  assert.throws(() => contactAddresses([]), /invalid_contacts/);
  assert.throws(() => contactAddresses([contact("a", ALICE), contact("b", ALICE)]), /invalid_contacts/);
});

test("resolves a name case-insensitively after trimming", () => {
  const rows = [contact("Alice", ALICE), contact("Bob", BOB)];
  for (const said of ["Alice", "alice", "  ALICE  "]) {
    const result = resolvePayee(rows, said);
    assert.equal(result.kind, "contact");
    if (result.kind === "contact") {
      assert.equal(result.contact.address, ALICE);
      assert.equal(result.matchedOn, "name");
    }
  }
});

test("an address wins over a name, and a known address is reported as a contact", () => {
  const rows = [contact("Alice", ALICE)];
  const result = resolvePayee(rows, ALICE.toLowerCase());
  assert.equal(result.kind, "contact");
  if (result.kind === "contact") assert.equal(result.matchedOn, "address");
});

test("an unknown address resolves as a raw address, not as a contact", () => {
  const result = resolvePayee([contact("Alice", ALICE)], CAROL);
  assert.equal(result.kind, "raw_address");
  if (result.kind === "raw_address") assert.equal(result.address, CAROL);
});

test("an ambiguous name is refused rather than guessed", () => {
  const rows = [contact("Sam", ALICE), contact("sam", BOB)];
  const result = resolvePayee(rows, "Sam");
  assert.equal(result.kind, "ambiguous_name");
  if (result.kind === "ambiguous_name") assert.equal(result.addresses.length, 2);
});

test("nonsense is unresolvable, never coerced into an address", () => {
  const result = resolvePayee([contact("Alice", ALICE)], "pay the rent");
  assert.equal(result.kind, "unknown_name");
  assert.equal(resolvePayee([contact("Alice", ALICE)], "   ").kind, "unresolvable");
});

test("mandate membership is compared numerically", () => {
  const approved = mandateAddresses([contact("Alice", ALICE)]);
  assert.ok(isInMandate(approved, ALICE.toLowerCase()));
  assert.ok(!isInMandate(approved, BOB));
  assert.ok(!isInMandate(approved, "not-an-address"));
});

test("the server drops contradictory browser-supplied contacts entirely", () => {
  assert.deepEqual(
    parseSubmittedContacts([
      { name: "Alice", address: ALICE },
      { name: "Bob", address: BOB },
    ]),
    [
      { name: "Alice", address: ALICE },
      { name: "Bob", address: BOB },
    ],
  );
  // A duplicate must invalidate the whole list, not be silently kept.
  assert.deepEqual(
    parseSubmittedContacts([
      { name: "Alice", address: ALICE },
      { name: "Other", address: ALICE },
    ]),
    [],
  );
  // Malformed and wrong-typed entries never reach the model.
  assert.deepEqual(parseSubmittedContacts([null, 7, "x", { name: "", address: ALICE }]), []);
  assert.deepEqual(parseSubmittedContacts("not an array"), []);
});

test("the agent resolves a saved name and knows whether it is in the mandate", () => {
  const submitted = [
    { name: "Alice", address: ALICE },
    { name: "Bob", address: BOB },
  ];
  const inside = resolveForAgent(submitted, "Alice");
  assert.ok(isResolved(inside));
  if (isResolved(inside)) {
    assert.equal(inside.address, ALICE);
    assert.equal(inside.label, "Alice");
    assert.equal(inside.inMandate, true);
  }
});

test("an out-of-mandate payee is allowed through, flagged, for the core to refuse", () => {
  const result = resolveForAgent([{ name: "Alice", address: ALICE }], CAROL);
  assert.ok(isResolved(result));
  if (isResolved(result)) {
    assert.equal(result.address, CAROL);
    assert.equal(result.inMandate, false);
  }
});

test("the agent cannot act on a name it was never given", () => {
  const result = resolveForAgent([{ name: "Alice", address: ALICE }], "Mallory");
  assert.ok(!isResolved(result));
  if (!isResolved(result)) assert.equal(result.problem, "unknown_name");
});
