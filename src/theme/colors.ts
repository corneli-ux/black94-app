// Black94 Theme — Minimalist Dark with proper visual hierarchy
// Pure black background with subtle gray layers for depth and readability.
// Updated with embed tokens for beautiful repost/quote cards.

export const colors = {
  // ── Backgrounds ──
  bg: '#000000',
  bgCard: '#0d0d0d',
  bgInput: '#0f0f0f',
  bgModal: '#111111',
  surface: '#0a0a0a',
  surfaceElevated: '#141414',
  surfaceLight: '#1a1a1a',
  background: '#000000',

  // ── Text — proper hierarchy with opacity levels ──
  text: '#e7e9ea',
  white: '#ffffff',
  textSecondary: '#a0a3a8',
  textMuted: '#6e7680',
  textTertiary: '#484d54',
  foreground: '#e7e9ea',

  // ── Borders — subtle but visible ──
  border: '#222528',
  borderLight: '#1c1f22',
  separator: '#1a1d20',
  input: '#1c1f22',

  // ── Brand Accents ──
  accent: '#D4AF37',
  accentGold: '#f59e0b',
  accentRed: '#f4212e',
  accentGreen: '#10b981',
  primary: '#FFFFFF',
  primaryForeground: '#000000',

  // ── Tab bar ──
  tabBar: '#000000',
  tabBarBorder: '#1a1d20',
  headerBg: '#000000',

  // ── Verified badges ──
  verified: '#D4AF37',
  verifiedGold: '#ffd700',
  verifiedDefault: '#FFFFFF',

  // ── Chat ──
  chatBubbleMine: '#FFFFFF',
  chatBubbleMineGradientEnd: '#FFFFFF',
  chatBubbleMineText: '#000000',
  chatBubbleOther: 'rgba(212,175,55,0.08)',
  chatBubbleOtherText: '#e7e9ea',

  // ── Like / Bookmark / Repost ──
  like: '#f43f5e',
  repost: '#10b981',
  bookmark: '#FFFFFF',

  // ── Semantic ──
  error: '#ef4444',
  destructive: '#ef4444',
  delete: '#f4212e',

  // ── Card ──
  card: '#000000',
  muted: '#000000',

  // ── Avatar fallback ──
  avatarFallback: '#1a1d20',
  avatarFallbackText: '#e7e9ea',
  avatarGradientEnd: '#000000',

  // ── Compose ──
  composeBorder: 'rgba(212,175,55,0.2)',
  composeDisabled: 'rgba(212,175,55,0.08)',
  composeDisabledText: '#6e7680',

  // ── Surfaces (semi-transparent) ──
  bgSubtle: 'rgba(255,255,255,0.05)',
  bgSubtleAlt: 'rgba(255,255,255,0.07)',
  white25: 'rgba(255,255,255,0.25)',
  white50: 'rgba(255,255,255,0.5)',
  borderSubtle: 'rgba(255,255,255,0.10)',
  borderSubtleAlt: 'rgba(255,255,255,0.12)',
  borderSubtleStrong: 'rgba(255,255,255,0.16)',
  borderWhite40: 'rgba(255,255,255,0.4)',

  // ── Overlays ──
  overlay: 'rgba(0,0,0,0.5)',
  overlayMedium: 'rgba(0,0,0,0.55)',
  overlayDark: 'rgba(0,0,0,0.6)',
  overlayHeavy: 'rgba(0,0,0,0.7)',
  overlayDarker: 'rgba(0,0,0,0.75)',
  drawerOverlay: 'rgba(0,0,0,0.7)',

  // ── Accent tints ──
  accentFaint: 'rgba(212,175,55,0.08)',
  accentBg: 'rgba(212,175,55,0.1)',
  accentBgStrong: 'rgba(212,175,55,0.15)',
  accentBorder: 'rgba(212,175,55,0.2)',
  accentBorderStrong: 'rgba(212,175,55,0.25)',
  accentBorderHeavy: 'rgba(212,175,55,0.3)',

  // ── Destructive tints ──
  destructiveFaint: 'rgba(244,63,94,0.08)',
  destructiveBg: 'rgba(244,63,94,0.15)',
  destructiveBorder: 'rgba(244,63,94,0.2)',

  // ── Green tints (repost) ──
  greenBg: 'rgba(16,185,129,0.1)',
  greenFaint: 'rgba(34,197,94,0.1)',

  // ── Row highlights ──
  rowUnreadBg: 'rgba(255,255,255,0.03)',
  rowPressed: 'rgba(255,255,255,0.04)',

  // ── Skeleton shimmer ──
  skeleton: 'rgba(255,255,255,0.06)',
  skeletonFaint: 'rgba(255,255,255,0.1)',
  skeletonBright: 'rgba(255,255,255,0.2)',

  // ── Fact check ──
  factCheckBg: 'rgba(16,185,129,0.1)',

  // ── Stars ──
  starEmpty: 'rgba(212,175,55,0.2)',

  // ── Additional tokens ──
  overlayLight: 'rgba(0,0,0,0.35)',
  overlaySoft: 'rgba(0,0,0,0.55)',
  overlayFull: 'rgba(0,0,0,0.9)',
  overlaySolid: 'rgba(0,0,0,0.95)',
  overlayMax: 'rgba(0,0,0,0.85)',
  silver: '#C0C0C0',
  bronze: '#CD7F32',

  // ── NEW: Beautiful embed cards for reposts and quote reposts (minimalist social) ──
  embedBg: '#111111',
  embedBorder: '#2a2d31',
  repostEmbedBorder: 'rgba(16,185,129,0.35)',
  quoteEmbedBorder: 'rgba(212,175,55,0.3)',
  embedLine: '#444',
};