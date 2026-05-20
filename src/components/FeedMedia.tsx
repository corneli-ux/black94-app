import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');

interface FeedMediaProps {
  uri: string;
  onRefreshUrl?: (uri: string) => void;
}

/**
 * FeedMedia — Renders a single post image with aspect-ratio-aware height.
 *
 * How it works:
 * 1. Uses Image.getSize() to fetch actual image dimensions.
 * 2. Calculates display height so the image fits naturally within the
 *    content column width (SCREEN_W - 32px padding).
 * 3. Caps the height at 1.35× screen width for very tall vertical images,
 *    and sets a minimum of 180px for very wide images.
 * 4. Uses resizeMode="contain" so the full image is always visible
 *    without any cropping (dark background fills remaining space).
 * 5. Shows a dark placeholder while dimensions are loading.
 * 6. On load error, calls onRefreshUrl (for Firebase token refresh) then
 *    shows the error fallback. If the parent updates the uri prop, the
 *    component automatically retries.
 */
export default function FeedMedia({ uri, onRefreshUrl }: FeedMediaProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // Detect image dimensions when uri changes; reset error state so retry works
  useEffect(() => {
    if (!uri) return;
    setFailed(false);
    setDimensions(null);
    Image.getSize(
      uri,
      (w, h) => setDimensions({ width: w, height: h }),
      () => setFailed(true),
    );
  }, [uri]);

  if (!uri || failed) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <Ionicons name="image-outline" size={28} color="#71767b" />
      </View>
    );
  }

  // Calculate display height based on actual aspect ratio
  let displayHeight = 300; // sensible default while getSize is in-flight
  if (dimensions) {
    const aspect = dimensions.width / dimensions.height;
    const fullWidth = SCREEN_W - 32; // 16px horizontal padding on each side
    const naturalHeight = fullWidth / aspect;
    // Clamp: min 180px, max 1.35× screen width (for very tall vertical images)
    displayHeight = Math.min(Math.max(naturalHeight, 180), SCREEN_W * 1.35);
  }

  return (
    <View style={[styles.container, { height: displayHeight }]}>
      {/* Loading indicator while dimensions are being fetched */}
      {!dimensions && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ActivityIndicator size="small" color="#555" />
        </View>
      )}
      <Image
        source={{ uri }}
        style={[styles.image, { width: '100%', height: displayHeight }]}
        resizeMode="contain"
        onError={() => {
          // Mark as failed immediately; parent can reset by updating uri prop
          setFailed(true);
          // Let parent attempt a URL refresh (e.g. expired Firebase token)
          if (onRefreshUrl) onRefreshUrl(uri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#1a1a1a',
  },
  image: {
    backgroundColor: '#000000',
  },
  errorContainer: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
