/**
 * Google Web OAuth — works without native Google Play Services or SHA-1 registration.
 *
 * Uses expo-web-browser to open Google's consent screen in the system browser.
 * On Android, the redirect is intercepted via the app's custom scheme (black94://auth).
 * On iOS, ASWebAuthenticationSession handles it natively.
 *
 * This flow does NOT require:
 *  - SHA-1 fingerprint registration in Google Console
 *  - Google Play Services on the device
 *  - Any native Google Sign-In SDK configuration
 *
 * It DOES require the redirect URI to be registered in Google Cloud Console.
 * Since we use the app's custom scheme (black94://auth), you must add it to
 * Google Console > APIs & Services > Credentials > Authorized redirect URIs.
 */

import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Get the redirect URI for the current platform.
 * 
 * Android: Uses the app's custom scheme (black94://auth) which is properly
 * intercepted by the deep linking system. This is the KEY fix — the previous
 * code used https://black94.web.app/__/auth/handler which Chrome Custom Tabs
 * cannot intercept on Android (it just navigates to that URL and Firebase
 * consumes the auth code).
 *
 * iOS: Uses the https:// Firebase redirect URI since ASWebAuthenticationSession
 * can intercept HTTPS redirects on iOS.
 */
function getRedirectUri(): string {
  if (Platform.OS === 'android') {
    // Custom scheme — Android deep linking will intercept this
    return makeRedirectUri({
      scheme: 'black94',
      path: 'auth',
      preferLocalhost: false,
    });
  }
  // iOS — ASWebAuthenticationSession intercepts https:// redirects fine
  return 'https://black94.firebaseapp.com/__/auth/handler';
}

/**
 * Generate a cryptographically random string for PKCE code_verifier.
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  // Use Math.random for PKCE code verifier — sufficient entropy, no native deps
  for (let i = 0; i < length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, v => chars[v % chars.length]).join('');
}

/**
 * SHA-256 hash for PKCE code_challenge (pure JS, no native deps).
 */
function sha256(plain: string): string {
  const rr = (n: number, s: number) => (n >>> s) | (n << (32 - s));

  let h0 = 0x6a09e667 | 0, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372 | 0, h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f | 0, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab | 0, h7 = 0x5be0cd19 | 0;

  const encoder = new TextEncoder();
  const encoded = encoder.encode(plain);
  const bitLen = encoded.length * 8;
  const msg = Array.from(encoded);
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  msg.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

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
    for (let i = 0; i < 16; i++)
      w[i] = (msg[offset + i * 4] << 24) | (msg[offset + i * 4 + 1] << 16) | (msg[offset + i * 4 + 2] << 8) | msg[offset + i * 4 + 3];
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

  const hash = new Uint8Array(32);
  const hh = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    hash[i * 4] = (hh[i] >>> 24) & 0xff;
    hash[i * 4 + 1] = (hh[i] >>> 16) & 0xff;
    hash[i * 4 + 2] = (hh[i] >>> 8) & 0xff;
    hash[i * 4 + 3] = hh[i] & 0xff;
  }
  let binary = '';
  hash.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign in with Google using web-based OAuth (no native Google Play Services).
 *
 * Opens Google's consent screen in the system browser. After authentication,
 * Google redirects back. On Android this uses the app's custom scheme
 * (black94://auth) which is intercepted by the deep linking system.
 * On iOS, ASWebAuthenticationSession intercepts the HTTPS redirect.
 *
 * PKCE prevents the redirect handler from consuming our auth code.
 * Returns a Google ID token for Firebase signInWithIdp.
 */
export async function signInWithGoogleWeb(): Promise<string> {
  await WebBrowser.warmUpAsync();

  const redirectUri = getRedirectUri();
  const codeVerifier = generateRandomString(128);
  const codeChallenge = sha256(codeVerifier);

  console.log('[GoogleWebAuth] redirect URI:', redirectUri, 'platform:', Platform.OS);

  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  console.log('[GoogleWebAuth] Opening browser for OAuth...');

  // openAuthSessionAsync opens in Chrome Custom Tabs (Android) or
  // ASWebAuthenticationSession (iOS). The redirect URI determines how
  // the browser returns control to the app.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    console.log('[GoogleWebAuth] Browser session ended:', result.type);
    throw new Error('cancelled');
  }

  console.log('[GoogleWebAuth] Browser returned URL:', result.url);

  // Parse the redirect URL to extract the authorization code
  let urlObj: URL;
  try {
    urlObj = new URL(result.url);
  } catch {
    // Handle Android deep link format (e.g. "black94://auth?code=...")
    const hashIdx = result.url.indexOf('?');
    if (hashIdx >= 0) {
      const search = result.url.substring(hashIdx);
      urlObj = new URL('https://dummy.com' + search);
    } else {
      throw new Error('Invalid redirect URL: ' + result.url);
    }
  }

  const code = urlObj.searchParams.get('code');
  if (!code) {
    const error = urlObj.searchParams.get('error');
    const errorDesc = urlObj.searchParams.get('error_description');
    const msg = errorDesc || error || 'No authorization code in redirect';
    console.error('[GoogleWebAuth] No code:', msg);
    throw new Error(msg);
  }

  console.log('[GoogleWebAuth] Got authorization code, exchanging for ID token...');

  // Exchange authorization code for ID token (using PKCE code_verifier)
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
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
    const errMsg = tokens.error_description || tokens.error || `HTTP ${tokenRes.status}`;
    console.error('[GoogleWebAuth] Token exchange failed:', errMsg);
    if (errMsg.includes('redirect_uri_mismatch')) {
      throw new Error(
        'Redirect URI not registered. Add "' + redirectUri +
        '" in Google Cloud Console > APIs & Services > Credentials > Authorized redirect URIs.'
      );
    }
    throw new Error(errMsg);
  }

  if (!tokens.id_token) {
    console.error('[GoogleWebAuth] No id_token in response');
    throw new Error('No ID token received from Google');
  }

  console.log('[GoogleWebAuth] Successfully obtained ID token');
  return tokens.id_token;
}
