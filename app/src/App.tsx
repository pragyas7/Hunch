import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import {
  cachedAddress, friendlyError, hasCredentialHint, logIn, signUp, forget, type Unlocked,
} from "./lib/account";
import { EXPLORER, fmtUsd } from "./lib/chain";
import { codeToSecret, secretToCode } from "./lib/crypto";
import {
  claimPayout, createGroup, createMarket, joinGroup, leaderboard, loadGroup, loadKeyring, loadMarkets,
  placeBet, resolveMarket, saveKeyring, sponsor, stakeOf, usdBalance,
  type Group, type Keyring, type Market,
} from "./lib/data";

type Toast = { kind: "busy" | "ok" | "err"; text: string; href?: string } | null;

const readJoinCode = () => {
  const m = location.hash.match(/join=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};

export default function App() {
  const [me, setMe] = useState<Unlocked | null>(null);
  const [keyring, setKeyring] = useState<Keyring | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [joinCode, setJoinCode] = useState<string | null>(readJoinCode());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /** Runs an onchain action with a toast that reports real settlement time. */
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setToast({ kind: "busy", text: label });
    const t0 = performance.now();
    try {
      const r = await fn();
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      setToast({ kind: "ok", text: `${done ?? "Done"} · settled in ${secs}s`, href: typeof r === "string" ? `${EXPLORER}/tx/${r}` : undefined });
      setTimeout(() => setToast((t) => (t?.kind === "ok" ? null : t)), 3500);
      return r;
    } catch (e) {
      setToast({ kind: "err", text: friendlyError(e) });
      if (friendlyError(e).includes("session ended")) setMe(null);
      return undefined;
    }
  }, []);

  const refreshBalance = useCallback(async (a: Address) => setBalance(await usdBalance(a)), []);

  const finishUnlock = useCallback(
    async (u: Unlocked, newName?: string) => {
      setMe(u);
      let k = await loadKeyring(u);
      if (!k) {
        await sponsor(u.address);
        k = { me: newName || "Friend", groups: [] };
        await saveKeyring(u, k);
      }
      setKeyring(k);
      refreshBalance(u.address);
      return k;
    },
    [refreshBalance],
  );

  // Accept a pending invite once we're unlocked.
  useEffect(() => {
    if (!me || !keyring || !joinCode) return;
    const code = joinCode;
    setJoinCode(null);
    history.replaceState(null, "", location.pathname);
    run("Joining group…", async () => {
      const { next } = await joinGroup(me, codeToSecret(code), keyring);
      setKeyring(next);
      setOpenGroup(next.groups.findIndex((g) => g.secret === codeToSecret(code)));
    }, "You're in");
  }, [me, keyring, joinCode, run]);

  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => refreshBalance(me.address), 5000);
    return () => clearInterval(t);
  }, [me, refreshBalance]);

  if (!me || !keyring)
    return (
      <Shell toast={toast}>
        <Onboarding
          inviting={!!joinCode}
          onSignUp={(name) => run("Setting up your account…", async () => { await finishUnlock(await signUp(name), name); }, "Welcome to Hunch")}
          onLogIn={() => run("Unlocking…", async () => { await finishUnlock(await logIn()); }, "Unlocked")}
        />
      </Shell>
    );

  const sessionLeft = Math.max(0, me.expiresAt - now);
  const group = openGroup !== null ? keyring.groups[openGroup] : null;

  return (
    <Shell toast={toast}>
      <header className="top">
        {group ? (
          <button className="ghost back" onClick={() => setOpenGroup(null)}>← Groups</button>
        ) : (
          <div className="brand">hunch<span>.</span></div>
        )}
        <div className="wallet" title={me.address}>
          <span className="bal">{balance === null ? "…" : fmtUsd(balance)}</span>
          <span className="who">{keyring.me}</span>
        </div>
      </header>
      {sessionLeft < 5 * 60 * 1000 && (
        <div className="banner">Session ends in {Math.ceil(sessionLeft / 60000)} min — you'll tap Face ID again after.</div>
      )}
      {group ? (
        <GroupView key={group.secret} entry={group} me={me} run={run} now={now} onMoney={() => refreshBalance(me.address)} />
      ) : (
        <Home
          keyring={keyring}
          onOpen={setOpenGroup}
          onCreate={(name) =>
            run("Creating group…", async () => {
              const { next } = await createGroup(me, name, keyring);
              setKeyring(next);
              setOpenGroup(next.groups.length - 1);
            }, "Group created")
          }
          onLogout={() => { me.end(); setMe(null); setKeyring(null); }}
          onForget={() => { me.end(); forget(); setMe(null); setKeyring(null); }}
        />
      )}
    </Shell>
  );
}

function Shell({ children, toast }: { children: React.ReactNode; toast: Toast }) {
  return (
    <div className="shell">
      {children}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.kind === "busy" && <span className="spin" />}
          <span>{toast.text}</span>
          {toast.href && <a href={toast.href} target="_blank" rel="noreferrer">receipt ↗</a>}
        </div>
      )}
    </div>
  );
}

// ---------------- onboarding ----------------

function Onboarding({ inviting, onSignUp, onLogIn }: { inviting: boolean; onSignUp: (n: string) => void; onLogIn: () => void }) {
  const returning = hasCredentialHint() || !!cachedAddress();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "back">(returning ? "back" : "new");
  return (
    <div className="onboard">
      <div className="brand big">hunch<span>.</span></div>
      <h1>Bet on your friends.<br /><em>Privately.</em></h1>
      <p className="lede">
        {inviting ? "You've been invited to a private group. " : ""}
        Make calls on what your friends will actually do. Only your group can see the bets, and payouts settle in under a second.
      </p>
      <div className="examples">
        <div className="chip">Will Sam make it to 8am lecture this week?</div>
        <div className="chip">Does Priya text him back by Friday?</div>
        <div className="chip">Jake finishes the half-marathon under 2h?</div>
      </div>
      {mode === "new" ? (
        <form className="card form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSignUp(name.trim()); }}>
          <label>What do your friends call you?</label>
          <input autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pragya" />
          <button className="primary" disabled={!name.trim()}>Continue with Face ID</button>
          <small>No app, no password, no seed phrase. You get $50 to start.</small>
          <button type="button" className="link" onClick={() => setMode("back")}>I already have Hunch</button>
        </form>
      ) : (
        <div className="card form">
          <button className="primary" onClick={onLogIn}>Unlock with Face ID</button>
          <small>Works on any device where your passkey is synced. Your groups and bets come with you.</small>
          <button type="button" className="link" onClick={() => setMode("new")}>New here? Create an account</button>
        </div>
      )}
    </div>
  );
}

// ---------------- home ----------------

function Home({ keyring, onOpen, onCreate, onLogout, onForget }: {
  keyring: Keyring; onOpen: (i: number) => void; onCreate: (n: string) => void; onLogout: () => void; onForget: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <main>
      <h2 className="section">Your groups</h2>
      {keyring.groups.length === 0 && (
        <div className="empty">No groups yet. Start one for your group chat, then drop the invite link in.</div>
      )}
      <div className="list">
        {keyring.groups.map((g, i) => (
          <button key={g.secret} className="card group-row" onClick={() => onOpen(i)}>
            <Avatar seed={g.secret} label={g.name} />
            <div>
              <div className="title">{g.name}</div>
              <div className="muted">🔒 End-to-end encrypted</div>
            </div>
            <span className="chev">›</span>
          </button>
        ))}
      </div>
      <form className="card form row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(name.trim()); setName(""); } }}>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="New group name, e.g. Quad 4B" />
        <button className="primary" disabled={!name.trim()}>Start</button>
      </form>
      <div className="foot">
        <button className="link" onClick={onLogout}>Lock</button>
        <button className="link" onClick={onForget}>Sign out of this device</button>
      </div>
    </main>
  );
}

// ---------------- group ----------------

type Run = <T>(label: string, fn: () => Promise<T>, done?: string) => Promise<T | undefined>;

function GroupView({ entry, me, run, now, onMoney }: {
  entry: Keyring["groups"][number]; me: Unlocked; run: Run; now: number; onMoney: () => void;
}) {
  const [group, setGroup] = useState<Group | null>(null);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [tab, setTab] = useState<"hunches" | "board">("hunches");
  const [composing, setComposing] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const g = await loadGroup(entry);
    const ms = await loadMarkets(g);
    if (!alive.current) return;
    setGroup(g);
    setMarkets(ms);
  }, [entry]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh]);

  const nameOf = useCallback(
    (a: Address) => (a.toLowerCase() === me.address.toLowerCase() ? "You" : group?.names.get(a.toLowerCase()) ?? a.slice(0, 6)),
    [group, me.address],
  );

  const invite = async () => {
    const url = `${location.origin}/#join=${secretToCode(entry.secret)}`;
    const text = `Join "${entry.name}" on Hunch — private bets on our group 👀`;
    if (navigator.share) await navigator.share({ title: "Hunch", text, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      alert("Invite link copied — paste it in your group chat.");
    }
  };

  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    await run(label, fn as () => Promise<string>, done);
    onMoney();
    refresh();
  };

  return (
    <main>
      <div className="group-head">
        <Avatar seed={entry.secret} label={entry.name} big />
        <div>
          <h2>{entry.name}</h2>
          <div className="faces">
            {group?.members.slice(0, 8).map((m) => <Avatar key={m} seed={m} label={nameOf(m)} small />)}
            <span className="muted">{group ? `${group.members.length} in` : "loading…"}</span>
          </div>
        </div>
        <button className="secondary" onClick={invite}>Invite</button>
      </div>

      <div className="tabs">
        <button className={tab === "hunches" ? "on" : ""} onClick={() => setTab("hunches")}>Hunches</button>
        <button className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>Leaderboard</button>
      </div>

      {tab === "hunches" ? (
        <>
          {composing ? (
            <Composer
              onCancel={() => setComposing(false)}
              onSubmit={(q, closesAt) => {
                setComposing(false);
                act("Posting hunch…", () => createMarket(me, group!, q, closesAt), "Hunch posted");
              }}
            />
          ) : (
            <button className="primary wide" disabled={!group} onClick={() => setComposing(true)}>+ New hunch</button>
          )}
          {markets === null && <div className="empty">Decrypting…</div>}
          {markets?.length === 0 && <div className="empty">Nothing yet. Post the first hunch — the more specific, the better.</div>}
          {markets?.map((m) => (
            <MarketCard key={String(m.id)} m={m} me={me.address} now={now} nameOf={nameOf}
              onBet={(yes, amt) => act(`Putting ${fmtUsd(amt)} on ${yes ? "YES" : "NO"}…`, () => placeBet(me, m.id, yes, amt), "Bet placed")}
              onResolve={(o) => act("Settling…", () => resolveMarket(me, m.id, o), "Settled")}
              onClaim={() => act("Collecting…", () => claimPayout(me, m.id), "Paid out")}
            />
          ))}
        </>
      ) : (
        <Board markets={markets ?? []} members={group?.members ?? []} nameOf={nameOf} />
      )}
    </main>
  );
}

const CLOSES = [
  { label: "1 hour", s: 3600 },
  { label: "Tonight", s: -1 },
  { label: "1 day", s: 86400 },
  { label: "1 week", s: 7 * 86400 },
];

function Composer({ onSubmit, onCancel }: { onSubmit: (q: string, closesAt: number) => void; onCancel: () => void }) {
  const [q, setQ] = useState("Will ");
  const [close, setClose] = useState(2);
  const closesAt = () => {
    const c = CLOSES[close];
    if (c.s > 0) return Math.floor(Date.now() / 1000) + c.s;
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  return (
    <form className="card form composer" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 5) onSubmit(q.trim(), closesAt()); }}>
      <textarea autoFocus rows={2} value={q} maxLength={140} onChange={(e) => setQ(e.target.value)} />
      <div className="seg">
        <span className="muted">Betting closes</span>
        {CLOSES.map((c, i) => (
          <button type="button" key={c.label} className={i === close ? "on" : ""} onClick={() => setClose(i)}>{c.label}</button>
        ))}
      </div>
      <small>🔒 Only group members can read this. You settle it once betting closes.</small>
      <div className="row">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={q.trim().length <= 5}>Post hunch</button>
      </div>
    </form>
  );
}

const AMOUNTS = [1, 5, 10, 25];

function MarketCard({ m, me, now, nameOf, onBet, onResolve, onClaim }: {
  m: Market; me: Address; now: number; nameOf: (a: Address) => string;
  onBet: (yes: boolean, amt: bigint) => void; onResolve: (o: 1 | 2 | 3) => void; onClaim: () => void;
}) {
  const [amt, setAmt] = useState(5);
  const total = m.yesPool + m.noPool;
  const yesPct = total === 0n ? 50 : Number((m.yesPool * 1000n) / total) / 10;
  const open = m.outcome === 0 && now / 1000 < m.closesAt;
  const mine = stakeOf(m, me);
  const isCreator = m.creator.toLowerCase() === me.toLowerCase();
  const a = BigInt(amt) * 1_000_000n;
  const preview = (yes: boolean) => {
    const side = (yes ? m.yesPool : m.noPool) + a;
    const stake = (yes ? mine.yes : mine.no) + a;
    return (stake * (total + a)) / side;
  };
  const payout = useMemo(() => {
    if (m.outcome === 0 || m.claimed.has(me.toLowerCase())) return 0n;
    if (m.outcome === 3) return mine.yes + mine.no;
    const win = m.outcome === 1 ? m.yesPool : m.noPool;
    const stake = m.outcome === 1 ? mine.yes : mine.no;
    return win === 0n ? 0n : (stake * total) / win;
  }, [m, me, mine.yes, mine.no, total]);

  return (
    <article className={`card market ${m.outcome ? "done" : ""}`}>
      <div className="meta">
        <span>{nameOf(m.creator)} asked</span>
        <span>{m.outcome ? "" : open ? `closes ${until(m.closesAt * 1000 - now)}` : "betting closed"}</span>
      </div>
      <h3>{m.question}</h3>
      {m.outcome !== 0 && (
        <div className={`verdict o${m.outcome}`}>{["", "YES", "NO", "VOID — refunded"][m.outcome]}</div>
      )}
      <div className="odds" aria-label={`${yesPct}% yes`}>
        <div className="yes" style={{ width: `${yesPct}%` }}><span>YES {Math.round(yesPct)}%</span></div>
        <div className="no"><span>NO {Math.round(100 - yesPct)}%</span></div>
      </div>
      <div className="meta">
        <span>{fmtUsd(total)} in the pot</span>
        <span>{new Set(m.bets.map((b) => b.bettor)).size} people in</span>
      </div>
      {(mine.yes > 0n || mine.no > 0n) && (
        <div className="mine">
          You: {mine.yes > 0n && <b className="y">{fmtUsd(mine.yes)} YES</b>} {mine.no > 0n && <b className="n">{fmtUsd(mine.no)} NO</b>}
        </div>
      )}
      {open && (
        <div className="betbox">
          <div className="seg">
            {AMOUNTS.map((x) => (
              <button key={x} className={x === amt ? "on" : ""} onClick={() => setAmt(x)}>${x}</button>
            ))}
          </div>
          <div className="row">
            <button className="yesbtn" onClick={() => onBet(true, a)}>YES<small>wins {fmtUsd(preview(true))}</small></button>
            <button className="nobtn" onClick={() => onBet(false, a)}>NO<small>wins {fmtUsd(preview(false))}</small></button>
          </div>
          <small className="muted">Payout is your share of the whole pot if you're right. It shifts as friends bet.</small>
        </div>
      )}
      {m.outcome === 0 && isCreator && (
        <div className="settle">
          <span className="muted">{open ? "Already know? Settle early:" : "Betting's closed. What happened?"}</span>
          <div className="row">
            <button className="yesbtn sm" onClick={() => onResolve(1)}>It happened</button>
            <button className="nobtn sm" onClick={() => onResolve(2)}>It didn't</button>
            <button className="ghost sm" onClick={() => onResolve(3)}>Call it off</button>
          </div>
        </div>
      )}
      {payout > 0n && <button className="primary wide" onClick={onClaim}>Collect {fmtUsd(payout)}</button>}
      {m.bets.length > 0 && (
        <ul className="feed">
          {m.bets.slice(-4).reverse().map((b, i) => (
            <li key={i}><Avatar seed={b.bettor} label={nameOf(b.bettor)} small /> {nameOf(b.bettor)} put {fmtUsd(b.amount)} on <b className={b.yes ? "y" : "n"}>{b.yes ? "YES" : "NO"}</b></li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Board({ markets, members, nameOf }: { markets: Market[]; members: Address[]; nameOf: (a: Address) => string }) {
  const rows = leaderboard(markets, members);
  const settled = markets.filter((m) => m.outcome === 1 || m.outcome === 2).length;
  return (
    <div className="card board">
      <div className="muted">Across {settled} settled hunch{settled === 1 ? "" : "es"}</div>
      {rows.map((r, i) => (
        <div className="brow" key={r.address}>
          <span className="rank">{i === 0 && r.pnl > 0n ? "👑" : i + 1}</span>
          <Avatar seed={r.address} label={nameOf(r.address)} small />
          <span className="bname">{nameOf(r.address)}</span>
          <span className="muted">{r.calls ? `${r.wins}/${r.calls} right` : "—"}</span>
          <span className={r.pnl > 0n ? "y" : r.pnl < 0n ? "n" : "muted"}>
            {r.pnl > 0n ? "+" : r.pnl < 0n ? "−" : ""}{fmtUsd(r.pnl < 0n ? -r.pnl : r.pnl)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Avatar({ seed, label, small, big }: { seed: string; label: string; small?: boolean; big?: boolean }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className={`av ${small ? "s" : ""} ${big ? "b" : ""}`} style={{ background: `hsl(${h % 360} 70% 62%)` }} title={label}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function until(ms: number) {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m || 1}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
