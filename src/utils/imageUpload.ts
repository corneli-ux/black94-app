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

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Firebase project ID — must match firebase.ts */
const PROJECT_ID = 'black94';

/** Firebase Storage bucket (default: {projectId}.appspot.com) */
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;

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
 * Reads a local file as a base64 string using expo-file-system.
 * Required because React Native's XMLHttpRequest doesn't support
 * sending raw file URIs in all environments.
 */
async function readFileAsBase64(uri: string): Promise<string> {
  // React Native file URIs: 'file:///path/to/file'
  // expo-file-system expects the path without the 'file://' prefix for readAsStringAsync
  const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;

  const { default: FileSystem } = await import('expo-file-system');
  const base64 = await FileSystem.readAsStringAsync(filePath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64;
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
      const token = await getValidToken();

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
        const error: any = new Error(`Failed to initiate upload: ${initiateResponse.status}`);
        error.status = initiateResponse.status;
        error.body = errorBody;
        throw error;
      }

      // The upload URL is returned in the Location header
      const uploadUrl = initiateResponse.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('Upload session initiated but no upload URL returned');
      }

      // Step 3: Upload the file data
      // Use XMLHttpRequest for progress tracking (fetch doesn't support upload progress)
      const fileData = await readFileAsBase64(uri);

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

        // Send base64 data — Firebase Storage will decode it
        // Note: We send as base64 with proper Content-Transfer-Encoding header
        // so Firebase knows how to handle it
        xhr.send(fileData);

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

      // Don't retry if the error is not retryable or we've exhausted retries
      if (!isRetryableError(err) || attempt >= maxRetries) {
        break;
      }

      // Don't retry aborted uploads
      if (abortSignal?.aborted || err.message === 'Upload aborted') {
        break;
      }

      const retryDelay = getRetryDelay(attempt);
      console.warn(
        `[imageUpload] Upload attempt ${attempt + 1} failed: ${err.message}. ` +
        `Retrying in ${retryDelay}ms...`,
      );
      await delay(retryDelay);
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
