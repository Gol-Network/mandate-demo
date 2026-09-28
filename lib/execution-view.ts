/** The small execution shape used by the proof panel and agent reply. */
export interface ExecutionView {
  id: string;
  state: string;
  transactionHashes: `0x${string}`[];
  receipt: { outcome: string; refusalCode: number | null } | null;
}

interface ExecutionLike {
  id: string;
  state: string;
  transactionHashes?: unknown;
  actionTransactionHash?: unknown;
  receipt?: unknown;
}

const isHash = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

export function hashesFromExecution(execution: ExecutionLike): `0x${string}`[] {
  const detailed = Array.isArray(execution.transactionHashes)
    ? execution.transactionHashes.filter(isHash)
    : [];
  if (detailed.length > 0) return detailed;
  return isHash(execution.actionTransactionHash) ? [execution.actionTransactionHash] : [];
}

export function executionView(execution: ExecutionLike): ExecutionView {
  const rawReceipt = execution.receipt;
  const receipt = rawReceipt && typeof rawReceipt === "object"
    ? rawReceipt as Record<string, unknown>
    : null;
  const rawCode = receipt?.refusalCode;
  const parsedCode = typeof rawCode === "string" && /^\d+$/.test(rawCode)
    ? Number(rawCode)
    : typeof rawCode === "number" ? rawCode : null;
  const refusalCode = parsedCode !== null && Number.isSafeInteger(parsedCode)
    ? parsedCode : null;
  return {
    id: execution.id,
    state: execution.state,
    transactionHashes: hashesFromExecution(execution),
    receipt: receipt && typeof receipt.outcome === "string"
      ? { outcome: receipt.outcome, refusalCode }
      : null,
  };
}
