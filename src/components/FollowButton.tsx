/**
 * FollowButton — animated follow / following toggle.
 *
 * Spring-driven scale punch on tap + smooth color transition between
 * the gold "Follow" pill and the outlined "Following" pill. Designed
 * to drop into ProfileScreen, UserProfileScreen, FollowersScreen, etc.
 *
 * Props:
 *   - following: current state
 *   - onPress: handler (parent does the actual API call)
 *   - loading: show ActivityIndicator instead of label
 *   - style: optional outer style override
 */

import React, { useCallback } from 'react';
import { Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { spring, DURATIONS } from '../constants/animations';
import { AnimatedPressableScale } from './AnimatedPressableScale';

export interface FollowButtonProps {
  following: boolean;
  onPress: () => void;
  loading?: boolean;
  style?: any;
  /** Optional label overrides. */
  followLabel?: string;
  followingLabel?: string;
}

export function FollowButton({
  following,
  onPress,
  loading = false,
  style,
  followLabel = 'Follow',
  followingLabel = 'Following',
}: FollowButtonProps) {
  const punch = useSharedValue(1);
  // 0 = follow state, 1 = following state. interpolateColor handles the
  // background/border cross-fade.
  const state = useSharedValue(following ? 1 : 0);

  // Keep the shared value in sync if the parent's prop changes (eg. after
  // a server roundtrip confirms the new state).
  React.useEffect(() => {
    state.value = withSpring(following ? 1 : 0, spring.gentle);
  }, [following, state]);

  const handlePress = useCallback(() => {
    // Scale punch + tiny over-shoot for playfulness.
    punch.value = withSequence(
      withSpring(0.92, spring.snappy),
      withSpring(1.05, spring.bouncy),
      withSpring(1, spring.snappy),
    );
    onPress();
  }, [onPress, punch]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      state.value,
      [0, 1],
      [colors.accent, 'transparent'],
    ),
    borderWidth: withTiming(1.5, { duration: DURATIONS.fast }),
    borderColor: interpolateColor(
      state.value,
      [0, 1],
      [colors.accent, 'rgba(255,255,255,0.25)'],
    ),
    transform: [{ scale: punch.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      state.value,
      [0, 1],
      [colors.bg, colors.text],
    ),
  }));

  return (
    <AnimatedPressableScale
      scale={1}  // we do our own punch via `punch` shared value
      springConfig={spring.snappy}
      onPress={handlePress}
      disabled={loading}
      style={[styles.btn, containerStyle, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={following ? colors.text : colors.bg} />
      ) : (
        <Animated.Text style={[styles.label, labelStyle]}>
          {following ? followingLabel : followLabel}
        </Animated.Text>
      )}
    </AnimatedPressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 24,
    paddingHorizontal: 26,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  label: {
    fontWeight: '800',
    fontSize: 13.5,
    letterSpacing: 0.2,
  },
});

export default FollowButton;
