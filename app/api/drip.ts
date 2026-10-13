// Onboarding sponsor: tops a new Hunch account up with a little testnet MON for gas and sends it a
// one-time $50 AUSD starter balance (from Agora's testnet faucet), so a new user never sees a faucet
// or a gas prompt.
import { createPublicClient, createWalletClient, http, isAddress, parseAbi, parseEther, parseGwei, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const FEES = { maxFeePerGas: parseGwei("120"), maxPriorityFeePerGas: parseGwei("2") };
const GAS_TOPUP = parseEther("0.15");
const LOW_WATER = parseEther("0.05");
const STARTER = 50_000_000n; // $50, AUSD has 6 decimals
const AUSD_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
const erc20 = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const faucetAbi = parseAbi(["function requestFunds(address)"]);

type Req = { method?: string; body: unknown };
type Res = { status: (c: number) => Res; json: (b: unknown) => void };

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { address?: string };
  const to = body?.address;
  if (!to || !isAddress(to)) return res.status(400).json({ error: "bad address" });

  const ausd = process.env.VITE_USD as Hex;
  const account = privateKeyToAccount(process.env.DEPLOYER_PK as Hex);
  const pub = createPublicClient({ chain: monadTestnet, transport: http() });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });

  const [gas, usd, treasury] = await Promise.all([
    pub.getBalance({ address: to }),
    pub.readContract({ address: ausd, abi: erc20, functionName: "balanceOf", args: [to] }),
    pub.readContract({ address: ausd, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  ]);

  const hashes: Hex[] = [];
  let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
  if (gas < LOW_WATER) hashes.push(await wallet.sendTransaction({ to, value: GAS_TOPUP, nonce: nonce++, ...FEES }));
  // One starter grant per account: only fund accounts that have never held AUSD.
  if (usd === 0n && gas === 0n)
    hashes.push(await wallet.writeContract({ address: ausd, abi: erc20, functionName: "transfer", args: [to, STARTER], nonce: nonce++, ...FEES }));
  if (treasury < STARTER * 10n)
    await wallet
      .writeContract({ address: AUSD_FAUCET, abi: faucetAbi, functionName: "requestFunds", args: [account.address], nonce: nonce++, ...FEES })
      .catch(() => undefined); // faucet has a shared cooldown; refill opportunistically
  const receipts = await Promise.all(hashes.map((hash) => pub.waitForTransactionReceipt({ hash, pollingInterval: 250 })));
  // Monad validates gas against balances from a few blocks back, so a freshly funded account can't
  // send immediately. Hold the response until the top-up is old enough to spend.
  if (receipts.length) {
    const ready = receipts.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), 0n) + 4n;
    while ((await pub.getBlockNumber({ cacheTime: 0 })) < ready) await new Promise((r) => setTimeout(r, 200));
  }
  res.status(200).json({ ok: true, txs: hashes });
}
