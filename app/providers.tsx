"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

/**
 * Privy configuration is deliberately minimal.
 *
 * Embedded wallets are created on login and nothing else is requested. Privy
 * smart wallets and Privy gas sponsorship are OFF, and they are off in the
 * Privy app's dashboard rather than here, because that is where Privy reads
 * them from. Both would matter: a smart wallet is a Kernel account, which no
 * Active GOL profile supports, and either one could re-delegate the EOA away
 * from the reviewed Nexus 1.3.3 delegate, which GOL refuses with
 * `account_integration_invalid`.
 */
export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  if (!appId) {
    return (
      <div className="p-8 font-mono text-sm">
        <h1 className="text-lg font-semibold text-red-700">
          NEXT_PUBLIC_PRIVY_APP_ID is not set
        </h1>
        <p className="mt-2">
          Put it in <code>mandate-demo/.env.local</code> and restart the dev
          server.
        </p>
      </div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "light" },
        // Email only, as the handover prompt decided. A login method listed here
        // must also be enabled in the Privy dashboard.
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
