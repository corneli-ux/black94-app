/**
 * Black94 — Divider primitive
 * Horizontal rule with optional label.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { typography, spacing } from '../../theme/tokens';

interface DividerProps {
  label?: string;
  style?: ViewStyle;
  subtle?: boolean;
}

export default function Divider({ label, style, subtle = false }: DividerProps) {
  const lineColor = subtle ? colors.separator : colors.border;

  if (label) {
    return (
      <View style={[styles.row, style]}>
        <View style={[styles.line, { backgroundColor: lineColor }]} />
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.line, { backgroundColor: lineColor }]} />
      </View>
    );
  }

  return <View style={[styles.solo, { backgroundColor: lineColor }, style]} />;
}

const styles = StyleSheet.create({
  solo: { height: 1, width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  line: { flex: 1, height: 1 },
  label: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    fontWeight: typography.medium,
  },
});
