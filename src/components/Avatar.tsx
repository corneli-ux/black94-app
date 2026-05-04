import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Web-matched colors
const BRAND_BLUE = '#2a7fff';
const GOLD_START = '#f59e0b';
const GOLD_END = '#d97706';

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
 * VerifiedBadge — matches web app's design exactly.
 *
 * Web CSS (.badge-gold):
 *   background: linear-gradient(135deg, #f59e0b, #d97706)
 *   padding: 1px 6px
 *   border-radius: 4px
 *   font-size: 10px
 *   font-weight: 700
 *   color: #fff
 *   display: inline-flex (align-items: center, gap: 3px)
 *
 * Web CSS (.badge-blue):
 *   background: linear-gradient(135deg, #2a7fff, #1a5fcc)
 *   same sizing
 */
export function VerifiedBadge({ badge, isVerified }: { badge?: string; isVerified?: boolean }) {
  // Show badge if explicitly set, OR if isVerified is true
  const showGold = badge === 'gold' || (isVerified && badge !== 'blue');
  const showBlue = badge === 'blue';

  if (showGold) {
    return (
      <LinearGradient
        colors={[GOLD_START, GOLD_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.goldBadge}
      >
        <Text style={styles.goldBadgeIcon}>✓</Text>
      </LinearGradient>
    );
  }

  if (showBlue) {
    return (
      <LinearGradient
        colors={[BRAND_BLUE, '#1a5fcc']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.blueBadge}
      >
        <Text style={styles.blueBadgeIcon}>✓</Text>
      </LinearGradient>
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

  // Gold badge — matches web .badge-gold
  goldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
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

  // Blue badge — matches web .badge-blue
  blueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
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
