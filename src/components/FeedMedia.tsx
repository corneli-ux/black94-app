import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Image, StyleSheet, ActivityIndicator, Dimensions,
  TouchableOpacity, Modal, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface FeedMediaProps {
  uri: string;
  onRefreshUrl?: (uri: string) => void;
}

/**
 * FeedMedia — Renders a single post image with aspect-ratio-aware height.
 *
 * How it works:
 * 1. Uses Image.getSize() to fetch actual image dimensions.
 * 2. Calculates display height so the image fills the container.
 * 3. Caps the height at 1.2× screen width for very tall vertical images,
 *    and sets a minimum of 200px for very wide images.
 * 4. Uses resizeMode="cover" so the image fills the entire container
 *    without gaps (edges may be slightly cropped for extreme ratios).
 * 5. Tapping the image opens a fullscreen viewer showing the complete image.
 * 6. Shows a dark placeholder while dimensions are loading.
 * 7. On load error, calls onRefreshUrl (for Firebase token refresh) then
 *    shows the error fallback.
 */

/** Global dimension cache to avoid re-fetching for the same URL */
const _dimCache = new Map<string, { width: number; height: number }>();
const MAX_CACHE = 200;

export default function FeedMedia({ uri, onRefreshUrl }: FeedMediaProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Detect image dimensions when uri changes; reset error state so retry works
  useEffect(() => {
    if (!uri) return;
    setFailed(false);

    // Check cache first
    const cached = _dimCache.get(uri);
    if (cached) {
      setDimensions(cached);
      return;
    }

    setDimensions(null);
    Image.getSize(
      uri,
      (w, h) => {
        const dims = { width: w, height: h };
        setDimensions(dims);
        // Cache for future renders
        if (_dimCache.size >= MAX_CACHE) {
          const firstKey = _dimCache.keys().next().value;
          if (firstKey) _dimCache.delete(firstKey);
        }
        _dimCache.set(uri, dims);
      },
      () => setFailed(true),
    );
  }, [uri]);

  const openFullscreen = useCallback(() => {
    if (uri && !failed) setFullscreen(true);
  }, [uri, failed]);

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
    // Clamp: min 200px, max 1.2× screen width (for very tall vertical images)
    displayHeight = Math.min(Math.max(naturalHeight, 200), SCREEN_W * 1.2);
  }

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={openFullscreen}
        style={[styles.container, { height: displayHeight }]}
      >
        {/* Loading indicator while dimensions are being fetched */}
        {!dimensions && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <ActivityIndicator size="small" color="#555" />
          </View>
        )}
        <Image
          source={{ uri }}
          style={[styles.image, { width: '100%', height: displayHeight }]}
          resizeMode="cover"
          onError={() => {
            setFailed(true);
            if (onRefreshUrl) onRefreshUrl(uri);
          }}
        />
      </TouchableOpacity>

      {/* Fullscreen Image Viewer Modal */}
      <Modal
        visible={fullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(false)}
      >
        <SafeAreaView style={styles.fullscreenBg}>
          <TouchableOpacity
            style={styles.fullscreenClose}
            onPress={() => setFullscreen(false)}
          >
            <Ionicons name="close" size={28} color="#ffffff" />
          </TouchableOpacity>
          <Image
            source={{ uri }}
            style={styles.fullscreenImage}
            resizeMode="contain"
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#111111',
  },
  image: {
    backgroundColor: '#000000',
  },
  errorContainer: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenBg: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: SCREEN_W,
    height: SCREEN_H - 60,
  },
});
