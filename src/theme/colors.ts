// Black94 Theme — "Pure Black Premium" — Deep Polish Pass
// All grays eliminated. Backgrounds, surfaces, borders all pure #000000.
// Visual hierarchy achieved through opacity layers, NOT color shifts.

export const colors = {
  // ── Backgrounds ──
  bg: '#000000',
  bgCard: '#000000',
  bgInput: '#000000',
  bgModal: '#000000',
  surface: '#000000',
  surfaceElevated: '#000000',
  surfaceLight: '#000000',
  background: '#000000',

  // ── Text ──
  text: '#e7e9ea',                 // primary text
  white: '#ffffff',
  textSecondary: '#e7e9ea',        // was #94a3b8 gray — now same as primary for readability
  textMuted: '#e7e9ea',            // was #71767b gray — now same as primary
  textTertiary: '#e7e9ea',         // was #64748b gray — now same as primary
  foreground: '#e7e9ea',

  // ── Borders ──
  border: '#000000',               // was #374151 gray — pure black
  borderLight: '#000000',          // was #3a3f44 gray — pure black
  separator: 'rgba(212,175,55,0.15)',  // gold-tinted separator for premium feel
  input: '#000000',                // was #374151 gray — pure black

  // ── Brand Accents ──
  accent: '#D4AF37',               // gold accent
  accentGold: '#f59e0b',
  accentRed: '#f4212e',
  accentGreen: '#10b981',
  primary: '#FFFFFF',
  primaryForeground: '#000000',

  // ── Tab bar ──
  tabBar: '#000000',
  tabBarBorder: '#000000',         // was #374151 gray — pure black
  headerBg: '#000000',

  // ── Verified badges ──
  verified: '#D4AF37',
  verifiedGold: '#ffd700',
  verifiedDefault: '#FFFFFF',

  // ── Chat ──
  chatBubbleMine: '#FFFFFF',
  chatBubbleMineGradientEnd: '#FFFFFF',  // was #D1D5DB gray — now pure white
  chatBubbleMineText: '#000000',
  chatBubbleOther: 'rgba(212,175,55,0.08)',  // gold-tinted received bubble
  chatBubbleOtherText: '#e7e9ea',

  // ── Like / Bookmark ──
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
  avatarFallback: '#000000',       // was #1e293b gray-blue — pure black
  avatarFallbackText: '#e7e9ea',
  avatarGradientEnd: '#000000',    // was #9CA3AF gray — pure black

  // ── Compose ──
  composeBorder: 'rgba(212,175,55,0.2)',   // gold-tinted border
  composeDisabled: 'rgba(212,175,55,0.08)',
  composeDisabledText: '#e7e9ea',          // was #64748b gray

  // ── Surfaces (semi-transparent) ──
  bgSubtle: 'rgba(212,175,55,0.04)',          // gold-tinted subtle surface
  bgSubtleAlt: 'rgba(212,175,55,0.06)',       // gold-tinted
  white25: 'rgba(255,255,255,0.25)',
  white50: 'rgba(255,255,255,0.5)',
  borderSubtle: 'rgba(212,175,55,0.12)',      // gold-tinted
  borderSubtleAlt: 'rgba(212,175,55,0.15)',   // gold-tinted
  borderSubtleStrong: 'rgba(212,175,55,0.2)', // gold-tinted
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

  // ── Green tints ──
  greenBg: 'rgba(16,185,129,0.1)',
  greenFaint: 'rgba(34,197,94,0.1)',

  // ── Row highlights ──
  rowUnreadBg: 'rgba(212,175,55,0.03)',
  rowPressed: 'rgba(212,175,55,0.04)',

  // ── Skeleton shimmer ──
  skeleton: 'rgba(212,175,55,0.06)',          // gold-tinted shimmer
  skeletonFaint: 'rgba(212,175,55,0.1)',
  skeletonBright: 'rgba(212,175,55,0.2)',

  // ── Fact check ──
  factCheckBg: 'rgba(16,185,129,0.1)',

  // ── Stars ──
  starEmpty: 'rgba(212,175,55,0.2)',           // gold-tinted empty star

  // ── Additional tokens for hardcoded value cleanup ──
  overlayLight: 'rgba(0,0,0,0.35)',
  overlaySoft: 'rgba(0,0,0,0.55)',
  overlayFull: 'rgba(0,0,0,0.9)',
  overlaySolid: 'rgba(0,0,0,0.95)',
  overlayMax: 'rgba(0,0,0,0.85)',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
};
