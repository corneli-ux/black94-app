/**
 * AnimatedPressableScale — a TouchableOpacity replacement that scales
 * down slightly on press using spring physics. Use for any tappable
 * that should feel premium (buttons, FABs, list items).
 *
 * Props:
 *   - scale (default 0.94): how much to shrink on press
 *   - springConfig (default spring.snappy): physics to use
 *   - ...all TouchableOpacity props
 *
 * Usage:
 *   <AnimatedPressableScale onPress={...} style={...}>
 *     <Text>Tap me</Text>
 *   </AnimatedPressableScale>
 */

import React, { useRef } from 'react';
import { TouchableOpacity, TouchableOpacityProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { spring, DURATIONS } from '../constants/animations';
import type { WithSpringConfig } from 'react-native-reanimated';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export interface AnimatedPressableScaleProps extends TouchableOpacityProps {
  scale?: number;
  springConfig?: WithSpringConfig;
  /** If true, animate a slight opacity dip on press as well. */
  dimOnPress?: boolean;
  children?: React.ReactNode;
}

export function AnimatedPressableScale({
  scale = 0.94,
  springConfig = spring.snappy,
  dimOnPress = false,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: AnimatedPressableScaleProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    const s = withSpring(pressed.value ? scale : 1, springConfig);
    const opacity = dimOnPress
      ? withTiming(pressed.value ? 0.7 : 1, { duration: DURATIONS.quick })
      : 1;
    return {
      transform: [{ scale: interpolate(s, [scale, 1], [scale, 1]) }],
      opacity,
    };
  });

  return (
    <AnimatedTouchable
      onPressIn={(e) => {
        pressed.value = 1;
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = 0;
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}

export default AnimatedPressableScale;
