/**
 * responsive.ts — Resolution-independent scaling for 8K / tablets / large screens
 *
 * Design baseline: iPhone 14 (390×844 @ 3x)
 * All sizes scale proportionally based on screen width.
 *
 * Usage:
 *   import { scale, vs, ms, useScale } from '../theme/responsive';
 *
 *   // Function-style (scales at render time):
 *   width: scale(16)      // 16dp on 390px screen, ~33dp on 8K
 *   fontSize: vs(15)      // vertical scale for text
 *   marginHorizontal: ms(20)
 *
 *   // Hook-style (reactive to dimension changes):
 *   const { scale: s, vs, ms } = useScale();
 */

import { Dimensions, PixelRatio, useWindowDimensions } from 'react-native';

// ── Design baseline: iPhone 14 ──────────────────────────────────────────────
const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

// ── Scale clamps ─────────────────────────────────────────────────────────────
// Minimum 0.8x (don't shrink too much on small phones)
// Maximum 2.0x (cap scaling at ~780dp — larger screens get constrained width)
const MIN_SCALE = 0.8;
const MAX_SCALE = 2.0;
const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 2.0;

// ── Static getters (for StyleSheet — don't change at runtime) ───────────────
// Use these in StyleSheet.create(). They capture the initial screen size.

/**
 * Horizontal scale factor based on current screen width.
 * Clamped between MIN_SCALE and MAX_SCALE.
 */
export function getScaleFactor(): number {
  const screenWidth = Dimensions.get('window').width;
  return Math.min(Math.max(screenWidth / BASE_WIDTH, MIN_SCALE), MAX_SCALE);
}

/**
 * Scale a horizontal value (width, marginHorizontal, padding, borderRadius, etc.)
 * Use in StyleSheet.create().
 */
export function scale(size: number): number {
  return Math.round(size * getScaleFactor());
}

/**
 * Scale a vertical value (height, marginVertical, paddingVertical, etc.)
 * Slightly less aggressive than horizontal to prevent overstretching.
 */
export function verticalScale(size: number): number {
  const screenHeight = Dimensions.get('window').height;
  const vScale = Math.min(Math.max(screenHeight / BASE_HEIGHT, MIN_SCALE), MAX_SCALE);
  return Math.round(size * vScale);
}

/**
 * Scale a moderate value (used for sizes that shouldn't stretch as aggressively
 * as horizontal but more than vertical — e.g., icon sizes, spacing).
 */
export function moderateScale(size: number, factor: number = 0.5): number {
  return Math.round(size + (scale(size) - size) * factor);
}

/**
 * Scale a font size. Fonts can go higher than other values for readability.
 */
export function fontScale(size: number): number {
  const scaleFactor = getScaleFactor();
  return Math.round(size * Math.min(Math.max(scaleFactor, MIN_FONT_SCALE), MAX_FONT_SCALE));
}

// Short aliases
export const s = scale;
export const vs = verticalScale;
export const ms = moderateScale;
export const fs = fontScale;

// ── Spacing scale (pre-scaled constants) ─────────────────────────────────────
export const spacing = {
  xs: scale(4),
  sm: scale(8),
  md: scale(12),
  lg: scale(16),
  xl: scale(20),
  xxl: scale(24),
  xxxl: scale(32),
  huge: scale(48),
};

// ── Typography scale (pre-scaled font sizes) ─────────────────────────────────
export const fonts = {
  micro: fontScale(10),
  caption: fontScale(11),
  small: fontScale(13),
  body: fontScale(15),
  bodyLarge: fontScale(17),
  subheading: fontScale(20),
  heading: fontScale(24),
  title: fontScale(28),
  display: fontScale(36),
  hero: fontScale(48),
};

// ── Border radius scale ────────────────────────────────────────────────────
export const radii = {
  sm: scale(4),
  md: scale(8),
  lg: scale(12),
  xl: scale(16),
  xxl: scale(20),
  round: scale(9999),
};

// ── Hook for reactive scaling (updates on rotation / resize) ───────────────
interface ScaleHelpers {
  /** Scale a horizontal value */
  scale: (size: number) => number;
  /** Scale a vertical value */
  vs: (size: number) => number;
  /** Moderate scale */
  ms: (size: number, factor?: number) => number;
  /** Scale a font size */
  fs: (size: number) => number;
  /** Current screen width in dp */
  width: number;
  /** Current screen height in dp */
  height: number;
  /** Pixel ratio */
  pixelRatio: number;
  /** Whether screen is tablet-sized (>= 768dp) */
  isTablet: boolean;
  /** Whether screen is ultra-wide (>= 2000dp) — constrain content width */
  isLargeScreen: boolean;
  /** Whether screen is 8K-class (>= 3840dp) */
  is8K: boolean;
  /** Recommended max content width for large screens */
  maxContentWidth: number;
}

export function useScale(): ScaleHelpers {
  const { width, height } = useWindowDimensions();
  const pixelRatio = PixelRatio.get();

  const scaleFactor = Math.min(Math.max(width / BASE_WIDTH, MIN_SCALE), MAX_SCALE);
  const fontScaleFactor = Math.min(Math.max(scaleFactor, MIN_FONT_SCALE), MAX_FONT_SCALE);
  const vScaleFactor = Math.min(Math.max(height / BASE_HEIGHT, MIN_SCALE), MAX_SCALE);

  return {
    scale: (size: number) => Math.round(size * scaleFactor),
    vs: (size: number) => Math.round(size * vScaleFactor),
    ms: (size: number, factor: number = 0.5) =>
      Math.round(size + (Math.round(size * scaleFactor) - size) * factor),
    fs: (size: number) => Math.round(size * fontScaleFactor),
    width,
    height,
    pixelRatio,
    isTablet: width >= 768,
    isLargeScreen: width >= 2000,
    is8K: width >= 3840,
    // On large/8K screens, constrain content to ~800dp centered
    maxContentWidth: width >= 2000 ? Math.min(width * 0.5, 800) : width,
  };
}

// ── Content width wrapper helper ────────────────────────────────────────────
// For large screens, this returns a constrained maxWidth for content containers.
// On phones, it returns the full screen width.
export function getContentMaxWidth(): number {
  const screenWidth = Dimensions.get('window').width;
  if (screenWidth >= 3840) return 800;
  if (screenWidth >= 2000) return Math.min(screenWidth * 0.5, 800);
  if (screenWidth >= 768) return Math.min(screenWidth * 0.8, 600);
  return screenWidth;
}
