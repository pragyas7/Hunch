// Creates a Chainlink price call in the demo group that closes in ~2 minutes, so a CRE simulation run has a
// live market to settle on camera. Uses a fresh throwaway member funded by the deployer.
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseGwei, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { codeToSecret, groupKeys, seal, signInvite } from "../src/lib/crypto";

const DEMO_CODE = "lujIxgEdoSIjCqVl3G-RTqD-xPt8whQ0xw6dCMQM4Ck";
const HUNCH = process.env.VITE_HUNCH as Address;
const ORACLE = process.env.VITE_ORACLE as Address;
const AUSD = process.env.VITE_USD as Address;
const fees = { maxFeePerGas: parseGwei("120"), maxPriorityFeePerGas: parseGwei("2") };
const abi = parseAbi([
  "function joinGroup(bytes32,bytes)", "function post(bytes32,bytes)",
  "function createMarketWithResolver(bytes32,uint64,bytes,address) returns (uint256)", "function marketCount() view returns (uint256)",
  "function setRule(uint256,string,uint256,bool)", "function bet(uint256,bool,uint256)",
  "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
]);
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const D = createWalletClient({ account: privateKeyToAccount(process.env.DEPLOYER_PK as Hex), chain: monadTestnet, transport: http() });
const A = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: monadTestnet, transport: http() });
const wait = async (h: Promise<Hex>) => {
  const r = await pub.waitForTransactionReceipt({ hash: await h, pollingInterval: 200 });
  if (r.status !== "success") throw new Error("reverted");
};

await wait(D.sendTransaction({ to: A.account.address, value: parseEther("0.15"), ...fees }));
await wait(D.writeContract({ address: AUSD, abi, functionName: "transfer", args: [A.account.address, 10_000_000n], ...fees }));
await new Promise((r) => setTimeout(r, 2500));
const g = await groupKeys(codeToSecret(DEMO_CODE));
await wait(A.writeContract({ address: AUSD, abi, functionName: "approve", args: [HUNCH, 2n ** 255n], ...fees }));
await wait(A.writeContract({ address: HUNCH, abi, functionName: "joinGroup", args: [g.groupId, await signInvite(g, A.account.address)], ...fees }));
await wait(A.writeContract({ address: HUNCH, abi, functionName: "post", args: [g.groupId, await seal(g.content, JSON.stringify({ t: "name", v: "Nia" }))], ...fees }));
const btc = (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")).json()).bitcoin.usd as number;
const strike = Math.round(btc / 100) * 100;
const q = `Will BTC be above $${strike.toLocaleString()} when betting closes?`;
const id = await pub.readContract({ address: HUNCH, abi, functionName: "marketCount" });
await wait(A.writeContract({ address: HUNCH, abi, functionName: "createMarketWithResolver", args: [g.groupId, BigInt(Math.floor(Date.now() / 1000) + 120), await seal(g.content, q), ORACLE], ...fees }));
await wait(A.writeContract({ address: ORACLE, abi, functionName: "setRule", args: [id, "bitcoin", BigInt(strike) * 100_000_000n, true], ...fees }));
await wait(A.writeContract({ address: HUNCH, abi, functionName: "bet", args: [id, true, 3_000_000n], ...fees }));
console.log(`market #${id}: "${q}" closes in ~2 min`);
