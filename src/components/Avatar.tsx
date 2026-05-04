import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export function Avatar({
  uri,
  size = 44,
  borderWidth = 0,
  borderColor,
}: {
  uri?: string | null;
  size?: number;
  borderWidth?: number;
  borderColor?: string;
}) {
  const border = borderWidth > 0
    ? { borderWidth, borderColor: borderColor || colors.bg }
    : {};

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          styles.image,
          { width: size, height: size, borderRadius: size / 2 },
          border,
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius: size / 2 },
        border,
      ]}
    >
      <Text style={[styles.placeholderText, { fontSize: size * 0.38 }]}>?</Text>
    </View>
  );
}

export function VerifiedBadge({ badge }: { badge?: string }) {
  if (badge === 'gold') {
    return (
      <View style={[styles.badge, { backgroundColor: colors.verifiedGold }]}>
        <Text style={[styles.badgeText, { color: '#000' }]}>✓</Text>
      </View>
    );
  }
  if (badge === 'blue') {
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✓</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#222' },
  placeholder: {
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: '#fff', fontWeight: '700' },
  badge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.verified,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.verified, fontSize: 10, fontWeight: '900' },
});
