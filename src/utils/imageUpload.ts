/**
 * imageUpload.ts — Firebase Storage upload utility for React Native (Expo)
 *
 * Handles uploading optimized images to Firebase Cloud Storage using the
 * REST API (consistent with the project's no-SDK approach in firebase.ts).
 *
 * Features:
 *  - Simple (one-shot) uploads with progress tracking via XMLHttpRequest
 *  - Automatic retry with exponential backoff on transient failures
 *  - Auth token injection for Firebase Storage security rules
 *  - Download URL generation (public or token-authenticated)
 *  - Clean deletion of stored images
 *
 * Why REST API instead of @react-native-firebase/storage?
 *  The project deliberately avoids native Firebase SDKs (see firebase.ts header)
 *  and uses pure fetch() for Auth + Firestore. Staying consistent avoids
 *  adding a large native dependency just for storage, keeps the app size
 *  smaller, and eliminates polyfill/shim issues.
 *
 * Why simple upload instead of resumable?
 *  The previous resumable upload implementation failed on some Android devices
 *  because fetch() may not return the Location header needed for the second
 *  step. Simple upload sends the entire file in a single POST request — fewer
 *  moving parts, no header dependency, works reliably across all devices.
 *  For the typical post photo (< 5MB after compression), simple upload is
 *  more than adequate.
 *
 * Upload flow:
 *  1. Read local file as base64 via expo-file-system
 *  2. Decode base64 → binary ArrayBuffer
 *  3. POST binary data to Firebase Storage (uploadType=media)
 *  4. Extract download token from response
 *  5. Construct download URL from storage path + token
 *
 * Memory & battery:
 *  - Uses XMLHttpRequest (available in RN) for upload progress events
 *  - Reads files as base64 to avoid encoding issues across platforms
 *  - Respects AbortController for cancellable uploads
 */

import { getValidToken } from '../lib/firebase';

/** Reference to the firebase module for token cache invalidation */
let _firebaseModule: any = null;
async function _invalidateTokenAndRetry(): Promise<string> {
  // Dynamic import to avoid circular dependency
  if (!_firebaseModule) {
    _firebaseModule = await import('../lib/firebase');
  }
  // Force-invalidate the cached token so the next getValidToken() call
  // does a fresh refresh instead of returning a stale cached token.
  // The firebase module exports _invalidateTokenCache for this purpose.
  if (typeof _firebaseModule._invalidateTokenCache === 'function') {
    _firebaseModule._invalidateTokenCache();
  }
  return getValidToken();
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Firebase project ID — must match firebase.ts and google-services.json */
const PROJECT_ID = 'black94';

/** Firebase Storage bucket — must match google-services.json storage_bucket field.
 *  Firebase now defaults to {projectId}.firebasestorage.app for new projects. */
const STORAGE_BUCKET = `${PROJECT_ID}.firebasestorage.app`;

/** Base URL for Firebase Storage REST API (includes /o for object operations) */
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;

/** Maximum number of upload retry attempts */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubles each retry) */
const RETRY_BASE_DELAY = 1000;

/** Maximum backoff delay cap in ms */
const RETRY_MAX_DELAY = 10000;

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Progress callback — called with bytes uploaded and total bytes */
export type UploadProgressCallback = (uploaded: number, total: number) => void;

/** Result of a successful image upload */
export interface UploadResult {
  /** Public download URL for the uploaded file */
  downloadUrl: string;
  /** Full Firebase Storage path (e.g., 'users/uid/photos/img123.jpg') */
  storagePath: string;
  /** MIME type that was set during upload */
  mimeType: string;
  /** Size of the uploaded file in bytes */
  size: number;
  /** Time the upload took in milliseconds */
  uploadTimeMs: number;
}

/** Options for uploadOptimizedImage */
export interface UploadOptions {
  /** MIME type override. If not provided, detected from the URI extension. */
  mimeType?: string;
  /** Custom metadata to attach to the file in Firebase Storage. */
  metadata?: Record<string, string>;
  /** Callback for upload progress (0 → total bytes). */
  onProgress?: UploadProgressCallback;
  /** Signal to abort an in-flight upload. */
  abortSignal?: AbortSignal;
  /** Max retry attempts. Default: 3. */
  maxRetries?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Delays execution for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detects MIME type from a file URI extension.
 * Defaults to 'image/jpeg' if the extension is unrecognized.
 */
function detectMimeType(uri: string, override?: string): string {
  if (override) return override;
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return 'image/png';
  if (cleanUri.endsWith('.gif')) return 'image/gif';
  if (cleanUri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Encodes a Firebase Storage path for use in URLs.
 * Encodes each path segment separately, preserving '/' separators.
 * This is correct for use in both query parameters and URL paths.
 */
function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Calculates the exponential backoff delay for a given retry attempt.
 * Adds jitter (±20%) to avoid thundering-herd issues.
 */
function getRetryDelay(attempt: number): number {
  const baseDelay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), RETRY_MAX_DELAY);
  const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDelay + jitter));
}

/**
 * Pure JavaScript base64 decoder — works in ALL React Native / Expo environments.
 *
 * WHY NOT atob()?
 *  - atob() is a browser global that was added to React Native 0.72+
 *  - With Expo's New Architecture (Fabric), atob() may NOT be available
 *  - Using atob() in imageUpload.ts was causing silent upload failures
 *
 * This implementation uses Buffer.from() (available in React Native) as a
 * fast path, with a pure JS polyfill as fallback.
 */
function safeBase64Decode(base64: string): Uint8Array {
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
  // Removing it breaks decoding for inputs whose length % 4 !== 0.
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

/**
 * Reads a local file as a base64 string using expo-file-system.
 * Required because React Native's XMLHttpRequest doesn't support
 * sending raw file URIs in all environments.
 */
async function readFileAsBase64(uri: string): Promise<string> {
  // expo-file-system v19 (Expo SDK 54) moved legacy functions to a separate
  // entry point. Importing from 'expo-file-system' throws at runtime.
  // The /legacy subpath exports the same API that always worked.
  const fsModule = await import('expo-file-system/legacy');
  const FileSystem = (fsModule as any).default || fsModule;

  // Strategy:
  //   1. Try reading the URI directly (works for file://, content://, asset://)
  //   2. If that fails AND the URI starts with file://, strip the scheme
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as const,
    });
    return base64;
  } catch (directErr: any) {
    if (uri.startsWith('file://')) {
      try {
        const filePath = uri.slice(7);
        const base64 = await FileSystem.readAsStringAsync(filePath, {
          encoding: 'base64' as const,
        });
        return base64;
      } catch {
        // Fall through to throw original error
      }
    }
    throw directErr;
  }
}

/**
 * Gets the file size in bytes for a local URI.
 */
async function getFileSize(uri: string): Promise<number> {
  try {
    const fsModule = await import('expo-file-system/legacy');
    const FileSystem = (fsModule as any).default || fsModule;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info) {
      return info.size as number;
    }
    return 0;
  } catch {
    return 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPLOAD — Core Implementation (Simple/One-shot Upload)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Perform a single upload attempt using XMLHttpRequest with progress tracking.
 *
 * Uses Firebase Storage's simple (one-shot) upload endpoint:
 *   POST /v0/b/{bucket}/o?uploadType=media&name={path}
 *   Headers: Authorization, Content-Type
 *   Body: raw binary ArrayBuffer
 *
 * The server responds with JSON containing downloadTokens.
 *
 * @returns Download URL string
 */
function doUpload(
  uploadUrl: string,
  binaryBody: ArrayBuffer,
  mimeType: string,
  token: string,
  encodedPath: string,
  onProgress?: UploadProgressCallback,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const downloadToken = data.downloadTokens?.split(',')[0];
          if (downloadToken) {
            resolve(`${STORAGE_BASE}/${encodedPath}?alt=media&token=${downloadToken}`);
          } else {
            // No token — construct URL without it (works for public-read rules)
            resolve(`${STORAGE_BASE}/${encodedPath}?alt=media`);
          }
        } catch {
          // Non-JSON response — construct URL from known path
          resolve(`${STORAGE_BASE}/${encodedPath}?alt=media`);
        }
      } else {
        const error: any = new Error(
          `Upload failed: HTTP ${xhr.status} — ${xhr.responseText?.slice(0, 300)}`,
        );
        error.status = xhr.status;
        reject(error);
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload — check your internet connection'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Upload timed out — try again with a better connection'));
    };

    // Handle abort signal
    const onAbort = () => {
      xhr.abort();
      reject(new Error('Upload aborted'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    // Send the upload
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.timeout = 5 * 60 * 1000; // 5 minutes
    xhr.send(binaryBody);

    // Cleanup abort listener when xhr completes
    xhr.onloadend = () => {
      abortSignal?.removeEventListener('abort', onAbort);
    };
  });
}

/**
 * uploadOptimizedImage — Uploads an optimized image to Firebase Storage
 *
 * Uses Firebase Storage's simple (one-shot) upload REST endpoint with
 * progress tracking via XMLHttpRequest and automatic retry on transient
 * failures.
 *
 * The simple upload protocol sends the entire file in a single POST:
 *   POST /v0/b/{bucket}/o?uploadType=media&name={path}
 *   Headers: Authorization: Bearer {token}, Content-Type: {mimeType}
 *   Body: raw binary bytes
 *
 * This is more reliable than resumable upload on React Native because:
 *  - No dependency on the Location response header (which may be stripped
 *    by Android's OkHttp on some devices/configurations)
 *  - Single request — fewer failure points
 *  - Same proven approach used by storage.ts for avatars, chat media, etc.
 *
 * @param uri - Local file URI of the optimized image
 * @param path - Firebase Storage path (e.g., 'users/uid/posts/photo123.jpg')
 * @param options - Upload configuration (progress callback, MIME type, etc.)
 * @returns UploadResult with download URL and metadata
 */
export async function uploadOptimizedImage(
  uri: string,
  path: string,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const {
    mimeType: mimeTypeOverride,
    metadata = {},
    onProgress,
    abortSignal,
    maxRetries = MAX_RETRIES,
  } = options;

  const mimeType = detectMimeType(uri, mimeTypeOverride);
  const startTime = Date.now();

  // Read the file as base64, then decode to binary ArrayBuffer.
  // Firebase Storage expects raw binary bytes — sending base64 as a string
  // would store the base64 characters as the file content (corrupted image).
  console.log(`[imageUpload] Reading file: ${uri} (${mimeType})`);
  const base64Data = await readFileAsBase64(uri);
  const bytes = safeBase64Decode(base64Data);

  const fileSize = bytes.byteLength;
  if (fileSize === 0) {
    throw new Error(`File is empty or could not be read: ${uri}`);
  }

  // BLACK PHOTO FIX: Sanity check — a valid image should be at least 100 bytes.
  // Anything smaller is almost certainly corrupted data (e.g., empty PNG header,
  // truncated JPEG). This catches expo-image-manipulator bugs that produce
  // near-empty files on certain Android devices.
  if (fileSize < 100) {
    throw new Error(`File too small to be a valid image (${fileSize} bytes): ${uri}`);
  }

  console.log(`[imageUpload] File read successfully: ${fileSize} bytes`);

  // Ensure clean ArrayBuffer copy (avoid SharedArrayBuffer views)
  const binaryBody: ArrayBuffer = bytes.buffer.byteLength === bytes.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  // Build the simple upload URL
  const encodedPath = encodeStoragePath(path);
  const uploadUrl = `${STORAGE_BASE}?name=${encodedPath}&uploadType=media`;

  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check for abort before starting
      if (abortSignal?.aborted) {
        throw new Error('Upload aborted');
      }

      // Get an auth token
      // On retry attempts, invalidate the cached token first to force a fresh refresh
      const token = attempt > 0
        ? await _invalidateTokenAndRetry()
        : await getValidToken();

      console.log(`[imageUpload] Upload attempt ${attempt + 1}/${maxRetries + 1} to ${path}`);

      const downloadUrl = await doUpload(
        uploadUrl,
        binaryBody,
        mimeType,
        token,
        encodedPath,
        onProgress,
        abortSignal,
      );

      // Final progress callback at 100%
      if (onProgress) {
        onProgress(fileSize, fileSize);
      }

      console.log(`[imageUpload] Upload succeeded in ${Date.now() - startTime}ms: ${downloadUrl.slice(0, 80)}...`);

      return {
        downloadUrl,
        storagePath: path,
        mimeType,
        size: fileSize,
        uploadTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      lastError = err;
      console.warn(`[imageUpload] Attempt ${attempt + 1} failed: ${err.message} (status: ${err.status || 'none'})`);

      // Don't retry aborted uploads
      if (abortSignal?.aborted || err.message === 'Upload aborted') {
        break;
      }

      // Don't retry if we've exhausted retries
      if (attempt >= maxRetries) {
        break;
      }

      // Determine if error is retryable
      const isAuthError = !err.status && (
        err.message?.includes('Not authenticated') ||
        err.message?.includes('Session expired') ||
        err.message?.includes('Token refresh') ||
        err.message?.includes('sign in again')
      );

      // Network errors (no status) — could be transient
      const isNetworkError = !err.status && !isAuthError;

      // HTTP status codes that are safe to retry
      const retryableStatus = err.status && [401, 408, 429, 500, 502, 503, 504].includes(err.status);

      if (isAuthError || isNetworkError || retryableStatus) {
        const retryDelay = getRetryDelay(attempt);
        console.log(`[imageUpload] Retrying in ${retryDelay}ms...`);
        await delay(retryDelay);
        continue;
      }

      // Non-retryable error (e.g., 403 forbidden, 404 not found)
      // 403 = storage rules issue — log helpful message
      if (err.status === 403) {
        console.error(
          `[imageUpload] 403 PERMISSION DENIED uploading to ${path}. ` +
          `This means Firebase Storage security rules are blocking the upload. ` +
          `Fix: run 'firebase deploy --only storage:rules' or check deploy-rules GitHub workflow.`,
        );
      }
      break;
    }
  }

  // All retries exhausted
  const errorMessage = lastError?.message || 'Upload failed after all retry attempts';
  console.error(`[imageUpload] Upload FAILED permanently: ${errorMessage}`);
  throw new Error(errorMessage);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * deleteImage — Deletes a file from Firebase Storage
 *
 * Sends a DELETE request to the Firebase Storage REST API.
 * Requires authentication — the user must have permission to delete the file
 * (enforced by Firebase Storage security rules on the server).
 *
 * Silently succeeds if the file doesn't exist (idempotent behavior).
 *
 * @param storagePath - The full path in Firebase Storage (e.g., 'users/uid/photo.jpg')
 *
 * @example
 * ```typescript
 * await deleteImage('users/abc123/posts/post456.jpg');
 * ```
 */
export async function deleteImage(storagePath: string): Promise<void> {
  try {
    const token = await getValidToken();

    const encodedPath = encodeStoragePath(storagePath);
    const url = `${STORAGE_BASE}/${encodedPath}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    // 404 is acceptable — file was already deleted or never existed
    if (response.ok || response.status === 404) {
      console.log(`[imageUpload] Deleted: ${storagePath}`);
      return;
    }

    // Log but don't throw for permission errors — the UI should handle this gracefully
    const errorBody = await response.text().catch(() => '');
    console.warn(
      `[imageUpload] Failed to delete ${storagePath}: ${response.status} ${errorBody}`,
    );
  } catch (err: any) {
    // Network errors during delete are non-critical — log and continue
    console.warn(`[imageUpload] Delete error for ${storagePath}:`, err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOWNLOAD URL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * getImageDownloadUrl — Gets a fresh download URL for a stored image
 *
 * Fetches the object metadata from Firebase Storage to obtain the current
 * download token, then constructs a fully-qualified download URL.
 *
 * This is useful when:
 *  - You only have the storage path (not a saved download URL)
 *  - Download tokens have expired and need refreshing
 *  - You need a canonical URL for caching keys
 *
 * @param storagePath - The full path in Firebase Storage
 * @returns The download URL string, or null if the file doesn't exist
 *
 * @example
 * ```typescript
 * const url = await getImageDownloadUrl('users/uid/profile.jpg');
 * if (url) {
 *   setImageUri(url);
 * }
 * ```
 */
export async function getImageDownloadUrl(
  storagePath: string,
): Promise<string | null> {
  try {
    const token = await getValidToken();

    const encodedPath = encodeStoragePath(storagePath);
    const url = `${STORAGE_BASE}/${encodedPath}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      console.log(`[imageUpload] File not found: ${storagePath}`);
      return null;
    }

    if (!response.ok) {
      console.warn(
        `[imageUpload] Failed to get metadata for ${storagePath}: ${response.status}`,
      );
      return null;
    }

    const data = await response.json();
    const downloadTokens = data.downloadTokens;

    if (!downloadTokens) {
      // No token means the bucket may have default public access rules
      // Return the URL without a token
      return `${STORAGE_BASE}/${encodedPath}?alt=media`;
    }

    // downloadTokens is a comma-separated string of tokens
    // Use the first (most recent) token
    const firstToken = downloadTokens.split(',')[0];
    return `${STORAGE_BASE}/${encodedPath}?alt=media&token=${firstToken}`;
  } catch (err: any) {
    console.warn(`[imageUpload] getImageDownloadUrl error:`, err.message);
    return null;
  }
}
