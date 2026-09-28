/**
 * The agent's chat route.
 *
 * Short-lived by design: it builds AgentKit with only the GOL provider, runs one
 * streamed turn, and returns. It never waits on a GOL settlement, because the
 * platform confirms at Base's `safe` head and that can take minutes. Status is
 * polled by the browser instead.
 *
 * AgentKit and its Vercel AI SDK bridge are loaded with dynamic `import()` inside
 * the handler. Two reasons: the dependency graph is very large, and importing it
 * at module scope made Next's build-time route collection fail with
 * `TypeError: X is not a function` while evaluating the bundled module. Loading
 * it per request also keeps it out of the build graph entirely.
 *
 * The request carries the owner's contacts so names can be resolved server-side.
 * That is untrusted input, re-validated in `agent-payees.ts`, and used only to
 * turn a name into an address. It is never authority.
 */
import { openai } from "@ai-sdk/openai";
import { streamText, type CoreMessage } from "ai";
import { createWalletClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { normaliseKey } from "@/lib/server/agent-key";
import { serverEnv } from "@/lib/server/env";
import { getGol, golProjectId } from "@/lib/server/gol";
import { requireOwnedAccount, requireHex } from "@/lib/server/privy";
import { jsonError } from "@/lib/server/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatBody {
  account?: string;
  gasPolicyId?: string;
  contacts?: unknown;
  messages?: { role: string; content: string }[];
}

const systemPrompt = `You are a payments agent for a person who has approved a GOL mandate on their own wallet.

Your only way to move money is transfer_usdc. You have no wallet of your own, no ability to swap, and no ability to request funds. Anything outside the owner's mandate is out of your reach.

How to behave:

- The owner named the payees they permit. Use transfer_usdc with the owner's name for a payee, or an address. If you are given a name you do not know, ask which payee they mean. Do not guess an address.
- If the owner asks for an amount above what the mandate permits, still make the attempt. The owner's mandate is the authority, not your judgement, and the on-chain refusal is something the owner should see. Report the refusal plainly, with its code name and what was attempted.
- Never describe a transfer as successful before the state says so. If the state is not terminal, say it is still settling.
- Report the transaction hash whenever there is one, so the owner can look it up themselves.
- Keep replies short. This is a payments assistant, not an analyst.

If a transfer is refused on-chain, say which rule refused it in plain words, for example "the owner capped each payment at 1 USDC" or "that address is not one of the payees the owner approved".`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody;
    const { account } = await requireOwnedAccount(request, String(body.account ?? ""));
    const gasPolicyId = requireHex(body.gasPolicyId, "gas_policy_id");

    // The gas policy must belong to this account and must be usable. This is the
    // server-side half of "only the logged-in user's own account is used".
    const policies = await getGol().listGasPolicies(golProjectId());
    const policy = policies.data.find(
      (candidate) =>
        candidate.gasPolicyId.toLowerCase() === gasPolicyId.toLowerCase() &&
        candidate.account.toLowerCase() === account.toLowerCase(),
    );
    if (!policy) {
      return Response.json({ error: "no_such_policy" }, { status: 403 });
    }
    if (policy.status !== "active") {
      return Response.json(
        {
          error: "mandate_not_active",
          status: policy.status,
          message:
            policy.status === "paused"
              ? "The owner has paused this mandate. Resume it on the owner page first."
              : `This mandate is ${policy.status}, so the agent cannot use it.`,
        },
        { status: 409 },
      );
    }

    const configuration = await getGol().getGasConfiguration(golProjectId());

    const [{ AgentKit, NETWORK_ID_TO_VIEM_CHAIN, ViemWalletProvider }, { getVercelAITools }, { golActionProvider }] =
      await Promise.all([
        import("@coinbase/agentkit"),
        import("@coinbase/agentkit-vercel-ai-sdk"),
        import("@/lib/server/gol-action-provider"),
      ]);

    const agentAccount = privateKeyToAccount(normaliseKey(serverEnv.agentPrivateKey));

    // AgentKit pins viem 2.38.3 and this app pins 2.37.13 to match `@gol/sdk`. The
    // two copies have structurally incompatible `Chain` and `WalletClient` types,
    // so the client is built here and narrowed in exactly one place.
    //
    // This is safe because `ViemWalletProvider` only ever calls `signTypedData`
    // and `getAddress` on it, and both take and return plain data. No viem
    // instance, client, or class ever crosses back out. Forcing one viem version
    // instead would change the dependency of `@gol/sdk`'s verified policy-encoding
    // path, which is the worse trade.
    const chain = (NETWORK_ID_TO_VIEM_CHAIN["base-sepolia"] ?? baseSepolia) as Chain;
    const built = createWalletClient({
      account: agentAccount,
      chain,
      transport: http(),
    });
    const walletClient = built as unknown as ConstructorParameters<
      typeof ViemWalletProvider
    >[0];
    const walletProvider = new ViemWalletProvider(walletClient);

    // Only the GOL provider is registered. AgentKit's built-in providers would
    // move the agent wallet's own funds, which is not what this demo is about.
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        golActionProvider(
          walletProvider,
          {
            account,
            gasPolicyId: policy.gasPolicyId as Hex,
            mandateId: policy.mandateId as Hex,
            contacts: body.contacts,
          },
          configuration.asset.decimals,
        ),
      ],
    });

    const messages: CoreMessage[] = (body.messages ?? []).map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));

    const result = await streamText({
      model: openai(serverEnv.openaiModel),
      system: systemPrompt,
      messages,
      tools: getVercelAITools(agentkit),
      maxSteps: 8,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    return jsonError(error);
  }
}
