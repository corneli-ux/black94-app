/**
 * PostIcons — Custom SVG-path icons for post actions.
 * Thin stroke, modern, consistent with the Black94 aesthetic.
 * Uses React Native's built-in View/StyleSheet to draw shapes
 * without any external SVG dependency.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

interface IconProps {
  size?: number;
  color?: string;
  filled?: boolean;
}

/**
 * CommentIcon — thin speech bubble. Replaces ugly chat-bubble-outline.
 */
export function CommentIcon({ size = 20, color = '#71767b', filled = false }: IconProps) {
  const s = size;
  const sw = s * 0.075; // stroke width proportional to size

  if (filled) {
    return (
      <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
        {/* Filled circle bubble */}
        <View style={{
          width: s * 0.85,
          height: s * 0.75,
          borderRadius: s * 0.2,
          backgroundColor: color,
          position: 'absolute',
          top: 0,
        }} />
        {/* Tail */}
        <View style={{
          position: 'absolute',
          bottom: 0,
          left: s * 0.15,
          width: 0,
          height: 0,
          borderLeftWidth: s * 0.12,
          borderRightWidth: s * 0.04,
          borderTopWidth: s * 0.22,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }} />
      </View>
    );
  }

  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* Rounded rect outline */}
      <View style={{
        width: s * 0.85,
        height: s * 0.72,
        borderRadius: s * 0.18,
        borderWidth: sw + 0.5,
        borderColor: color,
        position: 'absolute',
        top: s * 0.02,
      }} />
      {/* Tail triangle */}
      <View style={{
        position: 'absolute',
        bottom: s * 0.02,
        left: s * 0.12,
        width: s * 0.18,
        height: s * 0.22,
        borderLeftWidth: sw,
        borderRightWidth: sw,
        borderTopWidth: s * 0.2,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: color,
      }} />
      {/* Cover the border gap at tail junction */}
      <View style={{
        position: 'absolute',
        bottom: s * 0.19,
        left: s * 0.115,
        width: s * 0.185,
        height: sw + 1,
        backgroundColor: '#000',
      }} />
    </View>
  );
}

/**
 * BookmarkIcon — thin bookmark shape.
 */
export function BookmarkIcon({ size = 20, color = '#71767b', filled = false }: IconProps) {
  const s = size;
  const sw = s * 0.08;

  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {filled ? (
        // Filled ribbon
        <View style={{
          width: s * 0.6,
          height: s * 0.88,
          backgroundColor: color,
          borderTopLeftRadius: s * 0.1,
          borderTopRightRadius: s * 0.1,
          // Create the V notch at bottom via overflow clipping is complex in RN
          // Use a border trick instead
        }}>
          {/* Bottom V notch */}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: s * 0.22,
            backgroundColor: '#000',
            // Clip to make a V shape using border radius
          }}>
            <View style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '50%',
              height: s * 0.22,
              backgroundColor: color,
              borderBottomRightRadius: s * 0.22,
            }} />
            <View style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '50%',
              height: s * 0.22,
              backgroundColor: color,
              borderBottomLeftRadius: s * 0.22,
            }} />
          </View>
        </View>
      ) : (
        <View style={{
          width: s * 0.6,
          height: s * 0.88,
          borderWidth: sw,
          borderColor: color,
          borderTopLeftRadius: s * 0.1,
          borderTopRightRadius: s * 0.1,
          borderBottomColor: 'transparent',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Left bottom diagonal */}
          <View style={{
            position: 'absolute',
            bottom: -(sw / 2),
            left: -(sw / 2),
            width: '55%',
            height: s * 0.28,
            backgroundColor: '#000',
            borderTopRightRadius: s * 0.2,
            borderRightWidth: sw,
            borderRightColor: color,
            transform: [{ skewY: '-40deg' }],
          }} />
          {/* Right bottom diagonal */}
          <View style={{
            position: 'absolute',
            bottom: -(sw / 2),
            right: -(sw / 2),
            width: '55%',
            height: s * 0.28,
            backgroundColor: '#000',
            borderTopLeftRadius: s * 0.2,
            borderLeftWidth: sw,
            borderLeftColor: color,
            transform: [{ skewY: '40deg' }],
          }} />
        </View>
      )}
    </View>
  );
}
