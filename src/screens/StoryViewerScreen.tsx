import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  PanResponder,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  cancelAnimation,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import { timeAgo } from '../utils/timeAgo';
import { AppIcon } from '../components/icons';
import { spring, DURATIONS, EASINGS } from '../constants/animations';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 5000;

interface StoryItem {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string;
  authorIsVerified: boolean;
  format: string;
  content: string;
  mediaUrl: string;
  pollOptions?: Array<{ id: string; text: string; votes: number; percentage: number }>;
  fontSize?: number;
  createdAt: number;
}

export default function StoryViewerScreen({ navigation, route }: any) {
  const { storyIds, startIndex = 0, storyGroupId } = route.params || {};

  const [stories, setStories] = useState<StoryItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedPollOption, setSelectedPollOption] = useState<string | null>(null);
  const votingRef = useRef(false);
  const [pollOptions, setPollOptions] = useState<StoryItem['pollOptions']>(undefined);
  const [userVote, setUserVote] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  const currentUser = auth()?.currentUser;

  // Reanimated-driven progress (0 → 1). We animate this directly with
  // withTiming on the UI thread for a buttery fill instead of the old
  // Animated.timing that ran on the JS thread.
  const progressSV = useSharedValue(0);
  // Pause scale — the whole story scales down slightly when held.
  const storyScale = useSharedValue(1);
  // Subtle pulse on the pause indicator.
  const pausePulse = useSharedValue(0);

  // Track the timestamp when the current story started playing so we can
  // compute remaining time when resuming from a pause.
  const startedAtRef = useRef<number>(0);
  const remainingRef = useRef<number>(STORY_DURATION);
  const animTokenRef = useRef(0); // bumps on every story switch to cancel old timers

  // Stable ref to the latest goNext callback. Worklet completion handlers
  // call this via runOnJS so they always invoke the freshest closure.
  const goNextRef = useRef<() => void>(() => {});

  /* ─────────────────────────────────────────────────────────────────────
   * Story loading
   * ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const loadStories = async () => {
      try {
        let snap = await firestore()
          .collection('stories')
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get();

        let allDocs = snap.docs;

        if (storyIds && storyIds.length > 0) {
          allDocs = allDocs.filter((d) => storyIds.includes(d.id));
          allDocs.sort((a, b) => storyIds.indexOf(a.id) - storyIds.indexOf(b.id));
        } else if (storyGroupId) {
          allDocs = allDocs.filter((d) => d.data().authorId === storyGroupId);
        }

        const items: StoryItem[] = allDocs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            authorId: data.authorId || '',
            authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '',
            authorProfileImage: data.authorProfileImage || '',
            authorIsVerified: data.authorIsVerified || false,
            format: data.format || data.type || 'text',
            content: data.content || data.text || '',
            mediaUrl: data.mediaUrl || '',
            pollOptions: data.pollOptions || undefined,
            fontSize: data.fontSize || undefined,
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
          };
        });

        setStories(items);
      } catch (e) {
        if (__DEV__) console.warn('[StoryViewerScreen] load error:', e);
      }
    };
    loadStories();
  }, [storyIds, storyGroupId]);

  /* ─────────────────────────────────────────────────────────────────────
   * Poll-vote check on story change
   * ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const currentStory = stories[currentIndex];
    if (currentStory && currentUser && currentStory.id) {
      setSelectedPollOption(null);
      setPollOptions(currentStory.pollOptions);

      const checkVote = async () => {
        try {
          const voteDoc = await firestore()
            .collection('stories')
            .doc(currentStory.id)
            .collection('votes')
            .doc(currentUser.uid)
            .get();
          if (voteDoc.exists) {
            const voteData = voteDoc.data();
            setUserVote(voteData.optionIndex ?? null);
            if (voteData.optionIndex != null) {
              const opts = currentStory.pollOptions;
              if (opts && opts.length > voteData.optionIndex) {
                setSelectedPollOption(opts[voteData.optionIndex].id);
              }
            }
          } else {
            setUserVote(null);
          }
        } catch {
          setUserVote(null);
        }
      };
      checkVote();
    }
  }, [currentIndex, stories, currentUser]);

  /* ─────────────────────────────────────────────────────────────────────
   * Progress bar animation — Reanimated 3, UI-thread smooth fill.
   * Pauses cleanly by stopping the animation and remembering the
   * remaining time, then resumes from that exact spot.
   * ───────────────────────────────────────────────────────────────────── */

  // Stable JS-side advance handler. runOnJS requires a stable function
  // reference — passing an inline arrow would capture a stale closure.
  const handleProgressComplete = useCallback(() => {
    goNextRef.current();
  }, []);

  useEffect(() => {
    if (stories.length === 0) return;
    const token = ++animTokenRef.current;

    // Reset for new story.
    progressSV.value = 0;
    remainingRef.current = STORY_DURATION;
    startedAtRef.current = Date.now();

    if (isPaused) return; // wait for unpause

    progressSV.value = withTiming(1, {
      duration: STORY_DURATION,
      easing: EASINGS.decel,
    }, (finished) => {
      if (finished && token === animTokenRef.current) {
        runOnJS(handleProgressComplete)();
      }
    });

    return () => {
      cancelAnimation(progressSV);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, stories.length]);

  // Pause / resume handling.
  useEffect(() => {
    if (isPaused) {
      // Snapshot current progress so we can resume from the same spot.
      const elapsed = Date.now() - startedAtRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      cancelAnimation(progressSV);
      // Pause feedback: scale down slightly + pulse the indicator.
      storyScale.value = withSpring(0.97, spring.gentle);
      pausePulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: DURATIONS.slow, easing: EASINGS.fade }),
          withTiming(0.6, { duration: DURATIONS.slow, easing: EASINGS.fade }),
        ),
        -1,
        true,
      );
    } else {
      // Resume: animate the remaining duration from current progress.
      const currentProgress = progressSV.value;
      const remainingDuration = Math.max(
        0,
        remainingRef.current * (1 - currentProgress),
      );
      const token = ++animTokenRef.current;
      startedAtRef.current = Date.now();
      progressSV.value = withTiming(1, {
        duration: remainingDuration || 1,
        easing: EASINGS.decel,
      }, (finished) => {
        if (finished && token === animTokenRef.current) {
          runOnJS(handleProgressComplete)();
        }
      });
      storyScale.value = withSpring(1, spring.gentle);
      pausePulse.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused]);

  /* ─────────────────────────────────────────────────────────────────────
   * PanResponder for swipe-to-dismiss (down) and story navigation (left/right)
   * ───────────────────────────────────────────────────────────────────── */
  const panResponderRef = useRef<any>(null);
  useEffect(() => {
    panResponderRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 || g.dy > 20,
      onPanResponderRelease: (_, g) => {
        if (g.dy > SCREEN_HEIGHT * 0.2 && Math.abs(g.dy) > Math.abs(g.dx)) {
          navigation.goBack();
        } else if (g.dx < -SCREEN_WIDTH * 0.2) {
          goNextRef.current();
        } else if (g.dx > SCREEN_WIDTH * 0.2) {
          goPrevRef.current();
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const goNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      progressSV.value = 0;
      setCurrentIndex((prev) => prev + 1);
    } else {
      navigation.goBack();
    }
  }, [currentIndex, stories.length, navigation, progressSV]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      progressSV.value = 0;
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex, progressSV]);

  // Keep the latest goNext/goPrev in a ref so the useEffect above picks them up.
  goNextRef.current = goNext;

  const handleTapLeft = useCallback(() => goPrev(), [goPrev]);
  const handleTapRight = useCallback(() => goNext(), [goNext]);

  const handleLongPressStart = useCallback(() => setIsPaused(true), []);
  const handleLongPressEnd = useCallback(() => setIsPaused(false), []);

  /* ─────────────────────────────────────────────────────────────────────
   * Reply to story — sends a chat message or creates a chat if needed.
   * Story replies go to the story author's DM thread.
   * ───────────────────────────────────────────────────────────────────── */
  const handleSendReply = useCallback(async () => {
    if (!currentUser || !replyText.trim() || replySending) return;
    const currentStory = stories[currentIndex];
    if (!currentStory) return;

    setReplySending(true);
    const text = replyText.trim();
    setReplyText('');

    try {
      // Find existing chat or create one.
      const myUid = currentUser.uid;
      const theirUid = currentStory.authorId;

      const snap1 = await firestore().collection('chats').where('user1Id', '==', myUid).get();
      let chatId = snap1.docs.find(d => d.data().user2Id === theirUid)?.id;
      if (!chatId) {
        const snap2 = await firestore().collection('chats').where('user2Id', '==', myUid).get();
        chatId = snap2.docs.find(d => d.data().user1Id === theirUid)?.id;
      }
      if (!chatId) {
        const ref = await firestore().collection('chats').add({
          user1Id: myUid,
          user2Id: theirUid,
          lastMessage: text,
          lastMessageTime: firestore.FieldValue.serverTimestamp(),
          unreadUser1: 0,
          unreadUser2: 1,
          createdAt: firestore.FieldValue.serverTimestamp(),
        });
        chatId = ref.id;
      } else {
        await firestore().collection('chats').doc(chatId).update({
          lastMessage: text,
          lastMessageTime: firestore.FieldValue.serverTimestamp(),
          unreadUser2: firestore.FieldValue.increment(1),
        });
      }

      await firestore().collection('chats').doc(chatId).collection('messages').add({
        text,
        senderId: myUid,
        createdAt: firestore.FieldValue.serverTimestamp(),
        type: 'text',
        storyReply: currentStory.id,
      });

      // Brief haptic-like scale punch on the input as confirmation.
      replyScale.value = withSequence(
        withSpring(0.96, spring.snappy),
        withSpring(1, spring.bouncy),
      );
    } catch (e) {
      if (__DEV__) console.warn('[StoryViewerScreen] reply failed:', e);
    } finally {
      setReplySending(false);
    }
  }, [currentUser, replyText, replySending, stories, currentIndex]);

  const replyScale = useSharedValue(1);

  /* ─────────────────────────────────────────────────────────────────────
   * Poll vote handler
   * ───────────────────────────────────────────────────────────────────── */
  const handlePollVote = useCallback((optionId: string) => {
    if (votingRef.current || selectedPollOption || !currentUser) return;
    votingRef.current = true;

    const currentStory = stories[currentIndex];
    if (!currentStory) { votingRef.current = false; return; }

    const optionIndex = currentStory.pollOptions?.findIndex(o => o.id === optionId) ?? -1;
    if (optionIndex < 0) { votingRef.current = false; return; }

    const doVote = async () => {
      try {
        await firestore()
          .collection('stories')
          .doc(currentStory.id)
          .collection('votes')
          .doc(currentUser.uid)
          .set({
            optionIndex,
            votedAt: firestore.FieldValue.serverTimestamp(),
          });

        const pollOpts = [...(currentStory.pollOptions || [])];
        if (pollOpts[optionIndex]) {
          pollOpts[optionIndex] = {
            ...pollOpts[optionIndex],
            votes: pollOpts[optionIndex].votes + 1,
          };
        }

        await firestore()
          .collection('stories')
          .doc(currentStory.id)
          .update({ pollOptions: pollOpts });

        setSelectedPollOption(optionId);
        setUserVote(optionIndex);
        setPollOptions(pollOpts);
      } catch (e) {
        if (__DEV__) console.warn('[StoryViewerScreen] Vote failed:', e);
      } finally {
        votingRef.current = false;
      }
    };

    doVote();
  }, [selectedPollOption, currentUser, currentIndex, stories]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  /* ─────────────────────────────────────────────────────────────────────
   * Render
   * ───────────────────────────────────────────────────────────────────── */
  const currentStory = stories[currentIndex];

  if (!currentStory) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const isTextStory = currentStory.format === 'text';
  const isPollStory = currentStory.format === 'poll' && currentStory.pollOptions;
  const isImageStory = !isTextStory && !isPollStory && currentStory.mediaUrl;
  const totalVotes = pollOptions?.reduce((sum, o) => sum + o.votes, 0) ?? 0;

  // Animated styles
  const storyAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: storyScale.value }],
  }));

  const pauseIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pausePulse.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pausePulse.value, [0, 1], [0.9, 1.05], Extrapolation.CLAMP) }],
  }));

  // Build progress bars: each completed bar = 1, current = progressSV, future = 0.
  const renderProgressBar = (_: any, i: number) => {
    const isPast = i < currentIndex;
    const isCurrent = i === currentIndex;
    return (
      <View key={i} style={styles.progressTrack}>
        <ProgressFill
          isPast={isPast}
          isCurrent={isCurrent}
          progress={progressSV}
        />
      </View>
    );
  };

  return (
    <View style={styles.container} {...(panResponderRef.current?.panHandlers ?? {})}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Background wrapped in a scale-animated view for the long-press pause effect */}
      <Animated.View style={[StyleSheet.absoluteFillObject, storyAnimatedStyle]}>
        {isTextStory ? (
          <View style={[styles.gradientBg, { backgroundColor: getGradientColor(currentStory.mediaUrl) }]}>
            {currentStory.content ? (
              <Text style={[styles.textStoryContent, currentStory.fontSize ? { fontSize: currentStory.fontSize } : undefined]}>
                {currentStory.content}
              </Text>
            ) : null}
          </View>
        ) : isImageStory ? (
          <Image
            source={{ uri: currentStory.mediaUrl }}
            style={styles.imageBg}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.gradientBg, { backgroundColor: colors.bg }]} />
        )}
      </Animated.View>

      {/* Dark overlay for readability of UI on top of images */}
      {!isTextStory && <View style={styles.darkOverlay} />}

      {/* Progress Bars */}
      <View style={styles.progressContainer}>
        {stories.map((_, i) => renderProgressBar(_, i))}
      </View>

      {/* Author Bar */}
      <View style={styles.authorBar}>
        <View style={styles.authorInfo}>
          {currentStory.authorProfileImage ? (
            <Image source={{ uri: currentStory.authorProfileImage }} style={styles.authorAvatar} />
          ) : (
            <View style={[styles.authorAvatar, styles.authorAvatarFallback]}>
              <Text style={styles.authorAvatarFallbackText}>
                {(currentStory.authorDisplayName || currentStory.authorUsername || 'A').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.authorTextContainer}>
            <View style={styles.authorNameRow}>
              <Text style={styles.authorName}>{currentStory.authorDisplayName}</Text>
              {currentStory.authorIsVerified && (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedText}>✓</Text>
                </View>
              )}
            </View>
            <Text style={styles.authorUsername}>@{currentStory.authorUsername}</Text>
          </View>
        </View>
        <View style={styles.authorMeta}>
          <Text style={styles.storyTime}>{timeAgo(currentStory.createdAt)}</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.7}>
            <AppIcon name="close" size="lg" color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content / Tap Zones (with long-press to pause) */}
      {!isTextStory && !isPollStory && (
        <View style={styles.tapZoneContainer}>
          <TouchableOpacity
            style={styles.tapZone}
            onPress={handleTapLeft}
            activeOpacity={1}
            delayLongPress={200}
            onLongPress={handleLongPressStart}
            onPressOut={handleLongPressEnd}
          />
          <TouchableOpacity
            style={styles.tapZone}
            onPress={handleTapRight}
            activeOpacity={1}
            delayLongPress={200}
            onLongPress={handleLongPressStart}
            onPressOut={handleLongPressEnd}
          />
        </View>
      )}

      {/* Poll Story Content */}
      {isPollStory && pollOptions && (
        <View style={styles.pollContainer}>
          <Text style={styles.pollQuestion}>{currentStory.content}</Text>
          {pollOptions.map((option) => {
            const isSelected = selectedPollOption === option.id;
            const votePercent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
            const hasVoted = !!selectedPollOption;

            return (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.pollOption,
                  isSelected && styles.pollOptionSelected,
                  hasVoted && styles.pollOptionVoted,
                ]}
                onPress={() => handlePollVote(option.id)}
                activeOpacity={0.8}
                disabled={hasVoted}
              >
                {hasVoted && (
                  <View style={[styles.pollOptionFill, { width: `${votePercent}%` }]} />
                )}
                <View style={styles.pollOptionContent}>
                  <Text style={[styles.pollOptionText, hasVoted && isSelected && styles.pollOptionTextSelected]}>
                    {option.text}
                  </Text>
                  {hasVoted && <Text style={styles.pollVotePercent}>{votePercent}%</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.pollVoteCount}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</Text>
        </View>
      )}

      {/* Reply bar — only on non-text stories. Story replies go to the
          author's DM thread (see handleSendReply). */}
      {!isTextStory && !isPollStory && currentUser?.uid !== currentStory.authorId && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.replyContainerWrap}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.replyContainer, { transform: [{ scale: replyScale }] }]}>
            <TextInput
              style={styles.replyInput}
              placeholder={`Reply to ${currentStory.authorDisplayName || currentStory.authorUsername || 'story'}…`}
              placeholderTextColor={colors.textMuted}
              value={replyText}
              onChangeText={setReplyText}
              onFocus={() => setIsPaused(true)}
              onBlur={() => setIsPaused(false)}
              returnKeyType="send"
              onSubmitEditing={handleSendReply}
            />
            <TouchableOpacity
              style={[styles.replySendBtn, !replyText.trim() && styles.replySendBtnDisabled]}
              onPress={handleSendReply}
              disabled={!replyText.trim() || replySending}
            >
              <AppIcon name="send" size="sm" color={replyText.trim() ? colors.text : colors.textMuted} />
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      )}

      {/* Pause indicator (animated) */}
      <Animated.View style={[styles.pauseIndicator, pauseIndicatorStyle]} pointerEvents="none">
        <View style={styles.pauseChip}>
          <Text style={styles.pauseText}>Paused</Text>
        </View>
      </Animated.View>
    </View>
  );
}

/* ── ProgressFill — animated via the shared progressSV value ──────────── */
function ProgressFill({
  isPast, isCurrent, progress,
}: { isPast: boolean; isCurrent: boolean; progress: SharedValue<number>; }) {
  const style = useAnimatedStyle(() => {
    let pct: number;
    if (isPast) pct = 1;
    else if (isCurrent) pct = progress.value;
    else pct = 0;
    return {
      width: `${pct * 100}%`,
    };
  });
  return <Animated.View style={[styles.progressFill, style]} />;
}

function getGradientColor(mediaUrl: string): string {
  if (!mediaUrl || mediaUrl.startsWith('http')) {
    return '#667eea';
  }
  const map: Record<string, string> = {
    sunset: '#f093fb',
    ocean: '#4facfe',
    forest: '#43e97b',
    fire: '#fa709a',
    night: '#a18cd1',
    purple: '#667eea',
    blue: '#2193b0',
    dark: colors.bg,
  };
  return map[mediaUrl] ?? '#667eea';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  gradientBg: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageBg: {
    ...StyleSheet.absoluteFillObject,
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayLight,
  },
  textStoryContent: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 42,
  },
  progressContainer: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 3,
    zIndex: 20,
  },
  progressTrack: {
    flex: 1,
    height: 2.5,
    backgroundColor: colors.accentBorder,
    borderRadius: 1.25,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.white,
    borderRadius: 1.25,
  },
  authorBar: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.surfaceLight,
  },
  authorAvatarFallback: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authorAvatarFallbackText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  authorTextContainer: {
    gap: 1,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.verified,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedText: {
    fontSize: 9,
    color: colors.white,
    fontWeight: '700',
  },
  authorUsername: {
    fontSize: 11,
    color: colors.text,
  },
  authorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storyTime: {
    fontSize: 12,
    color: colors.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapZoneContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 10,
  },
  tapZone: {
    flex: 1,
  },
  pollContainer: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    zIndex: 15,
  },
  pollQuestion: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.white,
    textAlign: 'center',
    marginBottom: 16,
  },
  pollOption: {
    backgroundColor: colors.accentBg,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  pollOptionSelected: {
    borderColor: colors.accent,
  },
  pollOptionVoted: {
    borderColor: colors.accentBorder,
  },
  pollOptionFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: colors.accentBorder,
  },
  pollOptionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pollOptionText: {
    fontSize: 15,
    color: colors.white,
    fontWeight: '500',
  },
  pollOptionTextSelected: {
    fontWeight: '700',
  },
  pollVotePercent: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  pollVoteCount: {
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
    marginTop: 8,
  },
  replyContainerWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 18,
  },
  replyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.borderSubtleAlt,
    gap: 8,
  },
  replyInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 80,
  },
  replySendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replySendBtnDisabled: {
    backgroundColor: colors.surfaceLight,
  },
  pauseIndicator: {
    position: 'absolute',
    top: '45%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 25,
  },
  pauseChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtleAlt,
  },
  pauseText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
});
