/**
 * Black94 — Button primitive
 * Variants: primary | secondary | ghost | destructive | gold
 * Sizes: sm | md | lg
 */
import React, { useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  Animated,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { typography, spacing, radius } from '../../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'gold';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  leftIcon?: React.ReactNode;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  leftIcon,
}: ButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  const handlePressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const containerStyle = [
    styles.base,
    styles[`size_${size}`],
    styles[`variant_${variant}`],
    fullWidth && styles.fullWidth,
    (disabled || loading) && styles.disabled,
    style,
  ];

  const labelStyle = [
    styles.label,
    styles[`label_${size}`],
    styles[`label_${variant}`],
    (disabled || loading) && styles.labelDisabled,
    textStyle,
  ];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={containerStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.85}
        disabled={disabled || loading}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' || variant === 'gold' ? colors.bg : colors.text}
          />
        ) : (
          <>
            {leftIcon}
            <Text style={labelStyle}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: radius.full,
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.45 },

  // ── Sizes ──
  size_sm: { height: 36, paddingHorizontal: spacing[4] },
  size_md: { height: 46, paddingHorizontal: spacing[6] },
  size_lg: { height: 54, paddingHorizontal: spacing[8] },

  // ── Variants ──
  variant_primary: {
    backgroundColor: colors.white,
  },
  variant_secondary: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  variant_ghost: {
    backgroundColor: 'transparent',
  },
  variant_destructive: {
    backgroundColor: colors.destructiveBg,
    borderWidth: 1,
    borderColor: colors.destructiveBorder,
  },
  variant_gold: {
    backgroundColor: colors.accent,
  },

  // ── Labels ──
  label: {
    fontWeight: typography.semibold,
    letterSpacing: typography.tight_ls,
  },
  label_sm: { fontSize: typography.sm },
  label_md: { fontSize: typography.base },
  label_lg: { fontSize: typography.md },

  label_primary:     { color: colors.bg },
  label_secondary:   { color: colors.text },
  label_ghost:       { color: colors.text },
  label_destructive: { color: colors.error },
  label_gold:        { color: colors.bg },
  labelDisabled:     { color: colors.textMuted },
});
