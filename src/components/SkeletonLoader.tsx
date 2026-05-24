import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { colors } from '../theme/colors';

/* ── Shimmer primitive ─────────────────────────────────────────────────── */

const SCREEN_W = Dimensions.get('window').width;

function SkeletonBox({
  width,
  height,
  borderRadius,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0.08)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.18,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.08,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: borderRadius ?? height / 2,
          backgroundColor: colors.surface,
        },
        { opacity },
        style,
      ]}
    />
  );
}

function SkeletonCircle({ size, style }: { size: number; style?: any }) {
  return <SkeletonBox width={size} height={size} borderRadius={size / 2} style={style} />;
}

function SkeletonLine({ width, style }: { width: number | string; style?: any }) {
  return <SkeletonBox width={width} height={12} borderRadius={6} style={style} />;
}

/* ── FeedSkeleton ──────────────────────────────────────────────────────── */

function FeedItemSkeleton() {
  return (
    <View style={s.feedItem}>
      <View style={s.feedContentRow}>
        <SkeletonCircle size={40} />
        <View style={s.feedTextBlock}>
          {/* Name + timestamp */}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <SkeletonLine width={100} />
            <SkeletonLine width={50} />
          </View>
          {/* Caption lines */}
          <SkeletonLine width="92%" style={{ marginTop: 8 }} />
          <SkeletonLine width="72%" style={{ marginTop: 6 }} />
          <SkeletonLine width="38%" style={{ marginTop: 6 }} />
          {/* Image placeholder */}
          <SkeletonBox
            width="100%"
            height={SCREEN_W * 0.52}
            borderRadius={16}
            style={{ marginTop: 12 }}
          />
          {/* Action row dots */}
          <View style={s.actionRow}>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonCircle key={i} size={30} />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <FeedItemSkeleton key={i} />
      ))}
    </View>
  );
}

/* ── ProfileSkeleton ───────────────────────────────────────────────────── */

export function ProfileSkeleton() {
  return (
    <View style={s.profileContainer}>
      {/* Cover placeholder */}
      <SkeletonBox width="100%" height={120} borderRadius={0} />

      {/* Avatar + actions row */}
      <View style={s.profileHeaderRow}>
        <SkeletonCircle size={80} style={{ marginTop: -32, borderWidth: 4, borderColor: colors.bg }} />
        <View style={{ flex: 1, gap: 8, justifyContent: 'flex-end' }}>
          <SkeletonBox width={120} height={34} borderRadius={20} />
        </View>
      </View>

      {/* Name + handle */}
      <View style={s.profileInfo}>
        <SkeletonLine width={160} />
        <SkeletonLine width={110} style={{ marginTop: 6 }} />
        <SkeletonLine width="85%" style={{ marginTop: 10 }} />
        <SkeletonLine width="60%" style={{ marginTop: 6 }} />
      </View>

      {/* Stats row */}
      <View style={s.statsRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.statItem}>
            <SkeletonLine width={40} />
            <SkeletonLine width={60} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>

      {/* Tab bar */}
      <View style={s.profileTabBar}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.profileTab}>
            <SkeletonLine width={60} />
          </View>
        ))}
      </View>

      {/* Post grid */}
      <View style={s.postGrid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBox key={i} width="31%" height={SCREEN_W * 0.31} borderRadius={4} />
        ))}
      </View>
    </View>
  );
}

/* ── NotificationsSkeleton ──────────────────────────────────────────────── */

function NotificationRowSkeleton() {
  return (
    <View style={s.notifRow}>
      <SkeletonCircle size={36} />
      <View style={s.notifTextBlock}>
        <SkeletonLine width="80%" />
        <SkeletonLine width="55%" style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export function NotificationsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <NotificationRowSkeleton key={i} />
      ))}
    </View>
  );
}

/* ── GenericSkeleton ───────────────────────────────────────────────────── */

export function GenericSkeleton({
  lines = 3,
  showAvatar = true,
}: {
  lines?: number;
  showAvatar?: boolean;
}) {
  const lineWidths = [0.9, 0.7, 0.45, 0.82, 0.6, 0.35];

  return (
    <View style={s.genericRow}>
      {showAvatar && <SkeletonCircle size={40} />}
      <View style={[s.genericTextBlock, showAvatar && { flex: 1 }]}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={`${Math.round((lineWidths[i % lineWidths.length]) * 100)}%`}
            style={{ marginTop: i === 0 ? 0 : 8 }}
          />
        ))}
      </View>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  /* Feed */
  feedItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  feedContentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  feedTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 4,
  },

  /* Profile */
  profileContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  profileInfo: {
    paddingHorizontal: 16,
    marginTop: 14,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 24,
  },
  statItem: {
    alignItems: 'flex-start',
  },
  profileTabBar: {
    flexDirection: 'row',
    marginTop: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  profileTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  postGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 2,
    gap: 2,
  },

  /* Notifications */
  notifRow: {
    flexDirection: 'row',
    padding: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  notifTextBlock: {
    flex: 1,
    justifyContent: 'center',
  },

  /* Generic */
  genericRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  genericTextBlock: {
    justifyContent: 'center',
  },
});
