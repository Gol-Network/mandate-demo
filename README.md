# mandate-demo

A working demo of GOL bounded mandates on Base Sepolia. An owner signs one
mandate; an AI agent can move USDC only inside it; the owner can stop it without
the agent.

This is a consumer of GOL's public SDK and API. It is not part of GOL, and it is
not audited. Everything here runs on testnet with testnet funds.

## What it is

| Part | What it is |
|---|---|
| Owner | A Privy embedded EOA, delegated by GOL's EIP-7702 setup to Biconomy Nexus 1.3.3 with the GOL version 3 core as its only executor. Family `nexus7702`. |
| Agent | An OpenAI chat agent through Coinbase AgentKit, holding no funds. |
| Mandate | One owner signature covering a transfer mandate and its gas policy. GOL's relayer pays network gas for the owner's agent and is repaid inline from the owner's ETH. |

## Status

Verified as of 2026-09-28:

- The GOL platform is healthy on API 0.5.0, compatibility profile 4 is Active,
  and `@gol/sdk@0.5.0` is the published `latest`. See
  `../.local/planning/mandate-demo/PROGRESS.md` for the recorded checks.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (79 tests), and `pnpm build` all pass.
- **The sponsored setup succeeded end to end on chain.** The owner EOA
  `0x2A9E395887Da36d8300bd7E51865dE7C297bE118` now carries the delegation
  designator `0xef01000000b1c01cb3b5770d8806f0d214d50131a08a5b`, naming the
  reviewed Nexus 1.3.3 delegate, and GOL reports the family as `nexus7702` with
  the core installed and the account initialised. Verified by a raw `eth_getCode`
  over public RPC as well as by the API.
- **Privy login works, both owner signatures are produced and verified, and the
  account-status fix is confirmed**: the same account that was refused as
  delegated elsewhere now reaches the setup and then the approval form.
- **Privy signs with the first linked wallet unless told which.** The first run
  failed with `eip7702_authorization_signer_mismatch`; pinning `options.address`
  produced `Authorization is correct ok` recovering to the owner.
- **`secp256k1_sign` returns the recovery id in the high bit**, as `0x80`, which
  the demo refused as `privy_raw_signature_bad_recovery_byte:80` before the byte
  was derived rather than read.

- **`supportedChains` in the Privy config is load-bearing.** A Privy embedded
  wallet defaults to mainnet when no `supportedChains` are set, and `switchChain`
  refuses a chain that has not been configured, so the wallet simply cannot reach
  Base Sepolia. Signing carries no chain, which is why the sponsored setup worked
  from a mainnet wallet while the owner-paid approval did not: the demo could sign
  perfectly and still be unable to send.
- **The owner EOA is funded at 0.006 ETH** on Base Sepolia, over the 0.000092
  per-transfer floor.
- **The owner approval succeeded on chain and GOL registered an active policy.**
  Transaction `0x468222c6dace2afaa406b45cc60c243f1b3b3c39d5bc84d953366979e09b98f3`
  succeeded in block 47410859. GOL returned `confirmed` after Base's safe head
  passed that block, and `listGasPolicies` now reports policy
  `0x4b9f829b7233c45fc4ebb1ecbc24dc696e7441334f3121e4f6cbfb123f2955a1`
  as active. The owner page now links directly to the agent chat at `/agent`.

- **The first agent transfer succeeded.** The first chat prompt failed before
  calling a tool because this OpenAI project could not access the configured
  `gpt-4.1-mini`. After switching the local gitignored config to `gpt-5.4`, the
  authenticated agent submitted 0.1 USDC to the owner's approved payee.
  Transaction `0x2370735ed418791f13b368e85e544f2a7833fb75d7bd06777db82c8dd1f10fbf`
  succeeded on Base Sepolia. Public receipt decoding shows the USDC transfer,
  `MandateActionExecuted`, and `GasSettled`; GOL reports the execution as
  `collected` with outcome `success` and 3174752159529 wei repaid inline.
- **AgentKit analytics failures are contained.** Coinbase AgentKit 0.10.4
  ignored rejected analytics promises, which produced an unhandled HTTP 400
  rejection in the demo server. The pinned pnpm patch catches those rejections;
  a local HTTP 400 smoke check and `pnpm check` pass.

The proof panel initially crashed because the public list
API returns summary rows without `transactionHashes`. The panel now fetches the
detailed execution and handles pending summaries. Its decoder is tested against
the live transfer receipt and a profile 4 refusal receipt. The owner confirmed
the repaired browser panel shows the 0.1 USDC transfer and GOL state `collected`.
This owner's on-chain refusal path has not been exercised.
Whether Privy will sign an authorization to the EIP-7702 reset address is also
unknown, which the delegation removal depends on. See `AGENTS.md` for the findings
and what to watch on the next run.

The approval-signing prompt exposed a Privy modal crash on the next local run.
The demo now signs through Privy's address-bound typed-data hook, then shows a
separate button for the owner-paid transaction. The same two-step flow is used for
pause, resume, revoke, and an owner-directed delegation reset. A submitted
approval is saved locally with its draft ID, transaction hash, and payee names so
a page reload can resume confirmation;
the platform still checks the draft and on-chain transaction. After confirmation,
the payee names are saved for the agent chat. The approval and first agent
transfer paths are verified live.

## Funding

The owner EOA needs **0.003 to 0.005 ETH on Base Sepolia**, plus Circle USDC. ETH
from the [Base Sepolia faucet](https://portal.cdp.coinbase.com/products/faucet),
USDC from [Circle's testnet faucet](https://faucet.circle.com).

The two obligations are different and the page shows them separately:

- the **sponsored setup is free**, GOL relays it at GOL's cost, which is how a
  zero-balance wallet gets far enough to need funding;
- the **approval is a transaction the owner sends and pays for**;
- **each transfer is prepaid by the relayer and repaid inline from the owner's
  ETH**, so the balance has to still be there when the agent moves money. The
  floor is the mandate's own per-action gas cap, read from `getGasConfiguration`
  at runtime rather than hard-coded, and `components/owner-balance.tsx` checks it
  before the approval is signed rather than letting a transfer fail later.

The owner setup, approval, one agent transfer, and the repaired proof panel have
been verified live. This owner's on-chain refusal has not been exercised.
Work-order step 6, including a live refusal, and step 7, Vercel deployment, are
not done.

## Setup

Requires Node.js 22 or later and pnpm 11.

```sh
pnpm install
```

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is gitignored.
Never commit it, and never put a real value in `.env.example`.

```sh
cp .env.example .env.local
pnpm key:agent          # the agent's disposable signing key, printed as an address only
pnpm check:env --write  # validates the GOL key and fills in GOL_PROJECT_ID
```

`pnpm check:env` calls `GET /v1/whoami` with your key and reports the project,
environment, and scopes, then fetches `gas-configuration` to confirm hosted gas is
actually reachable for that project. It also checks that `OPENAI_MODEL` is
available to the configured OpenAI key when both are set. The project ID is the
project's **UUID**; the
SDK's `contractProjectId` packs it into 32 bytes for the on-chain terms, but the
platform does that itself, so the demo only ever needs the UUID. `pnpm check:env` reads
it out of the key's identity, so there is nothing to copy by hand.

The key must be a **`gol_test_`** key. Hosted gas refuses a live key with
`capability_unavailable`. Every project currently reports its `live` environment as
`unavailable` anyway, so a key you create now is a test key.

| Variable | Where it goes |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy dashboard. Public. |
| `PRIVY_APP_SECRET` | Privy dashboard. Server only, used to confirm an address belongs to the logged-in user. |
| `GOL_API_KEY` | console.gol.network. A `gol_test_` key; a live key gets `capability_unavailable`. |
| `GOL_PROJECT_ID` | console.gol.network. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI. The model name is read from the environment and must be available to the key's project. |
| `AGENT_PRIVATE_KEY` | A fresh test key. The agent holds no funds. |
| `AGENT_MAX_CHARGE_WEI` | The ceiling the agent may sign for one transfer's gas. |

There is deliberately **no recipients variable**. Payees are not configuration: the
owner fills a table of 1 to 16 (name, address) rows in the mandate form, and the agent
resolves names against whatever that owner entered. A shared list in the environment
would not be per-owner, and would make the demo's central claim untrue.

Then:

```sh
pnpm dev
```

The owner signs in Privy; the GOL project API key never leaves the server.

## Why the owner is a Privy embedded EOA and not a Privy smart wallet

A Privy smart wallet uses Kernel, and no Active GOL profile supports Kernel. It
would also put the mandate on a different contract address than the plain EOA,
which changes the story the demo is telling. So the EOA is delegated through
GOL's own EIP-7702 setup instead.

Two Privy app settings must be **off**, and they are set in the Privy dashboard
rather than in code:

- smart wallets, because of the above;
- Privy gas sponsorship, because it can delegate the EOA away from the reviewed
  Nexus 1.3.3 delegate.

GOL refuses an account delegated to anything else with
`account_integration_invalid`, so a wrong setting fails closed rather than
silently.

## When the account is delegated somewhere GOL did not review

There are two different situations, and they used to be one.

**No delegation at all** is the normal state of a wallet that has never been set
up. GOL still reports a `delegation` object for it, with a null `delegate` and
`reviewed: false`, because `reviewed` is a property of a delegate rather than of
the account. Reading that as "delegated somewhere else" is what produced the
`delegate 0x0 reviewed false` refusal on a brand new wallet. The page now sends
that account to the sponsored setup, which is where it belongs.

**A real delegation somewhere else** is a different case and the page says so,
naming the delegate and linking it on BaseScan. GOL will keep refusing it, and the
page offers the owner the one repair available: EIP-7702 lets an account clear its
own delegation, by signing an authorization naming the reset address
`0x0000000000000000000000000000000000000000` and sending the type-4 transaction
that carries it. Two Privy prompts, and the owner pays for the transaction out of
their own ETH, because GOL's sponsorship covers the reviewed delegate only.

What that is and is not:

- **It is the owner's authority, not a GOL capability.** GOL has no undelegation
  API and the demo does not ask it for one. The demo cannot clear a delegation on
  an account whose key it does not have, and it never sees a key at all. ADR 0019
  puts it the same way: changing or removing the delegation makes GOL refuse until
  the reviewed delegate is restored.
- **It is not offered when it would not help.** If the core is already installed,
  the setup lives in the account's own storage, which changing the delegation does
  not clear. Removing the delegation there would leave an EOA that still believes
  it is set up, so the page explains that restoring the reviewed delegate is the
  way back (ADR 0019) instead of offering the wrong repair. Re-delegating is an
  installation rather than a repair and is not built.
- **It is unproven.** It has never been run. Whether Privy will sign an
  authorization to the reset address, and whether it will send a type-4
  transaction, are both open questions listed under Status. If Privy refuses, the
  panel says so plainly and points at the wallet that owns the account's
  EIP-7702 settings, because there is no version of this that skips the owner's
  signature.

## Owner page controls

Three things on the page worth having:

- **Sign out** (`components/sign-out-button.tsx`) drops the Privy session. Nothing
  on-chain changes and no mandate is affected. The demo's browser storage is keyed
  by account or by Privy user ID, so it is left alone on purpose: one person
  signing out does not delete state the next sign-in would restore, and cannot
  expose another person's.
- **Copy** (`components/copy-address.tsx`) sits next to every address. Addresses
  are displayed truncated, which is right for reading aloud and useless for
  pasting, so the button copies the full value while the short form stays on
  screen. It falls back to a selection-based copy when `navigator.clipboard` is
  unavailable, which is what happens on any origin that is not a secure context:
  `localhost` is one, a LAN address over plain http is not.
- **Remove the delegation**, described above.

## Stack and pinned versions

Chosen 2026-09-28. Versions are pinned exactly, including the AgentKit packages,
which the `create-onchain-agent` template ships as `latest`.

| Package | Version | Why |
|---|---|---|
| `@gol/sdk` | 0.5.0 | The GOL integration surface. Version 3 core, hosted gas API revision 2.0, profile 4. |
| `viem` | 2.37.13 | Matches `@gol/sdk`'s exact pin, so this app and the SDK share one instance. |
| `next` | 16.3.6 | App Router. |
| `react` | 19.3.0 | Required by Next 16 and by Privy React. |
| `@privy-io/react-auth` | 3.45.0 | The owner's wallet. |
| `@privy-io/node` | 0.35.0 | Server-side access-token verification. |
| `jose` | 6.2.12 | Verifies the token against Privy's JWKS. `@privy-io/node` does not re-export its own JWKS helper. |
| `@coinbase/agentkit` | 0.10.4 | The agent runtime. |
| `@coinbase/agentkit-vercel-ai-sdk` | 0.1.0 | Exposes the agent's tools to the Vercel AI SDK. |
| `ai` | 4.3.19 | Pinned to v4 because `agentkit-vercel-ai-sdk` peers on `^4.1.16`. |
| `@ai-sdk/openai` | 1.3.24 | The v4-generation OpenAI provider. |

### The `viem` situation

Four packages pin `viem` to different exact versions, so several copies exist in
`node_modules`. This is deliberate and left alone: `@gol/sdk` was verified
against `2.37.13` and forcing a single version would change the dependency of a
security-critical encoding path. The copies are safe here because every boundary
in this application is data (hex strings and JSON), never a viem class instance.

### The template, and what was replaced

The stack comes from `create-onchain-agent@0.5.7` (Next.js 16, Vercel AI SDK,
OpenAI), run in a scratch directory first to inspect it. It was **not** adopted
as generated, because nearly all of its application code is placeholder:

- it writes a generated private key to `wallet_data.txt` on disk. This demo reads
  `AGENT_PRIVATE_KEY` from the environment and writes nothing;
- it registers the built-in `weth`, `pyth`, `wallet`, and `erc20` action
  providers, which move the **agent wallet's own funds** and would bypass the
  mandate entirely. Only the GOL provider is registered;
- it hard-codes `gpt-4o-mini` and offers faucet actions. The model comes from
  `OPENAI_MODEL`;
- it caches the agent and the conversation in module-level variables, which leaks
  one visitor's conversation into another's;
- its layout is Coinbase-branded.

`pnpm-workspace.yaml` carries an explicit `allowBuilds` list. Only the four
toolchain binaries this project actually runs are allowed to execute build
scripts. The native modules behind AgentKit's x402, OpenSea, and ethers paths are
denied, because the demo registers no action provider that can reach them.

## Layout

```text
app/
  page.tsx                        index, the owner page and its state machine
  agent/page.tsx                  the agent's chat
  spike/page.tsx                  Privy signing test (work-order step 3)
  api/gol/config/route.ts         live gas configuration, proxied
  api/gol/account-status/route.ts detected family, delegation, core installed
  api/gol/eip7702/{prepare,submit,status}/route.ts
components/
  mandate-contacts-editor.tsx     the 1 to 16 name/address table
  copy-address.tsx                a short value and a button that copies it whole
  sign-out-button.tsx             drops the Privy session
  remove-delegation.tsx           the owner clears their own EIP-7702 delegation
  owner-balance.tsx               what the owner has to pay for, before signing
  authorization-finding.tsx       which of five causes a refused signature had
lib/
  account-status.ts               GOL's account status to the step the page is on
  authorization-diagnosis.ts      why an authorization did not come back
  raw-signature.ts                which of two readings of r || s is the signer
  wallet-chain.ts                 which chain a Privy wallet and provider are on
  chain.ts                        Base Sepolia and the explorer
  contacts.ts                     the contact model, validation, and resolution
  contact-storage.ts              contacts in browser storage
  gol-client.ts                   browser to own-server calls
  privy-signers.ts                Privy to @gol/sdk signer adapters
  undelegate.ts                   the EIP-7702 reset address, and its checks
  server/
    env.ts                        environment access
    gol.ts                        the GOL API client
    privy.ts                      access-token verification, account ownership
    agent-payees.ts               name resolution from untrusted browser input
    route.ts                      route wrapper and JSON errors
test/
  account-status.test.ts          the page's state machine, including the trap
  authorization-diagnosis.test.ts five causes of a refused signature, real keys
  raw-signature.test.ts           four encodings of the recovery byte, real keys
  wallet-chain.test.ts            CAIP-2, hex, and eth_chainId, with refusals
  contacts.test.ts                15 tests over the pure contact logic
  undelegate.test.ts              the reset address and the tuple checks
  agent.test.ts                   the amount parser and the refusal names
```

## Payees: names are labels, addresses are authority

The owner fills a table of 1 to 16 (name, address) rows when approving a mandate. Only
the addresses are sent to GOL and hashed into the policy; the name is the owner's own
label. Two consequences the demo relies on:

- **Renaming a contact needs no new approval.** Only adding, removing, or replacing an
  address does, because only the address is on-chain. A mandate cannot be amended in
  place at all, so any address change means revoke plus re-approve.
- **Names must be unique**, which is what makes resolution deterministic. An ambiguous
  name is refused at entry rather than guessed at.

The agent resolves what you said in code, never in the model. An exact address wins
over a name; a name matches case-insensitively after trimming; anything else comes back
unresolved instead of being coerced. So the model can pick "Alice" but cannot invent a
payee, because an invented name fails to resolve and the tool refuses.

A payee **outside** the mandate is deliberately allowed through. The agent mentions it
and the core refuses on-chain with code 65, and that refusal is the demo's proof, so
blocking it client-side would remove the thing worth showing.

## Testing

`pnpm test` uses Node's built-in runner, so there is no test dependency. Node 22 strips
the TypeScript types directly, which is why test files import source modules with an
explicit `.ts` extension.

## The recovery-byte normalisation

`lib/privy-signers.ts` normalises the last byte of a 65-byte signature to 27 or
28 before handing it to the SDK. The reason is specific: viem's `recoverAddress`
accepts 0/1 or 27/28, so a provider returning 0/1 would pass the SDK's own check
and then be rejected by Nexus 1.3.3's on-chain initializer, which may accept only
27/28. Whether Privy actually returns 0/1 is one of the findings `/spike`
exists to establish.

## Vercel readiness

Not deployed. When it is:

- set every server variable from `.env.example` in the Vercel project, and set
  `NEXT_PUBLIC_PRIVY_APP_ID` there too;
- add the Vercel domain to the Privy app's allowed origins. `http://localhost:3000`
  is the only one configured so far;
- the first public deployment should restrict Privy login to an email allowlist,
  to protect the OpenAI key and the project's 20-per-day sponsored-setup quota.
