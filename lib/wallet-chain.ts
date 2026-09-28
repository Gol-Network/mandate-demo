/**
 * Which chain a Privy wallet is on, as a number.
 *
 * Privy reports a connected wallet's chain in CAIP-2 form, `eip155:84532`, and
 * some paths hand back a `0x`-prefixed id instead. Both are compared as a number
 * so a switch is not triggered by formatting, and an unrecognised form returns
 * null rather than a guess, which makes the caller switch rather than assume.
 *
 * This matters because a Privy embedded wallet holds one chain at a time and a
 * fresh one starts on mainnet. `eth_sendTransaction` then refuses with "The
 * current chain of the wallet does not match the target chain", naming chain 1
 * against the expected 84532. Signing is unaffected, since `eth_signTypedData_v4`
 * and `secp256k1_sign` carry no chain, so a demo can sign successfully on the
 * wrong chain and only fail when the owner has to pay for a transaction.
 */
export function walletChainId(caip2: string): number | null {
  const caip = /^eip155:(\d+)$/.exec(caip2);
  if (caip?.[1] !== undefined) return Number.parseInt(caip[1], 10);
  const hex = /^0x([0-9a-fA-F]+)$/.exec(caip2);
  if (hex?.[1] !== undefined) return Number.parseInt(hex[1], 16);
  return null;
}

/**
 * The chain a provider will actually send on, asked of the provider.
 *
 * `wallet.chainId` and the provider can disagree, and the provider is the one
 * `eth_sendTransaction` compares the transaction against, so it is the one that
 * has to be read. Returns null when the provider will not say, which makes the
 * caller report rather than proceed on a chain it has not confirmed.
 */
export async function providerChainId(provider: {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}): Promise<number | null> {
  try {
    const raw = await provider.request({ method: "eth_chainId" });
    if (typeof raw !== "string") return null;
    return walletChainId(raw);
  } catch {
    return null;
  }
}
