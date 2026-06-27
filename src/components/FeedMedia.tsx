/**
 * FeedMedia — Post image renderer.
 *
 * Key design: render immediately with a default aspect ratio (4:3).
 * onLoad updates to the real ratio. No Image.getSize() call — that was
 * blocking render and silently failing on expired Firebase URLs.
 *
 * For expired URLs: onError fires → calls onRefreshUrl → parent supplies
 * a fresh URL → uri prop changes → image retries automatically.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Image, StyleSheet, Dimensions,
  TouchableOpacity, Modal, SafeAreaView, Text,
} from 'react-native';
import { colors } from '../theme/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_W - 32; // 16px padding each side

export default function FeedMedia({ uri, onRefreshUrl }: {
  uri: string;
  onRefreshUrl?: (uri: string) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(1.5); // default 3:2 landscape
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const retried = useRef(false);

  const handleLoad = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.source;
    if (width && height) {
      const ratio = width / height;
      // Clamp: min 0.5 (portrait), max 2 (very wide)
      setAspectRatio(Math.min(Math.max(ratio, 0.5), 2));
    }
    setLoaded(true);
    setFailed(false);
  }, []);

  const handleError = useCallback(() => {
    if (!retried.current && onRefreshUrl) {
      retried.current = true;
      onRefreshUrl(uri);
    } else {
      setFailed(true);
    }
  }, [uri, onRefreshUrl]);

  if (!uri) return null;

  const displayHeight = CARD_WIDTH / aspectRatio;

  if (failed) {
    return (
      <View style={[styles.container, { height: Math.min(displayHeight, 260) }]}>
        <View style={styles.errorInner}>
          {/* Simple broken image indicator — no icon dependency */}
          <View style={styles.brokenIcon}>
            <View style={styles.brokenLine} />
            <View style={[styles.brokenLine, { transform: [{ rotate: '90deg' }] }]} />
          </View>
          <Text style={styles.errorText}>Image unavailable</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.97}
        onPress={() => setFullscreen(true)}
        style={[styles.container, { height: displayHeight }]}
      >
        {/* Skeleton while loading */}
        {!loaded && <View style={[StyleSheet.absoluteFill, styles.skeleton]} />}

        <Image
          source={{ uri }}
          style={[styles.image, { opacity: loaded ? 1 : 0 }]}
          resizeMode="cover"
          onLoad={handleLoad}
          onError={handleError}
        />
      </TouchableOpacity>

      <Modal visible={fullscreen} transparent animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <SafeAreaView style={styles.fullscreenBg}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setFullscreen(false)}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Image
            source={{ uri }}
            style={{ width: SCREEN_W, height: SCREEN_H - 80 }}
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
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  skeleton: {
    backgroundColor: '#111',
  },
  errorInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  brokenIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brokenLine: {
    position: 'absolute',
    width: 24,
    height: 1.5,
    backgroundColor: colors.textMuted,
    borderRadius: 1,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  fullscreenBg: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
