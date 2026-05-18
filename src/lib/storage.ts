// Firebase Storage REST API — NO Firebase SDK.
// Pure fetch / XMLHttpRequest for uploads, deletes, and download URLs.
// Works in React Native without any shims.

import { getValidToken } from './firebase';

const PROJECT_ID = 'black94';
const BUCKET = `${PROJECT_ID}.appspot.com`;
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Detect MIME type from a file URI extension.
 * Supports jpg, jpeg, png, gif, webp, bmp, svg, heic, heif.
 * @param uri - Local or remote file URI
 * @returns MIME type string (defaults to `application/octet-stream`)
 */
export function getImageMimeType(uri: string): string {
  const ext = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Build a unique storage path combining folder, user UID, timestamp, and filename.
 * @param folder - Storage folder (e.g. `'avatars'`, `'posts'`)
 * @param filename - Original filename with extension
 * @param uid - User ID for namespacing
 * @returns Storage object path, e.g. `avatars/abc123_1700000000_photo.jpg`
 */
export function getFilePath(folder: string, filename: string, uid: string): string {
  const ts = Date.now();
  return `${folder}/${uid}_${ts}_${filename}`;
}

/**
 * Read a local file URI as a base64 data string.
 * Uses expo-file-system which properly handles file:// URIs in React Native.
 * @param uri - Local file URI (e.g. `file:///...` or `content://...`)
 * @param mimeType - Expected MIME type (unused — kept for API compat)
 * @returns Base64-encoded string (raw, no data-URI prefix)
 */
async function readFileAsBase64(uri: string, mimeType: string): Promise<string> {
  // React Native's fetch() does NOT support file:// URIs.
  // expo-file-system is the correct approach for reading local files.
  const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;

  const { default: FileSystem } = await import('expo-file-system');
  const base64 = await FileSystem.readAsStringAsync(filePath, {
    encoding: 'base64' as const,
  });
  return base64;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff.
 * On 401, refreshes the auth token and retries immediately (no backoff).
 * @param fn - Async function that receives a fresh auth token
 * @param context - Description for log messages
 * @returns The result of `fn`
 */
async function withRetry<T>(
  fn: (token: string) => Promise<T>,
  context: string,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const token = await getValidToken();

    try {
      const result = await fn(token);
      return result;
    } catch (e: any) {
      lastError = e;
      const status = e?.status;

      if (status === 401 && attempt <= MAX_RETRIES) {
        // Token expired mid-request — retry immediately with fresh token.
        // getValidToken will refresh on next call since we don't cache here.
        console.warn(`[Storage] 401 on ${context} (attempt ${attempt}) — will retry with fresh token`);
        continue;
      }

      const isLast = attempt === MAX_RETRIES;
      console.error(`[Storage] ${context} failed (attempt ${attempt}/${MAX_RETRIES}): ${e?.message || e}`);

      if (isLast) break;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[Storage] Retrying ${context} in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError || new Error(`${context} failed after ${MAX_RETRIES} retries`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPLOAD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Upload a local file to Firebase Storage.
 *
 * When an `onProgress` callback is provided, the upload uses `XMLHttpRequest`
 * for progress tracking. Otherwise it uses `fetch` for simplicity.
 *
 * @param uri - Local file URI (e.g. `file:///...` or `content://...`)
 * @param path - Storage object path (e.g. `avatars/user_123_photo.jpg`)
 * @param onProgress - Optional callback receiving upload percentage (0–100)
 * @returns Public download URL for the uploaded file
 *
 * @example
 * ```ts
 * const url = await uploadFile(
 *   photoUri,
 *   getFilePath('avatars', 'photo.jpg', uid),
 *   (pct) => console.log(`${pct}% uploaded`),
 * );
 * ```
 */
export async function uploadFile(
  uri: string,
  path: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const mimeType = getImageMimeType(uri);
  const encodedPath = encodeURIComponent(path);
  const base64 = await readFileAsBase64(uri, mimeType);

  console.log(`[Storage] Uploading to ${path} (${mimeType}, ${Math.round(base64.length * 0.75)} bytes)`);

  const uploadUrl = `${STORAGE_BASE}?name=${encodedPath}&uploadType=media`;

  if (onProgress) {
    return uploadWithProgress(uploadUrl, base64, mimeType, path, onProgress);
  }

  return withRetry(async (token) => {
    const resp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: base64,
    });

    if (!resp.ok) {
      const text = await resp.text();
      const err: any = new Error(`Upload failed: HTTP ${resp.status} — ${text.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    const downloadToken = data.downloadTokens?.split(',')[0];
    if (!downloadToken) {
      throw new Error('Upload succeeded but no download token in response');
    }

    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
    console.log(`[Storage] Upload complete: ${downloadURL}`);
    return downloadURL;
  }, `upload(${path})`);
}

/**
 * Upload using XMLHttpRequest for progress tracking.
 * Only called when `onProgress` is provided.
 */
function uploadWithProgress(
  url: string,
  base64: string,
  mimeType: string,
  path: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', url);
    // Don't set Authorization header here — it will be set with the real token below
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const downloadToken = data.downloadTokens?.split(',')[0];
          if (!downloadToken) {
            reject(new Error('Upload succeeded but no download token in response'));
            return;
          }
          const encodedPath = encodeURIComponent(path);
          const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
          console.log(`[Storage] Upload complete: ${downloadURL}`);
          resolve(downloadURL);
        } catch (e) {
          reject(new Error('Failed to parse upload response'));
        }
      } else if (xhr.status === 401) {
        // Retry with a fresh token
        try {
          const token = await getValidToken();
          const result = await uploadWithProgressRetry(url, base64, mimeType, path, token, onProgress);
          resolve(result);
        } catch (retryErr: any) {
          reject(retryErr);
        }
      } else {
        const err: any = new Error(`Upload failed: HTTP ${xhr.status} — ${xhr.responseText?.slice(0, 300)}`);
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));

    // Set real auth header and send
    getValidToken()
      .then(token => {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(base64);
      })
      .catch(err => reject(err));
  });
}

/**
 * XHR upload retry with an already-fresh token (used after a 401).
 */
function uploadWithProgressRetry(
  url: string,
  base64: string,
  mimeType: string,
  path: string,
  token: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const downloadToken = data.downloadTokens?.split(',')[0];
          if (!downloadToken) {
            reject(new Error('Upload succeeded but no download token in response'));
            return;
          }
          const encodedPath = encodeURIComponent(path);
          resolve(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`);
        } catch {
          reject(new Error('Failed to parse upload response'));
        }
      } else {
        const err: any = new Error(`Upload failed: HTTP ${xhr.status} — ${xhr.responseText?.slice(0, 300)}`);
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload retry'));
    xhr.send(base64);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Delete a file from Firebase Storage.
 * Silently succeeds if the file does not exist (404).
 *
 * @param path - Storage object path (e.g. `avatars/user_123_photo.jpg`)
 *
 * @example
 * ```ts
 * await deleteFile('avatars/old_photo.jpg');
 * ```
 */
export async function deleteFile(path: string): Promise<void> {
  const encodedPath = encodeURIComponent(path);
  const url = `${STORAGE_BASE}/${encodedPath}`;

  await withRetry(async (token) => {
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text();
      const err: any = new Error(`Delete failed: HTTP ${resp.status} — ${text.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }

    if (resp.status === 404) {
      console.log(`[Storage] File not found (already deleted): ${path}`);
    } else {
      console.log(`[Storage] Deleted: ${path}`);
    }
  }, `delete(${path})`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOWNLOAD URL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Get a fresh download URL for a file in Firebase Storage.
 * Fetches object metadata to extract the current download token.
 *
 * @param path - Storage object path (e.g. `avatars/user_123_photo.jpg`)
 * @returns Public download URL with a valid token
 *
 * @example
 * ```ts
 * const url = await getDownloadURL('avatars/user_123_photo.jpg');
 * ```
 */
export async function getDownloadURL(path: string): Promise<string> {
  const encodedPath = encodeURIComponent(path);
  const url = `${STORAGE_BASE}/${encodedPath}`;

  return withRetry(async (token) => {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      const err: any = new Error(`getDownloadURL failed: HTTP ${resp.status} — ${text.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    const downloadToken = data.downloadTokens?.split(',')[0];
    if (!downloadToken) {
      throw new Error(`No download token found for ${path}`);
    }

    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
    return downloadURL;
  }, `getDownloadURL(${path})`);
}
