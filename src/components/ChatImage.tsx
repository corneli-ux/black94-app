/**
 * ChatImage — aspect-ratio-aware image for chat bubbles.
 *
 * Like the feed's FeedMedia: reads the image's natural dimensions on load and
 * frames it with a sensible aspect ratio (clamped) instead of forcing every
 * image into a fixed square. Tall images are capped so they don't dominate the
 * conversation; wide images show in full.
 */
import React, { useState, useCallback } from 'react';
import { Image, TouchableOpacity, View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

const MAX_W = 240;
const MAX_H = 320;

export default function ChatImage({
  uri,
  onPress,
}: {
  uri: string;
  onPress?: () => void;
}) {
  const [ratio, setRatio] = useState(1); // w/h, default square until loaded
  const [failed, setFailed] = useState(false);

  const handleLoad = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.source || {};
    if (width && height) {
      // Clamp portrait to 0.7 (so very tall images aren't huge) and
      // landscape to 1.8 (so very wide images keep some height).
      setRatio(Math.min(Math.max(width / height, 0.7), 1.8));
    }
  }, []);

  if (failed || !uri) return null;

  // Compute display box: fill MAX_W, derive height, cap at MAX_H.
  let w = MAX_W;
  let h = w / ratio;
  if (h > MAX_H) {
    h = MAX_H;
    w = h * ratio;
  }

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} disabled={!onPress}>
      <View style={[styles.wrap, { width: w, height: h }]}>
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onLoad={handleLoad}
          onError={() => setFailed(true)}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    marginBottom: 2,
  },
});
