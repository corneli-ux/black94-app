/**
 * Black94 Design Tokens
 * Single source of truth for typography, spacing, radius, shadows.
 * Import from here — never hardcode values in screens.
 */

import { Platform } from 'react-native';

// ── Typography ────────────────────────────────────────────────────────────────
export const typography = {
  // Font families
  fontFamily: Platform.select({
    ios: 'System',
    android: 'Roboto',
    default: 'System',
  }),

  // Size scale
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 36,

  // Weight scale
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,

  // Line height multipliers
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,

  // Letter spacing
  tighter: -0.8,
  tight_ls: -0.4,
  normal_ls: 0,
  wide: 0.4,
};

// ── Spacing scale (4-pt grid) ─────────────────────────────────────────────────
export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
};

// ── Border radius ─────────────────────────────────────────────────────────────
export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
};

// ── Elevation / Shadow ────────────────────────────────────────────────────────
export const shadow = {
  none: {},
  sm: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 2 },
    android: { elevation: 2 },
    default: {},
  }),
  md: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8 },
    android: { elevation: 4 },
    default: {},
  }),
  lg: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16 },
    android: { elevation: 8 },
    default: {},
  }),
  gold: Platform.select({
    ios: { shadowColor: '#D4AF37', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 8 },
    android: { elevation: 4 },
    default: {},
  }),
};

// ── Animation durations ───────────────────────────────────────────────────────
export const duration = {
  fast: 150,
  normal: 250,
  slow: 380,
};

// ── Z-index stack ─────────────────────────────────────────────────────────────
export const zIndex = {
  base: 0,
  raised: 10,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
};
