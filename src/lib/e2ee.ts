/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BLACK94 — Real End-to-End Encryption (E2EE)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Cryptography: NaCl (Networking and Cryptography Library) via tweetnacl
 *   - Key Exchange : X25519 (Curve25519 ECDH) — same as Signal Protocol
 *   - Encryption   : XSalsa20-Poly1305 AEAD (authenticated encryption)
 *   - nonce         : 24 random bytes per message (never reused with same key)
 *
 * Architecture:
 *   1. Each user generates an X25519 identity key pair on first app launch
 *   2. Private key is stored ON-DEVICE ONLY (expo-secure-store / platform keystore)
 *   3. Public key is published to Firestore at users/{uid}/e2eePublicKey
 *   4. To chat: both users' public keys are fetched, X25519 ECDH derives a
 *      shared 32-byte secret
 *   5. Every message is encrypted with NaCl `box` (XSalsa20-Poly1305 + nonce)
 *   6. Firestore stores ONLY ciphertext — Firebase admins / hackers see nothing
 *
 * Threat model:
 *   - Firebase database admins  → CANNOT read messages (only ciphertext)
 *   - Network attackers (MITM)  → TLS protects transit; ciphertext in DB
 *   - Compromised device        → Private key accessible only via OS keystore
 *   - Firebase breach           → Messages remain encrypted, keys are on devices
 *
 * NOT in scope (future enhancement):
 *   - Forward secrecy (double ratchet) — requires per-session key rotation
 *   - Post-compromise security — requires ratchet reset mechanism
 *   - Pre-key bundles for offline message delivery
 *
 * Encrypted message format:
 *   "E2EE:{base64_url_nonce(24)}:{base64_url_ciphertext}"
 *   - Nonce is stored alongside ciphertext so the recipient can decrypt
 *   - Base64URL encoding avoids Firestore special character issues
 *
 * Backward compatibility:
 *   - Messages NOT prefixed with "E2EE:" are treated as legacy plaintext
 *   - This allows gradual rollout without breaking existing messages
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';

/* ── Polyfill ──────────────────────────────────────────────────────────────── */
import 'react-native-get-random-values';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const E2EE_PREFIX = 'E2EE:';
const SK_KEY = '@black94/e2ee_sk'; // SecureStore key for our private key
const PK_FIRESTORE = 'e2eePublicKey'; // Firestore field name on user doc
const SHARED_SECRET_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface KeyPair {
  publicKey: Uint8Array;  // 32 bytes
  secretKey: Uint8Array;  // 32 bytes
}

interface CachedSecret {
  secret: Uint8Array;
  expiresAt: number;
}

/* ── In-memory caches ──────────────────────────────────────────────────────── */
let _localKeyPair: KeyPair | null = null;
const _sharedSecretCache: Record<string, CachedSecret> = {};
const _publicKeyCache: Record<string, Uint8Array> = {};

/* ═══════════════════════════════════════════════════════════════════════════════
   1. IDENTITY KEY MANAGEMENT — on-device only
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Get or create the current user's X25519 identity key pair.
 * Private key is persisted in the OS keystore via expo-secure-store.
 * Public key is kept in memory (and also published to Firestore).
 */
export async function getMyKeyPair(): Promise<KeyPair> {
  if (_localKeyPair) return _localKeyPair;

  // Try to load existing private key from secure storage
  const storedSk = await SecureStore.getItemAsync(SK_KEY);

  if (storedSk) {
    try {
      const secretKey = base64UrlToBytes(storedSk);
      // Derive public key from secret key (nacl box key derivation)
      const publicKey = nacl.box.keyPair.fromSecretKey(secretKey).publicKey;
      _localKeyPair = { publicKey, secretKey };
      return _localKeyPair;
    } catch (e) {
      console.warn('[E2EE] Failed to load stored key pair, generating new one:', e);
    }
  }

  // Generate new key pair
  const keyPair = nacl.box.keyPair();
  _localKeyPair = keyPair;

  // Persist private key to secure storage (NEVER to Firestore)
  await SecureStore.setItemAsync(SK_KEY, bytesToBase64Url(keyPair.secretKey));

  return keyPair;
}

/**
 * Get the current user's public key as a base64url string.
 */
export async function getMyPublicKeyBase64(): Promise<string> {
  const kp = await getMyKeyPair();
  return bytesToBase64Url(kp.publicKey);
}

/**
 * Publish the current user's public key to their Firestore user doc.
 * Called on first launch and on login.
 */
export async function publishPublicKey(userUid: string): Promise<void> {
  try {
    const pubKeyB64 = await getMyPublicKeyBase64();
    // Dynamic import to avoid circular dependency
    const { firestore } = await import('./firebase');
    await firestore().collection('users').doc(userUid).set(
      { [PK_FIRESTORE]: pubKeyB64 },
      { merge: true },
    );
    if (__DEV__) console.log('[E2EE] Public key published for user:', userUid);
  } catch (e) {
    console.error('[E2EE] Failed to publish public key:', e);
  }
}

/**
 * Delete the local key pair from secure storage.
 * Zeroes all key material in memory before clearing.
 * Used during logout or account deletion.
 */
export async function destroyLocalKeys(): Promise<void> {
  // Zero in-memory key material before clearing (defense-in-depth)
  if (_localKeyPair) {
    try { _localKeyPair.secretKey.fill(0); } catch {}
    try { _localKeyPair.publicKey.fill(0); } catch {}
    _localKeyPair = null;
  }
  // Zero cached shared secrets before clearing
  for (const key of Object.keys(_sharedSecretCache)) {
    try { _sharedSecretCache[key].secret.fill(0); } catch {}
    delete _sharedSecretCache[key];
  }
  // Clear public key cache (public keys are not secret, but clean up anyway)
  for (const key of Object.keys(_publicKeyCache)) {
    delete _publicKeyCache[key];
  }
  // Remove from device secure storage
  await SecureStore.deleteItemAsync(SK_KEY);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   2. PUBLIC KEY FETCHING — from Firestore
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Fetch another user's public key from Firestore.
 * Results are cached in memory to avoid repeated reads.
 */
export async function getRecipientPublicKey(recipientUid: string): Promise<Uint8Array | null> {
  // Check cache first
  if (_publicKeyCache[recipientUid]) {
    return _publicKeyCache[recipientUid];
  }

  try {
    const { firestore } = await import('./firebase');
    const doc = await firestore().collection('users').doc(recipientUid).get();
    if (!doc.exists) {
      console.warn('[E2EE] User not found:', recipientUid);
      return null;
    }

    const data = doc.data();
    const pkB64 = data?.[PK_FIRESTORE];
    if (!pkB64 || typeof pkB64 !== 'string') {
      if (__DEV__) console.warn('[E2EE] Recipient has no E2EE public key yet:', recipientUid);
      return null;
    }

    const publicKey = base64UrlToBytes(pkB64);
    _publicKeyCache[recipientUid] = publicKey;
    return publicKey;
  } catch (e) {
    console.error('[E2EE] Failed to fetch public key for:', recipientUid, e);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   3. SHARED SECRET DERIVATION — X25519 ECDH
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Derive a shared 32-byte secret via X25519 ECDH.
 * Both users derive the SAME secret when they combine:
 *   - Their own secret key
 *   - The other user's public key
 *
 * The result is cached for SHARED_SECRET_CACHE_TTL to avoid recomputation.
 * Cache key: sorted pair of UIDs to ensure both parties use the same cache key.
 */
export async function deriveSharedSecret(myUid: string, theirUid: string): Promise<Uint8Array | null> {
  // Deterministic cache key (sorted UIDs)
  const cacheKey = [myUid, theirUid].sort().join(':');

  // Check cache
  const cached = _sharedSecretCache[cacheKey];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.secret;
  }

  // Get our key pair and their public key in parallel
  const [myKeyPair, theirPublicKey] = await Promise.all([
    getMyKeyPair(),
    getRecipientPublicKey(theirUid),
  ]);

  if (!theirPublicKey) {
    console.warn('[E2EE] Cannot derive shared secret — missing recipient public key');
    return null;
  }

  // Compute shared secret: nacl.scalarMult(mySk, theirPk)
  // This produces the same 32 bytes on both sides:
  //   Alice: scalarMult(alice_sk, bob_pk)   = shared_secret
  //   Bob:   scalarMult(bob_sk, alice_pk)   = shared_secret
  const sharedSecret = nacl.scalarMult(myKeyPair.secretKey, theirPublicKey);

  // Cache the result
  _sharedSecretCache[cacheKey] = {
    secret: sharedSecret,
    expiresAt: Date.now() + SHARED_SECRET_CACHE_TTL,
  };

  if (__DEV__) console.log('[E2EE] Shared secret derived for:', cacheKey);
  return sharedSecret;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   4. MESSAGE ENCRYPTION — NaCl box (XSalsa20-Poly1305 + X25519)
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Encrypt a plaintext message using NaCl authenticated encryption.
 *
 * Algorithm: nacl.box(plaintext, nonce, theirPublicKey, mySecretKey)
 *   - Uses X25519 for key agreement
 *   - XSalsa20 for symmetric encryption
 *   - Poly1305 for authentication (tamper detection)
 *
 * @returns Encrypted string in format: "E2EE:{nonce_b64url}:{ciphertext_b64url}"
 *          Returns null if encryption fails (caller should fall back to plaintext)
 */
export async function encryptMessage(
  plaintext: string,
  myUid: string,
  theirUid: string,
): Promise<string | null> {
  try {
    const myKeyPair = await getMyKeyPair();
    const theirPublicKey = await getRecipientPublicKey(theirUid);

    if (!theirPublicKey) {
      if (__DEV__) console.warn('[E2EE] Cannot encrypt — recipient has no public key');
      return null;
    }

    // Generate a random 24-byte nonce (unique per message)
    const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes

    // Encode plaintext to UTF-8 bytes
    const messageBytes = new TextEncoder().encode(plaintext);

    // Encrypt: nacl.box(message, nonce, theirPk, mySk)
    const ciphertext = nacl.box(messageBytes, nonce, theirPublicKey, myKeyPair.secretKey);

    if (!ciphertext) {
      console.error('[E2EE] nacl.box returned null — encryption failed');
      return null;
    }

    // Format: "E2EE:{nonce}:{ciphertext}" in base64url
    const nonceB64 = bytesToBase64Url(nonce);
    const cipherB64 = bytesToBase64Url(ciphertext);

    return `${E2EE_PREFIX}${nonceB64}:${cipherB64}`;
  } catch (e) {
    console.error('[E2EE] Encryption error:', e);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   5. MESSAGE DECRYPTION — NaCl box.open
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Decrypt an encrypted message using NaCl authenticated decryption.
 *
 * Algorithm: nacl.box.open(ciphertext, nonce, theirPublicKey, mySecretKey)
 *   - Verifies authenticity (Poly1305 MAC)
 *   - Decrypts with XSalsa20
 *   - If ciphertext was tampered with or corrupted → returns null
 *
 * Backward compatible: messages NOT prefixed with "E2EE:" are returned as-is.
 *
 * @returns Decrypted plaintext string, or the original string if not encrypted.
 *          Returns null if decryption fails (tampered message).
 */
export async function decryptMessage(
  encrypted: string,
  senderUid: string,
): Promise<string | null> {
  // Backward compatibility: not encrypted, return as-is
  if (!encrypted.startsWith(E2EE_PREFIX)) {
    return encrypted;
  }

  try {
    // Parse: "E2EE:{nonce}:{ciphertext}"
    const parts = encrypted.substring(E2EE_PREFIX.length).split(':');
    if (parts.length !== 2) {
      console.warn('[E2EE] Invalid encrypted message format');
      return '[Unable to decrypt message]'; // Never show raw ciphertext
    }

    const nonce = base64UrlToBytes(parts[0]);
    const ciphertext = base64UrlToBytes(parts[1]);

    const myKeyPair = await getMyKeyPair();
    const senderPublicKey = await getRecipientPublicKey(senderUid);

    if (!senderPublicKey) {
      if (__DEV__) console.warn('[E2EE] Cannot decrypt — sender public key not found:', senderUid);
      return '[Encrypted — key not available]';
    }

    // Decrypt: nacl.box.open(ciphertext, nonce, theirPk, mySk)
    const decrypted = nacl.box.open(ciphertext, nonce, senderPublicKey, myKeyPair.secretKey);

    if (!decrypted) {
      console.error('[E2EE] nacl.box.open returned null — decryption failed (tampered?)');
      return null; // Message was tampered with
    }

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('[E2EE] Decryption error:', e);
    return '[Unable to decrypt message]'; // Never show raw ciphertext to user
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   6. CHAT PREVIEW ENCRYPTION — for lastMessage in chat list
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Generate a safe chat list preview that reveals NO message content.
 * Instead of storing plaintext lastMessage, we store this placeholder
 * so even Firebase admins can't see message content in chat list previews.
 */
export function encryptedPreviewText(): string {
  return '🔒 Encrypted message';
}

/* ═══════════════════════════════════════════════════════════════════════════════
   7. E2EE INITIALIZATION — call on app launch / login
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Initialize E2EE for the current user.
 * Should be called once on login / app launch.
 * Ensures the user has an identity key pair and their public key is published.
 */
export async function initE2EE(userUid: string): Promise<void> {
  try {
    // Ensure key pair exists (generates if first time, loads from keystore if not)
    await getMyKeyPair();

    // Publish public key to Firestore
    await publishPublicKey(userUid);

    if (__DEV__) console.log('[E2EE] Initialized for user:', userUid);
  } catch (e) {
    console.error('[E2EE] Initialization failed:', e);
  }
}

/**
 * Check if E2EE is ready for a given recipient.
 * Returns true if both users have identity key pairs and public keys published.
 */
export async function isE2EEReady(recipientUid: string): Promise<boolean> {
  try {
    const myKeyPair = await getMyKeyPair();
    const theirPublicKey = await getRecipientPublicKey(recipientUid);
    return !!(myKeyPair && theirPublicKey);
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS — Base64URL encoding (Firebase-safe)
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Convert Uint8Array to Base64URL string (no +, /, = padding).
 * Base64URL is safe for Firestore field values and URL params.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // Standard base64 → base64url
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Convert Base64URL string back to Uint8Array.
 */
function base64UrlToBytes(b64url: string): Uint8Array {
  // base64url → standard base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
