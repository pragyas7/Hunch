// Traction snapshot for the submission: totals from Hunch's onchain history (via the app's HyperSync API).
// Usage: npx tsx scripts/stats.ts   (reads VITE_HUNCH / VITE_DEPLOY_BLOCK from .env.production)
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { monadTestnet } from "viem/chains";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.production", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => l.split("=")),
);
const HUNCH = env.VITE_HUNCH as Address;
const fromBlock = BigInt(env.VITE_DEPLOY_BLOCK);
const client = createPublicClient({ chain: monadTestnet, transport: http("https://hunch-neon.vercel.app/api/rpc") });
const abi = parseAbi([
  "event GroupCreated(bytes32 indexed groupId, address indexed creator, bytes encName)",
  "event MemberJoined(bytes32 indexed groupId, address indexed member)",
  "event MarketCreated(uint256 indexed marketId, bytes32 indexed groupId, address indexed creator, uint64 closesAt, bytes encQuestion)",
  "event BetPlaced(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, bool yes, uint256 amount)",
  "event MarketResolved(uint256 indexed marketId, bytes32 indexed groupId, uint8 outcome)",
  "event Claimed(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, uint256 payout)",
]);
const get = (eventName: (typeof abi)[number]["name"]) => client.getContractEvents({ address: HUNCH, abi, eventName, fromBlock });
const [groups, joins, markets, bets, resolved, claims] = await Promise.all(
  ["GroupCreated", "MemberJoined", "MarketCreated", "BetPlaced", "MarketResolved", "Claimed"].map((e) => get(e as never)),
);
const sum = (xs: { args: { amount?: bigint; payout?: bigint } }[], k: "amount" | "payout") =>
  xs.reduce((s, x) => s + (x.args[k] ?? 0n), 0n);
const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
const people = new Set(joins.map((j) => (j.args as { member: string }).member.toLowerCase()));
const bettors = new Set(bets.map((b) => (b.args as { bettor: string }).bettor.toLowerCase()));
console.log(`groups:            ${groups.length}`);
console.log(`people (members):  ${people.size}`);
console.log(`people who bet:    ${bettors.size}`);
console.log(`hunches:           ${markets.length}`);
console.log(`bets:              ${bets.length}`);
console.log(`wagered:           ${usd(sum(bets as never, "amount"))}`);
console.log(`settled hunches:   ${resolved.length}`);
console.log(`paid out:          ${usd(sum(claims as never, "payout"))}`);
console.log(`total onchain txs: ${groups.length + joins.length + markets.length + bets.length + resolved.length + claims.length}+`);
