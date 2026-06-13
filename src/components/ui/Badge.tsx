/**
 * Black94 — Badge primitive
 * Variants: default | gold | green | red | outline
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { typography, spacing, radius } from '../../theme/tokens';

type BadgeVariant = 'default' | 'gold' | 'green' | 'red' | 'outline';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  dot?: boolean;
}

export default function Badge({ label, variant = 'default', style, dot }: BadgeProps) {
  return (
    <View style={[styles.badge, styles[`variant_${variant}`], style]}>
      {dot && <View style={[styles.dot, styles[`dot_${variant}`]]} />}
      <Text style={[styles.label, styles[`label_${variant}`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: radius.full,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    letterSpacing: typography.wide,
    textTransform: 'uppercase',
  },

  variant_default:  { backgroundColor: colors.surfaceElevated },
  variant_gold:     { backgroundColor: colors.accentBg },
  variant_green:    { backgroundColor: colors.greenBg },
  variant_red:      { backgroundColor: colors.destructiveBg },
  variant_outline:  { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },

  dot_default: { backgroundColor: colors.textMuted },
  dot_gold:    { backgroundColor: colors.accent },
  dot_green:   { backgroundColor: colors.accentGreen },
  dot_red:     { backgroundColor: colors.error },
  dot_outline: { backgroundColor: colors.textMuted },

  label_default: { color: colors.textSecondary },
  label_gold:    { color: colors.accent },
  label_green:   { color: colors.accentGreen },
  label_red:     { color: colors.error },
  label_outline: { color: colors.textSecondary },
});
