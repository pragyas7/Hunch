import { createPublicClient, encodeFunctionData, formatLog, http, maxUint256, parseEventLogs, toHex, type RpcLog, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { DEPLOY_BLOCK, HUNCH, ORACLE, USD, hunchAbi, oracleAbi, publicClient, usdAbi } from "./chain";
import { groupKeys, inviteSigner, newGroupSecret, open, seal, signInvite, type GroupKeys } from "./crypto";
import type { Unlocked } from "./account";

/** Historical reads go through Envio HyperRPC (via /api/rpc); the public RPC only serves 100 blocks of logs. */
const history = createPublicClient({ chain: monadTestnet, transport: http("/api/rpc") });

export type KeyringEntry = { secret: Hex; name: string };
export type Keyring = { me: string; groups: KeyringEntry[] };
export type Group = GroupKeys & { name: string; members: Address[]; creator: Address; names: Map<string, string> };
export type Bet = { bettor: Address; yes: boolean; amount: bigint; block: bigint };
export type Market = {
  id: bigint;
  groupId: Hex;
  creator: Address;
  closesAt: number;
  outcome: 0 | 1 | 2 | 3;
  yesPool: bigint;
  noPool: bigint;
  question: string;
  bets: Bet[];
  claimed: Set<string>;
  oracle?: { asset: string; threshold: bigint; above: boolean };
};

export type OracleRule = { asset: string; threshold: number; above: boolean };

// ---------- keyring (group keys wrapped under the passkey-derived key, stored onchain) ----------

export async function loadKeyring(u: Unlocked): Promise<Keyring | null> {
  const blob = await publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "keyring", args: [u.address] });
  if (!blob || blob === "0x") return null;
  return JSON.parse(await open(u.keyringKey, blob));
}

export async function saveKeyring(u: Unlocked, k: Keyring) {
  const blob = await seal(u.keyringKey, JSON.stringify(k));
  await u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "setKeyring", args: [blob] }) });
}

// ---------- public stats (aggregate only — no group content) ----------

export async function globalStats() {
  const base = { address: HUNCH, abi: hunchAbi, fromBlock: DEPLOY_BLOCK } as const;
  const [groups, joins, markets, bets] = await Promise.all([
    history.getContractEvents({ ...base, eventName: "GroupCreated" }),
    history.getContractEvents({ ...base, eventName: "MemberJoined" }),
    history.getContractEvents({ ...base, eventName: "MarketCreated" }),
    history.getContractEvents({ ...base, eventName: "BetPlaced" }),
  ]);
  return {
    groups: groups.length,
    people: new Set(joins.map((j) => j.args.member!.toLowerCase())).size,
    hunches: markets.length,
    bets: bets.length,
    wagered: bets.reduce((s, b) => s + b.args.amount!, 0n),
  };
}

// ---------- onboarding ----------

export async function sponsor(address: Address) {
  const r = await fetch("/api/drip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!r.ok) throw new Error("Couldn't set up your account — try again in a moment.");
}

export const usdBalance = (a: Address) =>
  publicClient.readContract({ address: USD, abi: usdAbi, functionName: "balanceOf", args: [a] });

// ---------- groups ----------

async function postName(u: Unlocked, g: GroupKeys, me: string) {
  const note = await seal(g.content, JSON.stringify({ t: "name", v: me }));
  await u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "post", args: [g.groupId, note] }) });
}

export async function createGroup(u: Unlocked, name: string, keyring: Keyring) {
  const secret = newGroupSecret();
  const g = await groupKeys(secret);
  const encName = await seal(g.content, name);
  await u.send({
    to: HUNCH,
    data: encodeFunctionData({ abi: hunchAbi, functionName: "createGroup", args: [g.groupId, inviteSigner(g), encName] }),
  });
  await postName(u, g, keyring.me);
  const next = { ...keyring, groups: [...keyring.groups, { secret, name }] };
  await saveKeyring(u, next);
  return { secret, next };
}

export async function joinGroup(u: Unlocked, secret: Hex, keyring: Keyring) {
  const g = await groupKeys(secret);
  const info = await publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "groups", args: [g.groupId] });
  if (info[0] === "0x0000000000000000000000000000000000000000") throw new Error("This invite link isn't valid.");
  const member = await publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "isMember", args: [g.groupId, u.address] });
  if (!member) {
    const sig = await signInvite(g, u.address);
    await u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "joinGroup", args: [g.groupId, sig] }) });
    await postName(u, g, keyring.me);
  }
  const created = await history.getContractEvents({
    address: HUNCH, abi: hunchAbi, eventName: "GroupCreated", args: { groupId: g.groupId }, fromBlock: DEPLOY_BLOCK,
  });
  const name = created[0] ? await open(g.content, created[0].args.encName!) : "Group";
  if (keyring.groups.some((k) => k.secret === secret)) return { name, next: keyring };
  const next = { ...keyring, groups: [...keyring.groups, { secret, name }] };
  await saveKeyring(u, next);
  return { name, next };
}

/** eth_getLogs with a raw topic filter (viem's getLogs only builds topics from a single event). */
async function rawLogs(topics: (Hex | null)[]) {
  const logs = (await history.request({
    method: "eth_getLogs",
    params: [{ address: HUNCH, topics, fromBlock: toHex(DEPLOY_BLOCK) }],
  })) as RpcLog[];
  return logs.map((l) => formatLog(l));
}

const ruleCache = new Map<bigint, Market["oracle"] | null>();

/**
 * Everything a group screen needs, from two HyperSync queries: events where the groupId is the first indexed
 * topic (GroupCreated, MemberJoined, GroupNote) and where it's the second (market events). Contract state is
 * read in one multicall batch.
 */
export async function loadGroupState(entry: KeyringEntry, me?: Address): Promise<{ group: Group; markets: Market[] }> {
  const g = await groupKeys(entry.secret);
  const [asTopic1, asTopic2, info] = await Promise.all([
    rawLogs([null, g.groupId]),
    rawLogs([null, null, g.groupId]),
    publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "groups", args: [g.groupId] }),
  ]);
  const logs = parseEventLogs({ abi: hunchAbi, logs: [...asTopic1, ...asTopic2] });
  const of = <N extends (typeof logs)[number]["eventName"]>(name: N) =>
    logs.filter((l): l is Extract<(typeof logs)[number], { eventName: N }> => l.eventName === name);

  const names = new Map<string, string>();
  for (const n of of("GroupNote")) {
    try {
      const msg = JSON.parse(await open(g.content, n.args.encNote));
      if (msg.t === "name") names.set(n.args.author.toLowerCase(), String(msg.v).slice(0, 24));
    } catch { /* ignore undecryptable notes */ }
  }
  const group: Group = { ...g, name: entry.name, members: of("MemberJoined").map((l) => l.args.member), creator: info[0], names };

  const bets = of("BetPlaced");
  const claims = of("Claimed");
  const markets = await Promise.all(
    of("MarketCreated").map(async (l) => {
      const id = l.args.marketId;
      // Claim state comes from the contract so "Collect" disappears the moment the claim lands,
      // without waiting for the indexer to catch up.
      const [m, resolver, iClaimed] = await Promise.all([
        publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "markets", args: [id] }),
        ruleCache.has(id) ? Promise.resolve(null) : publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "resolverOf", args: [id] }),
        me ? publicClient.readContract({ address: HUNCH, abi: hunchAbi, functionName: "claimed", args: [id, me] }) : Promise.resolve(false),
      ]);
      if (!ruleCache.has(id)) {
        let rule: Market["oracle"] | null = null;
        if (ORACLE && resolver && resolver.toLowerCase() === ORACLE.toLowerCase()) {
          const r = await publicClient.readContract({ address: ORACLE, abi: oracleAbi, functionName: "rules", args: [id] });
          rule = r[0] ? { asset: r[0], threshold: r[1], above: r[2] } : null;
        }
        // Rules are immutable once set; don't cache an oracle market whose rule hasn't landed yet.
        if (rule || !ORACLE || resolver?.toLowerCase() !== ORACLE.toLowerCase()) ruleCache.set(id, rule);
      }
      let question = "🔒 (couldn't decrypt)";
      try {
        question = await open(g.content, l.args.encQuestion);
      } catch { /* wrong key — leave placeholder */ }
      return {
        id,
        groupId: g.groupId,
        creator: m[1],
        closesAt: Number(m[2]),
        outcome: m[3] as Market["outcome"],
        yesPool: m[4],
        noPool: m[5],
        question,
        bets: bets
          .filter((b) => b.args.marketId === id)
          .map((b) => ({ bettor: b.args.bettor, yes: b.args.yes, amount: b.args.amount, block: b.blockNumber })),
        claimed: new Set([
          ...claims.filter((c) => c.args.marketId === id).map((c) => c.args.bettor.toLowerCase()),
          ...(iClaimed && me ? [me.toLowerCase()] : []),
        ]),
        oracle: ruleCache.get(id) ?? undefined,
      } satisfies Market;
    }),
  );
  return { group, markets: markets.sort((a, b) => Number(b.id - a.id)) };
}

export async function createMarket(u: Unlocked, g: Group, question: string, closesAt: number, rule?: OracleRule) {
  const enc = await seal(g.content, question);
  if (!rule || !ORACLE) {
    await u.send({
      to: HUNCH,
      data: encodeFunctionData({ abi: hunchAbi, functionName: "createMarket", args: [g.groupId, BigInt(closesAt), enc] }),
    });
    return;
  }
  const hash = await u.send({
    to: HUNCH,
    data: encodeFunctionData({ abi: hunchAbi, functionName: "createMarketWithResolver", args: [g.groupId, BigInt(closesAt), enc, ORACLE] }),
  });
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const [created] = parseEventLogs({ abi: hunchAbi, eventName: "MarketCreated", logs: receipt.logs });
  const id = created.args.marketId;
  await u.send({
    to: ORACLE,
    data: encodeFunctionData({
      abi: oracleAbi, functionName: "setRule",
      args: [id, rule.asset, BigInt(Math.round(rule.threshold * 1e8)), rule.above],
    }),
  });
}

export async function placeBet(u: Unlocked, id: bigint, yes: boolean, amount: bigint) {
  const allowance = await publicClient.readContract({ address: USD, abi: usdAbi, functionName: "allowance", args: [u.address, HUNCH] });
  if (allowance < amount)
    await u.send({ to: USD, data: encodeFunctionData({ abi: usdAbi, functionName: "approve", args: [HUNCH, maxUint256] }) });
  await u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "bet", args: [id, yes, amount] }) });
}

export const resolveMarket = (u: Unlocked, id: bigint, outcome: 1 | 2 | 3) =>
  u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "resolve", args: [id, outcome] }) });

export const claimPayout = (u: Unlocked, id: bigint) =>
  u.send({ to: HUNCH, data: encodeFunctionData({ abi: hunchAbi, functionName: "claim", args: [id] }) });

/** What `who` would get back if the market resolved `yes` right now (parimutuel). */
export function payoutIf(m: Market, who: Address, yes: boolean): bigint {
  const mine = m.bets.filter((b) => b.bettor.toLowerCase() === who.toLowerCase() && b.yes === yes).reduce((s, b) => s + b.amount, 0n);
  const side = yes ? m.yesPool : m.noPool;
  return side === 0n ? 0n : (mine * (m.yesPool + m.noPool)) / side;
}

export function stakeOf(m: Market, who: Address) {
  let yes = 0n, no = 0n;
  for (const b of m.bets) if (b.bettor.toLowerCase() === who.toLowerCase()) b.yes ? (yes += b.amount) : (no += b.amount);
  return { yes, no };
}

/** Group leaderboard: net profit across resolved markets + hit rate. */
export function leaderboard(markets: Market[], members: Address[]) {
  const rows = new Map(members.map((a) => [a.toLowerCase(), { address: a, pnl: 0n, wins: 0, calls: 0 }]));
  for (const m of markets) {
    if (m.outcome !== 1 && m.outcome !== 2) continue;
    const yesWon = m.outcome === 1;
    const total = m.yesPool + m.noPool;
    const win = yesWon ? m.yesPool : m.noPool;
    const per = new Map<string, { yes: bigint; no: bigint }>();
    for (const b of m.bets) {
      const k = b.bettor.toLowerCase();
      const s = per.get(k) ?? { yes: 0n, no: 0n };
      b.yes ? (s.yes += b.amount) : (s.no += b.amount);
      per.set(k, s);
    }
    for (const [k, s] of per) {
      const r = rows.get(k);
      if (!r) continue;
      const winStake = yesWon ? s.yes : s.no;
      const payout = win === 0n ? 0n : (winStake * total) / win;
      r.pnl += payout - s.yes - s.no;
      r.calls += 1;
      if (winStake > 0n) r.wins += 1;
    }
  }
  return [...rows.values()].sort((a, b) => (b.pnl > a.pnl ? 1 : b.pnl < a.pnl ? -1 : b.wins - a.wins));
}
