import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">GOL mandate demo</h1>
      <p className="mt-3 text-neutral-600">
        A Privy embedded EOA owner, an OpenAI agent through Coinbase AgentKit,
        and a GOL bounded mandate between them on Base Sepolia.
      </p>
      <ul className="mt-8 space-y-3">
        <li>
          <Link className="underline" href="/spike">
            Privy signing test
          </Link>
          <p className="text-sm text-neutral-500">
            Sponsored EIP-7702 setup with Privy as the owner. Step 3 of the work
            order.
          </p>
        </li>
      </ul>
    </main>
  );
}
