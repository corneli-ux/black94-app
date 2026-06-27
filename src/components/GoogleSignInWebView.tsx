import { colors } from '../theme/colors';
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
 *
 * ERROR INTERCEPTION:
 * When Google shows an error page (e.g. policy violation, testing mode),
 * we detect it via URL parameters and intercept BEFORE the page renders.
 * The user sees a branded Black94 error instead of Google's raw error page
 * (which exposes project IDs, developer emails, etc.).
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { sha256 } from '../utils/crypto';
import Constants from 'expo-constants';

// Use the web client ID from app config (same one used for native Google Sign-In).
// This is the NEW memora-bond project (project number 815007868471).
const WEB_CLIENT_ID = (Constants.expoConfig?.extra?.googleWebClientId as string)
  || '815007868471-10t3bepb2kjqlqk7oihh7k3clmvrteab.apps.googleusercontent.com';

// Firebase auth handler for the CURRENT project (memora-bond).
// This URL is pre-authorized for every Firebase project that has the web SDK
// configured, so it works WITHOUT registering any SHA-1 fingerprint.
// The previous value 'black94.firebaseapp.com' was the OLD migrated project
// and caused the WebView fallback to fail with redirect_uri_mismatch.
const FIREBASE_HANDLER = 'https://memora-bond.firebaseapp.com/__/auth/handler';

interface Props {
  onToken: (idToken: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

/* ─── Error sanitization ──────────────────────────────────────────────────── */

/**
 * Strip project IDs, emails, and other identifiers from Google error messages.
 * Prevents exposing internal details (project-210565807767, developer email, etc.)
 * to the end user.
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

function buildAuthUrl(nonce: string): string {
  // Use the id_token implicit flow. Google returns the id_token directly in the
  // redirect URL fragment (#id_token=...), so there is NO authorization-code
  // exchange. This avoids the secretless-code-exchange problem where Google
  // rejects the token POST for a web client that has no client secret.
  // The nonce binds the token to this request (replay protection).
  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: FIREBASE_HANDLER,
    response_type: 'id_token',
    scope: 'openid profile email',
    nonce: nonce,
    prompt: 'select_account',
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
    const errMsg = sanitizeErrorMessage(data.error_description || data.error || `HTTP ${resp.status}`);
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

  // Generate a nonce and build the auth URL on mount
  useEffect(() => {
    try {
      const nonce = generateCodeVerifier(64);
      codeVerifierRef.current = nonce;
      setAuthUrl(buildAuthUrl(nonce));
      setIsReady(true);
    } catch (e: any) {
      console.error('[GoogleSignInWebView] Nonce generation failed:', e);
      onError('Failed to initialize sign-in');
    }
  }, [onError]);

  /**
   * Intercept navigation events — catch both:
   * 1. Successful redirect to Firebase handler (extract auth code)
   * 2. Google error pages (block and show branded error)
   *
   * Google error URLs contain error= or error_description= parameters
   * on accounts.google.com. We block these BEFORE the page renders,
   * preventing the user from seeing Google's raw error page with
   * project IDs and developer emails.
   */
  const handleShouldStartLoad = useCallback(
    (request: WebViewNavigation): boolean => {
      const url = request.url;
      if (__DEV__) console.log('[GoogleSignInWebView] Navigation:', url.substring(0, 120));

      // ── Check for Google OAuth errors in the URL ──
      // Google includes error parameters when the consent screen fails
      // (policy violation, testing mode, invalid client, etc.)
      if (url.includes('accounts.google.com') && (url.includes('error=') || url.includes('error_description='))) {
        // Extract the error message
        let errorMsg = 'Unable to sign in with Google. Please try again.';
        try {
          const urlObj = new URL(url);
          const rawError = urlObj.searchParams.get('error_description') || urlObj.searchParams.get('error');
          if (rawError) {
            errorMsg = sanitizeErrorMessage(decodeURIComponent(rawError));
          }
        } catch {
          const match = url.match(/[?&]error_description=([^&#]+)/);
          if (match) errorMsg = sanitizeErrorMessage(decodeURIComponent(match[1]));
        }

        console.error('[GoogleSignInWebView] Google OAuth error intercepted:', errorMsg);
        onError(errorMsg);
        return false; // Block the error page from loading
      }

      // Check if this is the redirect to Firebase's auth handler
      if (url.startsWith(FIREBASE_HANDLER) && !handledRef.current) {
        handledRef.current = true;

        // id_token implicit flow: the token comes back in the URL FRAGMENT
        // (after #), e.g. .../__/auth/handler#id_token=XXX&...
        // No code exchange needed — extract the id_token directly.
        let idToken: string | null = null;
        try {
          const hashPart = url.split('#')[1] || '';
          const params = new URLSearchParams(hashPart);
          idToken = params.get('id_token');
          // Some flows put it in the query string instead
          if (!idToken) {
            const urlObj = new URL(url);
            idToken = urlObj.searchParams.get('id_token');
          }
        } catch {
          const match = url.match(/[#&?]id_token=([^&]+)/);
          idToken = match ? decodeURIComponent(match[1]) : null;
        }

        if (idToken) {
          if (__DEV__) console.log('[GoogleSignInWebView] Got id_token from redirect, completing sign-in');
          onToken(idToken);
        } else {
          // Check for error in redirect
          let error: string | null = null;
          try {
            const urlObj = new URL(url);
            const rawError = urlObj.searchParams.get('error_description') || urlObj.searchParams.get('error');
            error = rawError ? sanitizeErrorMessage(decodeURIComponent(rawError)) : null;
          } catch {
            const match = url.match(/[?&]error_description=([^&#]+)/);
            error = match ? sanitizeErrorMessage(decodeURIComponent(match[1])) : null;
          }
          onError(error || 'No ID token received from Google');
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
          <ActivityIndicator size="large" color={colors.white} />
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
            <ActivityIndicator size="large" color={colors.white} />
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
    backgroundColor: colors.bg,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
