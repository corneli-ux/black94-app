/**
 * PullToRefresh — custom spring-driven pull-to-refresh indicator.
 *
 * Drop into a FlatList/ScrollView as a ListHeaderComponent (or
 * absolutely position above the list). The indicator stays hidden
 * until the user actually pulls, then scales+fades in with a spring,
 * and spins while refreshing.
 *
 * Pass the pullProgress as a Reanimated shared value (0–1) so the
 * indicator updates on the UI thread without re-rendering React.
 *
 * The actual refresh trigger is wired via the parent's RefreshControl
 * (set its tintColor='transparent' so the default indicator is
 * invisible and only this custom one shows).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  cancelAnimation,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spring } from '../constants/animations';

export interface PullToRefreshProps {
  /** Are we currently refreshing? Drives the spinner spin. */
  refreshing: boolean;
  /** Shared value 0–1 — how far the user has pulled. Drives icon scale + opacity. */
  pullProgress: SharedValue<number>;
  /** Icon color. Defaults to brand accent. */
  color?: string;
  /** Size of the indicator icon. */
  size?: number;
}

export function PullToRefresh({
  refreshing, pullProgress, color = colors.accent, size = 22,
}: PullToRefreshProps) {
  const rotate = useSharedValue(0);

  // Spin forever while refreshing; stop and reset when not.
  React.useEffect(() => {
    if (refreshing) {
      rotate.value = withRepeat(
        withTiming(360, { duration: 900 }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotate);
      rotate.value = withSpring(0, spring.snappy);
    }
  }, [refreshing, rotate]);

  const style = useAnimatedStyle(() => {
    // Icon fades in once the user has pulled ~20% of the trigger distance.
    const opacity = interpolate(pullProgress.value, [0, 0.2, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    // Scale from 0.6 → 1.05 → 1.0 as the pull completes.
    const scale = interpolate(pullProgress.value, [0, 0.8, 1], [0.6, 1.05, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [
        { scale: withSpring(scale, spring.snappy) },
        { rotate: `${rotate.value}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.container, style]} pointerEvents="none">
      <Feather
        name={refreshing ? 'loader' : 'arrow-down'}
        size={size}
        color={color}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PullToRefresh;
