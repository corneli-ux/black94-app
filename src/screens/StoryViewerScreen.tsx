import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  StatusBar,
} from 'react-native';
import { firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import { timeAgo } from '../utils/timeAgo';

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
  const [pollOptions, setPollOptions] = useState<StoryItem['pollOptions']>(undefined);
  const [userVote, setUserVote] = useState<number | null>(null);

  const panResponderRef = useRef<any>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pausedProgressRef = useRef(0); // BUG FIX: Save progress value when pausing
  const currentUser = auth()?.currentUser;

  // Load stories
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
          allDocs.sort((a, b) => {
            const aIdx = storyIds.indexOf(a.id);
            const bIdx = storyIds.indexOf(b.id);
            return aIdx - bIdx;
          });
        } else if (storyGroupId) {
          allDocs = allDocs.filter((d) => {
            const data = d.data();
            return data.authorId === storyGroupId;
          });
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
        console.warn('[StoryViewerScreen] load error:', e);
      }
    };
    loadStories();
  }, [storyIds, storyGroupId]);

  // Check if user already voted when story changes
  useEffect(() => {
    const currentStory = stories[currentIndex];
    if (currentStory && currentUser && currentStory.id) {
      setSelectedPollOption(null);
      setPollOptions(currentStory.pollOptions);

      // Check if user already voted
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
            // Highlight the selected option
            if (voteData.optionIndex != null) {
              const opts = currentStory.pollOptions;
              if (opts && opts.length > voteData.optionIndex) {
                setSelectedPollOption(opts[voteData.optionIndex].id);
              }
            }
          } else {
            setUserVote(null);
          }
        } catch (e) {
          console.warn('[StoryViewerScreen] Failed to check vote:', e);
          setUserVote(null);
        }
      };
      checkVote();
    }
  }, [currentIndex, stories]);

  // Progress bar animation
  useEffect(() => {
    if (stories.length === 0) return;

    if (isPaused) {
      // BUG FIX: Save current progress before pausing so we resume from the same spot
      progressAnim.stopAnimation();
      progressAnim.addListener(({ value }) => { pausedProgressRef.current = value; });
      setTimeout(() => progressAnim.removeAllListeners(), 50);
      return;
    }

    // BUG FIX: Resume from saved progress on unpause, reset to 0 only for new stories
    const startValue = pausedProgressRef.current > 0.01 ? pausedProgressRef.current : 0;
    pausedProgressRef.current = 0;
    progressAnim.setValue(startValue);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION * (1 - startValue), // remaining time
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        goNext();
      }
    });

    return () => {
      progressAnim.stopAnimation();
    };
  }, [currentIndex, stories.length, isPaused, goNext]);

  // Pan responder for swipe dismiss
  useEffect(() => {
    panResponderRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 30 && Math.abs(gestureState.dx) < 50;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > SCREEN_HEIGHT * 0.25) {
          navigation.goBack();
        }
      },
    });
  }, [navigation]);

  const goNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      progressAnim.setValue(0);
      setCurrentIndex((prev) => prev + 1);
    } else {
      navigation.goBack();
    }
  }, [currentIndex, stories.length, navigation, progressAnim]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      progressAnim.setValue(0);
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex, progressAnim]);

  const handleTapLeft = useCallback(() => {
    goPrev();
  }, [goPrev]);

  const handleTapRight = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleLongPressStart = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    setIsPaused(false);
  }, []);

  const handlePollVote = useCallback((optionId: string) => {
    if (selectedPollOption || !currentUser) return;

    const currentStory = stories[currentIndex];
    if (!currentStory) return;

    // Find the option index
    const optionIndex = currentStory.pollOptions?.findIndex(o => o.id === optionId) ?? -1;
    if (optionIndex < 0) return;

    // Save vote to Firestore
    const doVote = async () => {
      try {
        // Save the vote
        await firestore()
          .collection('stories')
          .doc(currentStory.id)
          .collection('votes')
          .doc(currentUser.uid)
          .set({
            optionIndex,
            votedAt: firestore.FieldValue.serverTimestamp(),
          });

        // Increment vote count on the story doc
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
          .update({
            pollOptions: pollOpts,
          });

        // Update local state
        setSelectedPollOption(optionId);
        setUserVote(optionIndex);
        setPollOptions(pollOpts);
      } catch (e) {
        console.error('[StoryViewerScreen] Vote failed:', e);
      }
    };

    doVote();
  }, [selectedPollOption, currentUser, currentIndex, stories]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

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

  const progressBars = stories.map((_, i) => i);

  const totalVotes = pollOptions?.reduce((sum, o) => sum + o.votes, 0) ?? 0;

  return (
    <View style={styles.container} {...(panResponderRef.current?.panHandlers ?? {})}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Background */}
      {isTextStory ? (
        <View style={[styles.gradientBg, { backgroundColor: getGradientColor(currentStory.mediaUrl) }]}>
          {currentStory.content ? (
            <Text style={[styles.textStoryContent, currentStory.fontSize ? { fontSize: currentStory.fontSize } : undefined]}>{currentStory.content}</Text>
          ) : null}
        </View>
      ) : isImageStory ? (
        <Image
          source={{ uri: currentStory.mediaUrl }}
          style={styles.imageBg}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.gradientBg, { backgroundColor: '#000000' }]} />
      )}

      {/* Dark overlay */}
      {!isTextStory && (
        <View style={styles.darkOverlay} />
      )}

      {/* Progress Bars */}
      <View style={styles.progressContainer}>
        {progressBars.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            {i < currentIndex ? (
              <View style={[styles.progressFill, styles.progressComplete]} />
            ) : i === currentIndex ? (
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>

      {/* Author Bar */}
      <View style={styles.authorBar}>
        <View style={styles.authorInfo}>
          {currentStory.authorProfileImage ? (
            <Image
              source={{ uri: currentStory.authorProfileImage }}
              style={styles.authorAvatar}
            />
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
          <Text style={styles.storyTime}>
            {timeAgo(currentStory.createdAt)}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.7}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content / Tap Zones */}
      {!isTextStory && !isPollStory && (
        <View style={styles.tapZoneContainer}>
          <TouchableOpacity
            style={styles.tapZone}
            onPress={handleTapLeft}
            activeOpacity={1}
            onPressIn={handleLongPressStart}
            onPressOut={handleLongPressEnd}
          />
          <TouchableOpacity
            style={styles.tapZone}
            onPress={handleTapRight}
            activeOpacity={1}
            onPressIn={handleLongPressStart}
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
            const votePercent =
              totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
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
                  <View
                    style={[
                      styles.pollOptionFill,
                      {
                        width: `${votePercent}%`,
                      },
                    ]}
                  />
                )}
                <View style={styles.pollOptionContent}>
                  <Text
                    style={[
                      styles.pollOptionText,
                      hasVoted && isSelected && styles.pollOptionTextSelected,
                    ]}
                  >
                    {option.text}
                  </Text>
                  {hasVoted && (
                    <Text style={styles.pollVotePercent}>{votePercent}%</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.pollVoteCount}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</Text>
        </View>
      )}

      {/* Swipe up hint */}
      <View style={styles.swipeHintContainer}>
        <Text style={styles.swipeHint}>Swipe down to dismiss</Text>
      </View>

      {/* Pause indicator */}
      {isPaused && (
        <View style={styles.pauseIndicator}>
          <Text style={styles.pauseText}>⏸ Paused</Text>
        </View>
      )}
    </View>
  );
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
    dark: '#232526',
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
    backgroundColor: 'rgba(0,0,0,0.3)',
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
    backgroundColor: 'rgba(255, 255, 255,0.2)',
    borderRadius: 1.25,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.white,
    borderRadius: 1.25,
  },
  progressComplete: {
    width: '100%',
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
    color: 'rgba(255, 255, 255,0.8)',
  },
  authorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storyTime: {
    fontSize: 12,
    color: 'rgba(255, 255,255,0.6)',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: colors.white,
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
    backgroundColor: 'rgba(255, 255,255,0.1)',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pollOptionSelected: {
    borderColor: colors.accent,
  },
  pollOptionVoted: {
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pollOptionFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    color: 'rgba(255,255,255,0.8)',
  },
  pollVoteCount: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 8,
  },
  swipeHintContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
  },
  swipeHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  pauseIndicator: {
    position: 'absolute',
    top: '45%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 25,
  },
  pauseText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
  },
});
