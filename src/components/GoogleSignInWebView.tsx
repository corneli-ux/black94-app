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
import { sha256 } from '../utils/crypto';

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
