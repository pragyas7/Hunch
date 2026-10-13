// Read-only JSON-RPC shim backed by Envio HyperSync. The public Monad RPC caps eth_getLogs at a
// 100-block range; HyperSync serves the contract's full history in one paginated query. The app's
// viem client points its history reads here, so eth_getLogs calls are translated to HyperSync queries.
// The Envio token stays server-side and only logs from the Hunch contract are served.
const HYPERSYNC = "https://monad-testnet.hypersync.xyz/query";
const RPC = "https://testnet-rpc.monad.xyz";

type Req = { method?: string; body: unknown };
type Res = { status: (c: number) => Res; json: (b: unknown) => void };
type Call = { id: number; jsonrpc: "2.0"; method: string; params?: any[] };
type HsLog = {
  block_number: number; log_index: number; transaction_index: number; transaction_hash: string; block_hash: string;
  address: string; data: string; topic0?: string | null; topic1?: string | null; topic2?: string | null; topic3?: string | null;
};

const hex = (n: number) => "0x" + n.toString(16);
const toBlock = async (tag: string | undefined): Promise<number | undefined> => {
  if (!tag || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") return undefined;
  return tag === "earliest" ? 0 : parseInt(tag, 16);
};

// Short-lived per-instance cache: many friends polling the same group share one HyperSync query.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const CACHE_MS = 2000;

async function hypersync(body: unknown) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(HYPERSYNC, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ENVIO_TOKEN}` },
      body: JSON.stringify(body),
    });
    if (r.status === 429 && attempt < 3) {
      await new Promise((res) => setTimeout(res, 300 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`hypersync ${r.status}`);
    return r.json();
  }
}

function getLogs(filter: any) {
  const key = JSON.stringify(filter);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = fetchLogs(filter);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 500) cache.clear();
  return value;
}

async function fetchLogs(filter: any) {
  const hunch = (process.env.VITE_HUNCH ?? "").toLowerCase();
  if (String(filter.address ?? "").toLowerCase() !== hunch) throw new Error("only Hunch logs are served");
  const topics = (filter.topics ?? []).map((t: string | string[] | null) => (t == null ? [] : Array.isArray(t) ? t : [t]));
  let from = (await toBlock(filter.fromBlock)) ?? 0;
  const to = await toBlock(filter.toBlock);
  const out: HsLog[] = [];
  for (let i = 0; i < 20; i++) {
    const page = (await hypersync({
        from_block: from,
        ...(to !== undefined ? { to_block: to + 1 } : {}),
        logs: [{ address: [hunch], topics }],
        field_selection: {
          log: ["block_number", "log_index", "transaction_index", "transaction_hash", "block_hash", "address", "data", "topic0", "topic1", "topic2", "topic3"],
        },
    })) as { data: { logs?: HsLog[] }[]; next_block: number; archive_height: number };
    for (const batch of page.data) out.push(...(batch.logs ?? []));
    if (page.next_block >= (to !== undefined ? to + 1 : page.archive_height) || page.next_block <= from) break;
    from = page.next_block;
  }
  return out.map((l) => ({
    address: l.address,
    topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter((t): t is string => !!t),
    data: l.data,
    blockNumber: hex(l.block_number),
    blockHash: l.block_hash,
    transactionHash: l.transaction_hash,
    transactionIndex: hex(l.transaction_index),
    logIndex: hex(l.log_index),
    removed: false,
  }));
}

async function handle(c: Call) {
  try {
    if (c.method === "eth_getLogs") return { jsonrpc: "2.0", id: c.id, result: await getLogs(c.params?.[0] ?? {}) };
    if (c.method === "eth_chainId" || c.method === "eth_blockNumber") {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      return await r.json();
    }
    return { jsonrpc: "2.0", id: c.id, error: { code: -32601, message: `${c.method} not served here` } };
  } catch (e) {
    return { jsonrpc: "2.0", id: c.id, error: { code: -32000, message: (e as Error).message } };
  }
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  res.status(200).json(Array.isArray(body) ? await Promise.all(body.map(handle)) : await handle(body as Call));
}
