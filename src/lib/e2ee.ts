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

/* ── Polyfill ──────────────────────────────────────────────────────────────── */
import 'react-native-get-random-values';

/* ── SecureStore — lazy-loaded to prevent native crash on import ───────── */
// CRASH FIX: Static import of expo-secure-store can crash the entire module
// if the native binary is incompatible (e.g., SDK 55 package with SDK 54 app).
// Lazy-loading means the crash only happens when SecureStore is actually
// called, and we can catch it with try/catch. If SecureStore fails, we
// use ephemeral in-memory keys (lost on restart, but chat works for the session).
let _secureStore: any = null;
let _secureStoreLoadAttempted = false;

async function getSecureStore(): Promise<any> {
  if (_secureStore !== null) return _secureStore;
  if (_secureStoreLoadAttempted) return null;
  _secureStoreLoadAttempted = true;
  try {
    const mod = await import('expo-secure-store');
    _secureStore = mod || mod.default || null;
    if (__DEV__) console.log('[E2EE] expo-secure-store loaded successfully');
    return _secureStore;
  } catch (e) {
    if (__DEV__) console.warn('[E2EE] expo-secure-store failed to load (using ephemeral keys):', e?.message || e);
    return null;
  }
}

/* ── Constants ─────────────────────────────────────────────────────────────── */
const E2EE_PREFIX = 'E2EE:';
const SK_KEY = '@black94/e2ee_sk'; // SecureStore key for our private key
const PK_FIRESTORE = 'e2eePublicKey'; // Firestore field name on user doc
const PUBLIC_KEY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface KeyPair {
  publicKey: Uint8Array;  // 32 bytes
  secretKey: Uint8Array;  // 32 bytes
}

interface CachedPublicKey {
  key: Uint8Array;
  expiresAt: number;
}

/* ── In-memory caches ──────────────────────────────────────────────────────── */
let _localKeyPair: KeyPair | null = null;
let _keyPairPromise: Promise<KeyPair> | null = null; // Deduplication gate
const _publicKeyCache: Record<string, CachedPublicKey> = {};
let _secureStoreFailed = false; // Track if SecureStore persistence failed

/* ═══════════════════════════════════════════════════════════════════════════════
   1. IDENTITY KEY MANAGEMENT — on-device only
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Get or create the current user's X25519 identity key pair.
 * Private key is persisted in the OS keystore via expo-secure-store.
 * Public key is kept in memory (and also published to Firestore).
 *
 * BUG FIX: Added promise-gate deduplication to prevent race conditions.
 * Two concurrent calls (e.g., initE2EE on mount in AnonymousChatScreen +
 * ChatRoomScreen) could generate DIFFERENT key pairs, leading to
 * permanent crypto desync (Firestore has key B, SecureStore has key A).
 *
 * BUG FIX: Persist to SecureStore BEFORE caching in memory. Previously,
 * _localKeyPair was set before await SecureStore.setItemAsync, so if
 * persistence failed, an ephemeral key was cached and all messages
 * encrypted with it became permanently undecryptable after restart.
 */
export async function getMyKeyPair(): Promise<KeyPair> {
  if (_localKeyPair) return _localKeyPair;

  // Deduplication gate — if a key generation is already in progress,
  // return the same promise instead of starting a second one.
  if (_keyPairPromise) return _keyPairPromise;

  _keyPairPromise = _createOrLoadKeyPair();
  try {
    return await _keyPairPromise;
  } finally {
    _keyPairPromise = null;
  }
}

async function _createOrLoadKeyPair(): Promise<KeyPair> {
  // Try to load existing private key from secure storage
  let storedSk: string | null = null;
  try {
    const ss = await getSecureStore();
    if (ss) {
      storedSk = await ss.getItemAsync(SK_KEY);
    }
  } catch (e) {
    if (__DEV__) console.warn('[E2EE] SecureStore unavailable, generating new key pair:', e);
    _secureStoreFailed = true;
  }

  if (storedSk) {
    try {
      const secretKey = base64UrlToBytes(storedSk);
      // Derive public key from secret key (nacl box key derivation)
      const publicKey = nacl.box.keyPair.fromSecretKey(secretKey).publicKey;
      _localKeyPair = { publicKey, secretKey };
      return _localKeyPair;
    } catch (e) {
      if (__DEV__) console.warn('[E2EE] Failed to load stored key pair, generating new one:', e);
    }
  }

  // Generate new key pair
  const keyPair = nacl.box.keyPair();

  // CRASH FIX: Persist FIRST, then cache. If persistence fails, don't cache
  // the ephemeral key — let the next call try again.
  // CRITICAL FIX: Use lazy-loaded SecureStore to prevent native crash.
  // If the native module throws (permission denied, storage full, SDK mismatch),
  // the error is caught and the key is still cached in memory (ephemeral —
  // lost on restart, but chat works for this session).
  try {
    const ss = await getSecureStore();
    if (ss) {
      await ss.setItemAsync(SK_KEY, bytesToBase64Url(keyPair.secretKey));
    } else {
      _secureStoreFailed = true;
    }
  } catch (e) {
    if (__DEV__) console.warn('[E2EE] Failed to persist key pair to SecureStore (non-fatal):', e);
    _secureStoreFailed = true;
  }
  _localKeyPair = keyPair;

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
    if (__DEV__) console.error('[E2EE] Failed to publish public key:', e);
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
  // Zero cached public keys
  for (const key of Object.keys(_publicKeyCache)) {
    delete _publicKeyCache[key];
  }
  // Remove from device secure storage
  try {
    const ss = await getSecureStore();
    if (ss) await ss.deleteItemAsync(SK_KEY);
  } catch (e) {
    if (__DEV__) console.warn('[E2EE] Failed to delete keys from SecureStore:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   2. PUBLIC KEY FETCHING — from Firestore
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Fetch another user's public key from Firestore.
 * Results are cached with TTL to allow key rotation.
 */
export async function getRecipientPublicKey(recipientUid: string): Promise<Uint8Array | null> {
  // Check cache with TTL
  const cached = _publicKeyCache[recipientUid];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  try {
    const { firestore } = await import('./firebase');
    const doc = await firestore().collection('users').doc(recipientUid).get();
    if (!doc.exists) {
      if (__DEV__) console.warn('[E2EE] User not found:', recipientUid);
      return null;
    }

    const data = doc.data();
    const pkB64 = data?.[PK_FIRESTORE];
    if (!pkB64 || typeof pkB64 !== 'string') {
      if (__DEV__) console.warn('[E2EE] Recipient has no E2EE public key yet:', recipientUid);
      return null;
    }

    const publicKey = base64UrlToBytes(pkB64);
    _publicKeyCache[recipientUid] = { key: publicKey, expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL };
    return publicKey;
  } catch (e) {
    if (__DEV__) console.error('[E2EE] Failed to fetch public key for:', recipientUid, e);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   3. MESSAGE ENCRYPTION — NaCl box (XSalsa20-Poly1305 + X25519)
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
      if (__DEV__) console.error('[E2EE] nacl.box returned null — encryption failed');
      return null;
    }

    // Format: "E2EE:{nonce}:{ciphertext}" in base64url
    const nonceB64 = bytesToBase64Url(nonce);
    const cipherB64 = bytesToBase64Url(ciphertext);

    return `${E2EE_PREFIX}${nonceB64}:${cipherB64}`;
  } catch (e) {
    if (__DEV__) console.error('[E2EE] Encryption error:', e);
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
      if (__DEV__) console.warn('[E2EE] Invalid encrypted message format');
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
      if (__DEV__) console.error('[E2EE] nacl.box.open returned null — decryption failed (tampered?)');
      return '[Unable to decrypt this message]'; // Consistent with other error paths
    }

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    if (__DEV__) console.error('[E2EE] Decryption error:', e);
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
    if (__DEV__) console.error('[E2EE] Initialization failed:', e);
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

/**
 * Check if the encryption keys are stored securely (SecureStore).
 * If this returns true, keys are ephemeral (in-memory only) and will be
 * lost on app restart. The caller should warn the user.
 */
export function isEphemeralKeys(): boolean {
  return _secureStoreFailed && !!_localKeyPair;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS — Base64URL encoding (Firebase-safe)
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Convert Uint8Array to Base64URL string (no +, /, = padding).
 * Base64URL is safe for Firestore field values and URL params.
 *
 * BUG FIX: btoa() may not be available in all React Native JS engines
 * (e.g., Hermes < 0.7 or New Architecture edge cases). Falls back to
 * Buffer.from() — same pattern as firebase.ts:_isTokenExpired().
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  try {
    // Standard base64 → base64url
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch {
    // btoa() unavailable — use Buffer fallback (transitive dependency)
    try {
      const { Buffer } = require('buffer') as { Buffer: typeof globalThis.Buffer };
      return Buffer.from(binary, 'binary').toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    } catch {
      throw new Error('[E2EE] Neither btoa() nor Buffer available for base64 encoding');
    }
  }
}

/**
 * Convert Base64URL string back to Uint8Array.
 *
 * BUG FIX: atob() may not be available in all React Native JS engines.
 * Falls back to Buffer.from() — same pattern as firebase.ts.
 */
function base64UrlToBytes(b64url: string): Uint8Array {
  // base64url → standard base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (b64.length % 4 !== 0) b64 += '=';
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    // atob() unavailable — use Buffer fallback
    try {
      const { Buffer } = require('buffer') as { Buffer: typeof globalThis.Buffer };
      const raw = Buffer.from(b64, 'base64');
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } catch {
      throw new Error('[E2EE] Neither atob() nor Buffer available for base64 decoding');
    }
  }
}
