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
import { safeBase64Decode } from './base64';

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
const PROJECT_ID = 'memora-bond';

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
  /** Skip image magic byte validation. Use for non-image uploads (e.g., audio). */
  skipImageValidation?: boolean;
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
 * Encodes a Firebase Storage path for use in download URLs.
 *
 * Firebase Storage download URLs use the GCS object path in the URL path:
 *   /v0/b/{bucket}/o/{encoded_path}?alt=media&token=...
 *
 * CRITICAL: Slashes in the storage path MUST be encoded as %2F, not left as
 * literal '/'. A literal '/' in the URL path is interpreted as a path
 * separator by the URL router, so:
 *
 *   BROKEN:  .../o/posts/uid/file.jpg?alt=media        → HTTP 400 Bad Request
 *   CORRECT: .../o/posts%2Fuid%2Ffile.jpg?alt=media      → HTTP 200 OK
 *
 * Each path segment is individually encodeURIComponent'd, then joined with %2F.
 */
function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('%2F');
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

// safeBase64Decode is now imported from './base64' (shared utility)

/**
 * Copies a file from ImagePicker's temporary cache to a permanent cache location.
 *
 * PROBLEM: ImagePicker returns URIs to temp files in /cache/ImagePicker/.
 * On Android, the OS may clean these up at any time — especially after a
 * delay (user spends time composing a caption). When the upload pipeline
 * later tries to read, it gets FileNotFoundException.
 *
 * FIX: Immediately after picking, copy to /cache/B94_picked/ which is
 * under our control and won't be cleaned by the OS/picker.
 */
export async function copyToSafeCache(uri: string): Promise<string> {
  // Don't copy remote URLs or data URIs
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) {
    return uri;
  }

  try {
    const fsModule = await import('expo-file-system/legacy');
    const FileSystem = (fsModule as any).default || fsModule;
    const cacheDir = (FileSystem as any).cacheDirectory || '';

    // Already in our safe cache
    const safePrefix = `${cacheDir}B94_picked/`;
    const normalizedUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    if (normalizedUri.startsWith(safePrefix) || uri.startsWith(safePrefix)) {
      return uri;
    }

    // Verify source file exists before copying
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      if (__DEV__) console.warn('[copyToSafeCache] Source file does not exist:', uri);
      throw new Error(`Source image file no longer exists. Please try selecting the image again.`);
    }

    // Ensure the safe cache directory exists
    const safeDir = `${cacheDir}B94_picked`;
    try {
      const dirInfo = await FileSystem.getInfoAsync(safeDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(safeDir, { intermediates: true });
      }
    } catch (mkdirErr) {
      if (__DEV__) console.warn('[copyToSafeCache] Failed to create safe directory, will copy to root cache:', mkdirErr);
    }

    // Generate unique destination filename preserving extension
    const ext = uri.split('?')[0].split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const destPath = `${cacheDir}B94_picked/img_${timestamp}_${random}.${ext}`;

    await FileSystem.copyAsync({ from: uri, to: destPath });
    if (__DEV__) console.log('[copyToSafeCache] Copied', uri.slice(-40), '→', destPath.slice(-40));
    return destPath;
  } catch (err: any) {
    if (err?.message?.includes('no longer exists')) {
      throw err; // Re-throw our friendly message
    }
    if (__DEV__) console.warn('[copyToSafeCache] Copy failed, returning original URI:', err?.message);
    return uri; // Best-effort: return original and hope it survives
  }
}

/**
 * Reads a local file and returns a Uint8Array of binary data.
 *
 * IMPORTANT FIX: React Native's Blob constructor does NOT support ArrayBuffer or
 * ArrayBufferView on many Android versions (throws "Creating blobs from
 * 'ArrayBuffer' and 'ArrayBufferView' are not supported"). We return Uint8Array
 * instead and let the upload functions use XHR.send(Uint8Array) directly, which
 * is supported on ALL React Native platforms.
 *
 * Strategy: readAsStringAsync(base64) → safeBase64Decode → Uint8Array.
 * This is the most reliable cross-platform approach for React Native.
 */
async function readFileAsBinary(uri: string): Promise<Uint8Array> {
  const fsModule = await import('expo-file-system/legacy');
  const FileSystem = (fsModule as any).default || fsModule;

  // Verify the file exists before attempting to read it.
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error(
        `Image file not found at: ${uri.slice(-60)}. ` +
        'The temporary image cache may have been cleared. Please try selecting the image again.'
      );
    }
  } catch (checkErr: any) {
    if (checkErr?.message?.includes('not found') || checkErr?.message?.includes('no longer exists')) {
      throw checkErr;
    }
  }

  // Strategy 1: base64 read — most reliable cross-platform approach.
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as const,
    });
    return safeBase64Decode(base64);
  } catch (err1: any) {
    // Strategy 2: Try stripping file:// prefix (some Android versions)
    if (uri.startsWith('file://')) {
      try {
        const base64 = await FileSystem.readAsStringAsync(uri.slice(7), {
          encoding: 'base64' as const,
        });
        return safeBase64Decode(base64);
      } catch {
        // Fall through
      }
    }
    throw new Error(`Failed to read image file: ${err1?.message || 'Unknown error'}`);
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
 * Upload binary data to Firebase Storage using fetch().
 *
 * Uses XHR as the primary upload method because:
 *  1. React Native's Blob constructor does NOT support ArrayBuffer/ArrayBufferView
 *     on many Android versions — throws "Creating blobs from ArrayBuffer...".
 *  2. XHR.send(Uint8Array) is supported on ALL React Native platforms.
 *  3. XHR provides upload progress events (fetch doesn't).
 *
 * fetch() is kept as a fast-path attempt on platforms where Blob works.
 */
function doUploadFetch(
  uploadUrl: string,
  binaryData: Uint8Array,
  mimeType: string,
  token: string,
  encodedPath: string,
): Promise<string> {
  // Try creating a Blob first — works on iOS and some Android versions.
  // If it fails (ArrayBuffer not supported), fall back to XHR.
  try {
    const blob = new Blob([binaryData.buffer], { type: mimeType });
    return fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: blob,
    }).then(async (resp) => {
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const error: any = new Error(`Upload failed: HTTP ${resp.status} — ${text.slice(0, 300)}`);
      error.status = resp.status;
      throw error;
    }
    const data = await resp.json();
    // Storage rules are public-read — no token needed, and token-less URLs never expire
    return `${STORAGE_BASE}/${encodedPath}?alt=media`;
  });
  } catch (blobErr: any) {
    // Blob constructor failed (ArrayBuffer not supported) — return a rejected
    // promise so the caller falls back to XHR.
    throw new Error(`Blob not supported: ${blobErr?.message}`);
  }
}

/**
 * Perform a single upload attempt using XMLHttpRequest with progress tracking.
 *
 * Uses Firebase Storage's simple (one-shot) upload endpoint.
 * XHR.send(Uint8Array) is supported on ALL React Native platforms.
 *
 * @returns Download URL string
 */
function doUpload(
  uploadUrl: string,
  binaryBody: Uint8Array,
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
    skipImageValidation = false,
  } = options;

  let mimeType = detectMimeType(uri, mimeTypeOverride);
  const startTime = Date.now();

  // Read the file as Uint8Array.
  // FIX: React Native's Blob doesn't support ArrayBuffer on many Android versions.
  // We use base64 → Uint8Array which works on ALL platforms.
  if (__DEV__) console.log(`[imageUpload] Reading file: ${uri} (${mimeType})`);
  const binaryData = await readFileAsBinary(uri);

  const fileSize = binaryData.length;
  if (fileSize === 0) {
    throw new Error(`File is empty or could not be read: ${uri}`);
  }

  // BLACK PHOTO FIX: Sanity check — a valid image should be at least 100 bytes.
  if (fileSize < 100 && !skipImageValidation) {
    throw new Error(`File too small to be a valid image (${fileSize} bytes): ${uri}`);
  }

  if (__DEV__) console.log(`[imageUpload] File read successfully: ${fileSize} bytes`);

  // BLACK PHOTO FIX #2: Validate image magic bytes before uploading.
  // Skip for non-image uploads (e.g., audio).
  const headerBytes = binaryData.slice(0, 4);
  if (!skipImageValidation && fileSize >= 4) {
    const isJpeg = headerBytes[0] === 0xFF && headerBytes[1] === 0xD8 && headerBytes[2] === 0xFF;
    const isPng = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47;
    const isGif = headerBytes[0] === 0x47 && headerBytes[1] === 0x49 && headerBytes[2] === 0x46;
    if (!isJpeg && !isPng && !isGif) {
      console.error(`[imageUpload] File has invalid magic bytes: ${headerBytes[0].toString(16).padStart(2, '0')} ${headerBytes[1].toString(16).padStart(2, '0')} ${headerBytes[2].toString(16).padStart(2, '0')} ${headerBytes[3].toString(16).padStart(2, '0')}. Expected JPEG (FF D8 FF), PNG (89 50 4E 47), or GIF (47 49 46)`);
      throw new Error(`File is not a valid image (invalid magic bytes). It may have been corrupted during optimization. Try again with a different image.`);
    }
    // Auto-correct MIME type if the actual bytes don't match.
    if (isPng && mimeType === 'image/jpeg') {
      if (__DEV__) console.warn('[imageUpload] MIME mismatch: PNG bytes but Content-Type is image/jpeg. Auto-correcting to image/png.');
      mimeType = 'image/png';
    } else if (isJpeg && mimeType === 'image/png') {
      if (__DEV__) console.warn('[imageUpload] MIME mismatch: JPEG bytes but Content-Type is image/png. Auto-correcting to image/jpeg.');
      mimeType = 'image/jpeg';
    }
    if (__DEV__) console.log(`[imageUpload] Magic byte check passed: ${isJpeg ? 'JPEG' : isPng ? 'PNG' : 'GIF'}`);
  }

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

      if (__DEV__) console.log(`[imageUpload] Upload attempt ${attempt + 1}/${maxRetries + 1} to ${path}`);

      // Upload using XHR as PRIMARY method (works on all RN platforms).
      // XHR.send(Uint8Array) is universally supported in React Native.
      // fetch() with Blob is tried first as a fast path on platforms that support it.
      let downloadUrl: string;
      try {
        // Try fetch + Blob first (fast path for iOS/some Android)
        downloadUrl = await doUploadFetch(
          uploadUrl,
          binaryData,
          mimeType,
          token,
          encodedPath,
        );
      } catch (fetchErr: any) {
        // Fallback: XHR with Uint8Array (works on ALL platforms)
        if (__DEV__) console.warn(`[imageUpload] fetch upload failed, trying XHR fallback: ${fetchErr.message}`);
        downloadUrl = await doUpload(
          uploadUrl,
          binaryData,
          mimeType,
          token,
          encodedPath,
          onProgress,
          abortSignal,
        );
      }

      // Post-upload verification: fetch the first bytes to confirm the file is valid.
      // Some Android XMLHttpRequest implementations silently corrupt binary data,
      // resulting in a 200 response but an empty or invalid file on the server.
      try {
        const verifyResp = await fetch(downloadUrl, { method: 'HEAD' });
        if (!verifyResp.ok) {
          if (__DEV__) console.warn(`[imageUpload] Post-upload verification FAILED: HTTP ${verifyResp.status} for ${downloadUrl.slice(0, 80)}...`);
        } else {
          const contentLength = verifyResp.headers.get('content-length');
          if (contentLength && parseInt(contentLength) < 100) {
            if (__DEV__) console.warn(`[imageUpload] Post-upload file is suspiciously small: ${contentLength} bytes`);
          }
        }
      } catch (verifyErr) {
        if (__DEV__) console.warn('[imageUpload] Post-upload verification error:', verifyErr);
      }

      // Final progress callback at 100%
      if (onProgress) {
        onProgress(fileSize, fileSize);
      }

      if (__DEV__) console.log(`[imageUpload] Upload succeeded in ${Date.now() - startTime}ms: ${downloadUrl.slice(0, 80)}...`);

      return {
        downloadUrl,
        storagePath: path,
        mimeType,
        size: fileSize,
        uploadTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      lastError = err;
      if (__DEV__) console.warn(`[imageUpload] Attempt ${attempt + 1} failed: ${err.message} (status: ${err.status || 'none'})`);

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
        if (__DEV__) console.log(`[imageUpload] Retrying in ${retryDelay}ms...`);
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
      if (__DEV__) console.log(`[imageUpload] Deleted: ${storagePath}`);
      return;
    }

    // Log but don't throw for permission errors — the UI should handle this gracefully
    const errorBody = await response.text().catch(() => '');
    if (__DEV__) console.warn(
      `[imageUpload] Failed to delete ${storagePath}: ${response.status} ${errorBody}`,
    );
  } catch (err: any) {
    // Network errors during delete are non-critical — log and continue
    if (__DEV__) console.warn(`[imageUpload] Delete error for ${storagePath}:`, err.message);
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
      if (__DEV__) console.log(`[imageUpload] File not found: ${storagePath}`);
      return null;
    }

    if (!response.ok) {
      if (__DEV__) console.warn(
        `[imageUpload] Failed to get metadata for ${storagePath}: ${response.status}`,
      );
      return null;
    }

    const data = await response.json();
    // Token-less URL — never expires since storage rules allow public read
    return `${STORAGE_BASE}/${encodedPath}?alt=media`;
  } catch (err: any) {
    if (__DEV__) console.warn(`[imageUpload] getImageDownloadUrl error:`, err.message);
    return null;
  }
}

/**
 * fixFirebaseUrl — Repairs a Firebase Storage download URL that has un-encoded
 * slashes in the object path.
 *
 * ROOT CAUSE FIX: The old encodeStoragePath() joined path segments with '/'
 * instead of '%2F', producing URLs like:
 *   .../o/posts/uid/file.jpg?alt=media&token=...    ← HTTP 400 Bad Request
 *
 * The correct format requires %2F:
 *   .../o/posts%2Fuid%2Ffile.jpg?alt=media&token=... ← HTTP 200 OK
 *
 * This function detects and repairs such URLs so that existing broken URLs
 * in Firestore (from before the fix) still work.
 *
 * It's safe to call on already-correct URLs — it only modifies URLs that
 * contain un-encoded slashes between /o/ and ?.
 */
export function fixFirebaseUrl(url: string): string {
  if (!url || (!url.startsWith('https://firebasestorage.googleapis.com') && !url.startsWith('https://storage.googleapis.com'))) {
    return url; // Not a Firebase Storage URL
  }

  try {
    // Find the path between /o/ and ? in the URL
    const oIdx = url.indexOf('/o/');
    if (oIdx === -1) return url;
    const baseUrl = url.substring(0, oIdx + 3); // everything up to and including /o/
    const afterO = url.substring(oIdx + 3);
    const qIdx = afterO.indexOf('?');
    const pathPart = qIdx === -1 ? afterO : afterO.substring(0, qIdx);
    const queryPart = qIdx === -1 ? '' : afterO.substring(qIdx);

    // Decode, split by /, re-encode with %2F
    const decoded = decodeURIComponent(pathPart);
    const segments = decoded.split('/');
    if (segments.length <= 1) return url; // Single segment — no slashes to fix

    // Re-encode: each segment gets encodeURIComponent, joined with %2F
    const fixedPath = segments.map(s => encodeURIComponent(s)).join('%2F');
    return `${baseUrl}${fixedPath}${queryPart}`;
  } catch {
    return url; // If anything goes wrong, return original
  }
}

/**
 * refreshFirebaseUrl — Refreshes a Firebase Storage download URL's token.
 *
 * When a Firebase Storage download URL contains a token that's no longer
 * valid (e.g., after security rules changes or token rotation), the image
 * fails to load in React Native's <Image> component. This function extracts
 * the storage path from the URL, fetches a fresh token, and returns a new URL.
 *
 * Also handles URLs that were stored without a token by appending ?alt=media.
 *
 * @param url - The original Firebase Storage download URL
 * @returns A refreshed URL, or null if the file no longer exists
 */
export async function refreshFirebaseUrl(url: string): Promise<string | null> {
  if (!url || (!url.startsWith('https://firebasestorage.googleapis.com') && !url.startsWith('https://storage.googleapis.com'))) {
    return null; // Not a Firebase Storage URL
  }

  try {
    // Extract storage path from URL format:
    // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded_path}?alt=media&token=...
    const match = url.match(/\/o\/([^?]+)/);
    if (!match) return null;

    const encodedPath = match[1];
    // Decode the path segments
    const storagePath = encodedPath
      .split('/')
      .map(seg => decodeURIComponent(seg))
      .join('/');

    return await getImageDownloadUrl(storagePath);
  } catch (err: any) {
    if (__DEV__) console.warn('[imageUpload] refreshFirebaseUrl error:', err.message);
    return null;
  }
}
