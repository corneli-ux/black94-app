/**
 * Google Web OAuth — bypasses native Google Play Services SHA-1 check.
 *
 * Uses expo-web-browser to open Google's OAuth consent screen in the system
 * browser, then exchanges the authorization code for an ID token.
 *
 * Advantages over native @react-native-google-signin:
 *  - NO SHA-1 fingerprint registration required
 *  - NO Google Play Services dependency
 *  - Works immediately without any Google Console configuration
 *  - Uses the Firebase project's pre-authorized web OAuth redirect URI
 */

import * as WebBrowser from 'expo-web-browser';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * Firebase Auth handler redirect URIs.
 * These are automatically pre-authorized in Google Cloud Console for every
 * Firebase project that has the web SDK configured. No manual setup needed.
 */
const FIREBASE_REDIRECT_URIS = [
  'https://black94.web.app/__/auth/handler',
  'https://black94.firebaseapp.com/__/auth/handler',
];

/**
 * Generate a cryptographically random string for PKCE code_verifier.
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  // react-native-get-random-values polyfills crypto.getRandomValues
  const crypto = require('react-native-get-random-values').getRandomValues;
  crypto(array);
  return Array.from(array, (v) => chars[v % chars.length]).join('');
}

/**
 * Simple SHA-256 hash for PKCE code_challenge.
 * Uses a pure JS implementation to avoid needing expo-crypto.
 */
function sha256(plain: string): string {
  // Right-rotate helper
  const rr = (n: number, s: number) => (n >>> s) | (n << (32 - s));

  let h0 = 0x6a09e667 | 0;
  let h1 = 0xbb67ae85 | 0;
  let h2 = 0x3c6ef372 | 0;
  let h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f | 0;
  let h5 = 0x9b05688c | 0;
  let h6 = 0x1f83d9ab | 0;
  let h7 = 0x5be0cd19 | 0;

  const encoder = new TextEncoder();
  const msg = encoder.encode(plain);
  const len = msg.length;

  // Pre-processing: adding padding bits
  const bitLen = len * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // Append bit length as 64-bit big-endian (JS only has 32-bit ops, so split)
  msg.push(0, 0, 0, 0); // high 32 bits of 64-bit length
  msg.push((bitLen >>> 24) & 0xff);
  msg.push((bitLen >>> 16) & 0xff);
  msg.push((bitLen >>> 8) & 0xff);
  msg.push(bitLen & 0xff);

  // Process each 512-bit block
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  for (let offset = 0; offset < msg.length; offset += 64) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] =
        (msg[offset + i * 4] << 24) |
        (msg[offset + i * 4 + 1] << 16) |
        (msg[offset + i * 4 + 2] << 8) |
        msg[offset + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  // Produce the hash as a byte array
  const hash = new Uint8Array(32);
  const hh = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    hash[i * 4] = (hh[i] >>> 24) & 0xff;
    hash[i * 4 + 1] = (hh[i] >>> 16) & 0xff;
    hash[i * 4 + 2] = (hh[i] >>> 8) & 0xff;
    hash[i * 4 + 3] = hh[i] & 0xff;
  }

  // Base64url encode
  let binary = '';
  hash.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign in with Google using web-based OAuth (no native Google Play Services).
 *
 * Opens Google's consent screen in the system browser. After the user
 * authenticates, Google redirects back to Firebase's pre-authorized handler
 * URL. We intercept this redirect via expo-web-browser, extract the auth
 * code, and exchange it for a Google ID token.
 *
 * PKCE (Proof Key for Code Exchange) is used to prevent the Firebase auth
 * handler from consuming our authorization code — only we can exchange it
 * with the matching code_verifier.
 */
export async function signInWithGoogleWeb(): Promise<string> {
  // Warm up the browser for faster display
  await WebBrowser.warmUpAsync();

  // Generate PKCE code_verifier and code_challenge
  const codeVerifier = generateRandomString(128);
  const codeChallenge = sha256(codeVerifier);

  // Try each Firebase redirect URI until one works
  let lastError: Error | null = null;

  for (const redirectUri of FIREBASE_REDIRECT_URIS) {
    try {
      const idToken = await attemptAuthFlow(redirectUri, codeVerifier, codeChallenge);
      return idToken;
    } catch (error: any) {
      console.warn(`[GoogleWebAuth] Failed with ${redirectUri}:`, error.message);
      lastError = error;

      // If Google explicitly rejects the redirect_uri, try the next one
      if (error.message?.includes('redirect_uri_mismatch') ||
          error.message?.includes('Error 400')) {
        continue;
      }

      // For other errors (network, user cancel, etc.), don't retry
      break;
    }
  }

  throw lastError || new Error('Google sign-in failed with all redirect URIs');
}

/**
 * Attempt a single OAuth flow with the given redirect URI.
 */
async function attemptAuthFlow(
  redirectUri: string,
  codeVerifier: string,
  codeChallenge: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    prompt: 'select_account',
    // PKCE — prevents the Firebase auth handler from stealing our code
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  console.log('[GoogleWebAuth] Opening browser for OAuth...');
  console.log('[GoogleWebAuth] Redirect URI:', redirectUri);

  // Open auth session — browser watches for navigation to redirectUri
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    console.log('[GoogleWebAuth] User cancelled or session ended');
    throw new Error('Sign in cancelled');
  }

  console.log('[GoogleWebAuth] Browser returned URL:', result.url);

  // Parse the redirect URL to extract the authorization code
  let urlObj: URL;
  try {
    urlObj = new URL(result.url);
  } catch {
    // Handle Android deep link format (e.g. "com.black94.app://...")
    const hashIdx = result.url.indexOf('?');
    if (hashIdx >= 0) {
      const search = result.url.substring(hashIdx);
      urlObj = new URL('https://dummy.com' + search);
    } else {
      throw new Error('Invalid redirect URL returned');
    }
  }

  const code = urlObj.searchParams.get('code');

  if (!code) {
    const error = urlObj.searchParams.get('error');
    const errorDesc = urlObj.searchParams.get('error_description');
    const msg = errorDesc || error || 'No authorization code in redirect URL';
    console.error('[GoogleWebAuth] No code:', msg);
    throw new Error(msg);
  }

  console.log('[GoogleWebAuth] Got authorization code, exchanging for ID token...');

  // Exchange authorization code for ID token (using PKCE code_verifier)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: WEB_CLIENT_ID,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok) {
    const errMsg = tokens.error_description || tokens.error || `Token exchange HTTP ${tokenRes.status}`;
    console.error('[GoogleWebAuth] Token exchange failed:', errMsg);
    throw new Error(errMsg);
  }

  if (!tokens.id_token) {
    console.error('[GoogleWebAuth] No id_token in response:', JSON.stringify(Object.keys(tokens)));
    throw new Error('No ID token received from Google');
  }

  console.log('[GoogleWebAuth] Successfully obtained ID token');
  return tokens.id_token;
}
