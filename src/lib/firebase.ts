// Firebase REST API — NO Web SDK, NO polyfills needed.
// Uses pure fetch() for Auth + Firestore. Works in React Native without any shims.

const API_KEY = 'AIzaSyDOGRbI4V82VJ0KZND3v1ggfO5s3933-3w';
const PROJECT_ID = 'black94';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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
const _authListeners = new Set<(user: any) => void>();

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
  console.log('[Firebase] Signing in via REST API...');
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
  const data = await resp.json();

  if (!resp.ok) {
    const msg = data.error?.message || `Auth HTTP ${resp.status}`;
    console.error('[Firebase] Auth REST error:', msg);
    throw new Error(msg);
  }

  _authUser = {
    uid: data.localId,
    email: data.email || null,
    displayName: data.displayName || null,
    photoURL: data.photoUrl || null,
  };
  _idToken = data.idToken;
  _refreshToken = data.refreshToken;

  console.log('[Firebase] Sign-in successful (REST):', _authUser.uid);
  _notifyAuthListeners();

  return { user: _authUser };
}

async function signOut(_authRef?: any) {
  // Firebase REST API has no dedicated sign-out endpoint.
  // Local token clearing is sufficient. Google OAuth revoke is handled in api.ts.
  _authUser = null;
  _idToken = null;
  _refreshToken = null;
  console.log('[Firebase] Signed out (REST)');
  _notifyAuthListeners();
}

/* ── Token refresh ────────────────────────────────────────────────────────── */

// Decode JWT payload to check expiry (no library needed)
function _isTokenExpired(token: string): boolean {
  try {
    // JWT uses base64url encoding — convert to standard base64 for atob()
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    // Consider expired if less than 60 seconds remaining
    return payload.exp * 1000 < Date.now() + 60000;
  } catch {
    return true; // If we can't parse, assume expired
  }
}

async function _getValidToken(): Promise<string> {
  // Check if current token is still valid
  if (_idToken && !_isTokenExpired(_idToken)) return _idToken;

  if (!_refreshToken) throw new Error('Not authenticated');

  // Invalidate cached token before attempting refresh
  _idToken = null;

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
    const data = await resp.json();
    if (!data.id_token) throw new Error('Token refresh failed');
    _idToken = data.id_token;
    _refreshToken = data.refresh_token || _refreshToken;
    return _idToken;
  } catch (e: any) {
    // Refresh failed — clear everything only if refresh token is truly dead
    _idToken = null;
    _refreshToken = null;
    // Do NOT clear _authUser here — let the caller decide.
    // This prevents mid-session data loss on transient errors.
    throw new Error('Session expired — please sign in again');
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

  console.log(`[Firestore] ${method} ${url}`);
  if (body !== undefined) console.log(`[Firestore] body: ${JSON.stringify(body).slice(0, 500)}`);

  let resp = await fetch(url, opts);
  console.log(`[Firestore] response: ${resp.status} ${resp.statusText}`);

  // Auto-refresh on 401 — invalidate token first so refresh actually runs
  if (resp.status === 401) {
    console.log(`[Firestore] 401 on ${method} ${path} — refreshing token...`);
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
    console.log(`[Firestore] After token refresh: ${resp.status}`);
  }

  // Safely parse response — may not be JSON on errors
  let data: any;
  const respText = await resp.text();
  try {
    data = JSON.parse(respText);
  } catch {
    console.error(`[Firestore] Non-JSON response (${resp.status}): ${respText.slice(0, 500)}`);
    throw new Error(`Firestore HTTP ${resp.status}: ${respText.slice(0, 200)}`);
  }

  if (!resp.ok) {
    const errMsg = data.error?.message || JSON.stringify(data).slice(0, 300) || `Firestore HTTP ${resp.status}`;
    const err: any = new Error(errMsg);
    err.status = resp.status;
    err.code = data.error?.status;
    // Log full error details for debugging
    console.error(`[Firestore] ${method} ${path} FAILED: ${resp.status} ${data.error?.status} - ${errMsg}`);
    console.error(`[Firestore] Full error response: ${respText.slice(0, 500)}`);
    // If it's a composite index error, include helpful info
    if (data.error?.message?.includes('FAILED_PRECONDITION') || errMsg.includes('index')) {
      console.error(`[Firestore] COMPOSITE INDEX NEEDED. Create it at: https://console.firebase.google.com/project/${PROJECT_ID}/firestore/indexes`);
      err.message = `Firestore index needed. Please create the composite index as logged.`;
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
} {
  const fields: Record<string, any> = {};
  const transforms: any[] = [];

  for (const [key, value] of Object.entries(data)) {
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
      }
    } else {
      const fsVal = _toFsValue(value);
      if (fsVal !== null) fields[key] = fsVal;
    }
  }

  return { fields, transforms };
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — Collection Reference
   ═══════════════════════════════════════════════════════════════════════════ */

interface Constraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  value?: any;
  direction?: string;
  n?: number;
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

    console.log(`[Firestore] Collection get: ${this._path}, constraints: ${JSON.stringify(this._constraints)}`);

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

    // runQuery returns array of { document: ... } or { done: true }
    const docs = (results || [])
      .filter((r: any) => r.document)
      .map((r: any) => {
        const docId = r.document.name.split('/').pop();
        return {
          id: docId,
          ref: new CompatDocRef(`${this._path}/${docId}`),
          data: () => _fromFsDoc(r.document),
          exists: true,
        };
      });

    console.log(`[Firestore] Collection get: ${this._path} returned ${docs.length} docs`);
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  async add(data: any) {
    const { fields, transforms } = _parseFields(data);

    // POST (auto-ID create) doesn't support fieldTransforms.
    // Convert serverTimestamp sentinels to client timestamps.
    if (transforms.length > 0) {
      for (const t of transforms) {
        if (t.setToServerValue) {
          fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
        }
      }
    }

    try {
      const resp = await _firestoreFetch(this._path, 'POST', { fields });
      const docId = resp.name?.split('/').pop();
      return { id: docId };
    } catch (e: any) {
      console.error('[Firestore] add error:', e?.message);
      throw e;
    }
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
      console.warn('[Firestore] Doc get error:', e?.message);
      return { id: this.id, exists: false, data: () => null };
    }
  }

  async set(data: any, options?: any) {
    const { fields, transforms } = _parseFields(data);
    const body: any = { fields };

    if (options?.merge) {
      // PATCH — supports fieldTransforms natively
      if (transforms.length > 0) body.fieldTransforms = transforms;
      await _firestoreFetch(this._path, 'PATCH', body);
    } else {
      // PUT (replace) — doesn't reliably support transforms;
      // fall back to client-side timestamps for sentinels.
      if (transforms.length > 0) {
        for (const t of transforms) {
          if (t.setToServerValue) {
            fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
          }
        }
      }
      await _firestoreFetch(this._path, 'PUT', body);
    }
  }

  async update(data: any) {
    const { fields, transforms } = _parseFields(data);
    const body: any = { fields };
    if (transforms.length > 0) body.fieldTransforms = transforms;
    await _firestoreFetch(this._path, 'PATCH', body);
  }

  async delete() {
    try {
      await _firestoreFetch(this._path, 'DELETE');
    } catch (e: any) {
      console.warn('[Firestore] delete error:', e?.message);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — WriteBatch
   ═══════════════════════════════════════════════════════════════════════════ */

class CompatWriteBatch {
  private _operations: Array<{ ref: CompatDocRef; data: any; mode: 'set' | 'update' | 'delete' }> = [];

  delete(ref: CompatDocRef): CompatWriteBatch {
    this._operations.push({ ref, data: null, mode: 'delete' });
    return this;
  }

  set(ref: CompatDocRef, data: any): CompatWriteBatch {
    this._operations.push({ ref, data, mode: 'set' });
    return this;
  }

  update(ref: CompatDocRef, data: any): CompatWriteBatch {
    this._operations.push({ ref, data, mode: 'update' });
    return this;
  }

  async commit(): Promise<void> {
    // Firestore REST API supports batch writes via a single commit endpoint.
    // We fire all operations — deletes are independent, sets/updates are PATCH/PUT.
    const promises = this._operations.map(async (op) => {
      try {
        if (op.mode === 'delete') {
          await op.ref.delete();
        } else if (op.mode === 'set') {
          await op.ref.set(op.data);
        } else if (op.mode === 'update') {
          await op.ref.update(op.data);
        }
      } catch (e: any) {
        console.warn('[Batch] Operation failed:', e?.message);
      }
    });
    await Promise.all(promises);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPAT — Firestore
   ═══════════════════════════════════════════════════════════════════════════ */

function firestore(): any {
  const instance: any = (path: string) => new CompatCollectionRef(path);
  instance.collection = (path: string) => new CompatCollectionRef(path);
  instance.batch = () => new CompatWriteBatch();
  return instance;
}

// Static access: api.ts uses firestore.FieldValue.serverTimestamp()
(firestore as any).FieldValue = { serverTimestamp: _serverTimestamp, increment: _increment };

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
  return map[op] || 'EQUAL';
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS — keep same surface area as before so api.ts needs zero changes
   ═══════════════════════════════════════════════════════════════════════════ */

// Stub GoogleAuthProvider (not used directly but kept for backward compat)
const GoogleAuthProvider = { credential: (_token: string) => ({}) };

export {
  auth,
  firestore,
  onAuthStateChanged,
  signInWithGoogleIdToken,
  signOut,
  GoogleAuthProvider,
};
