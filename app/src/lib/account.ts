import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createWalletClient, http, nonceManager, parseGwei, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { HUNCH, ORACLE, USD, publicClient } from "./chain";
import { deriveKeyringKey } from "./crypto";

const CRED_KEY = "hunch.cred"; // credential id hint only — not secret, safe to lose
const ADDR_KEY = "hunch.addr";
// Monad charges the full gas limit at the bid price, so bid just above the 100 gwei base fee.
const FEES = { maxFeePerGas: parseGwei("120"), maxPriorityFeePerGas: parseGwei("2") };
export const SESSION_TTL_MS = 30 * 60 * 1000;
const rpId = location.hostname;

export type Unlocked = {
  address: Address;
  keyringKey: CryptoKey;
  send: (tx: { to: Address; data: Hex }) => Promise<Hex>;
  expiresAt: number;
  end: () => void;
};

function fromPrf(prf: Uint8Array) {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prf, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  seed.fill(0);
  if (!node.privateKey) throw new Error("key derivation failed");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  node.wipePrivateData();
  return session;
}

/** Signing session scoped to Hunch: only our two contracts, auto-ends after SESSION_TTL_MS. */
function scoped(session: Secp256k1SigningSession, keyringKey: CryptoKey): Unlocked {
  const address = getEvmAddress(session.publicKey) as Address;
  const wallet = createWalletClient({
    account: toViemAccount(session, { nonceManager }),
    chain: monadTestnet,
    transport: http(),
  });
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const timer = setTimeout(() => session.end(), SESSION_TTL_MS);
  const allowed = new Set([HUNCH, USD, ORACLE].filter(Boolean).map((a) => a.toLowerCase()));
  localStorage.setItem(ADDR_KEY, address);
  return {
    address,
    keyringKey,
    expiresAt,
    async send({ to, data }) {
      if (Date.now() > expiresAt) throw new Error("SESSION_EXPIRED");
      if (!allowed.has(to.toLowerCase())) throw new Error("Blocked: outside session scope");
      const hash = await wallet.sendTransaction({ to, data, ...FEES });
      const r = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
      if (r.status !== "success") throw new Error("Transaction reverted");
      return hash;
    },
    end() {
      clearTimeout(timer);
      session.end();
    },
  };
}

async function unlockFromPrf(prf: Uint8Array) {
  const keyringKey = await deriveKeyringKey(prf); // derive before the PRF bytes are zeroed
  const session = fromPrf(prf);
  prf.fill(0);
  return scoped(session, keyringKey);
}

export async function signUp(name: string): Promise<Unlocked> {
  const c = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "Hunch" },
    user: { name, displayName: `${name} · Hunch` },
  });
  const cred: PasskeyCredentialMetadata = {
    credentialId: c.credentialId,
    ...(c.transports ? { transports: c.transports } : {}),
  };
  localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  return unlockFromPrf(c.prfOutput);
}

/** Works on a fresh device: omitting the credential hint lets the OS show its passkey picker. */
export async function logIn(): Promise<Unlocked> {
  let known: PasskeyCredentialMetadata | undefined;
  try {
    known = JSON.parse(localStorage.getItem(CRED_KEY) ?? "null") ?? undefined;
  } catch {
    known = undefined;
  }
  const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId, credential: known });
  if (known?.credentialId !== credentialId) localStorage.setItem(CRED_KEY, JSON.stringify({ credentialId }));
  return unlockFromPrf(prfOutput);
}

export const cachedAddress = () => localStorage.getItem(ADDR_KEY) as Address | null;
export const hasCredentialHint = () => !!localStorage.getItem(CRED_KEY);

export function forget() {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(ADDR_KEY);
}

export function friendlyError(e: unknown): string {
  if (isMeraError(e)) {
    if (e.code === "PRF_UNAVAILABLE")
      return "This device's passkey manager doesn't support Hunch yet. Try iPhone/Mac Safari, Android Chrome, or 1Password.";
    if (e.code === "PASSKEY_OPERATION_FAILED") return "Face ID was cancelled — try again.";
    if (e.code === "SESSION_ENDED") return "Your session ended. Unlock again to continue.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("SESSION_EXPIRED")) return "Your session ended. Unlock again to continue.";
  return msg.split("\n")[0].slice(0, 160);
}
