"use client";

/**
 * A short value with a button that copies the whole thing.
 *
 * Every address in this demo is displayed truncated, which is right for reading
 * aloud and useless for using: checking an address against an explorer, pasting
 * it into a faucet, or reading it out over a call all need the full 42
 * characters. The truncated form stays on screen and the full value goes to the
 * clipboard, so the two never disagree about which address is which.
 *
 * The label is part of the control, not decoration. A row of `0x1234...cdef` with
 * no labels is unreadable in a screenshot, and a copy button with no label is
 * impossible to hit on a projector.
 */
import { useEffect, useRef, useState } from "react";
import { BASESCAN_ADDRESS, shortAddress } from "@/lib/chain";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies text without the async clipboard API.
 *
 * `navigator.clipboard` is undefined outside a secure context, which includes a
 * demo served over plain http on a LAN address. That is exactly the situation
 * this button is for, so the old path stays as a fallback rather than the feature
 * quietly doing nothing in front of an audience.
 */
function copyBySelection(value: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}

export function CopyValue({
  value,
  label,
  lead = 6,
  tail = 4,
  explorer = false,
}: {
  value: string;
  label?: string;
  lead?: number;
  tail?: number;
  /** Link the text to the address on BaseScan. Off for non-addresses. */
  explorer?: boolean;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      // Only the pending reset is cleaned up. Nothing is derived from the value
      // here, so changing the value does not re-run anything.
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(value);
      done = true;
    } catch {
      done = copyBySelection(value);
    }
    setState(done ? "copied" : "failed");
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  const text = shortAddress(value, lead, tail);

  return (
    <span className="inline-flex items-baseline gap-1 font-mono text-xs">
      {label && <span className="text-neutral-500">{label}</span>}
      {explorer ? (
        <a className="underline" href={BASESCAN_ADDRESS(value)} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        title={value}
        aria-label={`Copy ${label ? `${label} ` : ""}${value}`}
        className="rounded border border-neutral-300 px-1 text-[11px] leading-tight text-neutral-500 hover:bg-neutral-100"
      >
        {state === "copied" ? "copied" : state === "failed" ? "failed" : "copy"}
      </button>
    </span>
  );
}
