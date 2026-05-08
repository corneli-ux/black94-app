import React from 'react';
import Svg, { Path, Polyline } from 'react-native-svg';

/* ── Reply/Comment Icon ───────────────────────────────────────────────────
 *  Custom SVG that replaces Ionicons chatbubble-outline.
 *  Symmetric speech bubble with a small tail pointing bottom-left,
 *  designed for perfect visual alignment in the action bar.
 *  Match the visual style of a popular social media platform's reply icon.
 * ────────────────────────────────────────────────────────────────────────── */
export function ReplyIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
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

/* ── Shared Helpers ─────────────────────────────────────────────────────── */

export function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
