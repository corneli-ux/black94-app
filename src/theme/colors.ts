/**
 * Black94 Color System — v2
 *
 * Three-layer dark depth model:
 *   Layer 0  bg          #000000  — absolute base (status bar, tab bar)
 *   Layer 1  surface     #0d0d0d  — default screen background
 *   Layer 2  surfaceCard #141414  — cards, list rows, modals
 *   Layer 3  surfaceHigh #1c1c1e  — inputs, elevated panels
 *
 * This gives depth without breaking the pure dark aesthetic.
 */

export const colors = {
  // ── Background layers ─────────────────────────────────────────────────
  bg:               '#000000',     // absolute black (nav bars, tab bar)
  background:       '#080808',     // default screen bg — barely off-black
  surface:          '#0d0d0d',     // base card / row surface
  surfaceCard:      '#141414',     // cards, chat bubbles, modals
  surfaceElevated:  '#1c1c1e',     // inputs, elevated panels, bottom sheets
  surfaceLight:     '#242424',     // hover states, pressed rows
  bgCard:           '#141414',     // alias for surfaceCard
  bgInput:          '#1c1c1e',     // input field background
  bgModal:          '#111111',     // modal / bottom sheet bg
  card:             '#141414',
  muted:            '#0d0d0d',

  // ── Text hierarchy ────────────────────────────────────────────────────
  text:             '#e7e9ea',     // primary — near white
  white:            '#ffffff',
  foreground:       '#e7e9ea',
  textSecondary:    '#8b8f96',     // secondary — timestamps, labels
  textMuted:        '#5c6068',     // placeholder, hint text
  textTertiary:     '#3d4148',     // very subtle — divider labels

  // ── Borders & separators ──────────────────────────────────────────────
  border:           '#2a2d31',     // standard card border
  borderLight:      '#222528',     // lighter variant
  separator:        '#1e2124',     // list dividers
  input:            '#2a2d31',     // input border ring

  // ── Brand accent — Gold ───────────────────────────────────────────────
  accent:           '#D4AF37',
  accentGold:       '#f59e0b',
  accentRed:        '#f4212e',
  accentGreen:      '#10b981',
  primary:          '#FFFFFF',
  primaryForeground:'#000000',

  // ── Navigation ────────────────────────────────────────────────────────
  tabBar:           '#000000',
  tabBarBorder:     '#1a1d20',
  headerBg:         '#000000',

  // ── Verified badges ───────────────────────────────────────────────────
  verified:         '#D4AF37',
  verifiedGold:     '#ffd700',
  verifiedDefault:  '#FFFFFF',

  // ── Chat bubbles ──────────────────────────────────────────────────────
  chatBubbleMine:              '#FFFFFF',
  chatBubbleMineGradientEnd:   '#FFFFFF',
  chatBubbleMineText:          '#000000',
  chatBubbleOther:             '#1e1e1e',
  chatBubbleOtherText:         '#e7e9ea',

  // ── Interactions ─────────────────────────────────────────────────────
  like:             '#f43f5e',
  repost:           '#10b981',
  bookmark:         '#D4AF37',

  // ── Semantic ──────────────────────────────────────────────────────────
  error:            '#ef4444',
  destructive:      '#ef4444',
  delete:           '#f4212e',
  success:          '#10b981',
  warning:          '#f59e0b',

  // ── Avatar ────────────────────────────────────────────────────────────
  avatarFallback:       '#1e2124',
  avatarFallbackText:   '#e7e9ea',
  avatarGradientEnd:    '#0d0d0d',

  // ── Compose ───────────────────────────────────────────────────────────
  composeBorder:        'rgba(212,175,55,0.25)',
  composeDisabled:      'rgba(212,175,55,0.08)',
  composeDisabledText:  '#5c6068',

  // ── Semi-transparent surfaces ─────────────────────────────────────────
  bgSubtle:             'rgba(255,255,255,0.04)',
  bgSubtleAlt:          'rgba(255,255,255,0.06)',
  white25:              'rgba(255,255,255,0.25)',
  white50:              'rgba(255,255,255,0.5)',
  borderSubtle:         'rgba(255,255,255,0.08)',
  borderSubtleAlt:      'rgba(255,255,255,0.10)',
  borderSubtleStrong:   'rgba(255,255,255,0.14)',
  borderWhite40:        'rgba(255,255,255,0.4)',

  // ── Overlays ──────────────────────────────────────────────────────────
  overlay:        'rgba(0,0,0,0.5)',
  overlayMedium:  'rgba(0,0,0,0.6)',
  overlayDark:    'rgba(0,0,0,0.68)',
  overlayHeavy:   'rgba(0,0,0,0.75)',
  overlayDarker:  'rgba(0,0,0,0.82)',
  drawerOverlay:  'rgba(0,0,0,0.72)',
  overlayLight:   'rgba(0,0,0,0.35)',
  overlaySoft:    'rgba(0,0,0,0.55)',
  overlayFull:    'rgba(0,0,0,0.9)',
  overlaySolid:   'rgba(0,0,0,0.95)',
  overlayMax:     'rgba(0,0,0,0.88)',

  // ── Accent tints ──────────────────────────────────────────────────────
  accentFaint:        'rgba(212,175,55,0.07)',
  accentBg:           'rgba(212,175,55,0.10)',
  accentBgStrong:     'rgba(212,175,55,0.16)',
  accentBorder:       'rgba(212,175,55,0.22)',
  accentBorderStrong: 'rgba(212,175,55,0.28)',
  accentBorderHeavy:  'rgba(212,175,55,0.35)',

  // ── Destructive tints ─────────────────────────────────────────────────
  destructiveFaint:  'rgba(244,63,94,0.08)',
  destructiveBg:     'rgba(244,63,94,0.15)',
  destructiveBorder: 'rgba(244,63,94,0.22)',

  // ── Green tints ───────────────────────────────────────────────────────
  greenBg:    'rgba(16,185,129,0.10)',
  greenFaint: 'rgba(34,197,94,0.10)',

  // ── Row highlights ────────────────────────────────────────────────────
  rowUnreadBg: 'rgba(212,175,55,0.04)',
  rowPressed:  'rgba(255,255,255,0.05)',

  // ── Skeleton shimmer ──────────────────────────────────────────────────
  skeleton:       'rgba(255,255,255,0.07)',
  skeletonFaint:  'rgba(255,255,255,0.11)',
  skeletonBright: 'rgba(255,255,255,0.20)',

  // ── Misc ──────────────────────────────────────────────────────────────
  factCheckBg: 'rgba(16,185,129,0.10)',
  starEmpty:   'rgba(212,175,55,0.20)',
  silver:      '#C0C0C0',
  bronze:      '#CD7F32',
};
