/**
 * Chain constants for the demo. Client-safe: no secrets, no server imports.
 *
 * Addresses and limits are NOT hard-coded here. They are read at runtime from
 * the GOL API's `getGasConfiguration`, which the server proxies through
 * `GET /api/gol/config`. The SDK's own verification uses its pinned constants
 * internally; this module only needs the chain identity and the explorer.
 */
import { baseSepolia } from "viem/chains";

export const BASE_SEPOLIA = baseSepolia;

/**
 * Public read-only RPC for the browser. No key, used only for balances and
 * receipt decoding. Override with NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL.
 */
export const BASE_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

export const BASESCAN_TX = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const BASESCAN_ADDRESS = (address: string) =>
  `https://sepolia.basescan.org/address/${address}`;

/** `0x1234...abcd` for display. Never used as an identity or a comparison. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}
