/** The small execution shape used by the proof panel and agent reply. */
export interface ExecutionView {
  id: string;
  state: string;
  transactionHashes: `0x${string}`[];
  receipt: { outcome: string; refusalCode: number | null } | null;
  inclusion: { state: string; outcome: string | null; transactionHash: string; finalizedAt: string | null } | null;
}

interface ExecutionLike {
  id: string;
  state: string;
  transactionHashes?: unknown;
  actionTransactionHash?: unknown;
  receipt?: unknown;
  inclusion?: unknown;
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
  const rawInclusion = execution.inclusion && typeof execution.inclusion === "object"
    ? execution.inclusion as Record<string, unknown> : null;
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
    inclusion: rawInclusion && typeof rawInclusion.state === "string" && isHash(rawInclusion.transactionHash)
      ? {
        state: rawInclusion.state,
        outcome: typeof rawInclusion.outcome === "string" ? rawInclusion.outcome : null,
        transactionHash: rawInclusion.transactionHash,
        finalizedAt: typeof rawInclusion.finalizedAt === "string" ? rawInclusion.finalizedAt : null,
      }
      : null,
    receipt: receipt && typeof receipt.outcome === "string"
      ? { outcome: receipt.outcome, refusalCode }
      : null,
  };
}
