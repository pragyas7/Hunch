# Submission form: paste-ready answers

## Primary track
**Social, Attention & Culture**

## Logo
`brand/logo.png` (1024×1024 PNG, 60 KB)

## Name / tagline
- Hunch
- Call it before it happens.

## Describe the problem, your solution, and what makes it useful

**The problem.** Every friend group already runs a prediction market. "Bet you won't make 8am." "$5 says she texts back by Friday." "Who's buying if Leo actually runs the half?" Today it lives in group-chat screenshots, Venmo requests and IOUs. The fun dies at settlement: nobody remembers the terms, and half the time nobody pays. Public prediction markets can't help:
- These questions are personal. "Does Priya text him back?" can't sit on a public order book, and the person in question is one tap away from seeing it.
- The markets are tiny ($5–$50) and short-lived (tonight, this week). Fees, KYC and listing reviews kill them.
- Trust is the product. If someone has to chase payment, it isn't fun.

**Our solution.** Hunch is private prediction markets for your group chat.
1. Sign up with Face ID (a Mera passkey). There's no wallet, seed phrase, extension or faucet; new accounts get gas and a $50 AUSD starter balance automatically.
2. Start a group and drop the invite link in your group chat. It unfurls as a card: "🔒 You've been invited to a private group on Hunch".
3. Post a hunch ("Will Sam make it to 8am lecture this week?"). Friends bet YES or NO in dollars, with parimutuel payouts and a live odds bar.
4. The creator settles it, and winners tap Collect. Bets settle in about 0.4–1s on Monad, so it feels like sending a message, not a transaction.
5. For public facts, a "Price call" ("Will ETH be above $2,510 when betting closes?") is settled by a Chainlink CRE workflow from live market prices. Nobody in the group, including the creator, can override it.

**What makes it different: private by construction, settled onchain.**
- **Encrypted groups.** Each group has a random 32-byte key that travels only in the invite link's URL fragment, which browsers never send to a server. Group names, questions and member names are AES-GCM encrypted under keys derived from it. The chain only sees ciphertext.
- **Contract-enforced membership.** Joining requires a signature from an invite key derived from the group key, so only people holding the link can join.
- **Your passkey is your whole account.** Your keyring (the list of group keys) is stored onchain, encrypted under an HKDF namespace of your passkey's PRF output. On a new phone, one Face ID rebuilds your account, every group and every decrypted question. Nothing secret is stored anywhere.
- **Fair settlement.** One-sided markets auto-void and refund. Price calls can only be settled by the Chainlink oracle, after betting closes.
- **Invisible chain.** The signing session is scoped to our two contracts and expires after 30 minutes. Gas is sponsored. Monad's sub-second finality means no "pending" states.

**Stack.** Solidity (Hunch, HunchOracle; verified on Sourcify), Mera passkeys + WebCrypto, viem, Envio HyperSync for full event history (the public RPC only serves 100 blocks of logs), Chainlink CRE for price settlement, Agora testnet AUSD for stakes, and a React mobile web app on Vercel.

**Traction so far (Monad testnet):** [N] groups, [N] people, [N] hunches, [N] bets, $[N] wagered, [N] settled. This includes our seeded demo group; fill in after friend testing by running `npx tsx scripts/stats.ts`.

## Who are your first users, and how will you reach them?

**First users: college friend groups.** That means dorm floors, club and team group chats, roommates and intramural teams, starting with our own community at Penn. These groups already bet on each other informally every week (who shows up, who texts back, who finishes the thing), and they live in iMessage, GroupMe and Instagram group chats. They are not crypto users and shouldn't have to become one. That's why Hunch is Face ID login, dollars, and no wallet.

**Why they'd switch.** There is nowhere else to put these bets. Polymarket and Kalshi can't host private, personal, $5 questions, and Venmo doesn't remember the terms or enforce the payout. Hunch is the first place these bets can live, with automatic settlement.

**How we reach them.**
1. **The product spreads itself.** Every group starts with an invite link dropped into an existing group chat, and the link unfurls into a preview card. One person creating a group brings 5–15 friends.
2. **Seed 10 Penn group chats this month:** 5 dorm floors and 5 club or team chats, through our campus blockchain community and our own friends, with a "first hunch is on us" starter balance.
3. **A "hunch of the week" campus account** posting public (Chainlink-settled) price calls and funny anonymized results. This builds a top-of-funnel for new groups.
4. **Retention loops:**
   - weekly per-group leaderboards and 👑 bragging rights;
   - "your hunch closes tonight" reminders;
   - settle-and-collect moments that bring everyone back into the group.
5. **Expansion:** an iMessage/WhatsApp mini-app so hunches live inside the chat itself, then other campuses through ambassador groups.

**Next milestones:** 10 active groups and 100 weekly bettors at Penn; group-vote disputes; hosted CRE deployment; mainnet AUSD with Agora on/off-ramps.

## Product link
https://hunch-neon.vercel.app

## Steps to try your product (private to judges)

No login credentials needed: every account is created with a passkey on your own device.

1. **Use a passkey-PRF-capable browser.** That means an iPhone (iOS 18+) in Safari with iCloud Keychain, Android in Chrome with Google Password Manager, or a Mac in Safari. Desktop Chrome's local profile passkeys do NOT support PRF.
2. **Join the pre-seeded demo group:** https://hunch-neon.vercel.app/#join=lujIxgEdoSIjCqVl3G-RTqD-xPt8whQ0xw6dCMQM4Ck
   Enter a name, then Continue with Face ID. You land in "Metropolis Demo Crew" with $50 AUSD. The group has live hunches and a Chainlink-settled ETH price call.
3. **Place a bet** (e.g. $5 YES on "Will a Metropolis judge bet on this market?"). Watch the "settled in ~1s" toast with a receipt link to the Monad explorer.
4. **Make your own:** go back to Groups, then Start a group, then Invite (share the link to a second device), then + New hunch. Bet from both devices, then as creator tap "It happened", then Collect.
5. **Try a Price call ⛓.** In the composer, choose e.g. BTC above $X with "1 hour". It shows "Auto-settles via Chainlink". Proof of a settlement run is in `cre/SIMULATION.md` in the repo.
6. **Stateless test:** on the home screen, tap "Sign out of this device", then "I already have Hunch", then Face ID. Groups, questions and names all reappear, rebuilt from the passkey plus onchain ciphertext.

Contracts on Monad testnet (verified):
- Hunch: `0x8a0c7C0ECcCda4209A834dF78B9d972d6075a3b9`
- HunchOracle: `0x6AC28Ae77f606232da6029aC352381A7F59F7830`
- Stake token: Agora testnet AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`

---

## Bounty answers

### Mera: Best Mera-Powered UX
*How does your project meaningfully integrate Mera as the entire account layer?*

Mera is Hunch's entire account layer. There's no seed phrase, extension, email/OTP or custody backend.
- **One-prompt onboarding:** `createPasskeyWithPrfOutput` runs one passkey ceremony. The PRF output becomes the EOA (BIP-39/44), and a sponsor endpoint funds gas and a $50 AUSD starter balance. Time to first confirmed Monad transaction is a name, one Face ID, and about 2 seconds.
- **Prompt-free signing session:** a Mera `Secp256k1SigningSession` lives only in memory.
  - It is scoped by the app to exactly two contracts (Hunch and AUSD, plus the oracle for price calls); anything else is blocked.
  - It auto-ends after 30 minutes with a warning in the last 5, and a single Face ID resumes it.
  - It ends immediately on Lock or Sign out.
- **Stateless test:** clear storage or use a fresh device, then "I already have Hunch" and Face ID. The account, every group, all decrypted questions and member names rebuild from the passkey plus untrusted onchain storage. Only a credential-id hint and the public address are cached, and both are optional.
- **Stack composability:** Mera + sponsored gas + Envio HyperSync history + Chainlink CRE settlement.

### Mera: One Passkey, Many Keys
*How does your project meaningfully utilize Mera in non-account work?*

The same passkey PRF output feeds separate namespaces:
- BIP-39/44 → wallet key (account work).
- HKDF(salt "hunch", info "hunch/keyring/v1") → AES-256-GCM keyring key (non-account work).

**What the keyring key does.** It encrypts the user's keyring, `{ name, groups: [K₁, K₂, …] }`. Each K is a private group's key. The ciphertext is stored onchain (`Hunch.keyring(address)`).

**Each group key K derives its own isolated namespaces:**
- `sha256("hunch/group-id" ‖ K)`: the public group id;
- `keccak256("hunch/invite" ‖ K)`: an invite signer the contract checks on join;
- HKDF("hunch/content/v1"): the AES-GCM content key for group names, questions and member names.

**Nothing sensitive is persisted** to disk or server, and group keys travel only in URL fragments.

**Cross-device test:** sign in with the same synced passkey on a second device or fresh browser profile. The same keyring key decrypts the same onchain blob, and every private group's questions read in plain text again, live.

### Envio: Best Use of Envio
*How does your project meaningfully use Envio's HyperIndex, HyperSync or HyperRPC?*

HyperSync is Hunch's history layer. Without it the app can't show anything older than about 40 seconds, because the public Monad RPC caps `eth_getLogs` at 100 blocks.
- `app/api/rpc.ts` is a JSON-RPC shim. It translates the app's `eth_getLogs` calls, including raw topic filters on the indexed `groupId`, into HyperSync `/query` requests. It paginates via `next_block` up to `archive_height` and maps results back to standard RPC logs. It also caches briefly and retries on 429. The Envio token stays server-side.
- **Two topic-filtered queries per refresh** load a whole group:
  - groupId as topic1 covers GroupCreated, MemberJoined and GroupNote;
  - groupId as topic2 covers MarketCreated, BetPlaced, MarketResolved and Claimed.
- **The app derives from these events:**
  - the group feed and odds history;
  - membership and encrypted display names;
  - per-member leaderboards (P&L, hit rate, 👑);
  - claim state;
  - the live global stats strip on the landing page (groups, hunches, people, $ wagered).
- `scripts/stats.ts` uses the same pipeline for traction reporting.

### Chainlink: Best workflow with CRE
*How does your project meaningfully utilize Chainlink CRE as an orchestration layer?*

CRE is the only party that can settle Hunch's "price call" markets.
- **Markets:** `Hunch.createMarketWithResolver` assigns `HunchOracle` as the resolver, and the creator attaches a public rule (e.g. ethereum > $2,510). After that, neither the creator nor anyone else can settle it manually.
- **The workflow** (`cre/settle-wf/main.ts`, TypeScript SDK) runs on a cron:
  1. EVM read of `HunchOracle.due()` on Monad testnet, for closed, unsettled markets;
  2. HTTP fetch of each asset's USD price (CoinGecko), with **median consensus** across nodes;
  3. a signed report of `(marketIds[], prices[])`;
  4. `writeReport` through the Chainlink forwarder (`0xB9F7…d192`) to `HunchOracle.onReport` (forwarder-only), which applies each rule and calls `Hunch.resolve`.
- **Demonstrated** with `cre workflow simulate settle-wf --broadcast`. It settled live market #4 ("Will ETH be above $2,510?") at ETH $2,512.67 → YES, tx `0x892c85e1…5775a` on Monad testnet. See `cre/SIMULATION.md`.

### Best Community Team Project
*Which community does your team represent?* **[your campus group, e.g. Penn Blockchain]**. Make sure it's selected in your hackathon profile too.

## Optional
- 30s ad: cut the demo-video sequence of sign-up → bet → "settled in 0.4s" → Collect.
- X: [your handle]
