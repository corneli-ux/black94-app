// Black94 Theme — "Pure Black Premium" matching web app globals.css exactly
// Colors extracted from web app's CSS custom properties + Tailwind config

export const colors = {
  // ── Backgrounds (web: --background: #000000, --card: #000000) ──
  bg: '#000000',
  bgCard: '#000000',
  bgInput: '#16181c',
  bgModal: '#0d0b14',              // web: compose sheet bg
  surface: '#16181c',               // web: --secondary, --muted
  surfaceElevated: '#1d1f23',      // web: chat bubble received, input bg
  surfaceLight: '#1e2026',
  background: '#000000',

  // ── Text (web: --foreground: #e7e9ea) ──
  text: '#e7e9ea',                 // primary text
  white: '#ffffff',
  textSecondary: '#94a3b8',        // web: text-[#94a3b8] (username, muted labels, action counts)
  textMuted: '#71767b',            // web: --muted-foreground
  textTertiary: '#64748b',         // web: timestamp, subtle labels
  foreground: '#e7e9ea',

  // ── Borders (web: --border: #374151, separators: white/[0.06]) ──
  border: '#374151',
  borderLight: '#3a3f44',
  separator: 'rgba(255,255,255,0.06)',  // web: border-white/[0.06]
  input: '#374151',

  // ── Brand Accents ──
  accent: '#D4AF37',               // gold accent (was brand blue)
  accentGold: '#f59e0b',           // web: --chart-3, amber-500
  accentRed: '#f4212e',            // web: destructive
  accentGreen: '#10b981',          // web: emerald-500
  primary: '#FFFFFF',              // web: --primary: #FFFFFF
  primaryForeground: '#000000',    // web: --primary-foreground: #000000

  // ── Tab bar ──
  tabBar: '#000000',
  tabBarBorder: '#374151',
  headerBg: '#000000',

  // ── Verified badges (exact match to web PAvatar.tsx resolveBadgeColor) ──
  verified: '#D4AF37',             // gold (was blue) — badge 'pro' or 'blue'
  verifiedGold: '#ffd700',         // web: badge 'gold' → #ffd700
  verifiedDefault: '#FFFFFF',      // web: generic verified → #FFFFFF

  // ── Chat ──
  chatBubbleMine: '#FFFFFF',
  chatBubbleMineGradientEnd: '#D1D5DB',  // web: gradient end for sent bubble
  chatBubbleMineText: '#000000',
  chatBubbleOther: 'rgba(255,255,255,0.08)',  // web: white/[0.06] with backdrop blur
  chatBubbleOtherText: '#e7e9ea',

  // ── Like / Bookmark ──
  like: '#f43f5e',                 // web: rose-500
  repost: '#10b981',               // web: emerald-500
  bookmark: '#FFFFFF',             // web: white when active

  // ── Semantic ──
  error: '#ef4444',
  destructive: '#ef4444',
  delete: '#f4212e',               // web: delete red

  // ── Card ──
  card: '#000000',
  muted: '#16181c',

  // ── Avatar fallback ──
  avatarFallback: '#1e293b',
  avatarFallbackText: '#e7e9ea',
  avatarGradientEnd: '#9CA3AF',    // web: bg-gradient-to-br from-[#FFFFFF] to-[#9CA3AF]

  // ── Compose ──
  composeBorder: 'rgba(255,255,255,0.08)',   // web: border-white/[0.08]
  composeDisabled: 'rgba(255,255,255,0.08)',  // web: bg-white/[0.08]
  composeDisabledText: '#64748b',             // web: text-[#64748b]

  // ── Surfaces (semi-transparent) ──
  bgSubtle: 'rgba(255,255,255,0.04)',          // subtle elevated surface
  bgSubtleAlt: 'rgba(255,255,255,0.05)',       // slightly more visible surface
  white25: 'rgba(255,255,255,0.25)',
  white50: 'rgba(255,255,255,0.5)',
  borderSubtle: 'rgba(255,255,255,0.08)',
  borderSubtleAlt: 'rgba(255,255,255,0.12)',
  borderSubtleStrong: 'rgba(255,255,255,0.15)',
  borderWhite40: 'rgba(255,255,255,0.4)',

  // ── Overlays ──
  overlay: 'rgba(0,0,0,0.5)',
  overlayMedium: 'rgba(0,0,0,0.55)',
  overlayDark: 'rgba(0,0,0,0.6)',
  overlayHeavy: 'rgba(0,0,0,0.7)',
  overlayDarker: 'rgba(0,0,0,0.75)',
  drawerOverlay: 'rgba(0,0,0,0.7)',

  // ── Accent tints (for badges, chips, highlights) ──
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
  greenBg: 'rgba(16,185,129,0.1)',          // matches accentGreen
  greenFaint: 'rgba(34,197,94,0.1)',

  // ── Row highlights ──
  rowUnreadBg: 'rgba(255,255,255,0.03)',
  rowPressed: 'rgba(255,255,255,0.04)',

  // ── Skeleton shimmer ──
  skeleton: '#2a2d33',                       // visible on pure black
  skeletonFaint: 'rgba(255,255,255,0.15)',
  skeletonBright: 'rgba(255,255,255,0.35)',

  // ── Fact check ──
  factCheckBg: 'rgba(16,185,129,0.1)',       // matches accentGreen (#10b981)

  // ── Stars ──
  starEmpty: '#374151',                       // visible empty star on dark bg
};
