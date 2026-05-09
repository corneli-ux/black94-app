/**
 * WebView-based Google Sign-In for Android (fallback).
 *
 * Used when native Google Sign-In fails (e.g., SHA-1 not registered,
 * Google Play Services unavailable, or DEVELOPER_ERROR).
 *
 * HOW IT WORKS:
 * 1. Opens Google's OAuth consent screen in a WebView
 * 2. Google redirects to the Firebase auth handler (pre-authorized URL)
 * 3. We intercept the redirect BEFORE the page loads
 * 4. Extract the auth code from the URL
 * 5. Exchange it for an ID token using PKCE
 *
 * WHY IT WORKS WITHOUT CONSOLE SETUP:
 * The redirect URI (https://black94.firebaseapp.com/__/auth/handler) is
 * pre-authorized for every Firebase project with web SDK configured.
 * PKCE prevents Firebase's handler from consuming our auth code.
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';
const FIREBASE_HANDLER = 'https://black94.firebaseapp.com/__/auth/handler';

interface Props {
  onToken: (idToken: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

/* ─── PKCE: Random string generation ───────────────────────────────────────── */

/**
 * Generate a random string for PKCE code_verifier.
 * Uses Math.random() — simple, zero native dependencies, sufficient entropy for PKCE.
 */
function generateCodeVerifier(length: number = 128): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/* ─── PKCE: Pure JS SHA-256 ──────────────────────────────────────────────── */

function sha256(plain: string): string {
  // Pure JavaScript SHA-256 implementation — no native deps needed
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

/* ─── OAuth URL builder ──────────────────────────────────────────────────── */

function buildAuthUrl(codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: FIREBASE_HANDLER,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/* ─── Token exchange ─────────────────────────────────────────────────────── */

async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: WEB_CLIENT_ID,
      redirect_uri: FIREBASE_HANDLER,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  });

  const data = await resp.json();

  if (!resp.ok) {
    const errMsg = data.error_description || data.error || `HTTP ${resp.status}`;
    throw new Error(errMsg);
  }

  if (!data.id_token) {
    throw new Error('No ID token in response from Google');
  }

  return data.id_token;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function GoogleSignInWebView({ onToken, onError, onCancel }: Props) {
  const webViewRef = useRef<any>(null);
  const codeVerifierRef = useRef<string>('');
  const handledRef = useRef(false);
  const [authUrl, setAuthUrl] = useState<string>('');
  const [isReady, setIsReady] = useState(false);

  // Generate PKCE and build auth URL on mount
  useEffect(() => {
    try {
      const verifier = generateCodeVerifier(128);
      const challenge = sha256(verifier);
      codeVerifierRef.current = verifier;
      setAuthUrl(buildAuthUrl(challenge));
      setIsReady(true);
    } catch (e: any) {
      console.error('[GoogleSignInWebView] PKCE generation failed:', e);
      onError('Failed to initialize sign-in');
    }
  }, [onError]);

  /**
   * Intercept navigation: when Google redirects to the Firebase handler,
   * extract the auth code BEFORE the page loads.
   */
  const handleShouldStartLoad = useCallback(
    (request: WebViewNavigation): boolean => {
      const url = request.url;
      console.log('[GoogleSignInWebView] Navigation:', url.substring(0, 120));

      // Check if this is the redirect to Firebase's auth handler
      if (url.startsWith(FIREBASE_HANDLER) && !handledRef.current) {
        handledRef.current = true;

        // Extract auth code from URL
        let code: string | null = null;
        try {
          const urlObj = new URL(url);
          code = urlObj.searchParams.get('code');
        } catch {
          // URL parser may fail on custom schemes — use regex fallback
          const match = url.match(/[?&]code=([^&#]+)/);
          code = match ? match[1] : null;
        }

        if (code) {
          console.log('[GoogleSignInWebView] Got auth code, exchanging for ID token...');
          exchangeCodeForToken(code, codeVerifierRef.current)
            .then((idToken) => {
              console.log('[GoogleSignInWebView] Got ID token, completing sign-in');
              onToken(idToken);
            })
            .catch((err) => {
              console.error('[GoogleSignInWebView] Token exchange failed:', err);
              onError(err.message);
            });
        } else {
          // Check for error in redirect
          let error: string | null = null;
          try {
            const urlObj = new URL(url);
            error = urlObj.searchParams.get('error_description') || urlObj.searchParams.get('error');
          } catch {
            const match = url.match(/[?&]error_description=([^&#]+)/);
            error = match ? decodeURIComponent(match[1]) : null;
          }
          onError(error || 'No authorization code received from Google');
        }

        // Block navigation — don't load the Firebase handler page
        return false;
      }

      return true;
    },
    [onToken, onError],
  );

  // Don't render WebView until auth URL is ready
  if (!isReady || !authUrl) {
    return (
      <View style={styles.container}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: authUrl }}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
        style={styles.webview}
        onHttpError={(e) => {
          console.error('[GoogleSignInWebView] HTTP error:', e.nativeEvent.statusCode);
        }}
        onError={(e) => {
          console.error('[GoogleSignInWebView] WebView error:', e.nativeEvent.description);
        }}
      />
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
});
