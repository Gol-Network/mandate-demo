/**
 * Tests for reading a Privy wallet's chain. Pure parsing, no wallet.
 *
 * This is small on purpose and pinned because the failure it prevents is silent
 * in the worst way. Signing carries no chain, so an embedded wallet left on
 * mainnet signs the setup perfectly and only refuses when the owner has to pay
 * for a transaction, with an error that reads like a demo bug rather than a
 * missing network switch. Every form Privy might report has to resolve to a
 * number, and anything unrecognised has to resolve to null so the caller switches
 * instead of assuming it is already in the right place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { providerChainId, walletChainId } from "../lib/wallet-chain.ts";

test("reads the CAIP-2 form Privy uses for a connected wallet", () => {
  assert.equal(walletChainId("eip155:84532"), 84532);
  assert.equal(walletChainId("eip155:1"), 1);
  assert.equal(walletChainId("eip155:11155111"), 11155111);
});

test("reads a hex chain id, which some paths return instead", () => {
  assert.equal(walletChainId("0x14a34"), 84532);
  assert.equal(walletChainId("0x1"), 1);
});

test("a bare number is not a chain id form Privy documents, and is not guessed at", () => {
  // Returning null makes the caller switch. Guessing here would mean either
  // switching when already correct, or proceeding on the wrong chain.
  assert.equal(walletChainId("84532"), null);
  assert.equal(walletChainId(""), null);
});

test("another chain namespace is not an EVM chain id", () => {
  assert.equal(walletChainId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), null);
});

test("a malformed CAIP-2 string is refused rather than partially parsed", () => {
  for (const bad of [
    "eip155:",
    "eip155:abc",
    "eip155:-1",
    "eip155:84532:extra",
    "prefix eip155:84532",
    "0x",
    "0xzz",
  ]) {
    assert.equal(walletChainId(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test("the demo's own chain is read correctly, which is the one that matters", () => {
  // The chain every transaction in this demo targets. If this ever parses to
  // null the page switches on every call, and if it parses wrong it stops
  // switching on the wrong chain.
  assert.equal(walletChainId("eip155:84532"), 84532);
});

/** A provider that answers `eth_chainId` with whatever it is given. */
const providerSaying = (value: unknown) => ({
  request: async () => value,
});

test("reads the chain the provider will actually send on", async () => {
  // `eth_chainId` answers in hex, which is the form the wallet compares the
  // transaction against. This is the number that has to be right.
  assert.equal(await providerChainId(providerSaying("0x14a34")), 84532);
  assert.equal(await providerChainId(providerSaying("0x1")), 1);
  assert.equal(await providerChainId(providerSaying("eip155:84532")), 84532);
});

test("a provider that will not say its chain reports null rather than a guess", async () => {
  // Null makes the caller refuse before sending, which is the point. Reporting
  // mainnet here would let an unconfirmed wallet send a transaction it will
  // reject anyway, and the rejection is the confusing error this avoids.
  for (const answer of [null, undefined, 84532, "", "not-a-chain", {}]) {
    assert.equal(await providerChainId(providerSaying(answer)), null, String(answer));
  }
});

test("a provider that throws its chain is null, not a crash", async () => {
  const broken = {
    request: async () => {
      throw new Error("provider unavailable");
    },
  };
  assert.equal(await providerChainId(broken), null);
});
