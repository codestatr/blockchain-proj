# Waste System — Recycle to Earn

A locally deployable waste rewards system aligned with **UN SDG 11, Target 11.6**. Citizens create accounts, link a wallet by signing a verification message, and access their recycling activity. An authorized server signer records deposits on-chain and mints RecycleToken (RCT) at **10 RCT per kilogram**, prorated by gram.

## Architecture

```text
Citizen wallet → Next.js dashboard → POST /api/deposit → owner/oracle signer
                                                       ↓
                         Hardhat / Base Sepolia ← WasteRewardToken.sol
```

- **Contracts:** Solidity 0.8.24, OpenZeppelin ERC-20 and Ownable. Only the owner/oracle can record deposits and mint RCT.
- **Frontend:** Next.js App Router, TypeScript, Tailwind CSS, Wagmi and Viem.
- **On-chain features:** Wallet balance and deposit history are read from the token contract. Users can send RCT directly from their linked wallet, see deposit transaction hashes, and open Base Sepolia transactions or contract details in BaseScan. Separate contract addresses are supported for Localhost and Base Sepolia.
- **Accounts:** Registration and login use scrypt password hashes and 14-day HttpOnly sessions. Local development stores accounts in `web/data/auth.sqlite`; when `DATABASE_URL` is set, the app uses Neon Postgres instead. Wallet linking requires an account session and a wallet signature. Deposits are restricted to that linked wallet.
- **Gateway:** Next.js server route validates input and sends the owner-signed transaction. The admin private key is server-only.
- **Networks:** Hardhat Localhost (31337) and Base Sepolia (84532).

The current deposit entry is user-submitted: login and wallet verification establish which account receives tokens, but do not independently verify material or weight. A real collection workflow still needs a trusted operator or authenticated bin integration, durable rate limiting, monitoring, and a dedicated relayer or multisig. The API logs `binId`; the contract records material and weight but does not store a bin identifier.

## Repository

```text
contracts/WasteRewardToken.sol  ERC-20 token and deposit ledger
scripts/deploy.js               Local or Base Sepolia deployment
test/WasteRewardToken.ts        Contract unit tests
web/src/app/                    Next.js dashboard and deposit API
hardhat.config.ts               Solidity compiler and network settings
```

## Local quickstart

Requirements: Node.js 22.5+ and npm. Node's built-in SQLite module stores local accounts. From the repository root:

```bash
npm install
npm run compile
npm test
```

Start a local node in terminal 1:

```bash
npm run node
```

In terminal 2 deploy to the local node:

```bash
npm run deploy:local
```

Copy the printed contract address. Keep blockchain deployment settings in the root `.env.blockchain` file (loaded by Hardhat and gitignored), and copy `web/.env.example` to `web/.env.local` for the Next.js app:

```dotenv
# root .env.blockchain: use the first Hardhat node account's private key for local deployment/oracle use
DEPLOYER_PRIVATE_KEY=
ADMIN_PRIVATE_KEY=0x...

# web/.env.local
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS
NEXT_PUBLIC_LOCAL_CONTRACT_ADDRESS=0xYOUR_LOCAL_CONTRACT_ADDRESS
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
LOCAL_RPC_URL=http://127.0.0.1:8545
ADMIN_PRIVATE_KEY=0x...
```

For local deposits the contract owner must be the same account represented by `ADMIN_PRIVATE_KEY`. Hardhat prints development accounts and their keys when the node starts; never use those keys on a public network. Then start the UI:

```bash
npm run dev
```

Visit `http://localhost:3002`, register an account, connect MetaMask to Localhost 8545 (chain ID 31337), and sign the wallet-link message. The API route signs deposits, so the citizen wallet does not pay gas. Account and session data persists in `web/data/auth.sqlite`; back up this file with the rest of the local application data.

## Base Sepolia deployment

Get free test ETH from an available Base Sepolia faucet and configure root `.env.blockchain`:

```dotenv
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0xYOUR_TESTNET_DEPLOYER_KEY
```

Deploy:

```bash
npm run deploy:base-sepolia
```

The deployer becomes the contract owner. Configure the server `ADMIN_PRIVATE_KEY` with that same testnet account (or transfer ownership to a separate oracle account before use). Set the frontend environment:

```dotenv
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_CONTRACT_ADDRESS=0xYOUR_BASE_SEPOLIA_CONTRACT
NEXT_PUBLIC_BASE_SEPOLIA_CONTRACT_ADDRESS=0xYOUR_BASE_SEPOLIA_CONTRACT
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ADMIN_PRIVATE_KEY=0xYOUR_SERVER_SIDE_ORACLE_KEY
```

Never put `ADMIN_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` in a `NEXT_PUBLIC_` variable or commit a real `.env` file. For production, keep the owner key in a managed secret store and rotate it if exposed.

## Free cloud setup: Netlify and Neon

Local development continues to use SQLite. In production, set `DATABASE_URL` to a Neon Postgres connection string and the account APIs use Postgres automatically. The schema is created on first use. Keep the database URL and `ADMIN_PRIVATE_KEY` server-only.

1. Create a Neon project on its Free plan and copy its pooled Postgres connection string.
2. Import this repository into Netlify and select `web` as the site package directory. Leave the base directory at the repository root so Netlify installs the npm workspace dependencies. The root `netlify.toml` sets the build command and Node version.
3. Add these variables in Netlify's site environment settings:

   ```dotenv   DATABASE_URL=<PASTE_NEON_CONNECTION_STRING_HERE>   # Neon pooled connection string
   NEXT_PUBLIC_CHAIN_ID=84532
   NEXT_PUBLIC_BASE_SEPOLIA_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS
   NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   NEXT_PUBLIC_APP_URL=https://wastesystem.netlify.app
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   ADMIN_PRIVATE_KEY=0xYOUR_SERVER_SIDE_ORACLE_KEY
   ```

4. Set the Netlify site name to `wastesystem`, which gives it the default domain `https://wastesystem.netlify.app`. The checked-in configuration uses that URL for canonical metadata. The domain must be available in Netlify; add a custom domain later in the site settings if you own one. The initial production account tables are created when an auth endpoint is first used.

If you already have users in the local SQLite database, set `DATABASE_URL` in your local environment and run `node scripts/migrate-auth-to-neon.cjs` once from the repository root. The script copies password hashes, wallet links, and unexpired sessions; it leaves the local database untouched. Back up the SQLite file before migration. Do not run the script more than once against a database that has since received account changes unless you intend to preserve Neon rows where IDs already exist.

Netlify Free has a fixed monthly usage cap; the site pauses after the cap rather than charging for overages. Neon Free has separate compute and storage quotas. Neither provider promises uninterrupted service or an unchanging free tier.

## Impact metrics

The contract exposes `totalWeightInGrams` and emits a `DepositRecorded` event for each recorded deposit. The dashboard converts total grams to kilograms. A 1 kg deposit mints 10 RCT; a 500 g deposit mints 5 RCT. These are activity measures and do not independently estimate environmental impact or emissions.

## Notes

- The deposit mappings are on-chain, and the dashboard loads each linked wallet's recorded deposits from the contract. The bin ID is included in the API log for operational context but is not stored in the contract.
- `DEPOSIT_API_SECRET` is reserved for a future authenticated bin gateway and is not currently used by the user interface.
- Contract ownership is a sensitive role; retain owner control and use a separate testnet key for the API oracle where practical.
