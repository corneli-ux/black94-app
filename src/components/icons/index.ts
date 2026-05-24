/**
 * Centralized icon system for Black94.
 *
 * Usage:
 *   import { AppIcon, RepostIcon, ICON_SIZE } from '../components/icons';
 *
 *   <AppIcon name="arrow-back" size="lg" color={colors.text} />
 *   <AppIcon name="favorite" size="md" color={colors.like} />
 *   <AppIcon name="favorite-border" size="md" color={colors.textSecondary} />
 *   <RepostIcon size={18} color={colors.repost} />
 */

export { default as AppIcon } from './AppIcon';
export { default as RepostIcon } from './RepostIcon';
export { ICON_SIZE } from './AppIcon';
export type { IconSize } from './AppIcon';
