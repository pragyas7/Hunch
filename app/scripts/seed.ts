// Seeds a public demo group for judges: a few named member accounts, live markets with bets, and one
// settled market so the leaderboard has data. Prints the invite link.
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseGwei, type Hex, type Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { groupKeys, inviteSigner, newGroupSecret, seal, secretToCode, signInvite } from "../src/lib/crypto";

const HUNCH = process.env.VITE_HUNCH as Address;
const AUSD = process.env.VITE_USD as Address;
const abi = parseAbi([
  "function createGroup(bytes32,address,bytes)", "function joinGroup(bytes32,bytes)", "function post(bytes32,bytes)",
  "function createMarket(bytes32,uint64,bytes) returns (uint256)", "function bet(uint256,bool,uint256)",
  "function resolve(uint256,uint8)", "function marketCount() view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
]);
const fees = { maxFeePerGas: parseGwei("120"), maxPriorityFeePerGas: parseGwei("2") };
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const D = createWalletClient({ account: privateKeyToAccount(process.env.DEPLOYER_PK as Hex), chain: monadTestnet, transport: http() });
const wait = async (h: Promise<Hex>) => {
  const r = await pub.waitForTransactionReceipt({ hash: await h, pollingInterval: 200 });
  if (r.status !== "success") throw new Error("reverted");
};

const names = ["Maya", "Leo", "Priya", "Sam"];
const people = names.map((name) => ({ name, w: createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: monadTestnet, transport: http() }) }));
for (const p of people) {
  await wait(D.sendTransaction({ to: p.w.account.address, value: parseEther("0.2"), ...fees }));
  await wait(D.writeContract({ address: AUSD, abi, functionName: "transfer", args: [p.w.account.address, 50_000_000n], ...fees }));
  await new Promise((r) => setTimeout(r, 2500)); // let the gas top-up become spendable
  await wait(p.w.writeContract({ address: AUSD, abi, functionName: "approve", args: [HUNCH, 2n ** 255n], ...fees }));
}
const secret = newGroupSecret();
const g = await groupKeys(secret);
const [maya, leo, priya, sam] = people;
await wait(maya.w.writeContract({ address: HUNCH, abi, functionName: "createGroup", args: [g.groupId, inviteSigner(g), await seal(g.content, "Metropolis Demo Crew")], ...fees }));
for (const p of people) {
  if (p !== maya) await wait(p.w.writeContract({ address: HUNCH, abi, functionName: "joinGroup", args: [g.groupId, await signInvite(g, p.w.account.address)], ...fees }));
  await wait(p.w.writeContract({ address: HUNCH, abi, functionName: "post", args: [g.groupId, await seal(g.content, JSON.stringify({ t: "name", v: p.name }))], ...fees }));
}
const now = Math.floor(Date.now() / 1000);
const market = async (by: typeof maya, q: string, closes: number) => {
  const id = await pub.readContract({ address: HUNCH, abi, functionName: "marketCount" });
  await wait(by.w.writeContract({ address: HUNCH, abi, functionName: "createMarket", args: [g.groupId, BigInt(closes), await seal(g.content, q)], ...fees }));
  return id;
};
const bet = (p: typeof maya, id: bigint, yes: boolean, usd: number) =>
  wait(p.w.writeContract({ address: HUNCH, abi, functionName: "bet", args: [id, yes, BigInt(usd) * 1_000_000n], ...fees }));

const m0 = await market(leo, "Will Leo actually go to the 7am gym session he keeps talking about?", now + 3600 * 6);
await bet(maya, m0, false, 5); await bet(priya, m0, false, 3); await bet(sam, m0, true, 2);
await wait(leo.w.writeContract({ address: HUNCH, abi, functionName: "resolve", args: [m0, 2], ...fees }));
const m1 = await market(maya, "Will Sam submit the hackathon project before 11:59pm?", now + 3600 * 5);
await bet(leo, m1, true, 10); await bet(priya, m1, false, 4); await bet(maya, m1, true, 5);
const m2 = await market(priya, "Does the group chat agree on a restaurant in under 20 messages?", now + 86400);
await bet(sam, m2, false, 8); await bet(leo, m2, true, 2);
const m3 = await market(sam, "Will a Metropolis judge bet on this market?", now + 7 * 86400);
await bet(maya, m3, true, 1);
console.log(`https://hunch-neon.vercel.app/#join=${secretToCode(secret)}`);
