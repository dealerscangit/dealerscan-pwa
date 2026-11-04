// scripts/scanTest/relay.js
// Sends license-scan TEST results to the desktop, end-to-end encrypted.
//
// The desktop extension makes a random session id + AES-256 key and puts
// both in the QR code's #fragment (browsers never send the fragment to a
// server). The phone encrypts each result with that key and drops the
// ciphertext in the Apps Script "relay" mailbox; the desktop picks it up and
// decrypts it. The backend only ever holds scrambled bytes, for ≤10 minutes.

import { APPS_SCRIPT_URL } from "../auth/config.js";

export function b64urlEncode(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read the session from a URL hash like "#s=<sid>&k=<key>". */
export function readSession(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const sid = p.get("s");
  const k = p.get("k");
  if (!sid || !k || !/^[A-Za-z0-9_-]{16,64}$/.test(sid)) return null;
  try {
    const keyBytes = b64urlDecode(k);
    if (keyBytes.length !== 32) return null;
    return { sid, keyBytes };
  } catch {
    return null;
  }
}

export async function importKey(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ct)) };
}

export async function decryptJson(key, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(iv) }, key, b64urlDecode(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** Encrypt + post message number `n` for this session. */
export async function sendMessage(session, key, n, obj) {
  const { iv, ct } = await encryptJson(key, obj);
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "relayPut");
  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ sid: session.sid, n, iv, ct }),
  });
  if (!res.ok) throw new Error(`relay HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`relay: ${data.error || "unknown"}`);
  return true;
}
