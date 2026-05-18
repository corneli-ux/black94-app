/**
 * imageUpload.ts — Firebase Storage upload utility for React Native (Expo)
 *
 * Handles uploading optimized images to Firebase Cloud Storage using the
 * REST API (consistent with the project's no-SDK approach in firebase.ts).
 *
 * Features:
 *  - Resumable uploads with progress tracking via XMLHttpRequest
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
 * Firebase Storage REST API reference:
 *  https://firebase.google.com/docs/storage/rest/start
 *
 * Upload flow:
 *  1. POST to create a resumable upload session → get upload URL
 *  2. PUT file data to the upload URL → get final metadata
 *  3. Construct download URL from the returned object metadata
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

/** Base URL for Firebase Storage REST API */
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}`;

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
 * Firebase uses URL-encoded object paths (spaces → %20, etc.)
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
 * Checks if an error is transient and worth retrying.
 * Network errors, timeouts, and 5xx server errors are retryable.
 * 4xx errors (auth, not found, etc.) are NOT retryable.
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Network-level errors (no response received)
  if (!error.status) return true;

  // HTTP status codes that are safe to retry
  const retryableStatuses = [408, 429, 500, 502, 503, 504];
  return retryableStatuses.includes(error.status);
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
  const { default: FileSystem } = await import('expo-file-system');

  // expo-file-system v16+ (Expo SDK 54+) accepts full URIs directly
  // including file://, content://, asset://, and expo-file-system:// URIs.
  // Stripping the scheme (old approach) breaks content:// URIs on Android
  // and asset:// URIs on both platforms.
  //
  // Strategy:
  //   1. Try reading the URI directly (works for most cases in SDK 54+)
  //   2. If that fails with a "not found" error AND the URI starts with file://,
  //      fall back to stripping file:// (legacy behavior for older SDK versions)
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
    const { default: FileSystem } = await import('expo-file-system');
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
   UPLOAD — Core Implementation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * uploadOptimizedImage — Uploads an optimized image to Firebase Storage
 *
 * Uses Firebase Storage's resumable upload REST endpoint with full
 * progress tracking and automatic retry on transient failures.
 *
 * The resumable upload protocol works in two steps:
 *  1. POST to initiate → server returns an upload URL
 *  2. PUT the file data to the upload URL
 *
 * Using resumable (instead of simple upload) because:
 *  - Supports upload progress tracking
 *  - Can be resumed after network interruptions
 *  - Handles larger files more reliably
 *
 * @param uri - Local file URI of the optimized image
 * @param path - Firebase Storage path (e.g., 'users/uid/posts/photo123.jpg')
 * @param options - Upload configuration (progress callback, MIME type, etc.)
 * @returns UploadResult with download URL and metadata
 *
 * @example
 * ```typescript
 * const result = await uploadOptimizedImage(
 *   optimizedImage.uri,
 *   `users/${userId}/posts/${postId}.jpg`,
 *   {
 *     mimeType: 'image/jpeg',
 *     onProgress: (uploaded, total) => {
 *       console.log(`${Math.round((uploaded / total) * 100)}%`);
 *     },
 *   }
 * );
 * console.log('Download URL:', result.downloadUrl);
 * ```
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
  const fileSize = await getFileSize(uri);
  const startTime = Date.now();

  if (fileSize === 0) {
    throw new Error(`File is empty or does not exist: ${uri}`);
  }

  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check for abort before starting
      if (abortSignal?.aborted) {
        throw new Error('Upload aborted');
      }

      // Step 1: Get an auth token for the upload
      // On retry attempts (attempt > 0), invalidate the cached token first
      // to force a fresh refresh — the previous token may have expired
      // between the failed attempt and now.
      const token = attempt > 0
        ? await _invalidateTokenAndRetry()
        : await getValidToken();

      // Step 2: Initiate a resumable upload session
      // POST to the storage endpoint with object metadata
      const initiateUrl = `${STORAGE_BASE}/o?uploadType=resumable&name=${encodeStoragePath(path)}`;

      const metadataObj: Record<string, string> = {
        name: path,
        contentType: mimeType,
        ...metadata,
      };

      const initiateResponse = await fetch(initiateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
        },
        body: JSON.stringify(metadataObj),
      });

      if (!initiateResponse.ok) {
        const errorBody = await initiateResponse.text();
        const error: any = new Error(`Upload failed (HTTP ${initiateResponse.status}): ${errorBody.slice(0, 200)}`);
        error.status = initiateResponse.status;
        error.body = errorBody;
        // 401 = auth token expired — invalidate and retry immediately
        if (initiateResponse.status === 401 && attempt < maxRetries) {
          if (__DEV__) console.log('[imageUpload] 401 on initiate — invalidating token and retrying');
          const retryDelay = getRetryDelay(attempt);
          await delay(retryDelay);
          continue; // Skip to next retry iteration
        }
        // 403 = permission denied (storage rules). Log clearly so it's not confused with network error.
        if (initiateResponse.status === 403) {
          console.error(
            `[imageUpload] 403 PERMISSION DENIED uploading to ${path}. ` +
            `This usually means Firebase Storage security rules are not deployed. ` +
            `Fix: run 'firebase deploy --only storage:rules' or check the deploy-rules GitHub workflow. ` +
            `Error: ${errorBody.slice(0, 300)}`
          );
        }
        throw error;
      }

      // The upload URL is returned in the Location header
      const uploadUrl = initiateResponse.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('Upload session initiated but no upload URL returned');
      }

      // Step 3: Upload the file data
      // Read as base64, then decode to binary ArrayBuffer for Firebase Storage.
      // Firebase Storage expects raw binary bytes — sending base64 as a string
      // would store the base64 characters as the file content (corrupted image).
      const base64Data = await readFileAsBase64(uri);

      // Decode base64 → binary ArrayBuffer
      // Use safeBase64Decode instead of atob() — atob is NOT reliably available
      // in all React Native / Expo environments (especially with New Architecture).
      const bytes = safeBase64Decode(base64Data);

      const downloadUrl = await new Promise<string>((resolve, reject) => {
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
            // Success — parse the response to get download tokens
            try {
              const responseData = JSON.parse(xhr.responseText);
              // The download URL can be constructed from the object metadata
              // Format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token={token}
              const downloadToken = responseData.downloadTokens;
              if (downloadToken) {
                const url = `${STORAGE_BASE}/o/${encodeStoragePath(path)}?alt=media&token=${downloadToken.split(',')[0]}`;
                resolve(url);
              } else {
                // Fallback: construct without token (works for public rules)
                resolve(`${STORAGE_BASE}/o/${encodeStoragePath(path)}?alt=media`);
              }
            } catch {
              // If response isn't valid JSON, construct URL from the known path
              resolve(`${STORAGE_BASE}/o/${encodeStoragePath(path)}?alt=media`);
            }
          } else {
            const error: any = new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`);
            error.status = xhr.status;
            error.body = xhr.responseText;
            reject(error);
          }
        };

        xhr.onerror = () => {
          const error = new Error('Network error during upload');
          reject(error);
        };

        xhr.ontimeout = () => {
          const error = new Error('Upload timed out');
          reject(error);
        };

        // Handle abort signal
        const onAbort = () => {
          xhr.abort();
          reject(new Error('Upload aborted'));
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        // Open and send the upload
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', mimeType);
        // Set a reasonable timeout (5 minutes for large files on slow connections)
        xhr.timeout = 5 * 60 * 1000;

        // Send decoded binary data — Firebase Storage expects raw bytes.
        // CRITICAL: Use bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        // instead of bytes.buffer directly. When bytes is a Uint8Array view into a larger
        // ArrayBuffer (common with Buffer.from() in React Native), sending bytes.buffer
        // would include ALL bytes in the underlying buffer, not just the image data.
        // This causes Firebase to store corrupted files (extra trailing bytes).
        const arrayBuffer = bytes.buffer.byteLength === bytes.byteLength
          ? bytes.buffer
          : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        xhr.send(arrayBuffer);

        // Cleanup abort listener when xhr completes
        xhr.onloadend = () => {
          abortSignal?.removeEventListener('abort', onAbort);
        };
      });

      // Final progress callback at 100%
      if (onProgress) {
        onProgress(fileSize, fileSize);
      }

      return {
        downloadUrl,
        storagePath: path,
        mimeType,
        size: fileSize,
        uploadTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      lastError = err;

      // Don't retry aborted uploads
      if (abortSignal?.aborted || err.message === 'Upload aborted') {
        break;
      }

      // Auth errors ('Not authenticated', 'Session expired', 'Token refresh failed')
      // are retryable by invalidating the token cache and forcing a fresh refresh.
      // These errors have no .status property since they come from getValidToken().
      const isAuthError = !err.status && (
        err.message?.includes('Not authenticated') ||
        err.message?.includes('Session expired') ||
        err.message?.includes('Token refresh') ||
        err.message?.includes('sign in again')
      );

      // Don't retry if we've exhausted retries
      if (attempt >= maxRetries) {
        break;
      }

      // Retry on auth errors (will invalidate token at top of loop)
      // or on retryable HTTP errors
      if (isAuthError || isRetryableError(err)) {
        const retryDelay = getRetryDelay(attempt);
        console.warn(
          `[imageUpload] Upload attempt ${attempt + 1} failed: ${err.message}. ` +
          `Retrying in ${retryDelay}ms...`,
        );
        await delay(retryDelay);
        continue; // Retry
      }

      // Non-retryable error (e.g., 403 forbidden, 404 not found)
      break;
    }
  }

  // All retries exhausted
  const errorMessage = lastError?.message || 'Upload failed after all retry attempts';
  console.error(`[imageUpload] Upload failed permanently: ${errorMessage}`);
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
    const url = `${STORAGE_BASE}/o/${encodedPath}`;

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
    const url = `${STORAGE_BASE}/o/${encodedPath}`;

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
      return `${STORAGE_BASE}/o/${encodedPath}?alt=media`;
    }

    // downloadTokens is a comma-separated string of tokens
    // Use the first (most recent) token
    const firstToken = downloadTokens.split(',')[0];
    return `${STORAGE_BASE}/o/${encodedPath}?alt=media&token=${firstToken}`;
  } catch (err: any) {
    console.warn(`[imageUpload] getImageDownloadUrl error:`, err.message);
    return null;
  }
}
