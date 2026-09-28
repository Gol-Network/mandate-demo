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
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` all pass.
- `/spike` implements the sponsored EIP-7702 setup end to end and compiles.

**Not verified:** `/spike` has never been run against live Privy credentials, so
the Privy signing findings are unknown. The three risks to test first are the
recovery byte from `secp256k1_sign`, whether `signAuthorization` accepts chain
`84532` with an explicit nonce, and whether typed-data signing and a normal
type-2 transaction work from the EOA after delegation. Until those are observed,
nothing about Privy-as-owner is established.

Not built yet: the owner page's full state machine, the approval, the agent and
its chat UI, and the on-chain proof panel.

## Setup

Requires Node.js 22 or later and pnpm 11.

```sh
pnpm install
```

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is gitignored.
Never commit it, and never put a real value in `.env.example`.

| Variable | Where it goes |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy dashboard. Public. |
| `PRIVY_APP_SECRET` | Privy dashboard. Server only, used to confirm an address belongs to the logged-in user. |
| `GOL_API_KEY` | console.gol.network. A `gol_test_` key; a live key gets `capability_unavailable`. |
| `GOL_PROJECT_ID` | console.gol.network. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI. The model name is read from the environment, never hard-coded. |
| `AGENT_PRIVATE_KEY` | A fresh test key. The agent holds no funds. |
| `AGENT_MAX_CHARGE_WEI` | The ceiling the agent may sign for one transfer's gas. |
| `DEMO_RECIPIENTS` | Addresses only, comma separated. |

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
  page.tsx                        index
  spike/page.tsx                  Privy signing test (work-order step 3)
  api/gol/config/route.ts         live gas configuration, proxied
  api/gol/account-status/route.ts detected family, delegation, core installed
  api/gol/eip7702/{prepare,submit,status}/route.ts
lib/
  chain.ts                        Base Sepolia and the explorer
  gol-client.ts                   browser to own-server calls
  privy-signers.ts                Privy to @gol/sdk signer adapters
  server/
    env.ts                        environment access
    gol.ts                        the GOL API client
    privy.ts                      access-token verification, account ownership
    route.ts                      route wrapper and JSON errors
```

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
