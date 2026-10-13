// Hunch auto-settlement workflow (Chainlink CRE).
//
// Every 30s: read HunchOracle.due() on Monad testnet → for each market whose betting has closed, fetch the
// asset's USD price from CoinGecko (median consensus across DON nodes) → sign a report of
// (marketIds, prices) → deliver it through the Chainlink forwarder to HunchOracle.onReport, which checks each
// market's public rule and settles it on Hunch. Nobody in the friend group can override the result.
import {
  bytesToHex, consensusMedianAggregation, CronCapability, EVMClient, encodeCallMsg, getNetwork, handler,
  HTTPClient, type HTTPSendRequester, LATEST_BLOCK_NUMBER, ok, prepareReportRequest, Runner, type Runtime,
  text, TxStatus,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { z } from "zod";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  oracleAddress: z.string(),
  priceApi: z.string(),
  gasLimit: z.string(),
});
type Config = z.infer<typeof configSchema>;

const oracleAbi = parseAbi(["function due() view returns (uint256[] ids, string[] assets)"]);

const fetchPrice = (req: HTTPSendRequester, url: string, asset: string): number => {
  const res = req.sendRequest({ url: url + asset, method: "GET" }).result();
  if (!ok(res)) throw new Error(`price API HTTP ${res.statusCode}`);
  const usd = JSON.parse(text(res))?.[asset]?.usd;
  if (typeof usd !== "number") throw new Error(`no price for ${asset}`);
  return usd;
};

const onCron = (runtime: Runtime<Config>) => {
  const cfg = runtime.config;
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: true });
  if (!net) throw new Error("network not found");
  const evm = new EVMClient(net.chainSelector.selector);

  // 1) Which oracle markets have closed and still need a price?
  const read = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: cfg.oracleAddress as Address,
        data: encodeFunctionData({ abi: oracleAbi, functionName: "due" }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const [ids, assets] = decodeFunctionResult({ abi: oracleAbi, functionName: "due", data: bytesToHex(read.data) });
  if (ids.length === 0) {
    runtime.log("no hunches due");
    return "idle";
  }
  runtime.log(`${ids.length} hunch(es) due: ${ids.join(", ")}`);

  // 2) One price per distinct asset, each agreed by median consensus across nodes.
  const http = new HTTPClient();
  const priceOf = new Map<string, bigint>();
  for (const asset of new Set(assets)) {
    const usd = http.sendRequest(runtime, fetchPrice, consensusMedianAggregation())(cfg.priceApi, asset).result();
    priceOf.set(asset, BigInt(Math.round(usd * 1e8)));
    runtime.log(`${asset} = $${usd}`);
  }

  // 3) Signed report → forwarder → HunchOracle.onReport → Hunch.resolve
  const payload = encodeAbiParameters(
    [{ type: "uint256[]" }, { type: "uint256[]" }],
    [[...ids], assets.map((a) => priceOf.get(a)!)],
  );
  const report = runtime.report(prepareReportRequest(payload)).result();
  const tx = evm.writeReport(runtime, { receiver: cfg.oracleAddress, report, gasConfig: { gasLimit: cfg.gasLimit } }).result();
  if (tx.txStatus !== TxStatus.SUCCESS) throw new Error(`write failed: ${tx.errorMessage ?? tx.txStatus}`);
  const hash = bytesToHex(tx.txHash ?? new Uint8Array(32));
  runtime.log(`settled ${ids.length} hunch(es) in tx ${hash}`);
  return hash;
};

const initWorkflow = (cfg: Config) => [handler(new CronCapability().trigger({ schedule: cfg.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
main();
