import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

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
    ? { borderWidth, borderColor: borderColor || '#000000' }
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

/**
 * VerifiedBadge — matches web app's badge design.
 *
 * Web CSS (.badge-gold):
 *   background: linear-gradient(135deg, #f59e0b, #d97706)
 *   padding: 1px 6px, border-radius: 4px
 *   font-size: 10px, font-weight: 700, color: #fff
 *
 * Web CSS (.badge-blue):
 *   background: linear-gradient(135deg, #2a7fff, #1a5fcc)
 *   same sizing
 *
 * We use the gradient start color (which is the dominant visible color
 * on small pill shapes) as the background. No external dependency needed.
 */
export function VerifiedBadge({ badge, isVerified }: { badge?: string; isVerified?: boolean }) {
  const showGold = badge === 'gold' || (isVerified && badge !== 'blue');
  const showBlue = badge === 'blue';

  if (showGold) {
    return (
      <View style={styles.goldBadge}>
        <Text style={styles.goldBadgeIcon}>✓</Text>
      </View>
    );
  }

  if (showBlue) {
    return (
      <View style={styles.blueBadge}>
        <Text style={styles.blueBadgeIcon}>✓</Text>
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

  // Gold badge — web: .badge-gold gradient 135deg #f59e0b -> #d97706
  goldBadge: {
    backgroundColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  goldBadgeIcon: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },

  // Blue badge — web: .badge-blue gradient 135deg #2a7fff -> #1a5fcc
  blueBadge: {
    backgroundColor: '#2a7fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  blueBadgeIcon: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
