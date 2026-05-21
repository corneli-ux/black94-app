/**
 * base64.ts — Pure JavaScript base64 decoder shared across the app.
 *
 * WHY NOT atob()?
 *  - atob() is a browser global added to React Native 0.72+
 *  - With Expo's New Architecture (Fabric), atob() may NOT be available
 *  - Using atob() in imageUpload.ts was causing silent upload failures
 *
 * This implementation uses Buffer.from() (available in React Native) as a
 * fast path, with a pure JS polyfill as fallback.
 */

/**
 * Decodes a base64-encoded string to a Uint8Array.
 * Handles whitespace and padding correctly.
 */
export function safeBase64Decode(base64: string): Uint8Array {
  // Fast path: Buffer is available in React Native
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  // Pure JS polyfill — always works
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Map<string, number>();
  for (let i = 0; i < chars.length; i++) {
    lookup.set(chars[i], i);
  }

  // Remove whitespace only — do NOT remove '=' padding characters!
  // Padding is meaningful: it indicates how many bytes the last group encodes.
  const cleaned = base64.replace(/\s/g, '');
  const len = cleaned.length;

  // Calculate output length based on padding
  const paddingCount = (cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0);
  const outputLength = Math.floor((len * 3) / 4) - paddingCount;
  const result = new Uint8Array(outputLength);

  let byteIndex = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = lookup.get(cleaned[i]) || 0;
    const c1 = lookup.get(cleaned[i + 1] || '') || 0;
    // Padding characters '=' map to 0, which is correct for decoding
    const c2 = cleaned[i + 2] === '=' ? 0 : (lookup.get(cleaned[i + 2] || '') || 0);
    const c3 = cleaned[i + 3] === '=' ? 0 : (lookup.get(cleaned[i + 3] || '') || 0);

    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    result[byteIndex++] = (triplet >> 16) & 0xFF;
    if (byteIndex < outputLength) result[byteIndex++] = (triplet >> 8) & 0xFF;
    if (byteIndex < outputLength) result[byteIndex++] = triplet & 0xFF;
  }

  return result;
}
