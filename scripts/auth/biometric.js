// scripts/auth/biometric.js
// WebAuthn-based biometric lock (Face ID / Touch ID / Windows Hello).
//
// HOW IT WORKS:
//   1. User signs in successfully (Google + verifyToken passed)
//   2. We prompt "Enable Face ID for next launch?"
//   3. If yes, we register a WebAuthn credential bound to this device.
//      The credential ID gets stored in localStorage.
//   4. On next launch, if a token is in localStorage (persistent mode),
//      we ask the device to authenticate using the stored credential.
//   5. Successful auth → unlock the app. Failed → clear session + sign in again.
//
// SECURITY MODEL:
//   - The WebAuthn credential is bound to this device + this origin.
//     Another person picking up the iPad cannot authenticate as you.
//   - The token in localStorage is NOT cryptographically encrypted by Face ID.
//     It's "soft-protected" — the iPad's OS-level app sandbox is the real
//     protection. This is a UX layer, not a security layer.
//   - For real security beyond "user-friendly device lock," the right
//     answer is short token TTLs + backend re-auth on sensitive actions.

const CREDENTIAL_ID_KEY = "ds.auth.webauthn.credentialId";
const RP_NAME = "DealerScan";
const RP_ID = window.location.hostname; // "dealerscan.live"

// ──────────────────────────────────────────────────────────────────
// Capability detection
// ──────────────────────────────────────────────────────────────────

export function isBiometricSupported() {
  if (!window.PublicKeyCredential) return false;
  if (!navigator.credentials || !navigator.credentials.create) return false;
  return true;
}

export async function isBiometricAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    // Specifically checks if the device has a platform authenticator
    // (Face ID / Touch ID / Windows Hello), not external keys.
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasBiometricEnrolled() {
  return !!localStorage.getItem(CREDENTIAL_ID_KEY);
}

// ──────────────────────────────────────────────────────────────────
// Enrollment — call after successful sign-in if user opts in
// ──────────────────────────────────────────────────────────────────

/**
 * Register a new biometric credential for this user on this device.
 * Returns true on success, false on failure (user cancelled, no biometric, etc).
 */
export async function enrollBiometric(userEmail, userName) {
  if (!isBiometricSupported()) {
    console.warn("[biometric] not supported on this device");
    return false;
  }

  try {
    // Generate a random challenge — for enrollment this just needs to be
    // unique per registration. We don't verify it server-side because we're
    // using biometric as a local unlock gate, not server authentication.
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    // User ID needs to be a stable bytes identifier. We hash the email.
    const userIdBytes = await stringToBytes(userEmail);

    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: RP_ID },
        user: {
          id: userIdBytes,
          name: userEmail,
          displayName: userName || userEmail,
        },
        challenge: challenge,
        // ES256 (-7) and RS256 (-257) — the two algos all platforms support
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          // Force the platform authenticator (Face ID etc), not external keys
          authenticatorAttachment: "platform",
          // Require biometric/PIN verification — not just "user presence"
          userVerification: "required",
          // Discoverable credential = device can use it without us providing ID first
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    });

    if (!credential) return false;

    // Store the credential ID (base64url) so we can challenge it on unlock
    const credentialIdB64 = bufferToBase64Url(credential.rawId);
    localStorage.setItem(CREDENTIAL_ID_KEY, credentialIdB64);

    return true;
  } catch (err) {
    console.warn("[biometric] enrollment failed:", err);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────
// Unlock — call on app boot when persistent session is found
// ──────────────────────────────────────────────────────────────────

/**
 * Prompt the user to authenticate with their enrolled biometric.
 * Returns true on success, false on cancel/fail.
 */
export async function verifyBiometric() {
  if (!isBiometricSupported()) return false;
  const credentialIdB64 = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!credentialIdB64) return false;

  try {
    const credentialId = base64UrlToBuffer(credentialIdB64);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        rpId: RP_ID,
        allowCredentials: [
          {
            type: "public-key",
            id: credentialId,
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (err) {
    console.warn("[biometric] verification failed:", err);
    return false;
  }
}

export function clearBiometric() {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

async function stringToBytes(s) {
  // Hash the string to a stable 32-byte user id. WebAuthn wants a stable
  // bytes identifier, not the email directly.
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const s = atob(padded);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
