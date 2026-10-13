# Hunch: submission kit

**Live:** https://hunch-neon.vercel.app · **Repo:** https://github.com/pragyas7/Hunch (share with metropolis@hackathon.monad.xyz)
**Judge access:** open the link on a phone (iOS Safari / Android Chrome, or Mac Safari with iCloud Keychain). Sign up with Face ID. No credentials needed: each new account gets gas and $50 of testnet AUSD.
**Demo group for judges** (pre-seeded with members, live markets and a settled one; tap after signing up):
https://hunch-neon.vercel.app/#join=hPbUucHjuJQfoBn2pU5ugj2rcqZfTYQwceJOWKABAJc

**Tagline:** Private prediction markets for your group chat.

## Where to submit

| Bounty | Why we qualify |
|---|---|
| **Track: Social, Attention & Culture** (primary; Consumer Products is the alternate) | The core value is group fun and social stakes. Calling it right turns into real economic stake, and the leaderboard is social status. |
| **Mera: Best Mera-Powered UX** | Mera is the entire account layer: one passkey ceremony, no seed phrase or extension, sponsored gas, an in-memory session scoped to two contracts with a 30-minute expiry. Passes the stateless test. |
| **Mera: One Passkey, Many Keys** | A PRF-derived HKDF namespace (`hunch/keyring/v1`) encrypts the user's group-key keyring, which is stored onchain. On a fresh device the same passkey decrypts every private group live. |
| **Envio: Best Use of Envio** | HyperSync is the app's history layer. `/api/rpc` translates eth_getLogs calls into paginated, topic-filtered HyperSync queries, and the feed, member names and leaderboard are derived from it. |
| **Best Community Team Project** | Fill in your campus group on your profile. |

---

## Answers to the submission questions

**Describe your project (general).**
Hunch lets friend groups make private prediction markets about each other: "Will Sam make 8am lecture?", "Does Jake finish the half under 2h?". You sign up with Face ID, start a group, and drop the invite link in your group chat. Friends bet in dollars (AUSD), the creator settles, and winners collect instantly. Everything is onchain on Monad, but the group name, questions and member names are end-to-end encrypted: the chain only stores ciphertext, and the group key travels only in the invite link's URL fragment. Monad's sub-second finality is what makes it feel like a chat app rather than a crypto app: bets confirm in about 350 ms.

**Who is the user / why would they move from existing platforms?**
College friend groups and group chats, starting with our campus community. They already bet on each other informally through Venmo, IOUs and screenshots, and settling up is where it breaks. Public prediction markets can't host private, tiny, personal questions. Hunch is the first place these bets can live, with settlement handled automatically.

**Traction & path forward.**
*(Fill in after tonight's tests: number of friends onboarded, groups, markets, bets, total AUSD wagered. Every tx is on the Monad testnet explorer.)*
- Next 100 users: invite links spread inside existing group chats. We seed 5 dorm floors and 5 club group chats at Penn, then run a "hunch of the week" campus account.
- Retention loop: weekly leaderboard per group, and "settle now" push notifications.
- Next step: an iMessage mini-app, plus disputes via a stake-weighted group vote.

**Mera: how is Mera the entire account layer?**
- One passkey ceremony (`createPasskeyWithPrfOutput`) creates the account. The PRF output is turned into an EOA via BIP-39/44.
- No seed phrase, extension or custody backend; a sponsor endpoint funds gas.
- Signing runs in a Mera `Secp256k1SigningSession` held only in memory:
  - prompt-free for in-app actions;
  - scoped to the Hunch and AUSD contracts (anything else is blocked);
  - auto-expires after 30 minutes, with a warning in the last 5 and a single Face ID tap to resume;
  - ends immediately on Lock or Sign out.
- **Stateless test:** clear storage or use a new device, tap "I already have Hunch", and Face ID rebuilds the account, groups, decrypted questions and names. Everything comes from the passkey plus onchain ciphertext.

**Mera: non-account use of PRF key material.**
The passkey PRF output feeds two namespaces:
- BIP-39 → wallet key (account work).
- HKDF(info=`hunch/keyring/v1`) → AES-256-GCM keyring key (non-account work).

The keyring key encrypts the user's list of group keys, and that ciphertext lives onchain (`Hunch.keyring(address)`). Group keys in turn derive their own namespaces: the content key (HKDF `hunch/content/v1`), the invite signer (keccak `hunch/invite`) and the group id. Nothing sensitive is persisted. Cross-device demo: sign out, open on a second device or profile with the same synced passkey, and the same keyring decrypts, so every private group's questions read in plain text again.

**Envio: how does HyperSync drive a feature?**
- The public Monad RPC limits `eth_getLogs` to 100 blocks (about 40 seconds), so without Envio the app couldn't show anything older than that.
- `app/api/rpc.ts` is a JSON-RPC shim. It translates the viem client's `eth_getLogs` (address and topic filters, including the indexed `groupId`) into HyperSync `/query` calls, paginates via `next_block` up to `archive_height`, and maps results back to RPC log objects. The Envio token stays server-side.
- These events drive:
  - the group feed (`MarketCreated`, `BetPlaced`, `Claimed`);
  - membership and display names (`MemberJoined`, `GroupNote`);
  - per-group leaderboard aggregation (P&L and hit rate per member across settled markets).

---

## Demo video script (≤ 3 min, must show the live product)

Record the phone screen (iOS screen recording). Use two phones, or a phone plus Mac Safari, for the second friend.

1. **0:00 Hook.** "This is our group chat. We bet on each other constantly and nobody ever pays up. Here's Hunch."
2. **0:10 Sign up.** Type a name, tap Continue with Face ID, and land on $50.00. Say: "No wallet, no seed phrase. That's a Mera passkey, and the app sponsored gas and gave me $50 of AUSD."
3. **0:30 Start a group.** Create "Quad 4B", tap Invite, and paste the link into iMessage. Say: "The group key is in the link's #fragment. It never touches a server or the chain."
4. **0:50 Friend joins.** Tap the link on phone 2, Face ID, "You're in".
5. **1:05 Post a hunch.** "Will Sam make it to 8am lecture this week?" Point out the 🔒: "On the explorer this is just ciphertext." Show the tx on the explorer.
6. **1:25 Bets.** Phone 1 bets $10 YES, phone 2 bets $5 NO. Show the toast "settled in 0.4s", the odds bar moving, the feed and the payout preview.
7. **1:50 Settle and collect.** "It happened", then Collect $15. Show the balance update and the leaderboard 👑.
8. **2:15 Stateless test.** Sign out of this device, choose "I already have Hunch", Face ID. Groups and questions come back decrypted. "Your passkey is the only key. Your groups follow you to any device."
9. **2:40 Close.** "Private markets, public settlement, invisible chain. Hunch."

## Pitch video script (≤ 2 min)

- **Who (10s):** "Hi, we're [names], students at Penn and members of [campus group]."
- **Problem (25s):** "Every friend group runs a betting market. 'Bet you won't.' 'Who's buying if she says yes?' It lives in Venmo requests and screenshots, and half the time nobody pays. Polymarket can't host 'Does Priya text him back', and you'd never want those questions public."
- **Product (35s):** "Hunch is private prediction markets for your group chat. Sign up with Face ID, drop an invite link in the chat, and bet in dollars. Questions are end-to-end encrypted. Settlement is instant and automatic: when it's called, winners get paid."
- **Why now / why Monad (20s):** "This only feels right if it's instant and invisible. Monad settles bets in under half a second, and Mera passkeys mean no wallet, ever."
- **Traction and next (25s):** "Tonight [N] friends placed [M] real bets across [G] groups. Next: seed 10 Penn group chats, ship an iMessage mini-app, and add group-vote disputes."
- **Close (5s):** "Hunch. Call it before it happens."
