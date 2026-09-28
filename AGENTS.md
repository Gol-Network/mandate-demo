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

It runs on `localhost` and is built to deploy to Vercel.

This is a consumer of GOL's public surface. It is not part of GOL.

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

- **Smart wallets off.** A Privy smart wallet is a Kernel account, and no Active
  GOL profile supports Kernel. It would also move the story to a different
  contract address.
- **Privy gas sponsorship off.** It can delegate the EOA to Privy's own
  implementation.

GOL fails closed with `account_integration_invalid` if the EOA is delegated to
anything other than the reviewed Nexus 1.3.3 delegate, so a wrong dashboard
setting shows up as a refusal rather than as silent breakage.

The demo also asks the user to clear the delegation in their own wallet if it
finds the account delegated somewhere else. It cannot do that for them.

## Development

Node.js 22 or later and pnpm 11. Run commands from this repository root.

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm start
pnpm check
```

`pnpm check` runs `typecheck`, `lint`, and `build` in that order and is the
command to run before committing.

There is no test suite yet. Adding one means adding a runner and a `test`
script here, and recording both in this file in the same change.

The project holds no database and writes no files at runtime. The only state is
the GOL API plus browser storage for draft IDs and the cached policy ID.

## Current state

Work-order steps 1 and 2 are done, and step 3 (the Privy signing test at
`/spike`) is built but has never been run against live Privy credentials. See
`README.md` for what is verified and what is not.
