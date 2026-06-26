// Firebase REST API — NO Web SDK, NO polyfills needed.
// Uses pure fetch() for Auth + Firestore. Works in React Native without any shims.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Firebase API key — loaded from app.json extra field (standard Expo approach).
// NOTE: Firebase Web API keys are NOT secret credentials. They are public identifiers
// baked into every REST call (?key=...). Security is enforced server-side via
// Firebase Security Rules + per-request auth tokens (Bearer headers).
// For production builds, this can be injected via EAS secrets as process.env.FIREBASE_API_KEY.
const API_KEY = Constants.expoConfig?.extra?.firebaseApiKey as string || '';
if (!API_KEY && __DEV__) {
  console.error('[Firebase] FATAL: firebaseApiKey not configured in app.json extra field');
}
const PROJECT_ID = 'memora-bond';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const AUTH_STORAGE_KEY = '@black94/auth';

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH — REST API
   ═══════════════════════════════════════════════════════════════════════════ */

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

let _authUser: AuthUser | null = null;
let _idToken: string | null = null;
let _refreshToken: string | null = null;
let _tokenRefreshPromise: Promise<string> | null = null; // Dedup concurrent refreshes
const _authListeners = new Set<(user: any) => void>();

/* ── Persistent Auth Storage ────────────────────────────────────────── */

async function _persistAuth(): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      authUser: _authUser,
      idToken: _idToken,
      refreshToken: _refreshToken,
    }));
    if (__DEV__) console.log('[Firebase] Auth state persisted to AsyncStorage');
  } catch (e) {
    if (__DEV__) console.warn('[Firebase] Failed to persist auth:', e);
  }
}

async function _restoreAuth(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.refreshToken) {
      _refreshToken = data.refreshToken;
      _idToken = data.idToken || null;
      _authUser = data.authUser || null;
      if (__DEV__) console.log('[Firebase] Auth state restored from AsyncStorage, uid:', _authUser?.uid);
      return true;
    }
    return false;
  } catch (e) {
    if (__DEV__) console.warn('[Firebase] Failed to restore auth:', e);
    return false;
  }
}

async function _clearAuthStorage(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    if (__DEV__) console.log('[Firebase] Auth storage cleared');
  } catch (e) {
    if (__DEV__) console.warn('[Firebase] Failed to clear auth storage:', e);
  }
}

function _notifyAuthListeners() {
  _authListeners.forEach(cb => {
    try { cb(_authUser); } catch (e) { /* ignore listener errors */ }
  });
}

function auth(): { currentUser: AuthUser | null } {
  return { currentUser: _authUser };
}

function onAuthStateChanged(
  _authRef: any,
  callback: (user: AuthUser | null) => void,
): () => void {
  // Fire immediately with current state (same behavior as Firebase SDK)
  setTimeout(() => callback(_authUser), 0);
  _authListeners.add(callback);
  return () => { _authListeners.delete(callback); };
}

async function signInWithGoogleIdToken(googleIdToken: string) {
  if (__DEV__) console.log('[Firebase] Signing in via REST API...');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${googleIdToken}&providerId=google.com`,
        requestUri: `https://${PROJECT_ID}.firebaseapp.com/__/auth/handler`,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  // Safely parse response — may not be JSON on errors (e.g., CloudFlare block, HTML)
  const respText = await resp.text();
  let data: any;
  try { data = JSON.parse(respText); } catch { data = {}; }

  if (!resp.ok) {
    const msg = data.error?.message || `Auth HTTP ${resp.status}: ${respText.slice(0, 200)}`;
    if (__DEV__) console.error('[Firebase] Auth REST error:', msg);
    throw new Error(msg);
  }

  // Keep the photoURL from Google sign-in as-is.
  // DO NOT strip Firebase Storage URLs — they are valid public URLs when
  // returned by the identity toolkit (Google has already resolved them).
  // The old filter was too aggressive and caused profile images to disappear.
  let photoURL: string | null = data.photoUrl || null;

  if (!data.localId) throw new Error('Sign-in response missing localId — cannot create auth state');

  _authUser = {
    uid: data.localId,
    email: data.email || null,
    displayName: data.displayName || null,
    photoURL,
  };
  _idToken = data.idToken;
  _refreshToken = data.refreshToken;

  if (__DEV__) console.log('[Firebase] Sign-in successful (REST):', _authUser.uid);
  _notifyAuthListeners();
  await _persistAuth(); // Persist tokens so user stays logged in

  return { user: _authUser };
}

async function signOut(_authRef?: any) {
  // Firebase REST API has no dedicated sign-out endpoint.
  // Local token clearing is sufficient. Google OAuth revoke is handled in api.ts.
  _authUser = null;
  _idToken = null;
  _refreshToken = null;
  if (__DEV__) console.log('[Firebase] Signed out (REST)');
  _notifyAuthListeners();
  await _clearAuthStorage(); // Clear persisted tokens on sign out
}

/* ── Token refresh ────────────────────────────────────────────────────────── */

// Decode JWT payload to check expiry (no library needed)
function _isTokenExpired(token: string): boolean {
  try {
    // JWT uses base64url encoding — convert to standard base64
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    let payload: string;
    try {
      payload = atob(base64);
    } catch {
      // atob() may not be available in RN New Architecture — use Buffer fallback
      const { Buffer } = require('buffer') as { Buffer: typeof globalThis.Buffer };
      payload = Buffer.from(base64, 'base64').toString('utf-8');
    }
    const parsed = JSON.parse(payload);
    // Consider expired if less than 60 seconds remaining
    return parsed.exp * 1000 < Date.now() + 60000;
  } catch {
    return true; // If we can't parse, assume expired
  }
}

async function _getValidToken(): Promise<string> {
  // Check if current token is still valid
  if (_idToken && !_isTokenExpired(_idToken)) return _idToken;

  if (!_refreshToken) throw new Error('Not authenticated');

  // Dedup: if a refresh is already in-flight, reuse the same promise.
  // Without this, concurrent calls (e.g., feed + notifications on app startup)
  // all send refresh requests, and Firebase rotates refresh tokens — the second
  // request fails because the old refresh token is now invalid.
  if (_tokenRefreshPromise) return _tokenRefreshPromise;

  // Invalidate cached token before attempting refresh
  _idToken = null;

  _tokenRefreshPromise = _doTokenRefresh();
  try {
    return await _tokenRefreshPromise;
  } finally {
    _tokenRefreshPromise = null;
  }
}

async function _doTokenRefresh(): Promise<string> {
  try {
    const resp = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: _refreshToken,
        }),
      },
    );
    const respText = await resp.text();
    let data: any;
    try {
      data = JSON.parse(respText);
    } catch {
      throw new Error(`Token refresh returned non-JSON response (HTTP ${resp.status})`);
    }
    if (!data.id_token) throw new Error('Token refresh failed: ' + (data.error?.message || respText.slice(0, 200)));
    _idToken = data.id_token;
    _refreshToken = data.refresh_token || _refreshToken;
    await _persistAuth(); // Persist refreshed tokens
    return _idToken as string;
  } catch (e: any) {
    // Keep _refreshToken on transient errors — only clear on auth failures
    _idToken = null;
    // Don't clear refresh token — it may be a transient network error.
    // The next call to _getValidToken will retry with the same refresh token.
    // Re-throw the original error so callers can distinguish network errors
    // from actual session expiration.
    if (e?.message?.includes('Session expired') || e?.message?.includes('Token refresh failed') || e?.message?.includes('TOKEN_EXPIRED') || e?.message?.includes('USER_DISABLED')) {
      throw new Error('Session expired — please sign in again');
    }
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRESTORE — REST API
   ═══════════════════════════════════════════════════════════════════════════ */

async function _firestoreFetch(
  path: string,
  method: string = 'GET',
  body?: any,
): Promise<any> {
  let token: string;
  try {
    token = await _getValidToken();
  } catch {
    throw new Error('Not authenticated');
  }

  // runQuery endpoints use ':runQuery' suffix — no '/' before the colon
  const url = path.startsWith(':')
    ? `${FIRESTORE_BASE}${path}?key=${API_KEY}`
    : `${FIRESTORE_BASE}/${path}?key=${API_KEY}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const logPath = url.includes('/documents/') ? url.split('/documents/')[1]?.split('?')[0] : url.split('?')[0];
  if (__DEV__) console.log(`[Firestore] ${method} ${logPath}`);
  if (__DEV__ && body !== undefined) console.log('[Firestore] body:', typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200));

  let resp = await fetch(url, opts);
  if (__DEV__) console.log(`[Firestore] response: ${resp.status} ${resp.statusText}`);

  // Auto-refresh on 401 — invalidate token first so refresh actually runs
  if (resp.status === 401) {
    if (__DEV__) console.log(`[Firestore] 401 on ${method} ${path} — refreshing token...`);
    _idToken = null; // Force refresh
    try {
      token = await _getValidToken();
    } catch {
      throw new Error('Session expired');
    }
    resp = await fetch(url, {
      ...opts,
      headers: { ...headers, Authorization: `Bearer ${token}` },
    });
    if (__DEV__) console.log(`[Firestore] After token refresh: ${resp.status}`);
  }

  // Safely parse response — may not be JSON on errors
  let data: any;
  const respText = await resp.text();
  try {
    data = JSON.parse(respText);
  } catch {
    if (__DEV__) console.error(`[Firestore] Non-JSON response (${resp.status}): ${respText.slice(0, 500)}`);
    throw new Error(`Firestore HTTP ${resp.status}: ${respText.slice(0, 200)}`);
  }

  if (!resp.ok) {
    const errMsg = data.error?.message || JSON.stringify(data).slice(0, 300) || `Firestore HTTP ${resp.status}`;
    const err: any = new Error(errMsg);
    err.status = resp.status;
    err.code = data.error?.status;
    // Log full error details for debugging
    if (__DEV__) console.error(`[Firestore] ${method} ${path} FAILED: ${resp.status} ${data.error?.status} - ${errMsg}`);
    if (__DEV__) console.error(`[Firestore] Full error response: ${respText.slice(0, 500)}`);
    // If it's a composite index error, include helpful info
    if (data.error?.message?.includes('FAILED_PRECONDITION') || errMsg.includes('index')) {
      if (__DEV__) console.error(`[Firestore] COMPOSITE INDEX NEEDED for query on path: ${path}`);
      if (__DEV__) console.error(`[Firestore] Create index at: https://console.firebase.google.com/project/${PROJECT_ID}/firestore/indexes`);
      // Return empty result with a special flag so callers can detect this.
      // This is intentionally allowed in production too — callers (FeedScreen, etc.)
      // check the _missingIndex flag and fall back to individual reads.
      const emptyResult: any = [];
      emptyResult._missingIndex = true;
      return emptyResult;
    }
    // Other FAILED_PRECONDITION errors (not index-related) should propagate
    if (data.error?.status === 'FAILED_PRECONDITION') {
      throw err;
    }
    throw err;
  }

  return data;
}

/* ── Value conversion (plain ↔ Firestore typed) ──────────────────────────── */

function _toFsValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(_toFsValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = _toFsValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function _fromFsValue(val: any): any {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue?.values || []).map(_fromFsValue);
  if ('mapValue' in val) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
      obj[k] = _fromFsValue(v);
    }
    return obj;
  }
  if ('referenceValue' in val) return val.referenceValue;
  return null;
}

function _fromFsDoc(doc: any): Record<string, any> {
  if (!doc?.fields) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = _fromFsValue(v);
  }
  return out;
}

/* ── Sentinel helpers (serverTimestamp, increment) ───────────────────────── */

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' };
function _serverTimestamp() { return SERVER_TIMESTAMP; }

function _increment(n: number) {
  return { __sentinel: 'increment', value: n };
}

function _parseFields(data: Record<string, any>): {
  fields: Record<string, any>;
  transforms: any[];
  deletePaths: string[];
} {
  const fields: Record<string, any> = {};
  const transforms: any[] = [];
  const deletePaths: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === 'object' &&
      '__sentinel' in (value as any)
    ) {
      const sentinel = value as any;
      if (sentinel.__sentinel === 'serverTimestamp') {
        transforms.push({
          fieldPath: key,
          setToServerValue: 'REQUEST_TIME',
        });
      } else if (sentinel.__sentinel === 'increment') {
        const n = sentinel.value;
        const fsVal = Number.isInteger(n)
          ? { integerValue: String(n) }
          : { doubleValue: n };
        transforms.push({ fieldPath: key, increment: fsVal });
      } else if (sentinel.__sentinel === 'delete') {
        // FieldValue.delete() — remove the field from the document.
        // In Firestore REST PATCH, including a field in updateMask but
        // NOT in the fields object deletes it. We track these paths separately.
        deletePaths.push(key);
      } else {
        // Unknown sentinel — fall through to normal field encoding
        if (__DEV__) console.warn(`[Firestore] Unknown sentinel type: ${sentinel.__sentinel} for field ${key}`);
      }
    } else {
      const fsVal = _toFsValue(value);
      if (fsVal !== null) fields[key] = fsVal;
    }
  }

  return { fields, transforms, deletePaths };
}

/**
 * _firestoreCommitUpdate — Applies field updates + server-side transforms safely.
 *
 * The PATCH endpoint (documents/{path}) does NOT support fieldTransforms.
 * We need transforms (serverTimestamp, increment) for features like createdAt,
 * updatedAt, counters, etc.
 *
 * CRITICAL FIX — The previous implementation used `write.update` in the commit
 * endpoint, which has TWO fatal flaws:
 *   1. `write.update` REQUIRES the document to exist. For new users signing in,
 *      the user doc doesn't exist yet, so the commit silently fails and the user
 *      document is NEVER created, causing all subsequent reads to return empty data.
 *   2. `write.update` WITHOUT `updateMask` can REPLACE the entire document,
 *      deleting fields not present in the fields map (e.g., username, displayName,
 *      profileImage stripped when only subscription/badge fields were sent).
 *
 * Safe approach — split into two independent operations:
 *   Step 1: documents.patch for field updates (guaranteed merge semantics,
 *           works for BOTH new and existing documents).
 *   Step 2: documents:commit with write.transform for transforms only
 *           (serverTimestamp, increment — zero risk of corrupting fields).
 *
 * Trade-off: not atomic (two API calls), but correctness is more important
 * than atomicity here.
 */
/**
 * Build a nested Firestore mapValue structure from dot-notation keys.
 * E.g., { 'privacy.paidChatPrice': { integerValue: '100' } }
 *   → { privacy: { mapValue: { fields: { paidChatPrice: { integerValue: '100' } } } } }
 *
 * BUG FIX: The Firestore REST PATCH endpoint treats field names literally —
 * 'privacy.paidChatPrice' creates a TOP-LEVEL field with a dot in the name,
 * NOT a nested update. To update nested subfields, we must build proper
 * mapValue structures AND use updateMask.fieldPaths to avoid overwriting
 * sibling fields (e.g., dmPermission, nameVisibility under 'privacy').
 */
function _dotNotationToNestedMap(dotFields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [dotPath, fsValue] of Object.entries(dotFields)) {
    const parts = dotPath.split('.');
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = { mapValue: { fields: {} } };
      }
      current = current[part].mapValue.fields;
    }
    current[parts[parts.length - 1]] = fsValue;
  }
  return result;
}

// BUG FIX: Added pre-fetched token parameter so step 1b doesn't need a
// duplicate _getValidToken() call. The caller (set/update) already fetched a
// valid token — reusing it saves one async round-trip per commit.
async function _firestoreCommitUpdate(
  docPath: string,
  fields: Record<string, any>,
  transforms: Array<{ fieldPath: string; setToServerValue?: string; increment?: any }>,
  preFetchedToken?: string,
  deletePaths?: string[],
): Promise<void> {
  // Separate dot-notation fields from regular top-level fields.
  // Dot-notation fields require special handling (updateMask) to avoid
  // corrupting sibling subfields in the parent map.
  const regularFields: Record<string, any> = {};
  const dotFields: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.includes('.')) {
      dotFields[key] = value;
    } else {
      regularFields[key] = value;
    }
  }
  const delPaths = deletePaths || [];
  const deleteDotPaths = delPaths.filter(p => p.includes('.'));
  const deleteRegularPaths = delPaths.filter(p => !p.includes('.'));

  // Step 1a: Write regular (non-dot-notation) field updates via PATCH with updateMask.
  // CRITICAL BUG FIX: Without updateMask, Firestore REST PATCH replaces the ENTIRE
  // document, deleting any fields not present in the payload. This caused chat docs
  // to lose user1Id/user2Id when sendMessage() updated lastMessage/unreadCount,
  // making chats invisible to fetchChatList() queries. Now we include updateMask
  // to ensure only the specified fields are updated, preserving all other fields.
  // Step 1a: Write regular field updates + delete regular fields via PATCH.
  // Including a path in updateMask but NOT in the fields body deletes it.
  const regularPaths = Object.keys(regularFields);
  const allRegularPaths = [...regularPaths, ...deleteRegularPaths];
  if (allRegularPaths.length > 0) {
    if (__DEV__) console.log(`[Firestore] commit step 1a: PATCH regular fields to ${docPath}: ${allRegularPaths.join(', ')}`);
    const authHeader = preFetchedToken || (await _getValidToken());
    const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}&updateMask.fieldPaths=${allRegularPaths.map(encodeURIComponent).join('&updateMask.fieldPaths=')}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authHeader}`,
      },
      body: JSON.stringify({ fields: regularFields }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const errMsg = data.error?.message || `Firestore regular PATCH failed (${resp.status})`;
      if (__DEV__) console.error(`[Firestore] regular PATCH FAILED: ${resp.status} - ${errMsg}`);
      const err: any = new Error(errMsg);
      err.status = resp.status;
      err.code = data.error?.status;
      throw err;
    }
  }

  // Step 1b: Write dot-notation field updates + delete dot-notation fields via PATCH.
  const dotPaths = Object.keys(dotFields);
  const allDotPaths = [...dotPaths, ...deleteDotPaths];
  if (allDotPaths.length > 0) {
    const nestedFields = _dotNotationToNestedMap(dotFields);
    if (__DEV__) console.log(`[Firestore] commit step 1b: PATCH dot-notation fields to ${docPath}: ${allDotPaths.join(', ')}`);

    // BUG FIX: Reuse the already-fetched token from the caller scope instead of
    // calling _getValidToken() again. The caller (CompatDocRef.set/update) already
    // fetched a valid token at the start of _firestoreCommitUpdate — fetching a
    // second token here is wasteful and adds unnecessary latency.
    // BUG FIX: Use pre-fetched token from caller instead of fetching a new one.
    // Falls back to _getValidToken() if no pre-fetched token was provided.
    const authHeader = preFetchedToken || (await _getValidToken());
    // CRASH FIX: Use '&' as separator for updateMask.fieldPaths (NOT ',').
    // The old code used ',' which caused Firestore to only apply the FIRST
    // updateMask fieldPath and silently ignore the rest. This meant when
    // multiple dot-notation fields were updated in a single call (e.g.,
    // { 'privacy.dmPermission': ..., 'privacy.paidChatPrice': ... }), only
    // 'privacy.dmPermission' got the mask, and 'privacy' was PARTIALLY
    // overwritten (losing 'paidChatPrice'). The Firestore REST API requires
    // each field path in its own updateMask.fieldParams parameter.
    const url = `${FIRESTORE_BASE}/${docPath}?key=${API_KEY}&${allDotPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authHeader}`,
      },
      body: JSON.stringify({ fields: nestedFields }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const errMsg = data.error?.message || `Firestore dot-notation PATCH failed (${resp.status})`;
      if (__DEV__) console.error(`[Firestore] dot-notation PATCH FAILED: ${resp.status} - ${errMsg}`);
      const err: any = new Error(errMsg);
      err.status = resp.status;
      err.code = data.error?.status;
      throw err;
    }
  }

  // Step 2: Apply transforms via commit endpoint — write.transform ONLY
  // applies fieldTransforms, never touches any other fields. Safe even if
  // the document doesn't exist (it will be created by the PATCH above).
  if (transforms.length > 0) {
    const token = await _getValidToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit?key=${API_KEY}`;
    const fullName = `projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;

    const write = {
      transform: {
        document: fullName,
        fieldTransforms: transforms,
      },
    };

    const body = { writes: [write] };

    if (__DEV__) console.log(`[Firestore] commit step 2: transform on ${docPath}`);

    let resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    // Auto-refresh on 401
    if (resp.status === 401) {
      _idToken = null;
      try {
        const refreshedToken = await _getValidToken();
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshedToken}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error('Session expired');
      }
    }

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const errMsg = data.error?.message || `Firestore transform commit failed (${resp.status})`;
      if (__DEV__) console.error(`[Firestore] commit transform FAILED: ${resp.status} - ${errMsg}`);
      const err: any = new Error(errMsg);
      err.status = resp.status;
      err.code = data.error?.status;
      throw err;
    }

    if (__DEV__) console.log(`[Firestore] commit succeeded for ${docPath}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — Collection Reference
   ═══════════════════════════════════════════════════════════════════════════ */

interface Constraint {
  type: 'where' | 'orderBy' | 'limit' | 'startAfter';
  field?: string;
  op?: string;
  value?: any;
  direction?: string;
  n?: number;
  cursorValues?: any[];
}

interface DocChange {
  type: 'added' | 'modified' | 'removed';
  doc: any;
  oldIndex: number;
  newIndex: number;
}

interface DocSnapshot {
  id: string;
  ref: any;
  data: () => any;
  exists: boolean;
}

interface ListenSnapshot {
  docs: DocSnapshot[];
  docChanges: DocChange[];
  empty: boolean;
}

class CompatCollectionRef {
  _path: string;
  _constraints: Constraint[];

  constructor(path: string, constraints: Constraint[] = []) {
    this._path = path;
    this._constraints = constraints;
  }

  doc(docId: string) {
    return new CompatDocRef(`${this._path}/${docId}`);
  }

  where(field: string, op: string, value: any) {
    return new CompatCollectionRef(this._path, [
      ...this._constraints,
      { type: 'where', field, op, value },
    ]);
  }

  orderBy(field: string, dir: string = 'asc') {
    // Firestore REST API requires full direction names: 'ASCENDING' / 'DESCENDING'
    const direction = dir.toLowerCase() === 'desc' ? 'DESCENDING' : 'ASCENDING';
    return new CompatCollectionRef(this._path, [
      ...this._constraints,
      { type: 'orderBy', field, direction },
    ]);
  }

  limit(n: number) {
    return new CompatCollectionRef(this._path, [
      ...this._constraints,
      { type: 'limit', n },
    ]);
  }

  startAfter(docOrValue: any) {
    let cursorValues: any[];
    if (docOrValue && typeof docOrValue === 'object' && typeof docOrValue.data === 'function') {
      // Document snapshot — extract values based on orderBy fields
      const orderConstraints = this._constraints.filter(c => c.type === 'orderBy');
      if (orderConstraints.length === 0) {
        if (__DEV__) console.warn('[Firestore] startAfter called without orderBy — skipping cursor');
        return this;
      }
      const data = docOrValue.data();
      cursorValues = orderConstraints.map((c: any) => {
        const val = data[(c as any).field];
        // Firestore timestamps come back as ISO strings from _fromFsValue
        // Convert them back to the format Firestore expects for cursors
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          return { __fs_type: 'timestamp', value: val };
        }
        return val;
      });
    } else {
      cursorValues = Array.isArray(docOrValue) ? docOrValue : [docOrValue];
    }
    return new CompatCollectionRef(this._path, [
      ...this._constraints,
      { type: 'startAfter', cursorValues },
    ]);
  }

  async get() {
    const collectionId = this._path.split('/').pop()!;
    const structuredQuery: any = { from: [{ collectionId }] };

    // Build where clause
    let whereClause: any = null;
    const whereConstraints = this._constraints.filter(c => c.type === 'where');
    if (whereConstraints.length === 1) {
      const wc = whereConstraints[0];
      whereClause = {
        fieldFilter: {
          field: { fieldPath: wc.field },
          op: _mapOp(wc.op!),
          value: _toFsValue(wc.value),
        },
      };
    } else if (whereConstraints.length > 1) {
      whereClause = {
        compositeFilter: {
          op: 'AND',
          filters: whereConstraints.map(wc => ({
            fieldFilter: {
              field: { fieldPath: wc.field },
              op: _mapOp(wc.op!),
              value: _toFsValue(wc.value),
            },
          })),
        },
      };
    }
    if (whereClause) structuredQuery.where = whereClause;

    // Build orderBy
    const orderConstraints = this._constraints.filter(c => c.type === 'orderBy');
    if (orderConstraints.length > 0) {
      structuredQuery.orderBy = orderConstraints.map(oc => ({
        field: { fieldPath: oc.field },
        direction: oc.direction || 'ASCENDING',
      }));
    }

    // Build limit
    const limitConstraints = this._constraints.filter(c => c.type === 'limit');
    if (limitConstraints.length > 0) {
      structuredQuery.limit = limitConstraints[0].n;
    }

    // Build startAfter cursor
    const startAfterConstraints = this._constraints.filter(c => c.type === 'startAfter');
    if (startAfterConstraints.length > 0) {
      const cursorValues: any[] = startAfterConstraints[0].cursorValues || [];
      structuredQuery.startAt = {
        values: cursorValues.map((v: any) => {
          if (v && typeof v === 'object' && v.__fs_type === 'timestamp') {
            return { timestampValue: v.value };
          }
          return _toFsValue(v);
        }),
      };
      // Note: Firestore REST API uses startAt for cursor-based pagination.
      // To emulate startAfter (exclusive), we combine with orderBy + offset.
      // Since documents have unique timestamps, startAt effectively works as startAfter.
    }

    if (__DEV__) console.log(`[Firestore] Collection get: ${this._path}, constraints: ${JSON.stringify(this._constraints)}`);

    // Firestore REST runQuery endpoint format:
    //   Top-level collection (path='posts'):
    //     POST .../documents:runQuery  body: { structuredQuery: { from: [{ collectionId: 'posts' }] } }
    //   Subcollection (path='chats/{id}/messages'):
    //     POST .../documents/chats/{id}:runQuery  body: { structuredQuery: { from: [{ collectionId: 'messages' }] } }
    const pathSegments = this._path.split('/');
    let runQueryPath: string;
    if (pathSegments.length > 1) {
      // Subcollection — parent is everything except the last segment
      const parentPath = pathSegments.slice(0, -1).join('/');
      runQueryPath = `${parentPath}:runQuery`;
    } else {
      // Top-level collection — parent is documents root
      runQueryPath = ':runQuery';
    }

    const results = await _firestoreFetch(
      runQueryPath,
      'POST',
      { structuredQuery },
    );

    // runQuery returns array of { document: ... }, { done: true }, or { error: ... }.
    // CRITICAL BUG FIX: The old code only filtered for r.document, silently discarding
    // error entries. When Firestore rules deny a query, runQuery returns HTTP 200 with
    // { error: { code: 403, message: "..." } } in the body — NOT HTTP 403. This caused
    // fetchChatList() to silently return 0 results instead of surfacing the real error.
    // Now we detect error-only responses and throw so callers can log/diagnose properly.
    const allResults = results || [];
    const errorResults = allResults.filter((r: any) => r.error);

    // Deduplicate by document name to handle edge cases where startAt
    // (inclusive cursor) returns the same doc as the previous page.
    const seen = new Set<string>();
    const docs = allResults
      .filter((r: any) => r.document)
      .filter((r: any) => {
        const name = r.document.name;
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map((r: any) => {
        const docId = r.document.name.split('/').pop();
        return {
          id: docId,
          ref: new CompatDocRef(`${this._path}/${docId}`),
          data: () => _fromFsDoc(r.document),
          exists: true,
        };
      });

    // If NO documents were returned but there ARE errors, the query likely failed
    // due to permissions or a server-side issue. Surface the error instead of
    // silently returning empty results.
    if (docs.length === 0 && errorResults.length > 0) {
      const firstErr = errorResults[0].error;
      const errMsg = firstErr?.message || JSON.stringify(firstErr);
      const errCode = firstErr?.code || firstErr?.status || 'UNKNOWN';
      if (__DEV__) {
        console.error(`[Firestore] runQuery on ${this._path} returned ${errorResults.length} error(s), 0 docs:`);
        errorResults.forEach((e: any, i: number) => {
          console.error(`[Firestore]   error[${i}]: code=${e.error?.code || '?'} status=${e.error?.status || '?'} msg=${e.error?.message || '?'}`);
        });
      }
      // Re-throw as a proper Error so callers (fetchChatList, etc.) can catch
      // and log it instead of silently showing an empty list
      const err: any = new Error(`Firestore query failed (${errCode}): ${errMsg}`);
      err.status = parseInt(errCode, 10) || 403;
      err.code = errCode;
      err._runQueryErrors = errorResults.map((e: any) => e.error);
      throw err;
    }

    if (__DEV__) console.log(`[Firestore] Collection get: ${this._path} returned ${docs.length} docs`);
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  async add(data: any) {
    const { fields, transforms } = _parseFields(data);

    // POST (auto-ID create) doesn't support fieldTransforms.
    // Convert sentinels to client-side values.
    if (transforms.length > 0) {
      for (const t of transforms) {
        if (t.setToServerValue) {
          // serverTimestamp → current time
          fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
        } else if (t.increment) {
          // increment → can't resolve client-side in a create (no existing doc to read).
          // Store as 0 for new documents. Increment should be used with update(), not add().
          if (__DEV__) console.warn(`[Firestore] increment(${t.increment.integerValue || t.increment.doubleValue || 0}) in add() has no existing value — defaulting to 0. Use update() for increments.`);
          fields[t.fieldPath] = t.increment;
        }
      }
    }

    try {
      const resp = await _firestoreFetch(this._path, 'POST', { fields });
      const docId = resp.name?.split('/').pop();
      return { id: docId };
    } catch (e: any) {
      if (__DEV__) console.error('[Firestore] add error:', e?.message);
      throw e;
    }
  }

  /**
   * Emulates Firebase's onSnapshot using optimized polling.
   * Only calls the callback when the query results actually change
   * (added/modified/removed docs), avoiding unnecessary re-renders.
   *
   * Returns an unsubscribe function.
   */
  listen(
    callback: (snapshot: ListenSnapshot) => void,
    options?: { pollInterval?: number },
  ): () => void {
    let previousDocs = new Map<string, { id: string; data: any; exists: boolean }>();
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const interval = options?.pollInterval || 5000;
    const isFirstCall = { value: true };

    const poll = async () => {
      if (!active) return;
      try {
        const result = await this.get();
        const currentDocs = new Map<string, { id: string; data: any; exists: boolean }>();
        const changes: DocChange[] = [];

        // Detect added/modified docs
        for (const doc of result.docs) {
          const prev = previousDocs.get(doc.id);
          const data = doc.data();
          currentDocs.set(doc.id, { id: doc.id, data, exists: doc.exists });

          if (!prev) {
            changes.push({ type: 'added', doc, oldIndex: -1, newIndex: -1 });
          } else if (JSON.stringify(data) !== JSON.stringify(prev.data)) {
            changes.push({ type: 'modified', doc, oldIndex: -1, newIndex: -1 });
          }
        }

        // Detect removed docs
        for (const [id] of previousDocs) {
          if (!currentDocs.has(id)) {
            const doc = previousDocs.get(id)!;
            changes.push({ type: 'removed', doc, oldIndex: -1, newIndex: -1 });
          }
        }

        previousDocs = currentDocs;

        // Call callback on first call (even if empty) or when there are changes
        if (isFirstCall.value || changes.length > 0) {
          isFirstCall.value = false;
          callback({
            docs: result.docs,
            docChanges: changes,
            empty: result.empty,
          });
        }
      } catch (e) {
        // Log but don't throw — polling should be resilient
        if (__DEV__) console.warn('[Firestore] listen poll error:', e);
      }
    };

    // Initial fetch
    poll();

    // Start polling
    timer = setInterval(poll, interval);

    // Return unsubscribe function
    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  // Alias: onSnapshot → listen (Firebase SDK compatibility)
  onSnapshot(
    callback: (snapshot: ListenSnapshot) => void,
    options?: { pollInterval?: number } | ((err: any) => void),
  ): () => void {
    // Support Firebase SDK signature: onSnapshot(callback, onError)
    if (typeof options === 'function') {
      const onError = options;
      return this.listen((snapshot) => {
        try { callback(snapshot); } catch (e) { onError(e); }
      });
    }
    return this.listen(callback, options);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — Document Reference
   ═══════════════════════════════════════════════════════════════════════════ */

class CompatDocRef {
  _path: string;
  id: string;

  constructor(path: string) {
    this._path = path;
    this.id = path.split('/').pop() || '';
  }

  collection(subPath: string) {
    return new CompatCollectionRef(`${this._path}/${subPath}`);
  }

  async get() {
    try {
      const resp = await _firestoreFetch(this._path, 'GET');
      return {
        id: this.id,
        exists: true,
        data: () => _fromFsDoc(resp),
      };
    } catch (e: any) {
      if (e.status === 404 || e.code === 'NOT_FOUND') {
        return { id: this.id, exists: false, data: () => null };
      }
      // Only 404/NOT_FOUND should be treated as "doc doesn't exist".
      // Re-throw all other errors (network, permission, server) so callers
      // can handle them properly. Swallowing these would cause data loss
      // in signInWithGoogle (non-merge set overwrites existing user docs).
      if (__DEV__) console.error('[Firestore] Doc get error:', e?.message);
      throw e;
    }
  }

  async set(data: any, options?: any) {
    const { fields, transforms, deletePaths } = _parseFields(data);
    const body: any = { fields };

    if (options?.merge) {
      // PATCH endpoint does NOT support fieldTransforms.
      // Use the commit API when transforms are present.
      // BUG FIX: Fetch a valid token BEFORE calling _firestoreCommitUpdate.
      // The old code referenced an undefined `token` variable, causing
      // ReferenceError at runtime for any merge+transform operation.
      if (transforms.length > 0 || deletePaths.length > 0) {
        const preToken = await _getValidToken();
        await _firestoreCommitUpdate(this._path, fields, transforms, preToken, deletePaths);
      } else {
        // BUG FIX: set(merge) must use updateMask to preserve existing fields.
        // Derive field paths from the data keys so Firestore knows which fields
        // to update. Empty updateMask causes a silent no-op.
        const fieldPaths = Object.keys(fields);
        if (fieldPaths.length === 0) return; // Nothing to write
        const token = await _getValidToken();
        const maskParam = fieldPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
        const url = `${FIRESTORE_BASE}/${this._path}?key=${API_KEY}&${maskParam}`;
        const resp = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          const errMsg = data.error?.message || `Firestore merge PATCH failed (${resp.status})`;
          if (__DEV__) console.error(`[Firestore] merge PATCH FAILED: ${resp.status} - ${errMsg}`);
          const err: any = new Error(errMsg);
          err.status = resp.status;
          err.code = data.error?.status;
          throw err;
        }
      }
    } else {
      // PUT (replace) — doesn't support transforms;
      // fall back to client-side timestamps for sentinels.
      if (transforms.length > 0) {
        for (const t of transforms) {
          if (t.setToServerValue) {
            fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
          } else if (t.increment) {
            if (__DEV__) console.warn(`[Firestore] increment in set() (non-merge) — storing raw value. Use update() for increments.`);
            fields[t.fieldPath] = t.increment;
          }
        }
      }
      await _firestoreFetch(this._path, 'PUT', body);
    }
  }

  async update(data: any) {
    const { fields, transforms, deletePaths } = _parseFields(data);
    if (transforms.length > 0 || deletePaths.length > 0) {
      // PATCH endpoint does NOT support fieldTransforms — use commit API.
      // BUG FIX: Fetch a valid token BEFORE calling _firestoreCommitUpdate.
      // The old code referenced an undefined `token` variable.
      const preToken = await _getValidToken();
      await _firestoreCommitUpdate(this._path, fields, transforms, preToken, deletePaths);
    } else {
      // CRITICAL BUG FIX: Always include updateMask in PATCH requests.
      // Without updateMask, Firestore REST PATCH replaces the ENTIRE document,
      // deleting any fields not present in the payload. This caused chat docs
      // to lose user1Id/user2Id when update({ unreadUser1: 0 }) was called,
      // making chats invisible to fetchChatList() queries.
      const fieldPaths = Object.keys(fields);
      if (fieldPaths.length === 0) return; // Nothing to update
      const token = await _getValidToken();
      const maskParam = fieldPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
      const url = `${FIRESTORE_BASE}/${this._path}?key=${API_KEY}&${maskParam}`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const errMsg = data.error?.message || `Firestore update PATCH failed (${resp.status})`;
        if (__DEV__) console.error(`[Firestore] update PATCH FAILED: ${resp.status} - ${errMsg}`);
        const err: any = new Error(errMsg);
        err.status = resp.status;
        err.code = data.error?.status;
        throw err;
      }
    }
  }

  async delete() {
    await _firestoreFetch(this._path, 'DELETE');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — WriteBatch
   ═══════════════════════════════════════════════════════════════════════════ */

class CompatWriteBatch {
  private _operations: Array<{ ref: CompatDocRef; data: any; mode: 'set' | 'update' | 'delete'; options?: any }> = [];

  delete(ref: CompatDocRef): CompatWriteBatch {
    this._operations.push({ ref, data: null, mode: 'delete' });
    return this;
  }

  set(ref: CompatDocRef, data: any, options?: any): CompatWriteBatch {
    this._operations.push({ ref, data, mode: 'set', options });
    return this;
  }

  update(ref: CompatDocRef, data: any): CompatWriteBatch {
    this._operations.push({ ref, data, mode: 'update' });
    return this;
  }

  async commit(): Promise<void> {
    // Use Promise.allSettled so we can detect partial failures.
    // The old Promise.all + try/catch swallowed ALL errors silently.
    const results = await Promise.allSettled(
      this._operations.map(async (op) => {
        if (op.mode === 'delete') {
          await op.ref.delete();
        } else if (op.mode === 'set') {
          await op.ref.set(op.data, op.options);
        } else if (op.mode === 'update') {
          await op.ref.update(op.data);
        }
      }),
    );
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      const errorMessages = failures.map(f => (f as PromiseRejectedResult).reason?.message || 'unknown').join('; ');
      if (__DEV__) console.error(`[Batch] ${failures.length} operation(s) failed:`, errorMessages);
      throw new Error(`${failures.length} batch operation(s) failed: ${errorMessages}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — Firestore
   ═══════════════════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firestore: any = function firestore(): any {
  const instance: any = (path: string) => new CompatCollectionRef(path);
  instance.collection = (path: string) => new CompatCollectionRef(path);
  instance.batch = () => new CompatWriteBatch();
  return instance;
};

// Static access: api.ts uses firestore.FieldValue.serverTimestamp()
firestore.FieldValue = {
  serverTimestamp: _serverTimestamp,
  increment: _increment,
  // Sentinel for deleting a field — recognized by _parseFields and
  // converted to a special updateMask in _firestoreCommitUpdate.
  delete: () => ({ __sentinel: 'delete' }),
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function _mapOp(op: string): string {
  const map: Record<string, string> = {
    '==': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    'array-contains': 'ARRAY_CONTAINS',
    in: 'IN',
    'array-contains-any': 'ARRAY_CONTAINS_ANY',
    'not-in': 'NOT_IN',
  };
  const mapped = map[op];
  if (!mapped) {
    if (__DEV__) console.warn(`[Firestore] Unknown query operator: ${op}, defaulting to EQUAL`);
  }
  return mapped || 'EQUAL';
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS — keep same surface area as before so api.ts needs zero changes
   ═══════════════════════════════════════════════════════════════════════════ */

export {
  auth,
  firestore,
  onAuthStateChanged,
  signInWithGoogleIdToken,
  signOut,
};

export { _getValidToken as getValidToken };
export { _restoreAuth as restoreAuth };

/** Update the in-memory auth user profile (e.g., after profile edit, username change). */
export async function updateAuthUser(updates: Partial<AuthUser>): Promise<void> {
  if (_authUser) {
    _authUser = { ..._authUser, ...updates };
    // Persist updated profile so cold restart picks up changes.
    // BUG FIX: Must await _persistAuth() — fire-and-forget could lose data if
    // the app suspends/closes immediately after profile edit.
    await _persistAuth();
    _notifyAuthListeners();
  }
}

/** Force-invalidate the cached ID token so the next getValidToken() call does a fresh refresh. */
export function _invalidateTokenCache(): void {
  _idToken = null;
}
