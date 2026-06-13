/**
 * Black94 — Card primitive
 * Provides consistent surface elevation, border, and optional press state.
 */
import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { radius, shadow } from '../../theme/tokens';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  elevated?: boolean;
  noBorder?: boolean;
  noPadding?: boolean;
}

export default function Card({
  children,
  onPress,
  style,
  elevated = false,
  noBorder = false,
  noPadding = false,
}: CardProps) {
  const containerStyle = [
    styles.card,
    elevated && styles.elevated,
    noBorder && styles.noBorder,
    noPadding && styles.noPadding,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={onPress}
        activeOpacity={0.75}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...(shadow.sm as object),
  },
  elevated: {
    backgroundColor: colors.surfaceElevated,
    ...(shadow.md as object),
  },
  noBorder: {
    borderWidth: 0,
  },
  noPadding: {
    padding: 0,
  },
});
