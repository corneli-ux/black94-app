import React from 'react';
import Svg, { Path, Polyline, Circle, Rect, Line } from 'react-native-svg';

/* ── Reply Icon (X/Twitter style) ─────────────────────────────────────────
 *  Premium chat bubble — rounded rect body with a curved tail
 *  pointing bottom-left. Slightly thicker stroke, softer feel.
 * ────────────────────────────────────────────────────────────────────────── */
export function ReplyIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Svg>
  );
}

/* ── Repost Icon (matches web app SVG exactly) ──────────────────────────── */
export function RepostIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
}

/* ── Heart / Like Icon ───────────────────────────────────────────────────── */
export function HeartIcon({ size = 18, color = '#94a3b8', filled = false }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </Svg>
  );
}

/* ── Bookmark Icon ──────────────────────────────────────────────────────── */
export function BookmarkIcon({ size = 18, color = '#94a3b8', filled = false }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </Svg>
  );
}

/* ── Share Icon ──────────────────────────────────────────────────────────── */
export function ShareIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <Polyline points="16 6 12 2 8 6" />
      <Line x1="12" y1="2" x2="12" y2="15" />
    </Svg>
  );
}

/* ── Views / Eye Icon (X/Twitter style) ────────────────────────────────────
 *  Clean eye outline — X uses this for views/analytics.
 *  Simple, premium, recognizable.
 * ────────────────────────────────────────────────────────────────────────── */
export function ChartIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11-8-11 8-11 8 4 8 11 8z" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

/* ── Photo / Camera Icon ────────────────────────────────────────────────── */
export function ImageIcon({ size = 20, color = '#2a7fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <Circle cx="8.5" cy="8.5" r="1.5" />
      <Polyline points="21 15 16 10 5 21" />
    </Svg>
  );
}

/* ── GIF Icon ────────────────────────────────────────────────────────────── */
export function GIFIcon({ size = 20, color = '#f59e0b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <Path d="M6 12V9h3l-2 6h3" />
      <Path d="M13 9h2a2 2 0 010 4h-2" />
      <Path d="M17 9v3a1 1 0 001 1h1" />
    </Svg>
  );
}

/* ── Emoji Smiley Icon ──────────────────────────────────────────────────── */
export function EmojiIcon({ size = 20, color = '#2a7fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="10" />
      <Path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <Path d="M9 9h.01" />
      <Path d="M15 9h.01" />
    </Svg>
  );
}

/* ── Poll / Chart Icon ──────────────────────────────────────────────────── */
export function PollIcon({ size = 20, color = '#8b5cf6' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Line x1="18" y1="20" x2="18" y2="10" />
      <Line x1="12" y1="20" x2="12" y2="4" />
      <Line x1="6" y1="20" x2="6" y2="14" />
    </Svg>
  );
}

/* ── Location / Pin Icon ────────────────────────────────────────────────── */
export function LocationIcon({ size = 20, color = '#f59e0b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <Circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

/* ── Camera Icon ────────────────────────────────────────────────────────── */
export function CameraIcon({ size = 20, color = '#10b981' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <Circle cx="12" cy="13" r="4" />
    </Svg>
  );
}

/* ── Compose / Feather Icon ─────────────────────────────────────────────── */
export function ComposeIcon({ size = 24, color = '#000000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M22 12l-10 10L3 13l10-10 9 9z" />
      <Path d="M18 8l-2-2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

/* ── Back Arrow Icon ────────────────────────────────────────────────────── */
export function BackArrowIcon({ size = 22, color = '#e7e9ea' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="15 18 9 12 15 6" />
    </Svg>
  );
}

/* ── More / Dots Icon ───────────────────────────────────────────────────── */
export function MoreIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Circle cx="5" cy="12" r="2" />
      <Circle cx="12" cy="12" r="2" />
      <Circle cx="19" cy="12" r="2" />
    </Svg>
  );
}

/* ── Shared Helpers ─────────────────────────────────────────────────────── */

export function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
