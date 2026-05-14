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
  accent: '#2a7fff',               // web: --chart-2, brand blue
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
  verified: '#3b82f6',             // web: badge 'pro' or 'blue' → #3b82f6
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
};
