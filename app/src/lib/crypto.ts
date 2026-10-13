// Key hierarchy (nothing secret is ever persisted):
//
//   passkey PRF (Mera, default salt) ──BIP-39/44──▶ wallet key (EOA)
//        └──HKDF "hunch/keyring/v1"──▶ keyring key (AES-GCM) — wraps the list of group keys stored onchain
//
//   group key K (32 random bytes, shared only via invite-link #fragment)
//        ├─ sha256("hunch/group-id" ‖ K)    → groupId (public)
//        ├─ keccak256("hunch/invite" ‖ K)    → invite signer (secp256k1) — proves you hold the link
//        └─ HKDF "hunch/content/v1"          → AES-GCM key for group name + market questions
import { keccak256, concat, toBytes, toHex, bytesToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(ikm: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("hunch"), info: enc.encode(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const deriveKeyringKey = (prf: Uint8Array) => hkdf(prf, "hunch/keyring/v1");

export async function seal(key: CryptoKey, plaintext: string): Promise<Hex> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return bytesToHex(concat([iv, ct]));
}

export async function open(key: CryptoKey, blob: Hex): Promise<string> {
  const b = hexToBytes(blob);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) as BufferSource }, key, b.slice(12) as BufferSource);
  return dec.decode(pt);
}

export type GroupKeys = {
  secret: Hex; // K
  groupId: Hex;
  inviteKey: Hex;
  content: CryptoKey;
};

export async function groupKeys(secret: Hex): Promise<GroupKeys> {
  const k = hexToBytes(secret);
  const gid = new Uint8Array(await crypto.subtle.digest("SHA-256", concat([enc.encode("hunch/group-id"), k]) as BufferSource));
  return {
    secret,
    groupId: bytesToHex(gid),
    inviteKey: keccak256(concat([toBytes("hunch/invite"), k])),
    content: await hkdf(k, "hunch/content/v1"),
  };
}

export const newGroupSecret = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

export const inviteSigner = (g: GroupKeys) => privateKeyToAccount(g.inviteKey).address;

/** Signature the contract checks in joinGroup: personal_sign(keccak256(groupId ‖ member)). */
export function signInvite(g: GroupKeys, member: Hex) {
  const h = keccak256(concat([g.groupId, member]));
  return privateKeyToAccount(g.inviteKey).signMessage({ message: { raw: h } });
}

// Invite links carry K base64url-encoded in the URL fragment, which browsers never send to a server.
export const secretToCode = (s: Hex) =>
  btoa(String.fromCharCode(...hexToBytes(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const codeToSecret = (c: string): Hex =>
  toHex(Uint8Array.from(atob(c.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));
