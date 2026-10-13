# hunch.

**Private prediction markets for your group chat.** Bet on what your friends will actually do. Only your group can read the bets, and payouts settle in under a second on Monad.

**Live app:** https://hunch-neon.vercel.app (Monad testnet). Open it on a phone (iOS Safari or Android Chrome) and sign up with Face ID. No wallet, seed phrase or faucet needed: new accounts get gas and $50 of testnet AUSD automatically.

> *"Will Sam make it to 8am lecture this week?"* → 5 friends put $5 on it → Sam shows up → the YES side splits the pot instantly.

---

## Why this exists

Friend groups already bet on each other: Venmo requests "for the bet", screenshots of who called it, and a group chat that never settles up. Public prediction markets (Polymarket, Kalshi) can't serve this because:

1. **The questions are private.** "Does Priya text him back?" can't go on a public order book, and the person in question is usually one tap away from seeing it.
2. **The markets are tiny and short-lived.** $20 pots that resolve tonight. Fees, KYC and listing reviews kill them.
3. **Settlement is the whole product.** The fun dies when someone has to chase payment. A market that pays out the instant the creator calls it is the feature.

Hunch puts all three onchain, where they're cheap, while keeping the chain invisible.

**First users:** college friend groups (dorm floors, club group chats, intramural teams), starting with our own campus community at Penn. Group chats spread on their own: every market is an invite link dropped into the chat.

## How it works

| What you see | What happens onchain |
|---|---|
| "Continue with Face ID" | A [Mera](https://mera.category.xyz) passkey. Its PRF output derives your EOA (BIP-39/44), so there's no seed phrase, extension or custody backend. A sponsor endpoint tops up gas and sends $50 of testnet **AUSD** (from Agora's faucet). |
| "Start a group" | A random 32-byte **group key K** is created on your device. `groupId = sha256("hunch/group-id" ‖ K)` goes onchain along with an **invite signer** address derived from K. The group name is AES-GCM encrypted under a key derived from K. |
| "Invite" → link in the group chat | K travels in the URL **fragment** (`/#join=…`), which browsers never send to a server. Joining requires a signature from the invite key, so only people with the link can join, and the contract enforces it. |
| "Post a hunch" | The question is encrypted with the group's content key. The chain only ever sees ciphertext. |
| Bet YES / NO | Parimutuel pools in AUSD. Your payout = your share of the winning side × the whole pot. |
| "It happened" / "It didn't" | The creator settles. One-sided markets automatically void and refund. Winners tap **Collect**. |
| New phone, sign in | Your list of group keys (your **keyring**) is stored onchain, encrypted under a key derived from your passkey PRF via HKDF (`hunch/keyring/v1`). One Face ID restores the account, every group, and every decrypted question. No secrets are stored anywhere. |
| Feed, names, leaderboard | Full event history is read through **Envio HyperSync** (`/api/rpc` translates the app's `eth_getLogs` calls into HyperSync queries). The public Monad RPC limits logs to 100 blocks, about 40 seconds of history. |

### Key hierarchy

```
passkey (Mera PRF, default salt)
 ├─ BIP-39 → m/44'/60'/0'/0/0            → wallet EOA (signs Monad txs)
 └─ HKDF("hunch/keyring/v1")             → AES-256-GCM keyring key  ──wraps──▶ { me, groups: [K₁, K₂, …] } (stored onchain)

group key K (random, shared only via invite-link fragment)
 ├─ sha256("hunch/group-id" ‖ K)         → groupId (public)
 ├─ keccak256("hunch/invite" ‖ K)        → invite signer (secp256k1) — proves link possession to the contract
 └─ HKDF("hunch/content/v1")             → AES-256-GCM content key (group name, questions, member names)
```

### Signing session

After one Face ID, a Mera signing session lives **in memory only** and is scoped by the app:
- It can only call the Hunch contract and AUSD.
- It ends after 30 minutes, and you get a warning in the last 5.
- It ends immediately on Lock or Sign out.

Nothing is written to disk except a credential-id hint and your public address, and the app works without either (the stateless test).

## Repo layout

```
contracts/          Foundry: Hunch.sol (groups, keyring, markets), HunchUSD.sol (mock dollar, unused in prod), tests
app/                Vite + React + viem mobile web app
  src/lib/account.ts  Mera passkey sign-up / sign-in, scoped signing session
  src/lib/crypto.ts   Key hierarchy above (WebCrypto HKDF + AES-GCM, invite signatures)
  src/lib/data.ts     Group/market reads & writes, leaderboard
  api/rpc.ts          eth_getLogs → Envio HyperSync shim (token stays server-side)
  api/drip.ts         Onboarding sponsor: gas + $50 AUSD starter balance
  scripts/e2e.ts      End-to-end smoke test on Monad testnet
```

## Deployments (Monad testnet, chain 10143)

| Contract | Address |
|---|---|
| Hunch | [`0x94c4Ed74E942fEAe4FC79e31D24eaaA52302c290`](https://testnet.monadexplorer.com/address/0x94c4Ed74E942fEAe4FC79e31D24eaaA52302c290) |
| AUSD (Agora, testnet) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |

## Run it yourself

```bash
# contracts
cd contracts && forge install foundry-rs/forge-std --no-git && forge test

# app (needs ENVIO_TOKEN and DEPLOYER_PK in the environment for /api, e.g. via `vercel dev`)
cd app && npm i && npx vercel dev

# end-to-end on testnet
set -a; source ../.env; source .env.production; set +a; npx tsx scripts/e2e.ts
```

## Roadmap

- **Disputes:** a stake-weighted group vote can overturn the creator's settlement within a window, and the creator can't bet on their own market without disclosure.
- **AI resolver for public facts** ("Will it snow in Philly Friday?"): a Chainlink CRE workflow checks a data source and settles.
- **iMessage / WhatsApp mini-app** so hunches live inside the chat itself.
- **Mainnet AUSD** with Agora's instant settlement for card on-ramp/off-ramp.
