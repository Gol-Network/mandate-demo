/**
 * The agent's signing key, and nothing else.
 *
 * Deliberately its own module with no AgentKit, viem-chains, or SDK import. The
 * owner page's `/api/gol/agent-address` route needs only the address, and
 * importing it from the action provider pulled the whole AgentKit module graph
 * into the route, which then failed during the build's page-data collection.
 *
 * The key itself is read from the environment and never returned, logged, or
 * serialised. Only the derived address leaves this module.
 */
import { privateKeyToAccount } from "viem/accounts";
import { serverEnv } from "./env.ts";

/** Normalises a configured private key to 0x-prefixed form. */
export const normaliseKey = (value: string): `0x${string}` =>
  (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;

/** The agent's address. */
export const agentAddress = (): `0x${string}` =>
  privateKeyToAccount(normaliseKey(serverEnv.agentPrivateKey)).address;
