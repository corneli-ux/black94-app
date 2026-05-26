/**
 * RepostIcon — Custom SVG icon matching the web app's Lucide "repeat" icon.
 * Shared across all screens that display repost indicators.
 *
 * Extracted from 5 duplicate definitions in:
 * - FeedScreen.tsx
 * - ProfileScreen.tsx
 * - UserProfileScreen.tsx
 * - PostCommentsScreen.tsx
 * - CommentSheet.tsx
 */

import React from 'react';
import Svg, { Path, Polyline } from 'react-native-svg';

interface RepostIconProps {
  size?: number;
  color?: string;
}

const RepostIcon = React.memo(function RepostIcon({
  size = 18,
  color = '#e7e9ea',
}: RepostIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
});

export default RepostIcon;
