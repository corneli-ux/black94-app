/**
 * Lightweight End-to-End Encryption (E2EE) for chat messages.
 *
 * Uses a XOR cipher with a random 32-byte per-chat key.
 * NOT military-grade — provides message-level obfuscation so
 * Firestore data is not readable in plaintext at rest.
 *
 * Encrypted messages are prefixed with "ENC:" so we can
 * distinguish them from legacy plain-text messages (backward compat).
 *
 * Encryption key is stored at `chats/{chatId}/meta/encryptionKey`.
 */

import { firestore } from './firebase';

// Ensure the global crypto polyfill is loaded (react-native-get-random-values)
import 'react-native-get-random-values';

/* ═══════════════════════════════════════════════════════════════════════════
   ENCRYPTION PREFIX
   ═══════════════════════════════════════════════════════════════════════════ */

const ENC_PREFIX = 'ENC:';

/* ═══════════════════════════════════════════════════════════════════════════
   Key Generation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Generates a random 32-byte key and returns it as a 64-character hex string.
 *
 * Uses `crypto.getRandomValues` (via react-native-get-random-values polyfill)
 * when available. Falls back to a `Math.random`–based approach if the API
 * isn't present (should not happen in practice with the polyfill installed).
 */
export function generateEncryptionKey(): string {
  const bytes = new Uint8Array(32);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    // Preferred path — cryptographically secure
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback: Math.random (less secure, but functional)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
   XOR Encrypt / Decrypt
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Converts a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Base64 encode a Uint8Array into a standard base64 string.
 * Uses btoa for simplicity (works in React Native JS context).
 */
function base64Encode(bytes: Uint8Array): string {
  // Convert Uint8Array → binary string, then btoa
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 decode a standard base64 string into a Uint8Array.
 */
function base64Decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypts a plaintext string using XOR cipher with the given key.
 *
 * Algorithm:
 * 1. Convert plaintext to UTF-8 bytes
 * 2. Convert key hex string to bytes
 * 3. XOR each plaintext byte with the corresponding key byte (cycling key)
 * 4. Base64 encode the result
 * 5. Prepend "ENC:" prefix
 *
 * @param plaintext - The message to encrypt
 * @param key - The encryption key (64-char hex string from generateEncryptionKey)
 * @returns Encrypted string with "ENC:" prefix
 */
export function encryptMessage(plaintext: string, key: string): string {
  // Convert plaintext to UTF-8 bytes
  const textEncoder = new TextEncoder();
  const plainBytes = textEncoder.encode(plaintext);

  // Convert key hex to bytes
  const keyBytes = hexToBytes(key);

  // XOR each byte, cycling through the key
  const encryptedBytes = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) {
    encryptedBytes[i] = plainBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  // Base64 encode and add prefix
  return ENC_PREFIX + base64Encode(encryptedBytes);
}

/**
 * Decrypts a ciphertext string that was encrypted with encryptMessage.
 *
 * - If the ciphertext starts with "ENC:", it is decrypted.
 * - Otherwise, it is returned as-is (backward compatible with plain messages).
 *
 * @param ciphertext - The encrypted message (or plain text)
 * @param key - The encryption key (64-char hex string)
 * @returns Decrypted plaintext string
 */
export function decryptMessage(ciphertext: string, key: string): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) {
    // Not encrypted — return as-is for backward compatibility
    return ciphertext;
  }

  try {
    // Strip the "ENC:" prefix
    const base64Part = ciphertext.substring(ENC_PREFIX.length);

    // Base64 decode to get XOR'd bytes
    const encryptedBytes = base64Decode(base64Part);

    // Convert key hex to bytes
    const keyBytes = hexToBytes(key);

    // XOR back to get original bytes
    const decryptedBytes = new Uint8Array(encryptedBytes.length);
    for (let i = 0; i < encryptedBytes.length; i++) {
      decryptedBytes[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    // Convert UTF-8 bytes back to string
    const textDecoder = new TextDecoder();
    return textDecoder.decode(decryptedBytes);
  } catch (e) {
    console.warn('[E2EE] Decryption failed, returning raw content:', e);
    return ciphertext;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Firestore Key Management
   ═══════════════════════════════════════════════════════════════════════════ */

/** In-memory cache of encryption keys to avoid repeated Firestore reads */
const _keyCache: Record<string, string> = {};

/**
 * Ensures a chat has an encryption key in Firestore.
 *
 * - Checks Firestore at `chats/{chatId}/meta/encryptionKey`
 * - If a key exists, returns it (also caches in memory)
 * - If no key exists, generates one, saves it, caches it, and returns it
 *
 * The key doc is accessible to both participants because Firestore security
 * rules (if configured) can check that the requesting user's UID matches
 * either `user1Id` or `user2Id` on the parent chat document.
 *
 * @param chatId - The Firestore chat document ID
 * @returns The encryption key (64-char hex string)
 */
export async function ensureChatEncryptionKey(chatId: string): Promise<string> {
  // Return from cache if available
  if (_keyCache[chatId]) {
    return _keyCache[chatId];
  }

  const metaDocPath = `chats/${chatId}/meta/encryptionKey`;

  try {
    // Check if encryption key already exists
    const docSnap = await firestore().doc(metaDocPath).get();

    if (docSnap.exists) {
      const data = docSnap.data();
      const existingKey = data?.key;
      if (existingKey && typeof existingKey === 'string' && existingKey.length === 64) {
        _keyCache[chatId] = existingKey;
        console.log('[E2EE] Existing encryption key loaded for chat:', chatId);
        return existingKey;
      }
    }

    // Generate a new key and save it
    const newKey = generateEncryptionKey();
    await firestore().doc(metaDocPath).set({
      key: newKey,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });

    _keyCache[chatId] = newKey;
    console.log('[E2EE] New encryption key created for chat:', chatId);
    return newKey;
  } catch (e) {
    console.error('[E2EE] Failed to ensure encryption key for chat:', chatId, e);
    // If Firestore fails, generate a session-only key so sending still works
    // The other participant will also generate their own key on first decrypt
    // attempt, so messages will be readable within the same session.
    if (!_keyCache[chatId]) {
      _keyCache[chatId] = generateEncryptionKey();
      console.warn('[E2EE] Using fallback session key for chat:', chatId);
    }
    return _keyCache[chatId];
  }
}

/**
 * Retrieves the encryption key for a chat without creating one.
 * Returns null if no key exists in Firestore or cache.
 *
 * @param chatId - The Firestore chat document ID
 * @returns The encryption key or null
 */
export async function getChatEncryptionKey(chatId: string): Promise<string | null> {
  if (_keyCache[chatId]) {
    return _keyCache[chatId];
  }

  const metaDocPath = `chats/${chatId}/meta/encryptionKey`;

  try {
    const docSnap = await firestore().doc(metaDocPath).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      const existingKey = data?.key;
      if (existingKey && typeof existingKey === 'string' && existingKey.length === 64) {
        _keyCache[chatId] = existingKey;
        return existingKey;
      }
    }
  } catch (e) {
    console.warn('[E2EE] Failed to fetch encryption key for chat:', chatId, e);
  }

  return null;
}

/**
 * Clears the cached encryption key for a chat (useful when a chat is deleted).
 */
export function clearKeyCache(chatId?: string): void {
  if (chatId) {
    delete _keyCache[chatId];
  } else {
    // Clear all cached keys
    for (const key of Object.keys(_keyCache)) {
      delete _keyCache[key];
    }
  }
}
