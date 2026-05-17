/**
 * Google Web OAuth — uses expo-web-browser (Chrome Custom Tabs / Safari).
 *
 * Google BLOCKS OAuth from embedded WebViews (Error 403: disallowed_useragent).
 * This module uses expo-web-browser which opens Chrome Custom Tabs on Android
 * and ASWebAuthenticationSession on iOS — both are "secure browsers" allowed by Google.
 *
 * IMPORTANT — redirect URI policy:
 *   Google OAuth 2.0 policy for Web clients only accepts http(s) redirect URIs.
 *   Custom scheme URIs (e.g. black94://auth) are REJECTED and cause
 *   "Error 400: invalid_request — doesn't comply with OAuth 2.0 policy".
 *   We use the Firebase auth handler HTTPS URL which is automatically authorized
 *   for every Firebase project with web SDK configured.
 *
 * FLOW (Chrome Custom Tabs / ASWebAuthenticationSession):
 *   1. Opens Google OAuth in system browser
 *   2. User authenticates
 *   3. Google redirects to https://black94.firebaseapp.com/__/auth/handler?code=...
 *   4. expo-web-browser intercepts the redirect and returns the URL
 *   5. We exchange the auth code for an ID token using PKCE
 */

import * as WebBrowser from 'expo-web-browser';
import { sha256 } from '../utils/crypto';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * Redirect URI — HTTPS for ALL platforms.
 *
 * WHY HTTPS everywhere:
 *   Google OAuth 2.0 policy for Web clients only accepts http(s) URIs.
 *   Custom scheme URIs (e.g. black94://auth) cause Error 400 invalid_request.
 *   The Firebase handler URL is pre-authorized for every Firebase project.
 *   PKCE prevents Firebase's handler from consuming our auth code.
 */
function getRedirectUri(): string {
  return 'https://black94.firebaseapp.com/__/auth/handler';
}

/**
 * Sanitize error messages from Google OAuth — strip project IDs, emails,
 * and any other sensitive identifiers before showing to the user.
 */
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/project-\d+/gi, '[project]')
    .replace(/\d{12,}/g, '[id]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/firebaseapp\.com/gi, '[firebase]')
    .replace(/googleusercontent\.com/gi, '[oauth]');
}

/**
 * Generate random string for PKCE code_verifier.
 * Uses Math.random() — zero native dependencies, no crash risk.
 */
function generateCodeVerifier(length: number = 128): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Sign in with Google using expo-web-browser.
 *
 * On Android: Chrome Custom Tabs (allowed by Google's policy)
 * On iOS: ASWebAuthenticationSession (allowed by Google's policy)
 *
 * Returns a Google ID token for Firebase signInWithIdp.
 */
export async function signInWithGoogleWeb(): Promise<string> {
  try {
    await WebBrowser.warmUpAsync();
  } catch {
    // warmUpAsync may fail in some environments — not critical
  }

  const redirectUri = getRedirectUri();
  const codeVerifier = generateCodeVerifier(128);
  const codeChallenge = sha256(codeVerifier);

  console.log('[GoogleWebAuth] Starting, redirect:', redirectUri);

  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  console.log('[GoogleWebAuth] Opening browser...');

  // openAuthSessionAsync opens Chrome Custom Tabs (Android) or
  // ASWebAuthenticationSession (iOS). Both are "secure browsers" per Google's policy.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    console.log('[GoogleWebAuth] Session ended without success:', result.type);
    // When the browser session ends without a success redirect, it typically
    // means Google showed an error page (policy violation, testing mode, etc.)
    // OR the user manually closed the browser.
    throw new Error(
      'Sign-in was interrupted. If you saw an error page in the browser, ' +
      'please try again or contact support.',
    );
  }

  console.log('[GoogleWebAuth] Got redirect URL');

  // Parse the redirect URL to extract the authorization code
  let code: string | null = null;
  try {
    const urlObj = new URL(result.url);
    code = urlObj.searchParams.get('code');
  } catch {
    // URL parser may fail on custom schemes — use regex
    const match = result.url.match(/[?&]code=([^&#]+)/);
    code = match ? match[1] : null;
  }

  if (!code) {
    // Check for error in redirect — extract and sanitize error message
    let error: string | null = null;
    try {
      const urlObj = new URL(result.url);
      const rawError = urlObj.searchParams.get('error_description') || urlObj.searchParams.get('error');
      error = rawError ? sanitizeErrorMessage(rawError) : null;
    } catch {
      const match = result.url.match(/[?&]error_description=([^&#]+)/);
      error = match ? sanitizeErrorMessage(decodeURIComponent(match[1])) : null;
    }
    throw new Error(error || 'No authorization code received from Google');
  }

  console.log('[GoogleWebAuth] Got auth code, exchanging for ID token...');

  // Exchange authorization code for ID token using PKCE
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
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

  const tokens = await tokenResp.json();

  if (!tokenResp.ok) {
    const errMsg = sanitizeErrorMessage(
      tokens.error_description || tokens.error || `HTTP ${tokenResp.status}`,
    );
    console.error('[GoogleWebAuth] Token exchange failed:', errMsg);
    throw new Error(errMsg);
  }

  if (!tokens.id_token) {
    console.error('[GoogleWebAuth] No id_token in response');
    throw new Error('No ID token received from Google');
  }

  console.log('[GoogleWebAuth] Successfully obtained ID token');
  return tokens.id_token;
}
