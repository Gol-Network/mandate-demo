import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Address, Hex, Log } from "viem";
import { buildProof, summarise } from "../lib/proof.ts";

// Captured from Base Sepolia public RPC after the owner's first live agent
// transfer. The fixture contains only public transaction receipt fields.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/transfer-receipt.json", import.meta.url), "utf8")) as {
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: string;
  logs: Log[];
};
const refusalFixture = JSON.parse(readFileSync(new URL("./fixtures/refusal-receipt.json", import.meta.url), "utf8")) as typeof fixture;

test("the profile 4 receipt proves the transfer and inline gas settlement", () => {
  const proof = buildProof({
    transactionHash: fixture.transactionHash,
    status: fixture.status,
    blockNumber: BigInt(fixture.blockNumber),
    logs: fixture.logs,
  }, {
    core: "0xB26194Ea02cBBC3E99F572B3a659Ae1e0815E3ce" as Address,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    assetDecimals: 6,
  });

  assert.equal(proof.executed, true);
  assert.equal(proof.refused, false);
  assert.equal(proof.movements.length, 1);
  assert.equal(proof.movements[0]?.formatted, "0.1 USDC");
  assert.equal(proof.movements[0]?.from.toLowerCase(), "0x2a9e395887da36d8300bd7e51865de7c297be118");
  assert.equal(proof.chargedWei, 3174752159529n);
  assert.equal(summarise(proof), "Transferred 0.1 USDC");
});

test("the profile 4 refusal receipt names the rule and actual owner charge", () => {
  const proof = buildProof({
    transactionHash: refusalFixture.transactionHash,
    status: refusalFixture.status,
    blockNumber: BigInt(refusalFixture.blockNumber),
    logs: refusalFixture.logs,
  }, {
    core: "0xB26194Ea02cBBC3E99F572B3a659Ae1e0815E3ce" as Address,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    assetDecimals: 6,
  });

  assert.equal(proof.executed, false);
  assert.equal(proof.refused, true);
  assert.equal(proof.refusalCode, 67);
  assert.equal(proof.ruleTag, 0x0200);
  assert.equal(proof.chargedWei, 2109482171655n);
  assert.equal(proof.movements.length, 0);
  assert.match(summarise(proof), /per_action_limit_exceeded/);
});
