# AGENTS.md

## Repository purpose

This repository is a working demo of GOL bounded mandates, with three parts:

1. An **owner wallet**, a Privy embedded EOA. GOL's EIP-7702 setup delegates it to
   Biconomy Nexus 1.3.3 and installs the GOL version 3 core as its only executor.
   The account family is `nexus7702`.
2. An **agent**, an OpenAI chat agent built with Coinbase AgentKit that sends
   Circle USDC transfers from the owner's wallet.
3. A **mandate in between**. The owner signs one GOL approval covering the
   mandate and its gas policy. The agent can move funds only within it, and the
   owner can pause, resume, and revoke without the agent.

It runs on `localhost` and has a Vercel artifact at
`https://gol-mandate-demo.vercel.app` from source
`4cd194aec2b01ee074518f5006f365832fb466d4`. The public shell and
unauthenticated route guards were checked; a hosted authenticated owner journey
has not been observed. The GitHub repository has an `origin` remote, but pushes
do not currently trigger this Vercel deployment.

This is a consumer of GOL's public surface. It is not part of GOL.

The local source and current Vercel artifact have a provisional inclusion
display for hosted API 0.6.0 and published SDK 0.6.0. The hosted authenticated
owner journey has not been repeated after this promotion.

## Boundaries

- Depend on `@gol/sdk` and GOL's public HTTP API only. Never import `platform`,
  `contracts`, or `console` internals. The dependency direction is
  `mandate-demo -> @gol/sdk -> platform -> contracts`.
- GOL never receives or stores the owner private key. It does not exist in this
  application either: the owner signs inside Privy.
- The GOL project API key (`GOL_API_KEY`) is server-only. It is never sent to the
  browser, never placed in a `NEXT_PUBLIC_` variable, and never logged.
- Every API route requires a valid Privy access token and acts only on that
  user's own linked account. This is what protects the OpenAI key and the
  project's sponsored-setup quota on a public URL.
- Deployed addresses and limits come from `getGasConfiguration` at runtime. Do
  not hard-code the core, the router, the relayer, the asset, the delegate, or
  the gas caps.
- Client-side checks are user experience only. GOL's hosted pre-check and the
  on-chain core are the enforcement points. The demo must not present its own
  checks as authority.
- Never commit secrets. `.env.local` is gitignored and `.env.example` holds
  placeholders only. Never write a key to a log line, a URL, or a filename.
- Testnet only. Base Sepolia, chain `84532`, USDC that nobody recovers. Nothing
  here is audited and nothing is claimed for mainnet.
- Use only hyphen characters for dashes in prose. No em dash, no en dash.

## Privy configuration that matters

Both of these are **off in the Privy dashboard**, not in code, because that is
where Privy reads them from:

- **Smart wallets off.** GOL profile 4 supports an exact ZeroDev Kernel v0.3.1
  configuration, but this demo has not verified Privy's smart-wallet configuration
  against that profile. A Privy smart wallet would also use a different contract
  address from the owner's EOA, changing this demo's account path.
- **Privy gas sponsorship off.** It can delegate the EOA to Privy's own
  implementation.

GOL fails closed with `account_integration_invalid` if the EOA is delegated to
anything other than the reviewed Nexus 1.3.3 delegate, so a wrong dashboard
setting shows up as a refusal rather than as silent breakage.

## When an authorization does not come back from the owner

`signPreparedEip7702Setup` recovers the authority from the signed tuple and
refuses anything that is not the owner, with one string:
`eip7702_authorization_signer_mismatch`. **This happened on the first live run,
2026-09-28.** The refusal is right; as a diagnosis it is useless, because a
mismatch has five causes needing five different fixes.

An authorization is signed over `keccak256(0x05 || rlp([chain_id, address,
nonce]))`, so three of the five are a disagreement about one of those three
fields. Privy returns the `address`, `chainId`, and `nonce` it signed for, so all
three are checkable without a secret. The other two are the signature itself: an
inverted `yParity`, or a different key.

`lib/authorization-diagnosis.ts` does this and names the cause:

| Finding | What it means |
|---|---|
| `ok` | It recovers to the owner. |
| `recovery_byte_missing` | No usable `yParity` and no `v` in 0, 1, 27, or 28. |
| `y_parity_looks_inverted` | Recovers to the owner only with the parity flipped. Genuine signature, wrong reported bit. |
| `wallet_signed_another_chain` | Privy reports a different `chain_id`. |
| `wallet_signed_another_nonce` | Privy reports a different `nonce`. |
| `wallet_signed_another_delegate` | Privy reports a different delegate. |
| `wallet_signed_another_key` | Everything reported matches, the signature is well-formed, and it still recovers elsewhere. A different signing wallet. |

Two rules that came out of it:

- **Recovery is the ground truth, the reported fields only explain it.** A wallet
  that misreports but signs correctly is `ok`, and a wallet that reports nothing
  is not treated as agreeing with anything.

**Confirmed on the second run**, so this is a finding rather than a hypothesis: the
mismatch was Privy signing with a different linked wallet, and pinning
`options.address` produced `ok` with the owner recovered. The instrument earned its
keep by turning a second guess into a named answer.

## The recovery byte is derived, never read

`secp256k1_sign` returned a 65-byte signature whose last byte was `0x80`, and the
demo refused it as `privy_raw_signature_bad_recovery_byte:80`. That is the high-bit
encoding, and Privy's documentation does not describe it.

The same one bit is written four ways: `0`/`1` as `yParity`, `27`/`28` as legacy
`v`, `0x00`/`0x80` with the parity in the high bit, and whatever else a provider
invents. **Do not add the fourth to the table.** A wrong recovery id does not
throw, it recovers to a different address, so a table that is wrong fails silently
and possibly on chain.

For one hash and one `r || s` there are exactly two valid readings and exactly one
recovers to the signer, and the demo already knows the signer's address. So
`readRawSignature` tries both and keeps the one that recovers. That is decoding,
not repairing:

- it cannot produce a signature recovering to the owner unless the wallet signed
  that hash with that key;
- a different hash or a different key fails both candidates and is refused, with
  both recovery results named in the error;
- the SDK still verifies the result before submission, and the chain still
  enforces.

The reported byte is recorded beside the derived parity, so the provider's
encoding is observed rather than assumed. Do not "simplify" this back into reading
the byte.
- **Always tell Privy which wallet to sign with.** `boundPrivyAuthorization` pins
  `options.address` to the owner. Privy otherwise signs with the **first** linked
  wallet, and a signature from another wallet is the one fault a caller can cause:
  well-formed, over exactly the right message, and indistinguishable from a
  correct signature by looking at the tuple. Binding the address in one place
  rather than at each call site is deliberate, because a comment asking for the
  argument gets ignored the first time somebody adds a fourth call site.

## Reading the account's delegation

GOL reports `delegation` for **every** EOA, delegated or not:

```json
{ "delegate": null, "reviewed": false, "initialized": null }
```

`reviewed` is about the delegate, not about the presence of one, so a wallet that
has never been delegated reports `reviewed: false` with a null `delegate`. Only a
**non-null `delegate`** that is not the reviewed delegate is an account delegated
somewhere else.

Reading `reviewed` on its own told a brand new wallet it was delegated elsewhere,
refused to set it up, and printed `delegate 0x0 reviewed false`. The rule lives in
`lib/account-status.ts` and is pinned by `test/account-status.test.ts`. Do not
re-derive it in a component.

## Removing a delegation is the owner's, not GOL's

GOL has no undelegation API and this demo does not ask it for one. The sponsored
setup covers exactly one delegation, to the reviewed Nexus delegate; anything
else is refused and stays refused until the owner acts.

What the page offers instead is the owner's own key authority, in the owner's own
wallet: sign an EIP-7702 authorization naming the reset address
`0x0000000000000000000000000000000000000000`, then send the type-4 transaction that
carries it. The spec's special case for that address clears the account's code.
Any other address installs that address as the account's code instead.

Four things hold that together:

- **The reset address is the zero address**, per EIP-7702, not a sentinel like
  `0xEeeE` from the early drafts. `lib/undelegate.ts` is the only place it is
  named.
- **The tuple the wallet returns is checked** against the address and chain that
  were asked for, before a transaction is built from it. Both are inside the
  signed payload, so a tuple for something else would either clear nothing or
  install a delegate nobody reviewed.
- **The owner pays.** GOL's sponsorship covers the reviewed delegate only, so
  this transaction costs the owner ETH, and the page reads the balance first
  rather than letting the wallet fail after a signature.
- **Removal is offered only where it helps.** If the core is already installed,
  the setup is in the account's own storage, which changing the delegation does
  not clear. Removing the delegation there would strand the account; restoring
  the reviewed delegate is the documented recovery (ADR 0019), and the page says
  so instead of offering the wrong repair.

## Development

Node.js 22 or later and pnpm 11. Run commands from this repository root.

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
pnpm key:agent
pnpm check:env
pnpm check
```

`pnpm check` runs `typecheck`, `lint`, `test`, and `build` in that order and is the
command to run before committing.

`pnpm key:agent` generates the agent's disposable signing key, writes it to
`.env.local`, and prints only the derived address. Never add the key by hand or
paste one into chat. It refuses to overwrite an existing key unless given `--force`,
and it always converges the file on exactly one key line.

`pnpm check:env` checks `.env.local`, calls `GET /v1/whoami` with the configured key, and
reports the project, environment, and scopes. It resolves the GOL project ID from the
key, so `GOL_PROJECT_ID` never has to be copied by hand; add `--write` to have it
written into `.env.local` for you. When an OpenAI key and model are set, it also
checks that the model is accessible to that key. It prints no secret values.

To create a local env file: `cp .env.example .env.local`, then fill it in.

Tests use Node's built-in runner, `node --test`, with no test dependency. Node 22
strips the TypeScript types directly, so the test files import source modules with an
explicit `.ts` extension, which is why `allowImportingTsExtensions` is set in
`tsconfig.json`. Files under `lib/server/` therefore use relative imports with
extensions rather than the `@/` alias, so the same modules resolve under both Node
and Next.

The project holds no database and writes no files at runtime. The state is the GOL
API plus browser storage for draft IDs, the cached policy ID, and the owner's
contacts.

## Payees are entered by the owner, never configured

There is no recipients environment variable, and there must not be one. The owner
fills a table of 1 to 16 (name, address) rows in the mandate form, and the agent
resolves names against whatever that owner entered.

- **Only the address goes on-chain.** The mandate's recipient allowlist is a sorted
  address set. The name is a label the owner chose, so renaming a contact needs no
  new approval, while adding, removing, or replacing an address does.
- **Names and addresses must both be unique.** That is what makes name resolution
  deterministic. An ambiguous name is rejected at entry rather than guessed at.
- **Resolution happens in code, never in the model.** The model picks a payee by
  name; the address that gets signed is the one `resolvePayee` returns for a
  validated contact. An invented name fails to resolve and the tool refuses, so the
  model cannot invent a payee.
- **A payee outside the mandate is allowed through on purpose.** The core refuses it
  on-chain with code 65, and that refusal is the demo's proof. `inMandate` exists
  only to let the agent tell the user in advance, never to block.
- Contact names live in browser storage and travel with each chat request. The server
  re-validates them with the same rules and discards the whole list if it is
  contradictory, because it is untrusted input.

## Current state

Work-order steps 1 to 5 are built, and **setup, approval, and one agent transfer are
proven on chain**. The production Vercel artifact is ready. The owner-specific
on-chain refusal and an authenticated run at the Vercel origin are not yet proven.
See `README.md` for the production artifact, read-only checks, Privy domain
setting, and current manual deployment command.

The sponsored setup succeeded end to end. The owner EOA carries the delegation
designator `0xef0100` plus the reviewed Nexus 1.3.3 delegate, GOL reports the
family as `nexus7702` with the core installed and the account initialised, and a
raw `eth_getCode` over public RPC agrees. The `nexus7702` account family this demo
depends on is real.

Three live runs on 2026-09-28. What they established:

- Privy login, `getGasConfiguration`, the agent address, and `getAccountStatus` all
  work against the hosted API with a real project key.
- The account reads as an EOA with no delegation and no core, which is the
  account-status fix in this repository confirmed end to end: the page reached the
  sponsored setup step instead of refusing.
- `prepareEip7702Setup` returned `delegation: "none"` with an authorization, and
  `verifyPreparedEip7702Setup` passed, so GOL's prepared setup is internally
  consistent and the delegate is the reviewed Nexus 1.3.3 one.
- **Privy signs EIP-7702 authorizations with the first linked wallet unless
  `options.address` says otherwise.** Confirmed, not assumed: the first run failed
  with `eip7702_authorization_signer_mismatch`, and the run after pinning the
  address returned `Authorization is correct ok` recovering to the owner. See
  `boundPrivyAuthorization`.
- **`secp256k1_sign` returns the recovery id in the high bit, as `0x80`**, which
  the demo refused as `privy_raw_signature_bad_recovery_byte:80` before the byte
  was derived rather than trusted. See `readRawSignature`.

## The owner wallet has to be on Base Sepolia

A Privy embedded wallet holds one chain at a time and a fresh one starts on
mainnet. `eth_sendTransaction` then refuses:

```
The current chain of the wallet (id: 1) does not match the target chain
(id: 84532 - Base Sepolia).
```

**Signing is unaffected**, because neither `eth_signTypedData_v4` nor
`secp256k1_sign` carries a chain. That is exactly why the sponsored setup worked
on mainnet and the owner-paid approval did not, and it is worth understanding
before the next run: a demo can sign perfectly and still be unable to send.

**Switching was not sufficient, and the first attempt failed.** `withWallet` was
changed to call `switchChain` before every wallet call, fetching the provider
afterwards because Privy's note says a switch does not update an existing provider
instance. The chain mismatch persisted, because Privy also documents that
`switchChain` **rejects when "the target chain has not been configured"**, and
`app/providers.tsx` set no `supportedChains`. The documented default is "the first
network in `supportedChains`, and to Ethereum mainnet if no `supportedChains` are
specified", so the wallet was on mainnet and Base Sepolia was not a network Privy
would switch to at all.

The fix is in `app/providers.tsx`: `supportedChains: [baseSepolia]` and
`defaultChain: baseSepolia`. **`supportedChains` is load-bearing, not
decoration**, and removing it reintroduces this failure.

`withWallet` now also asks the provider itself, via `eth_chainId`, and refuses
before sending when that is not 84532. `wallet.chainId` and the provider can
disagree, and the provider is the one `eth_sendTransaction` compares the
transaction against, so it is the one worth reading. The refusal names both
numbers, which is the difference between a diagnosis and another guess.

`lib/wallet-chain.ts` holds both readers. Anything unrecognised returns null, so a
provider that will not say its chain causes a refusal rather than a guess.

The approval was sent by the owner and succeeded in block 47410859 as transaction
`0x468222c6dace2afaa406b45cc60c243f1b3b3c39d5bc84d953366979e09b98f3`.
The API returned `observing` while Base's safe head lagged the sequencer, then
`confirmed`, and the policy list reports
`0x4b9f829b7233c45fc4ebb1ecbc24dc696e7441334f3121e4f6cbfb123f2955a1`
as active. This proves the address-bound typed-data signature and the owner's
type-2 send in the live flow. The owner page links to `/agent` once the policy
is active.

The first agent prompt failed before a GOL submission because the configured
OpenAI project could not access `gpt-4.1-mini`. The local gitignored environment
now uses `gpt-5.4`. The retried authenticated prompt submitted a 0.1 USDC
transfer, transaction
`0x2370735ed418791f13b368e85e544f2a7833fb75d7bd06777db82c8dd1f10fbf`.
The public receipt shows the owner-to-payee USDC transfer,
`MandateActionExecuted`, and inline `GasSettled`; GOL reports `collected` with
outcome `success`. The proof panel initially crashed because list rows are
summaries with `actionTransactionHash`, not `transactionHashes` or a receipt.
The route now fetches detailed executions and the panel handles pending rows.
Receipt decoding is pinned by public transfer and refusal fixtures.

Still unproven, in order of what the next run reaches:

1. **This owner's on-chain refusal.** The owner confirmed the repaired proof
   panel shows the 0.1 USDC transfer and GOL state `collected`. A profile 4
   refusal receipt decodes correctly; this owner's refusal flow has not been
   exercised.
2. **Whether Privy will sign an authorization to the EIP-7702 reset address**, which
   the delegation removal needs.

`pnpm typecheck`, `pnpm lint`, and `pnpm test` pass with 79 tests after the proof
panel repair. See `README.md` for the full boundary.

## Approval prompt and recovery

The first mandate-signing attempt reached `prepare-policy` and then crashed in
Privy's `SignRequestScreen` while reading absent `signMessage` modal data. The
page had requested a transaction immediately after a typed-data signature, so
the two wallet prompts could overlap. The owner now completes the signature,
returns to the page, and clicks a separate button to send the transaction.
`OwnerControls` stages pause, resume, and revoke the same way, and delegation
removal stages its type-4 reset transaction.

`lib/pending-approval.ts` keeps a submitted draft ID, transaction hash, and payee
names under an account-scoped browser key. On reload the page resumes polling;
browser storage never authorizes a transaction. Only after GOL confirms the
drafted policy at its selected chain head does the page save contact labels for
the agent. `usePolicy` chooses the newly confirmed policy among the owner's
active policies using the local hint, but always validates against the API list.

The signing prompt fix and approval are verified against Privy and Base Sepolia.
The first agent transfer is verified against a public receipt and GOL's
collected record. The owner confirmed the proof panel shows it correctly. Do
not describe the full demo as end-to-end verified until this owner's refusal
is observed.

## Heavy dependencies and the build

`@coinbase/agentkit` is loaded with a dynamic `import()` inside the chat route, never
at module scope. Two reasons: its dependency graph is very large, and a static import
made Next's build-time route collection fail with `TypeError: X is not a function`
while evaluating the bundle.

AgentKit 0.10.4 calls its analytics endpoint without handling promise rejection.
An HTTP 400 from that endpoint produced an unhandled rejection after the live
transfer. `patches/@coinbase__agentkit@0.10.4.patch`, pinned by
`pnpm-workspace.yaml`, catches rejected analytics promises in its wallet and
action paths. Keep the patch when reinstalling until the dependency handles this
itself. A simulated HTTP 400 produced a warning and no unhandled rejection.

`lib/server/agent-key.ts` exists only so `/api/gol/agent-address` can read the
agent's address without pulling AgentKit in. Do not import the key helpers from
`gol-action-provider.ts`; that reintroduces the build failure.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
