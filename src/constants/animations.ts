/**
 * Black94 — Centralised animation constants.
 *
 * Single source of truth for spring physics and durations across the app.
 * Import from here instead of inlining magic numbers — keeps the feel
 * consistent and lets us tune the entire app from one place.
 *
 * Usage:
 *   import { spring, timing, SPRING_CONFIGS, DURATIONS } from '../constants/animations';
 *   import Animated, { withSpring, withTiming } from 'react-native-reanimated';
 *
 *   withSpring(scale, spring.gentle);
 *   withTiming(opacity, timing.fade);
 */

import { Easing, type WithSpringConfig } from 'react-native-reanimated';

/* ── Spring Configs ────────────────────────────────────────────────────────
 * Most hide/show and button interactions use springs for natural feel.
 * Pick the gentle/snappy/bouncy variant based on the motion's intent.
 */

export const SPRING_CONFIGS = {
  /** Default — coordinated header/tab bar, modals, sheets. Calm + natural. */
  gentle: {
    damping: 20,
    stiffness: 200,
    mass: 1,
  } satisfies WithSpringConfig,

  /** Quick feedback — button taps, micro-interactions, FAB press. */
  snappy: {
    damping: 16,
    stiffness: 320,
    mass: 0.9,
  } satisfies WithSpringConfig,

  /** Playful — like burst, follow success, repost success. */
  bouncy: {
    damping: 12,
    stiffness: 240,
    mass: 0.8,
  } satisfies WithSpringConfig,

  /** Soft — empty state reveals, content enter. Slow and gentle. */
  soft: {
    damping: 26,
    stiffness: 140,
    mass: 1.1,
  } satisfies WithSpringConfig,
} as const;

/* ── Durations ────────────────────────────────────────────────────────────
 * Animation guideline: most UI animations land in the 180–280ms band.
 * Quick feedback can drop to ~120ms. Slow reveals up to ~400ms.
 */

export const DURATIONS = {
  instant: 90,   // press flash, color blip
  quick: 150,    // small icon state change
  fast: 200,     // default micro-interaction
  normal: 240,   // standard hide/show
  slow: 320,     // sheet open, large enter
  reveal: 420,   // empty state, hero enter
} as const;

/* ── Easings ────────────────────────────────────────────────────────────── */

export const EASINGS = {
  /** Default ease for fade/scale enter. */
  fade: Easing.bezier(0.25, 0.1, 0.25, 1),
  /** For exit/dismiss. */
  exit: Easing.bezier(0.4, 0.0, 1, 1),
  /** Spring-like timing fallback when springs don't fit (eg. layout shifts). */
  entrance: Easing.bezier(0.16, 1, 0.3, 1),
  /** Smooth deceleration for slides. */
  decel: Easing.bezier(0.0, 0.0, 0.2, 1),
} as const;

/* ── Timing Configs ──────────────────────────────────────────────────────── */

export const TIMING_CONFIGS = {
  fade: { duration: DURATIONS.fast, easing: EASINGS.fade },
  fadeQuick: { duration: DURATIONS.quick, easing: EASINGS.fade },
  scaleIn: { duration: DURATIONS.normal, easing: EASINGS.entrance },
  slideUp: { duration: DURATIONS.slow, easing: EASINGS.decel },
  exit: { duration: DURATIONS.fast, easing: EASINGS.exit },
} as const;

/* ── Convenience builders ──────────────────────────────────────────────────
 * `spring.gentle`, `spring.snappy`, etc. drop straight into withSpring().
 * `timing.fade` etc. drop into withTiming()'s config arg.
 */

export const spring = SPRING_CONFIGS;
export const timing = TIMING_CONFIGS;
