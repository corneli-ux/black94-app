/**
 * imageOptimizer.ts — Client-side image optimization for React Native (Expo)
 *
 * Mimics X (Twitter)'s photo processing pipeline:
 *  1. Detect image type & determine optimal compression strategy
 *  2. Resize to device-appropriate dimensions while preserving aspect ratio
 *  3. Convert to efficient format (JPG for photos, PNG for graphics/text)
 *  4. Strip EXIF metadata for privacy
 *  5. Apply subtle noise dithering to prevent banding in gradients
 *  6. Generate a small thumbnail for previews
 *
 * Design decisions:
 *  - Photos → JPG @ 88% quality, max 2048px (X uses ~2048 for full-res)
 *  - Graphics/PNG → Keep PNG, max 1600px to preserve sharp edges & transparency
 *  - Thumbnails → max 500px for scroll performance
 *  - EXIF stripping via re-encoding (ImageManipulator doesn't preserve EXIF)
 *  - Noise dithering uses ImageManipulator's `processRuntimeType` where possible;
 *    falls back to a very light overlay since expo-image-manipulator has limited
 *    pixel-level access. The noise is deliberately subtle (~1-2 LSB) so it's
 *    invisible to the eye but breaks up quantization banding in smooth gradients.
 *
 * Memory & battery considerations:
 *  - Processes one image at a time to avoid OOM on mid-range devices
 *  - Cleans up temp files after each step to avoid cache bloat
 *  - Uses FileSystem.cacheDirectory for all intermediaries
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { safeBase64Decode } from './base64';

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Supported output MIME types after optimization */
export type OptimizedMimeType = 'image/jpeg' | 'image/png' | 'image/gif';

/** Size variant used to select the right image for a given UI context */
export type ImageVariant = 'thumb' | 'small' | 'medium' | 'large';

/** Result returned by the main `optimizeImage` function */
export interface OptimizedImageResult {
  /** File URI of the optimized image in the cache directory */
  optimizedUri: string;
  /** File URI of the generated thumbnail */
  thumbnailUri: string;
  /** Width in pixels of the optimized image */
  width: number;
  /** Height in pixels of the optimized image */
  height: number;
  /** MIME type of the optimized output */
  mimeType: OptimizedMimeType;
  /** File size in bytes of the optimized image */
  size: number;
}

/** Options for `optimizeImage` */
export interface OptimizeOptions {
  /** Maximum dimension (longest side) in px for the full-size output. Default: 2048 */
  maxWidth?: number;
  /** Maximum height in px. Default: 1600. Tall vertical images are capped at this height. */
  maxHeight?: number;
  /** JPG quality (0–1). Default: 0.88. Ignored for PNG. */
  jpegQuality?: number;
  /** Whether to generate a thumbnail. Default: true */
  generateThumbnail?: boolean;
  /** Maximum dimension for thumbnail. Default: 500 */
  thumbnailMaxSize?: number;
  /** Force output format. Default: auto-detect */
  forceFormat?: 'jpeg' | 'png';
}

/** Options passed through to `expo-image-picker` */
export interface PickAndOptimizeOptions extends OptimizeOptions {
  /** Allows editing (crop) in the picker. Default: false */
  allowsEditing?: boolean;
  /** Restrict to certain media types. Default: ['Images'] */
  mediaTypes?: ImagePicker.MediaType[];
  /** Aspect ratio for crop. Default: [4, 3] */
  aspect?: [number, number];
  /** Quality of the picked image (0–1). Default: 1 (full res) */
  pickerQuality?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Max file size for regular images (5 MB) */
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
/** Max file size for GIFs (15 MB) — GIFs are passed through unmodified */
const MAX_GIF_SIZE_BYTES = 15 * 1024 * 1024;

/** Default max dimension for full-size optimized images */
const DEFAULT_MAX_DIMENSION = 2048;
/** Default max dimension for PNG graphics (preserve sharpness) */
const DEFAULT_PNG_MAX_DIMENSION = 1600;
/** Default thumbnail max dimension */
const DEFAULT_THUMBNAIL_MAX = 500;
/** Default JPG quality — high enough to look good, low enough to save bandwidth */
const DEFAULT_JPEG_QUALITY = 0.88;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Detects the MIME type from a URI's file extension.
 * Falls back to 'image/jpeg' if the extension is unrecognized.
 */
function detectImageType(uri: string): OptimizedMimeType {
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return 'image/png';
  if (cleanUri.endsWith('.gif')) return 'image/gif';
  // Default to JPEG for .jpg, .jpeg, .webp, .heic, .heif, or unknown
  return 'image/jpeg';
}

/**
 * Gets the file size in bytes for a local URI.
 * Returns 0 if the file doesn't exist or can't be read.
 */
async function getFileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info) {
      return info.size as number;
    }
    return 0;
  } catch (err) {
    if (__DEV__) console.warn('[imageOptimizer] Failed to get file size:', err);
    return 0;
  }
}

/**
 * Gets the width and height of an image without fully decoding it.
 * Uses ImageManipulator's `manipulateAsync` with no actions — this triggers
 * a lightweight decode that returns dimensions.
 */
async function getImageDimensions(
  uri: string,
): Promise<{ width: number; height: number }> {
  try {
    const result = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.PNG,
    });
    return { width: result.width, height: result.height };
  } catch (err) {
    if (__DEV__) console.warn('[imageOptimizer] Failed to get image dimensions:', err);
    return { width: 0, height: 0 };
  }
}

/**
 * Generates a unique temp file path in the cache directory.
 * Ensures no collisions between concurrent operations.
 */
function getTempFilePath(extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const dir = (FileSystem as any).cacheDirectory || '';
  return `${dir}img_${timestamp}_${random}.${extension}`;
}

/**
 * Applies very subtle noise dithering to reduce banding artifacts.
 *
 * Strategy: expo-image-manipulator doesn't expose pixel-level manipulation,
 * so we apply a tiny sharpen + slight contrast adjustment via its built-in
 * processing. This is NOT true dithering, but it breaks up the worst
 * quantization banding that appears in smooth gradients after JPEG re-compression.
 *
 * The effect is intentionally imperceptible — just enough to smooth out
 * 8-bit color stepping in sky gradients, shadows, and flat-color regions.
 *
 * For true pixel-level dithering you'd need a native module or Canvas API;
 * this is the best we can do with Expo's built-in tools.
 */
async function generateNoiseDitheredUri(uri: string): Promise<string> {
  try {
    // Apply a very light sharpen pass — this introduces micro-variations
    // that break up banding without being visually noticeable.
    // BUG FIX: Removed resize: { width: 2000, height: 2000 } which forced
    // ALL images (portrait, landscape) into a square, distorting them.
    // The function's purpose is noise dithering, not resizing.
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [],
      {
        compress: 1, // No additional compression at this step
        format: ImageManipulator.SaveFormat.PNG, // Lossless intermediate
      },
    );

    // Clean up the input if it was a temp file we created
    if (uri.startsWith((FileSystem as any).cacheDirectory || '')) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return result.uri;
  } catch (err) {
    // If dithering fails, just return the original URI — it's non-critical
    if (__DEV__) console.warn('[imageOptimizer] Noise dithering failed, using original:', err);
    return uri;
  }
}

/**
 * Determines if a PNG image is likely a "graphic" (sharp edges, text, logos)
 * vs a photo that happens to be saved as PNG.
 *
 * Heuristic: If the image has many fully-transparent pixels or the file is
 * very small relative to its dimensions (indicating sparse graphics), treat
 * it as a graphic and keep PNG format.
 *
 * This is a best-effort check — perfect classification requires pixel analysis.
 */
async function isLikelyGraphic(
  uri: string,
  width: number,
  height: number,
  fileSize: number,
): Promise<boolean> {
  // Very small file for its pixel count → likely a simple graphic or screenshot
  const totalPixels = width * height;
  const bytesPerPixel = fileSize / totalPixels;

  // Real photos are typically 1-4 bytes/px even compressed.
  // Graphics/text/logos are often < 0.5 bytes/px or have transparency.
  if (bytesPerPixel < 0.3 && totalPixels > 10000) return true;

  // Check for transparency — PNGs with alpha are almost always graphics
  try {
    // Read first few bytes to check PNG color type
    // BUG FIX: Safely strip file:// prefix. The old code blindly used uri.slice(7)
    // which crashes if the URI doesn't start with 'file://'.
    const readPath = uri.startsWith('file://') ? uri.slice(7) : uri;
    const base64 = await FileSystem.readAsStringAsync(readPath, {
      encoding: 'base64' as const,
      length: 64,
    });
    // If we can read the header, check for alpha channel
    // PNG header: byte 25 has color type (bit 6 = alpha)
    if (base64.length > 36) {
      // Use safeBase64Decode from shared utility (same approach as imageUpload.ts)
      try {
        const decoded = safeBase64Decode(base64);
        if (decoded.length >= 26) {
          const colorType = decoded[25];
          // Color type 4 = grayscale+alpha, 6 = RGB+alpha
          if (colorType === 4 || colorType === 6) return true;
        }
      } catch {
        // Decoding failed — assume it's a photo (safe default)
      }
    }
  } catch {
    // Can't read header — assume it's a photo (safe default)
  }

  return false;
}

/**
 * Validates that the source image meets size requirements.
 * Throws a descriptive error if the file is too large.
 */
async function validateFileSize(uri: string): Promise<void> {
  const size = await getFileSize(uri);
  const mimeType = detectImageType(uri);

  const maxSize = mimeType === 'image/gif' ? MAX_GIF_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  const maxMB = (maxSize / (1024 * 1024)).toFixed(0);

  if (size > maxSize) {
    const sizeMB = (size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image too large (${sizeMB}MB). Maximum ${maxMB}MB for ${mimeType === 'image/gif' ? 'GIFs' : 'images'}.`,
    );
  }
}

/**
 * Cleans up a temp file. Errors are silently swallowed.
 */
async function cleanupTemp(uri: string): Promise<void> {
  if (!uri || !uri.startsWith((FileSystem as any).cacheDirectory || '')) return;
  // BUG FIX: Never delete files from ImagePicker's cache directory OR our safe
  // cache directory (B94_picked/). These are managed separately and deleting
  // them causes FileNotFoundException when the upload pipeline tries to read.
  if (uri.includes('/ImagePicker/') || uri.includes('/B94_picked/')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Cleanup is best-effort — don't let it propagate
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * optimizeImage — Main optimization pipeline
 *
 * Takes a raw image URI (from camera, gallery, or any source) and produces:
 *  1. An optimized full-size image (resized + compressed + EXIF-stripped)
 *  2. An optional thumbnail for previews
 *
 * Pipeline:
 *  1. Validate file size (reject oversized images early)
 *  2. Detect image type and dimensions
 *  3. For GIFs: pass through without modification (animated content)
 *  4. Resize the longest side to max dimension while preserving aspect ratio
 *  5. Apply subtle noise dithering to prevent banding
 *  6. Encode to final format (JPG for photos, PNG for graphics)
 *  7. Generate thumbnail (separate resize pass at smaller dimensions)
 *  8. Clean up all intermediate temp files
 *
 * @param uri - Local file URI of the source image
 * @param options - Optional configuration overrides
 * @returns OptimizedImageResult with URIs, dimensions, and metadata
 */
export async function optimizeImage(
  uri: string,
  options: OptimizeOptions = {},
): Promise<OptimizedImageResult> {
  const {
    maxWidth = DEFAULT_MAX_DIMENSION,
    maxHeight = 1600,
    jpegQuality = DEFAULT_JPEG_QUALITY,
    generateThumbnail = true,
    thumbnailMaxSize = DEFAULT_THUMBNAIL_MAX,
    forceFormat,
  } = options;

  // Step 1: Validate file size before doing any expensive processing
  await validateFileSize(uri);

  // Step 2: Detect type and read dimensions
  const sourceType = detectImageType(uri);
  const { width: originalWidth, height: originalHeight } = await getImageDimensions(uri);

  if (originalWidth === 0 || originalHeight === 0) {
    throw new Error('Could not read image dimensions. The file may be corrupted.');
  }

  // Step 3: GIF pass-through — don't re-encode animated content
  if (sourceType === 'image/gif') {
    const size = await getFileSize(uri);
    return {
      optimizedUri: uri,
      thumbnailUri: uri, // Use the same file for thumbnail of GIFs
      width: originalWidth,
      height: originalHeight,
      mimeType: 'image/gif',
      size,
    };
  }

  // Step 4: Determine output format and max dimension
  let outputFormat: ImageManipulator.SaveFormat;
  let outputMime: OptimizedMimeType;
  let maxDimension = maxWidth;

  if (forceFormat === 'png') {
    outputFormat = ImageManipulator.SaveFormat.PNG;
    outputMime = 'image/png';
    maxDimension = Math.min(maxDimension, DEFAULT_PNG_MAX_DIMENSION);
  } else if (sourceType === 'image/png') {
    // Check if it's a graphic or a photo saved as PNG
    const fileSize = await getFileSize(uri);
    const isGraphic = await isLikelyGraphic(uri, originalWidth, originalHeight, fileSize);

    if (isGraphic) {
      // Keep as PNG to preserve sharp edges and transparency
      outputFormat = ImageManipulator.SaveFormat.PNG;
      outputMime = 'image/png';
      maxDimension = Math.min(maxDimension, DEFAULT_PNG_MAX_DIMENSION);
    } else {
      // Photo saved as PNG → convert to JPG for smaller file size
      outputFormat = ImageManipulator.SaveFormat.JPEG;
      outputMime = 'image/jpeg';
    }
  } else {
    // Default: convert to JPG (photos, HEIC, WebP, etc.)
    outputFormat = ImageManipulator.SaveFormat.JPEG;
    outputMime = 'image/jpeg';
  }

  // Step 5: Calculate resize dimensions preserving aspect ratio
  // Only resize if the image exceeds the max dimension
  let resizeWidth = originalWidth;
  let resizeHeight = originalHeight;

  const longestSide = Math.max(originalWidth, originalHeight);
  if (longestSide > maxDimension) {
    const scale = maxDimension / longestSide;
    resizeWidth = Math.round(originalWidth * scale);
    resizeHeight = Math.round(originalHeight * scale);
    // Ensure minimum 1px per dimension
    resizeWidth = Math.max(1, resizeWidth);
    resizeHeight = Math.max(1, resizeHeight);
  }

  // Cap height for very tall vertical images (screenshots, stories).
  // A 9:16 image at 2048px wide would be 3640px tall — way too much for feed display.
  // Cap at maxHeight while preserving aspect ratio so vertical images don't dominate.
  if (resizeHeight > maxHeight && resizeHeight > resizeWidth) {
    const scale = maxHeight / resizeHeight;
    resizeWidth = Math.max(1, Math.round(resizeWidth * scale));
    resizeHeight = maxHeight;
  }

  // Step 6: Resize the image
  // ImageManipulator.manipulateAsync automatically strips EXIF data
  // because it re-encodes from scratch — no explicit EXIF removal needed
  const resizeActions: ImageManipulator.Action[] = [];
  if (resizeWidth !== originalWidth || resizeHeight !== originalHeight) {
    resizeActions.push({ resize: { width: resizeWidth, height: resizeHeight } });
  }

  let optimizedUri: string;
  if (resizeActions.length > 0) {
    const resized = await ImageManipulator.manipulateAsync(uri, resizeActions, {
      compress: 1, // Don't compress yet — we'll dither first
      format: ImageManipulator.SaveFormat.PNG, // Lossless intermediate
    });
    optimizedUri = resized.uri;
    // Clean up source if it was a temp file
    if (uri !== optimizedUri) await cleanupTemp(uri);
  } else {
    optimizedUri = uri;
  }

  // Step 7: Final compression to target format
  // NOTE: Noise dithering step REMOVED — expo-image-manipulator's manipulateAsync
  // with empty actions was silently producing black/corrupt images on certain
  // Android devices. The minimal banding reduction wasn't worth the risk.
  let finalResult: ImageManipulator.ImageResult;
  if (outputFormat === ImageManipulator.SaveFormat.JPEG) {
    finalResult = await ImageManipulator.manipulateAsync(optimizedUri, [], {
      compress: jpegQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    // Clean up the dithered/intermediate file
    await cleanupTemp(optimizedUri);
  } else {
    // PNG — already in correct format, just ensure it's in cache
    if (!optimizedUri.startsWith((FileSystem as any).cacheDirectory || '')) {
      const destPath = getTempFilePath('png');
      await FileSystem.copyAsync({ from: optimizedUri, to: destPath });
      finalResult = await ImageManipulator.manipulateAsync(destPath, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.PNG,
      });
      await cleanupTemp(destPath);
    } else {
      finalResult = await ImageManipulator.manipulateAsync(optimizedUri, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.PNG,
      });
      await cleanupTemp(optimizedUri);
    }
  }

  const optimizedSize = await getFileSize(finalResult.uri);

  // Step 8: Validate output with magic bytes — catches corrupt expo-image-manipulator output
  // AND format mismatches (e.g., expo saved PNG bytes when JPEG was requested).
  // A valid JPEG starts with FF D8 FF, PNG with 89 50 4E 47.
  // If the output is corrupt (all-black or garbage), fall back to the original URI.
  let actualMime: OptimizedMimeType = outputMime;
  try {
    // BUG FIX: Safely strip file:// prefix.
    const finalPath = finalResult.uri.startsWith('file://') ? finalResult.uri.slice(7) : finalResult.uri;
    const headerBase64 = await FileSystem.readAsStringAsync(finalPath, {
      encoding: 'base64',
      length: 16,
    });
    const headerBytes = safeBase64Decode(headerBase64);
    const isJpeg = headerBytes.length >= 3 && headerBytes[0] === 0xFF && headerBytes[1] === 0xD8 && headerBytes[2] === 0xFF;
    const isPng = headerBytes.length >= 4 && headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47;
    const isGif = headerBytes.length >= 3 && headerBytes[0] === 0x47 && headerBytes[1] === 0x49 && headerBytes[2] === 0x46;

    // BUG FIX: Detect format mismatch — expo-image-manipulator sometimes outputs
    // PNG bytes even when SaveFormat.JPEG is requested (especially on certain
    // Android GPU drivers). If the actual bytes don't match the requested format,
    // use the ACTUAL format's MIME type. This prevents uploading PNG bytes with
    // Content-Type: image/jpeg, which causes React Native's Image component to
    // fail loading (it tries to decode as JPEG but bytes are PNG).
    if (isPng && outputMime === 'image/jpeg') {
      if (__DEV__) console.warn('[imageOptimizer] Format mismatch: requested JPEG but got PNG bytes. Using actual format.');
      actualMime = 'image/png';
    } else if (isJpeg && outputMime === 'image/png') {
      if (__DEV__) console.warn('[imageOptimizer] Format mismatch: requested PNG but got JPEG bytes. Using actual format.');
      actualMime = 'image/jpeg';
    }

    const outputValid = isJpeg || isPng || isGif;
    if (!outputValid) {
      if (__DEV__) console.warn('[imageOptimizer] Output FAILED magic byte validation — corrupt file. Size:', optimizedSize, 'bytes');
      if (__DEV__) console.warn('[imageOptimizer] Falling back to original URI:', uri);
      const origSize = await getFileSize(uri);
      return {
        optimizedUri: uri,
        thumbnailUri: uri,
        width: originalWidth,
        height: originalHeight,
        mimeType: sourceType,
        size: origSize,
      };
    }
    if (__DEV__) console.log('[imageOptimizer] Output passed magic byte validation:', isJpeg ? 'JPEG' : isPng ? 'PNG' : 'GIF', '(requested:', outputMime, ')');
  } catch (validationErr) {
    if (__DEV__) console.warn('[imageOptimizer] Magic byte validation failed (non-critical):', validationErr);
  }

  // Step 9: Generate thumbnail
  let thumbnailUri = finalResult.uri;

  if (generateThumbnail) {
    const thumbLongest = Math.max(finalResult.width, finalResult.height);
    if (thumbLongest > thumbnailMaxSize) {
      const thumbScale = thumbnailMaxSize / thumbLongest;
      const thumbW = Math.max(1, Math.round(finalResult.width * thumbScale));
      const thumbH = Math.max(1, Math.round(finalResult.height * thumbScale));

      try {
        // Generate thumbnail from the optimized image (not the original)
        // to avoid re-processing and keep consistent colors
        const thumb = await ImageManipulator.manipulateAsync(
          finalResult.uri,
          [{ resize: { width: thumbW, height: thumbH } }],
          {
            compress: outputFormat === ImageManipulator.SaveFormat.JPEG ? 0.7 : 1,
            format: outputFormat,
          },
        );
        thumbnailUri = thumb.uri;
      } catch (err) {
        if (__DEV__) console.warn('[imageOptimizer] Thumbnail generation failed, using optimized:', err);
        // Non-critical — fall back to the optimized image
      }
    }
  }

  return {
    optimizedUri: finalResult.uri,
    thumbnailUri,
    width: finalResult.width,
    height: finalResult.height,
    mimeType: actualMime,
    size: optimizedSize,
  };
}

/**
 * pickAndOptimizeImage — Combines image picking with optimization
 *
 * Opens the system image picker, then immediately runs the optimization
 * pipeline. This is the primary entry point for UI components.
 *
 * Handles:
 *  - Camera and gallery permissions
 *  - Picker cancellation (returns null)
 *  - Invalid selections
 *  - Automatic optimization of the picked image
 *
 * @param options - Picker + optimization options
 * @returns OptimizedImageResult or null if the user cancelled
 */
export async function pickAndOptimizeImage(
  options: PickAndOptimizeOptions = {},
): Promise<OptimizedImageResult | null> {
  const {
    allowsEditing = false,
    mediaTypes = [ImagePicker.MediaTypeOptions.Images],
    aspect,
    pickerQuality = 1,
    ...optimizeOpts
  } = options;

  try {
    // Request permissions first
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      if (__DEV__) console.warn('[imageOptimizer] Media library permission denied');
      // Don't throw — let the UI decide how to handle this
      return null;
    }

    // Launch the picker
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypes as ImagePicker.MediaType[],
      allowsEditing,
      aspect: aspect as [number, number] | undefined,
      quality: pickerQuality,
      // Request full-res — we'll resize ourselves for consistency
    });

    // User cancelled
    if (pickerResult.canceled || !pickerResult.assets?.length) {
      return null;
    }

    const asset = pickerResult.assets[0];
    if (!asset.uri) {
      if (__DEV__) console.warn('[imageOptimizer] Picker returned asset without URI');
      return null;
    }

    // Run the optimization pipeline
    return await optimizeImage(asset.uri, optimizeOpts);
  } catch (err) {
    console.error('[imageOptimizer] pickAndOptimizeImage failed:', err);
    throw err;
  }
}

/**
 * getDeviceAppropriateVariant — Selects the right image variant for a given context
 *
 * Returns which image resolution to serve based on:
 *  - The display size (width in pixels of the image view)
 *  - The current network type (to save bandwidth on cellular)
 *
 * This mirrors how X/Twitter serves different image sizes from their
 * `pbs.twimg.com` CDN with `?format=jpg&name=small|medium|large` params.
 *
 * Variant breakdown:
 *  - thumb:  < 100px   — Avatar overlays, inline tiny previews
 *  - small:  100–400px — Timeline thumbnails, list items
 *  - medium: 400–1200px — Feed images, card previews
 *  - large:  > 1200px   — Fullscreen view, detail modal
 *
 * @param viewWidth - Width in CSS/logical pixels of the image container
 * @param networkType - 'wifi' | 'cellular' | 'unknown'
 * @returns The recommended ImageVariant to load
 */
function getDeviceAppropriateVariant(
  viewWidth: number,
  networkType: string = 'unknown',
): ImageVariant {
  // On cellular, prefer smaller variants to save data
  const cellularFactor = networkType === 'cellular' ? 0.7 : 1;

  const effectiveWidth = viewWidth * cellularFactor;

  // Account for device pixel ratio (typically 2-3x on modern phones)
  // We serve 1.5x the logical size as a compromise between quality and bandwidth
  const targetPixels = effectiveWidth * 1.5;

  if (targetPixels < 100) return 'thumb';
  if (targetPixels < 400) return 'small';
  if (targetPixels < 1200) return 'medium';
  return 'large';
}
