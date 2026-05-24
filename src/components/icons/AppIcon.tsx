/**
 * AppIcon — Centralized icon component for Black94.
 *
 * All icons use Google Material Design icons (MaterialIcons) by default.
 * For icons not available in MaterialIcons (e.g. "diamond", "incognito"),
 * the component falls back to MaterialCommunityIcons automatically.
 *
 * Usage:
 *   <AppIcon name="arrow-back" size={22} color={colors.text} />
 *   <AppIcon name="heart" variant="filled" size={18} color={colors.like} />
 *
 * Pattern:
 *   - Use kebab-case names matching MaterialIcons naming
 *   - For filled vs outlined variants, use MaterialIcons naming:
 *     "favorite" (filled), "favorite-border" (outlined)
 *   - For brand icons not in MaterialIcons (diamond, incognito),
 *     define custom SVG components in this directory
 */

import React from 'react';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';

/**
 * MaterialCommunityIcons-only names that don't exist in MaterialIcons.
 * The component will auto-route to MaterialCommunityIcons for these.
 */
const COMMUNITY_ICONS = new Set([
  'incognito',
  'diamond-outline',
  'diamond',
  'poll',
  'image-multiple-outline',
  'gif',
  'shield-checkmark-outline',
  'trail-sign-outline',
  'bag-handle-outline',
  'megaphone-outline',
  'chatbubble-ellipses-outline',
  'chatbubbles-outline',
  'card-outline',
  'newspaper-outline',
  'share-social-outline',
  'repost',
  'checkmark-done-outline',
  'lock-closed-outline',
  'key-outline',
  'storefront-outline',
  'credit-card',
  'forum',
  'repeat',
  'account-group-outline',
  'account-multiple-outline',
  'circle-outline',
  'eye-off-outline',
  'shield-check-outline',
  'account-circle-outline',
  'tray-arrow-down',
  'tag-outline',
  'web',
  'chat-minus-outline',
  'chat-remove-outline',
  'bullhorn-outline',
  'fire',
  'star-outline',
  'crown',
  'flash',
  'lightning-bolt',
  'chart-line',
  'cash',
  'currency-usd',
  'package-variant-closed',
  'truck-outline',
  'map-marker-outline',
  'store',
  'handshake-outline',
  'percent-outline',
  'clock-outline',
  'calendar-range',
  'image-filter-vintage',
  'palette-outline',
  'format-text',
  'information-outline',
  'help-circle-outline',
  'email-outline',
  'phone-outline',
  'alert-circle-outline',
  'bell-outline',
  'chevron-double-right',
  'dots-horizontal-circle-outline',
]);

/** Predefined size tokens for consistent icon sizing across the app. */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 22,
  xl: 24,
  xxl: 28,
  '3xl': 32,
  '4xl': 36,
  hero: 48,
  overlay: 80,
} as const;

export type IconSize = number | keyof typeof ICON_SIZE;

interface AppIconProps {
  /** MaterialIcons name (kebab-case). Falls back to MaterialCommunityIcons if not found. */
  name: string;
  /** Icon size — use a named token or a custom number */
  size?: IconSize;
  /** Icon color */
  color?: string;
  /** Optional style prop */
  style?: any;
  /** Accessibility label */
  accessibilityLabel?: string;
}

/**
 * Resolves the size prop to a pixel value.
 */
function resolveSize(size: IconSize): number {
  if (typeof size === 'number') return size;
  return ICON_SIZE[size] ?? 24;
}

/**
 * AppIcon — single icon component for the entire app.
 * Uses MaterialIcons by default, auto-falls back to MaterialCommunityIcons.
 */
const AppIcon = React.memo(function AppIcon({
  name,
  size = 'lg',
  color = '#e7e9ea',
  style,
  accessibilityLabel,
}: AppIconProps) {
  const resolvedSize = resolveSize(size);
  const isCommunity = COMMUNITY_ICONS.has(name);

  if (isCommunity) {
    return (
      <MaterialCommunityIcons
        name={name as any}
        size={resolvedSize}
        color={color}
        style={style}
        accessibilityLabel={accessibilityLabel || name}
      />
    );
  }

  return (
    <MaterialIcons
      name={name as any}
      size={resolvedSize}
      color={color}
      style={style}
      accessibilityLabel={accessibilityLabel || name}
    />
  );
});

export default AppIcon;
