/**
 * AppIcon — Centralized icon component for Black94.
 *
 * All icons use Google Material Design icons (MaterialIcons) by default.
 * For icons not available in MaterialIcons (e.g. "diamond", "incognito"),
 * the component falls back to MaterialCommunityIcons automatically.
 *
 * SAFETY: Validates icon names against glyph maps BEFORE rendering.
 * MaterialIcons renders "?" for unknown names (doesn't throw), so
 * we check the glyph map to prevent "?" icons from appearing.
 *
 * Usage:
 *   <AppIcon name="arrow-back" size="lg" color={colors.text} />
 *   <AppIcon name="favorite" size="md" color={colors.like} />
 */

import React from 'react';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';

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
  // Added from screen audit — MCI-only icons used across the app
  'phone-portrait-outline',
  'moon-outline',
  'sunny-outline',
  'people-circle-outline',
  'wallet-outline',
  'stats-chart-outline',
  'people-outline',
  'call-outline',
  'ribbon-outline',
  'medal-outline',
  'trophy-outline',
  'time-outline',
  'sync-outline',
  'briefcase-outline',
  'hand-left',
  'format-bold',
  'format-italic',
  'format-list-numbered',
  'format-h1',
  'format-h2',
  'videocam-outline',
]);

/**
 * Icon name aliases — maps old/common names to their correct MaterialIcons names.
 * This prevents "?" icons when a slightly different name is used.
 */
const ICON_ALIASES: Record<string, string> = {
  // Navigation
  'arrow-back-ios': 'arrow-back',
  'arrow-left': 'arrow-back',
  'chevron-right': 'chevron-right',
  'chevron-forward': 'chevron-right',

  // Actions
  'create-outline': 'edit',
  'add-circle': 'add-circle',
  'add-circle-outline': 'add-circle-outline',
  'checkmark': 'check',
  'checkmark-circle': 'check-circle',
  'checkmark-circle-outline': 'check-circle-outline',
  'ellipsis-horizontal': 'more-horiz',
  'ellipsis-vertical': 'more-vert',
  'close-circle': 'cancel',
  'close-circle-outline': 'cancel',

  // Social
  'heart': 'favorite',
  'heart-outline': 'favorite-border',
  'heart-filled': 'favorite',
  'chatbubble': 'chat',
  'chatbubble-outline': 'chat-bubble-outline',
  'send': 'send',
  'share': 'share',
  'share-outline': 'share',
  'notifications': 'notifications',
  'notifications-outline': 'notifications-outlined',
  'person': 'person',
  'person-outline': 'person-outline',
  'person-add': 'person-add',
  'person-add-outline': 'person-add-alt',

  // Content
  'bookmark': 'bookmark',
  'bookmark-outline': 'bookmark-border',
  'bookmark-border': 'bookmark-border',
  'images': 'photo-library',
  'images-outline': 'photo-library',
  'image': 'image',
  'image-outline': 'image',
  'article': 'article',
  'newspaper': 'article',
  'document': 'description',
  'document-text': 'description',
  'document-text-outline': 'description',

  // Search
  'search': 'search',
  'search-outline': 'search',
  'magnifying-glass': 'search',

  // Settings
  'settings': 'settings',
  'settings-outline': 'settings',
  'lock': 'lock',
  'lock-outline': 'lock-outline',
  'lock-closed': 'lock',
  'shield': 'shield',
  'shield-outline': 'shield',
  'eye': 'visibility',
  'eye-off': 'visibility-off',
  'visibility-off-outline': 'visibility-off',
  'key': 'vpn-key',
  'key-outline': 'vpn-key',

  // Account
  'log-out': 'logout',
  'log-out-outline': 'logout',
  'download': 'download',
  'download-outline': 'download',
  'calendar': 'calendar-today',
  'calendar-outline': 'calendar-today',
  'phone-outline': 'phone-android',

  // Media
  'camera': 'camera-alt',
  'camera-outline': 'camera-alt',
  'camera-alt': 'camera-alt',
  'videocam': 'videocam',
  'videocam-outline': 'videocam',
  'mic': 'mic',
  'microphone': 'mic',
  'microphone-outline': 'mic-none',
  'volume-off': 'volume-off',
  'volume-mute': 'volume-off',
  'volume-mute-outline': 'volume-off',
  'trash': 'delete-outline',
  'trash-outline': 'delete-outline',

  // Misc
  'alert-circle': 'error-outline',
  'alert': 'warning',
  'warning': 'warning',
  'warning-outline': 'warning-amber',
  'info': 'info',
  'info-outline': 'info-outline',
  'help': 'help-outline',
  'help-circle': 'help-outline',
  'check': 'check',
  'close': 'close',
  'menu': 'menu',
  'more': 'more-horiz',
  'refresh': 'refresh',
  'link': 'link',
  'globe': 'public',
  'star': 'star',
  'star-outline': 'star-outline',
  'flag': 'flag',
  'mail': 'mail',
  'mail-outline': 'mail-outline',
  'at': 'alternate-email',
  'at-outline': 'alternate-email',
  'block': 'block',
  'ban': 'block',
  'grid': 'grid-view',
  'grid-outline': 'grid-view',
  'list': 'list',
  'trending': 'trending-up',
  'trending-up-outline': 'trending-up',
  'stats': 'bar-chart',
  'stats-chart': 'bar-chart',
  'flash': 'flash-on',
  'bolt': 'flash-on',
  'flower': 'local-florist',
  'sparkles': 'auto-awesome',
  'visibility': 'visibility',
  'pause': 'pause',
  'play': 'play-arrow',
  'stop': 'stop',
  'skip-next': 'skip-next',
  'skip-previous': 'skip-previous',
  'image-filter-vintage': 'filter-vintage',
  'palette': 'palette',
};

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
 * Checks if an icon name exists in MaterialIcons glyph map.
 * This prevents the "?" fallback glyph from rendering.
 */
function materialIconExists(name: string): boolean {
  try {
    return name in (MaterialIcons as any).glyphMap;
  } catch {
    return false;
  }
}

/**
 * Checks if an icon name exists in MaterialCommunityIcons glyph map.
 */
function communityIconExists(name: string): boolean {
  try {
    return name in (MaterialCommunityIcons as any).glyphMap;
  } catch {
    return false;
  }
}

/**
 * Resolves an icon name through aliases and existence checks.
 * Returns { library: 'material' | 'community', name: string } or null if not found.
 */
function resolveIcon(inputName: string): { library: 'material' | 'community'; name: string } | null {
  if (!inputName || typeof inputName !== 'string') return null;

  const name = inputName.trim();

  // 1. Check if it's in the COMMUNITY_ICONS set first
  if (COMMUNITY_ICONS.has(name)) {
    // Verify it actually exists in the community glyph map
    if (communityIconExists(name)) {
      return { library: 'community', name };
    }
  }

  // 2. Try alias resolution
  const aliased = ICON_ALIASES[name];
  if (aliased) {
    if (materialIconExists(aliased)) {
      return { library: 'material', name: aliased };
    }
    if (communityIconExists(aliased)) {
      return { library: 'community', name: aliased };
    }
  }

  // 3. Check MaterialIcons directly
  if (materialIconExists(name)) {
    return { library: 'material', name };
  }

  // 4. Check MaterialCommunityIcons directly
  if (communityIconExists(name)) {
    return { library: 'community', name };
  }

  return null;
}

/**
 * AppIcon — single icon component for the entire app.
 * Uses MaterialIcons by default, auto-falls back to MaterialCommunityIcons.
 *
 * SAFETY: Validates icon names against glyph maps BEFORE rendering.
 * If an icon name doesn't exist in either library, renders nothing (null)
 * instead of showing "?" which happens with MaterialIcons' default behavior.
 */
const AppIcon = React.memo(function AppIcon({
  name,
  size = 'lg',
  color = '#e7e9ea',
  style,
  accessibilityLabel,
}: AppIconProps) {
  const resolvedSize = resolveSize(size);
  const resolved = resolveIcon(name);

  if (!resolved) {
    // Icon not found in either library — render nothing instead of "?"
    if (__DEV__) {
      console.warn(`[AppIcon] Icon "${name}" not found in MaterialIcons or MaterialCommunityIcons. Rendering null.`);
    }
    return <View style={[{ width: resolvedSize, height: resolvedSize }, style]} />;
  }

  const IconComponent = resolved.library === 'community' ? MaterialCommunityIcons : MaterialIcons;

  return (
    <IconComponent
      name={resolved.name as any}
      size={resolvedSize}
      color={color}
      style={style}
      accessibilityLabel={accessibilityLabel || resolved.name}
    />
  );
});

export default AppIcon;
