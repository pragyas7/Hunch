// End-to-end smoke test against Monad testnet with two throwaway accounts (no passkeys):
// create group → join via invite signature → post encrypted question → bet both sides → settle → claim.
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, type Hex, type Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { groupKeys, inviteSigner, newGroupSecret, open, seal, signInvite } from "../src/lib/crypto";

const HUNCH = process.env.VITE_HUNCH as Address;
const AUSD = process.env.VITE_USD as Address;
const abi = parseAbi([
  "function createGroup(bytes32,address,bytes)", "function joinGroup(bytes32,bytes)", "function post(bytes32,bytes)",
  "function createMarket(bytes32,uint64,bytes) returns (uint256)", "function bet(uint256,bool,uint256)",
  "function resolve(uint256,uint8)", "function claim(uint256)", "function marketCount() view returns (uint256)",
  "function payoutOf(uint256,address) view returns (uint256)",
  "event MarketCreated(uint256 indexed marketId, bytes32 indexed groupId, address indexed creator, uint64 closesAt, bytes encQuestion)",
  "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PK as Hex);
const w = (pk: Hex) => createWalletClient({ account: privateKeyToAccount(pk), chain: monadTestnet, transport: http() });
const wait = async (h: Promise<Hex>) => {
  const t = Date.now();
  const r = await pub.waitForTransactionReceipt({ hash: await h, pollingInterval: 200 });
  if (r.status !== "success") throw new Error("reverted");
  return Date.now() - t;
};

const [a, b] = [generatePrivateKey(), generatePrivateKey()];
const A = w(a), B = w(b), D = w(process.env.DEPLOYER_PK as Hex);
for (const x of [A, B]) {
  await wait(D.sendTransaction({ to: x.account.address, value: parseEther("0.15") }));
  await wait(D.writeContract({ address: AUSD, abi, functionName: "transfer", args: [x.account.address, 20_000_000n] }));
  await wait(x.writeContract({ address: AUSD, abi, functionName: "approve", args: [HUNCH, 2n ** 255n] }));
}
const g = await groupKeys(newGroupSecret());
await wait(A.writeContract({ address: HUNCH, abi, functionName: "createGroup", args: [g.groupId, inviteSigner(g), await seal(g.content, "e2e crew")] }));
await wait(B.writeContract({ address: HUNCH, abi, functionName: "joinGroup", args: [g.groupId, await signInvite(g, B.account.address)] }));
await wait(B.writeContract({ address: HUNCH, abi, functionName: "post", args: [g.groupId, await seal(g.content, JSON.stringify({ t: "name", v: "Bob" }))] }));
const q = "Will the e2e test pass?";
const from = await pub.getBlockNumber();
await wait(A.writeContract({ address: HUNCH, abi, functionName: "createMarket", args: [g.groupId, BigInt(Math.floor(Date.now() / 1000) + 3600), await seal(g.content, q)] }));
const [log] = await pub.getContractEvents({ address: HUNCH, abi, eventName: "MarketCreated", args: { groupId: g.groupId }, fromBlock: from });
const id = log.args.marketId!;
console.log("decrypted question:", await open(g.content, log.args.encQuestion!));
const tBet = await wait(A.writeContract({ address: HUNCH, abi, functionName: "bet", args: [id, true, 5_000_000n] }));
await wait(B.writeContract({ address: HUNCH, abi, functionName: "bet", args: [id, false, 15_000_000n] }));
await wait(A.writeContract({ address: HUNCH, abi, functionName: "resolve", args: [id, 1] }));
console.log("A payout:", await pub.readContract({ address: HUNCH, abi, functionName: "payoutOf", args: [id, A.account.address] }));
await wait(A.writeContract({ address: HUNCH, abi, functionName: "claim", args: [id] }));
console.log("A balance:", await pub.readContract({ address: AUSD, abi, functionName: "balanceOf", args: [A.account.address] }), "bet confirmed in", tBet, "ms");
