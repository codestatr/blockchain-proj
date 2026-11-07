import { createConfig, http } from "wagmi";
import { injected } from "@wagmi/core";
import { baseSepolia, hardhatLocal } from "@/lib/chains";

export const config = createConfig({
  chains: [hardhatLocal, baseSepolia],
  connectors: [
    injected({ target: "rabby", shimDisconnect: false }),
    injected({ target: "metaMask", shimDisconnect: false }),
    injected({ target: "coinbaseWallet", shimDisconnect: false }),
    injected({ shimDisconnect: false })
  ],
  transports: { [hardhatLocal.id]: http("http://127.0.0.1:8545"), [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") },
  ssr: true
});
