"use client";

/**
 * The recipient table of the mandate form. Each row is a (name, address) pair.
 *
 * Only the addresses are sent to GOL and hashed into the policy. The name is the
 * owner's label so the agent can be told "pay Alice"; it is never authority.
 *
 * The table is limited to 1 to 16 rows, which is the API and on-chain limit, and
 * it is enforced in the UI so the owner cannot build a form the approval will
 * reject. Names and addresses must both be unique, which is what makes name
 * resolution deterministic on the agent side.
 */
import { useCallback, useMemo } from "react";
import {
  contactsAreValid,
  MAX_CONTACTS,
  MIN_CONTACTS,
  validateContacts,
  type Contact,
  type ContactProblem,
} from "@/lib/contacts";

export function emptyContact(): Contact {
  return { name: "", address: "0x" };
}

const describe = (problem: ContactProblem): string => {
  switch (problem.kind) {
    case "too_few":
      return `Add at least ${MIN_CONTACTS} payee.`;
    case "too_many":
      return `At most ${MAX_CONTACTS} payees.`;
    case "empty_name":
      return `Row ${problem.index + 1} needs a name.`;
    case "bad_address":
      return `Row ${problem.index + 1} is not a valid address: "${problem.value}".`;
    case "duplicate_address":
      return `Row ${problem.index + 1} repeats the address from row ${problem.firstIndex + 1}.`;
    case "duplicate_name":
      return `Row ${problem.index + 1} repeats the name "${problem.name}" from row ${problem.firstIndex + 1}.`;
  }
};

export function MandateContactsEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: Contact[];
  onChange: (next: Contact[]) => void;
  disabled?: boolean;
}) {
  const problems = useMemo(() => validateContacts(rows), [rows]);
  const canAdd = rows.length < MAX_CONTACTS;
  const canRemove = rows.length > MIN_CONTACTS;

  const update = useCallback(
    (index: number, patch: Partial<Contact>) => {
      onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    },
    [onChange, rows],
  );

  return (
    <fieldset className="rounded-lg border border-neutral-300 bg-white p-5" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">Payees</legend>
      <p className="mt-1 text-sm text-neutral-600">
        Between {MIN_CONTACTS} and {MAX_CONTACTS}. The name is how you will refer to
        this payee in chat; only the address is signed and put on-chain.
      </p>

      <div className="mt-4 space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 basis-40">
              <span className="block text-xs text-neutral-500">Name</span>
              <input
                value={row.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="Alice"
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="flex-[2] basis-64">
              <span className="block text-xs text-neutral-500">Address</span>
              <input
                value={row.address}
                onChange={(event) => update(index, { address: event.target.value })}
                placeholder="0x..."
                spellCheck={false}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, at) => at !== index))}
              disabled={!canRemove}
              title={canRemove ? "Remove this payee" : `At least ${MIN_CONTACTS} payee is required`}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...rows, emptyContact()])}
        disabled={!canAdd}
        title={canAdd ? "Add a payee" : `At most ${MAX_CONTACTS} payees`}
        className="mt-4 rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Add payee
      </button>

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-red-700">
          {problems.map((problem, index) => (
            <li key={index}>{describe(problem)}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export { contactsAreValid };
