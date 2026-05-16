import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { firestore, auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { tsToMillis } from '../lib/api';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HIGHLIGHT_SIZE = 48;
const HIGHLIGHT_RING_PADDING = 3;
const STORY_DURATION = 5000;
const DOUBLE_TAP_DELAY = 300;
const HEART_ANIM_DURATION = 900;

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */
interface Story {
  id: string;
  authorId: string;
  authorDisplayName: string;
  authorUsername: string;
  authorProfileImage: string | null;
  content: string;
  mediaUrl: string | null;
  type: string;
  viewCount: number;
  likeCount: number;
  createdAt: number;
  category?: string;
  viewed?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRADIENT BORDER — Instagram-style ring around highlight circles
   ═══════════════════════════════════════════════════════════════════════════ */
function GradientBorder({
  size,
  viewed,
  children,
}: {
  size: number;
  viewed?: boolean;
  children: React.ReactNode;
}) {
  const gradientColors: readonly [string, string, ...string[]] = viewed
    ? ['#374151', '#6b7280', '#374151']
    : ['#f09433', '#e6683c', '#dc2743', '#cc2366', '#bc1888', '#8a3ab9'];

  return (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size + HIGHLIGHT_RING_PADDING * 2 + 2,
        height: size + HIGHLIGHT_RING_PADDING * 2 + 2,
        borderRadius: (size + HIGHLIGHT_RING_PADDING * 2 + 2) / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </LinearGradient>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STORY PROGRESS BAR
   ═══════════════════════════════════════════════════════════════════════════ */
function StoryProgressBar({
  index,
  currentIndex,
  total,
  progress,
  paused,
}: {
  index: number;
  currentIndex: number;
  total: number;
  progress: number;
  paused: boolean;
}) {
  const barWidth = (SCREEN_W - 16) / total;

  return (
    <View style={[styles.progressTrack, { width: barWidth }]}>
      {index < currentIndex ? (
        <View style={[styles.progressFill, { width: '100%' }]} />
      ) : index === currentIndex ? (
        <View
          style={[
            styles.progressFill,
            {
              width: `${(paused ? progress : progress) * 100}%`,
              backgroundColor: paused ? 'rgba(255,255,255,0.5)' : '#fff',
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOUBLE-TAP HEART OVERLAY
   ═══════════════════════════════════════════════════════════════════════════ */
function HeartOverlay({
  visible,
  x,
  y,
}: {
  visible: boolean;
  x: number;
  y: number;
}) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0);
      opacity.setValue(1);
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.2,
          duration: 150,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.delay(400),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.heartOverlay,
        {
          left: x - 40,
          top: y - 40,
          opacity,
          transform: [{ scale }],
        },
      ]}
    >
      <Ionicons name="heart" size={80} color="#ff3040" />
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */
export default function StoriesScreen({ navigation }: any) {
  /* ── State ──────────────────────────────────────────────────────────────── */
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Story viewer
  const [viewingStory, setViewingStory] = useState<Story | null>(null);
  const [authorStories, setAuthorStories] = useState<Story[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Double-tap heart
  const [heartVisible, setHeartVisible] = useState(false);
  const [heartPos, setHeartPos] = useState({ x: 0, y: 0 });
  const lastTapRef = useRef<number>(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressingRef = useRef(false);
  const viewedStoriesRef = useRef<Set<string>>(new Set());
  const currentUser = auth()?.currentUser;

  /* ── Load stories from Firestore ──────────────────────────────────────── */
  const loadStories = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('stories')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      const loaded: Story[] = snap.docs
        .map((d: any) => {
          const data = d.data();
          return {
            id: d.id,
            authorId: data.authorId || '',
            authorDisplayName: data.authorDisplayName || '',
            authorUsername: data.authorUsername || '',
            authorProfileImage: data.authorProfileImage || null,
            content: data.content || data.text || '',
            mediaUrl: data.mediaUrl || null,
            type: data.type || 'text',
            viewCount: data.viewCount || 0,
            likeCount: data.likeCount || 0,
            createdAt: tsToMillis(data.createdAt),
            category: data.category || 'all',
          };
        })
        .filter((s: Story) => now - s.createdAt < twentyFourHours);

      setStories(loaded);
    } catch (e) {
      console.error('[StoriesScreen] Failed to load stories:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  /* ── Unique author bubbles (first story per author) ───────────────────── */
  const authorBubbles = useMemo(() => {
    const seen = new Set<string>();
    const result: Story[] = [];
    for (const s of stories) {
      if (!seen.has(s.authorId)) {
        seen.add(s.authorId);
        result.push(s);
      }
    }
    return result;
  }, [stories]);

  /* ── Image picker + upload (no cropping) ──────────────────────────────── */
  const pickAndUploadStory = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create a story.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);
      const mediaUrl = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;

      const storyData = {
        authorId: currentUser.uid,
        authorDisplayName: currentUser.displayName || 'Anonymous',
        authorUsername: currentUser.email?.split('@')[0] || 'user',
        authorProfileImage: currentUser.photoURL || null,
        content: '',
        mediaUrl,
        type: 'image',
        viewCount: 0,
        likeCount: 0,
        createdAt: new Date().toISOString(),
        category: 'all',
      };

      await firestore().collection('stories').add(storyData);
      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Upload failed:', e);
      Alert.alert('Upload', 'Could not post your story. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [currentUser, loadStories]);

  /* ── Camera upload (no cropping) ──────────────────────────────────────── */
  const openCameraForStory = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create a story.');
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);
      const mediaUrl = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;

      const storyData = {
        authorId: currentUser.uid,
        authorDisplayName: currentUser.displayName || 'Anonymous',
        authorUsername: currentUser.email?.split('@')[0] || 'user',
        authorProfileImage: currentUser.photoURL || null,
        content: '',
        mediaUrl,
        type: 'image',
        viewCount: 0,
        likeCount: 0,
        createdAt: new Date().toISOString(),
        category: 'all',
      };

      await firestore().collection('stories').add(storyData);
      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Camera upload failed:', e);
      Alert.alert('Upload', 'Could not post your story. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [currentUser, loadStories]);

  /* ── Increment view count (once per story per session) ────────────────── */
  const incrementViewCount = useCallback(async (storyId: string) => {
    if (viewedStoriesRef.current.has(storyId)) return;
    viewedStoriesRef.current.add(storyId);
    try {
      await firestore()
        .collection('stories')
        .doc(storyId)
        .update({ viewCount: firestore.FieldValue.increment(1) });
    } catch (e) {
      console.warn('[StoriesScreen] Failed to increment view count:', e);
    }
  }, []);

  /* ── Like a story ─────────────────────────────────────────────────────── */
  const doLike = useCallback(async () => {
    if (!viewingStory || !currentUser) return;
    setLiked(true);
    try {
      await firestore()
        .collection('stories')
        .doc(viewingStory.id)
        .update({ likeCount: firestore.FieldValue.increment(1) });
    } catch (e) {
      console.warn('[StoriesScreen] Failed to like story:', e);
    }
  }, [viewingStory, currentUser]);

  const toggleLike = useCallback(async () => {
    if (!viewingStory || !currentUser) return;
    const newLiked = !liked;
    setLiked(newLiked);
    try {
      await firestore()
        .collection('stories')
        .doc(viewingStory.id)
        .update({ likeCount: firestore.FieldValue.increment(newLiked ? 1 : -1) });
    } catch (e) {
      console.warn('[StoriesScreen] Failed to like story:', e);
    }
  }, [viewingStory, currentUser, liked]);

  /* ── Story viewer: open, navigation, timer ───────────────────────────── */
  const openStoryViewer = useCallback(
    (authorId: string, specificStoryId?: string) => {
      const authorStoryList = stories.filter((s) => s.authorId === authorId);
      if (authorStoryList.length === 0) return;

      authorStoryList.sort((a, b) => a.createdAt - b.createdAt);

      let startIndex = 0;
      if (specificStoryId) {
        const idx = authorStoryList.findIndex((s) => s.id === specificStoryId);
        if (idx >= 0) startIndex = idx;
      }

      setAuthorStories(authorStoryList);
      setStoryIndex(startIndex);
      setViewingStory(authorStoryList[startIndex]);
      setStoryProgress(0);
      setLiked(false);
      setPaused(false);
      setShowCommentInput(false);
      setCommentText('');
      pausedElapsedRef.current = 0;
      incrementViewCount(authorStoryList[startIndex].id);
    },
    [stories, incrementViewCount],
  );

  const goToNextStory = useCallback(() => {
    if (storyIndex < authorStories.length - 1) {
      const next = storyIndex + 1;
      setStoryIndex(next);
      setViewingStory(authorStories[next]);
      setStoryProgress(0);
      setLiked(false);
      setPaused(false);
      pausedElapsedRef.current = 0;
      incrementViewCount(authorStories[next].id);
    } else {
      closeStoryViewer();
    }
  }, [storyIndex, authorStories, incrementViewCount]);

  const goToPrevStory = useCallback(() => {
    if (storyIndex > 0) {
      const prev = storyIndex - 1;
      setStoryIndex(prev);
      setViewingStory(authorStories[prev]);
      setStoryProgress(0);
      setLiked(false);
      setPaused(false);
      pausedElapsedRef.current = 0;
    }
  }, [storyIndex, authorStories]);

  const closeStoryViewer = useCallback(() => {
    setViewingStory(null);
    setAuthorStories([]);
    setStoryIndex(0);
    setStoryProgress(0);
    setLiked(false);
    setPaused(false);
    setShowCommentInput(false);
    pausedElapsedRef.current = 0;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* ── Auto-progress timer (pauses when paused) ─────────────────────────── */
  useEffect(() => {
    if (!viewingStory || paused) {
      if (paused && timerRef.current) {
        pausedElapsedRef.current = storyProgress;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now() - storyProgress * STORY_DURATION;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(elapsed / STORY_DURATION, 1);
      setStoryProgress(progress);

      if (progress >= 1) {
        goToNextStory();
      }
    }, 50);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [viewingStory, storyIndex, paused, goToNextStory]);

  /* ── Tap + long-press handlers on story content ──────────────────────── */
  const handleStoryTouchStart = useCallback(
    (e: any) => {
      isLongPressingRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        isLongPressingRef.current = true;
        setPaused(true);
      }, 200);
    },
    [],
  );

  const handleStoryTouchEnd = useCallback(
    (e: any) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      if (isLongPressingRef.current) {
        isLongPressingRef.current = false;
        // Long press ended — resume
        setPaused(false);
        return;
      }

      // Single tap or double-tap
      const now = Date.now();
      const x = e.nativeEvent.locationX;
      const y = e.nativeEvent.locationY;

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        // Double tap — show heart animation + like
        setHeartPos({ x, y });
        setHeartVisible(false);
        setTimeout(() => setHeartVisible(true), 10);
        doLike();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;

        // After delay, if no second tap → navigate
        setTimeout(() => {
          if (Date.now() - lastTapRef.current >= DOUBLE_TAP_DELAY - 50) {
            const third = SCREEN_W / 3;
            if (x < third) {
              goToPrevStory();
            } else {
              goToNextStory();
            }
          }
        }, DOUBLE_TAP_DELAY);
      }
    },
    [goToNextStory, goToPrevStory, doLike],
  );

  const handleStoryTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER — Main Screen
     ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={openCameraForStory} style={styles.headerBtn}>
            <Ionicons name="camera-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* ── Highlight Circles (compact row) ──────────────────────────── */}
          <View style={styles.highlightsSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.highlightsScrollContent}
            >
              {/* Your Story circle */}
              <TouchableOpacity style={styles.highlightItem} onPress={pickAndUploadStory}>
                <View style={styles.yourStoryRing}>
                  <Avatar
                    uri={currentUser?.photoURL}
                    name={currentUser?.displayName}
                    size={HIGHLIGHT_SIZE}
                  />
                </View>
                <View style={styles.plusBadge}>
                  <Ionicons name="add" size={14} color={colors.accent} />
                </View>
                <Text style={styles.highlightLabel} numberOfLines={1}>
                  Your story
                </Text>
              </TouchableOpacity>

              {/* Author bubbles */}
              {authorBubbles.map((s) => (
                <TouchableOpacity
                  key={s.authorId}
                  style={styles.highlightItem}
                  onPress={() => openStoryViewer(s.authorId, s.id)}
                >
                  <GradientBorder size={HIGHLIGHT_SIZE} viewed={s.viewed}>
                    <View style={styles.highlightAvatarContainer}>
                      <Avatar
                        uri={s.authorProfileImage}
                        name={s.authorDisplayName}
                        size={HIGHLIGHT_SIZE}
                      />
                    </View>
                  </GradientBorder>
                  <Text style={styles.highlightLabel} numberOfLines={1}>
                    {s.authorUsername || s.authorDisplayName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── Stories Grid (2-column) ─────────────────────────────────── */}
          {stories.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={64} color={colors.textMuted} />
              <Text style={styles.emptyText}>No stories yet</Text>
              <Text style={styles.emptySubtext}>Be the first to share a moment</Text>
              <TouchableOpacity style={styles.emptyUploadBtn} onPress={pickAndUploadStory}>
                <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                <Text style={styles.emptyUploadBtnText}>Create a Story</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="grid-outline" size={18} color={colors.accent} />
                  <Text style={styles.sectionTitle}>Recent Stories</Text>
                </View>
                <Text style={styles.storyCountText}>{stories.length} stories</Text>
              </View>

              <View style={styles.storyGrid}>
                {stories.map((story) => (
                  <TouchableOpacity
                    key={story.id}
                    style={styles.storyCard}
                    onPress={() => openStoryViewer(story.authorId, story.id)}
                  >
                    {story.mediaUrl ? (
                      <Image
                        source={{ uri: story.mediaUrl }}
                        style={styles.storyCardBg}
                        resizeMode="cover"
                      />
                    ) : (
                      <LinearGradient
                        colors={['#4a2080', '#2a7fff']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.storyCardBg, styles.storyCardTextBg]}
                      >
                        <Text style={styles.storyCardText} numberOfLines={4}>
                          {story.content}
                        </Text>
                      </LinearGradient>
                    )}

                    {/* Bottom gradient overlay */}
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.75)']}
                      style={styles.storyCardOverlay}
                    />

                    {/* Story info */}
                    <View style={styles.storyCardInfo}>
                      <View style={styles.storyCardAuthorRow}>
                        <Avatar uri={story.authorProfileImage} name={story.authorDisplayName} size={20} />
                        <Text style={styles.storyCardAuthor} numberOfLines={1}>
                          {story.authorDisplayName}
                        </Text>
                      </View>
                      <View style={styles.storyCardStats}>
                        <Ionicons name="eye-outline" size={11} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.storyCardStat}>{story.viewCount}</Text>
                        <Ionicons name="heart-outline" size={11} color="rgba(255,255,255,0.7)" style={{ marginLeft: 6 }} />
                        <Text style={styles.storyCardStat}>{story.likeCount}</Text>
                        <Text style={styles.storyCardTime}>{timeAgo(story.createdAt)}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={{ height: 50 }} />
        </ScrollView>
      )}

      {/* ── Upload indicator ───────────────────────────────────────────── */}
      {uploading && (
        <Modal transparent animationType="fade">
          <View style={styles.uploadingOverlay}>
            <View style={styles.uploadingCard}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.uploadingText}>Posting your story...</Text>
            </View>
          </View>
        </Modal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          STORY VIEWER MODAL — Fullscreen, 90% content / 10% reaction bar
         ═══════════════════════════════════════════════════════════════════ */}
      <Modal visible={!!viewingStory} animationType="fade" transparent statusBarTranslucent>
        {viewingStory && (
          <View style={styles.viewerContainer}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

            {/* ── Progress bars at top ──────────────────────────────────── */}
            <SafeAreaView edges={['top']} style={styles.viewerTopArea}>
              <View style={styles.progressBarsRow}>
                {authorStories.map((_, i) => (
                  <StoryProgressBar
                    key={i}
                    index={i}
                    currentIndex={storyIndex}
                    total={authorStories.length}
                    progress={storyProgress}
                    paused={paused}
                  />
                ))}
              </View>

              {/* Viewer header row */}
              <View style={styles.viewerHeader}>
                <Avatar
                  uri={viewingStory.authorProfileImage}
                  name={viewingStory.authorDisplayName}
                  size={32}
                />
                <Text style={styles.viewerUsername} numberOfLines={1}>
                  {viewingStory.authorUsername || viewingStory.authorDisplayName}
                </Text>
                <Text style={styles.viewerTimestamp}>
                  {timeAgo(viewingStory.createdAt)}
                </Text>
                {/* Pause indicator */}
                {paused && (
                  <View style={styles.pausedIndicator}>
                    <Ionicons name="pause" size={10} color="#fff" />
                  </View>
                )}
                <TouchableOpacity
                  style={{ marginLeft: 'auto' }}
                  onPress={closeStoryViewer}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </SafeAreaView>

            {/* ── Story content area (90%) ──────────────────────────────── */}
            <View
              style={styles.viewerContent}
              onTouchStart={handleStoryTouchStart}
              onTouchEnd={handleStoryTouchEnd}
              onTouchMove={handleStoryTouchMove}
            >
              {viewingStory.mediaUrl ? (
                <Image
                  source={{ uri: viewingStory.mediaUrl }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.viewerTextContent}>
                  <Text style={styles.viewerStoryText}>{viewingStory.content}</Text>
                </View>
              )}

              {/* Double-tap heart overlay */}
              <HeartOverlay visible={heartVisible} x={heartPos.x} y={heartPos.y} />
            </View>

            {/* ── Bottom reaction bar (10%) ──────────────────────────────── */}
            <View style={styles.viewerReactionBar}>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.6)']}
                style={styles.reactionGradient}
              />
              <SafeAreaView edges={['bottom']} style={styles.reactionBarContent}>
                {/* Author info row */}
                <View style={styles.reactionAuthorRow}>
                  <Avatar
                    uri={viewingStory.authorProfileImage}
                    name={viewingStory.authorDisplayName}
                    size={28}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.reactionAuthorName} numberOfLines={1}>
                      {viewingStory.authorDisplayName}
                    </Text>
                    <Text style={styles.reactionAuthorUsername} numberOfLines={1}>
                      @{viewingStory.authorUsername || 'user'}
                    </Text>
                  </View>
                </View>

                {/* Action buttons row */}
                <View style={styles.reactionActions}>
                  <TouchableOpacity style={styles.reactionBtn} onPress={toggleLike}>
                    <Ionicons
                      name={liked ? 'heart' : 'heart-outline'}
                      size={26}
                      color={liked ? colors.like : '#fff'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reactionBtn}
                    onPress={() => setShowCommentInput(!showCommentInput)}
                  >
                    <Ionicons name="chatbubble-outline" size={24} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reactionBtn}>
                    <Ionicons name="send-outline" size={24} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reactionBtn}>
                    <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Stats row */}
                <View style={styles.reactionStats}>
                  <Ionicons name="heart" size={14} color={colors.like} />
                  <Text style={styles.reactionStatText}>
                    {viewingStory.likeCount + (liked ? 1 : 0)}
                  </Text>
                  <View style={{ width: 16 }} />
                  <Ionicons name="eye" size={14} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.reactionStatTextMuted}>
                    {viewingStory.viewCount}
                  </Text>
                </View>
              </SafeAreaView>
            </View>

            {/* ── Comment input overlay ──────────────────────────────────── */}
            {showCommentInput && (
              <View style={styles.commentInputOverlay}>
                <SafeAreaView edges={['bottom']}>
                  <View style={styles.commentInputRow}>
                    <Avatar
                      uri={currentUser?.photoURL}
                      name={currentUser?.displayName}
                      size={32}
                    />
                    <View style={styles.commentInputWrapper}>
                      <TextInput
                        style={styles.commentInput}
                        placeholder="Send a comment..."
                        placeholderTextColor={colors.textMuted}
                        value={commentText}
                        onChangeText={setCommentText}
                        autoFocus
                        returnKeyType="send"
                        onSubmitEditing={() => {
                          if (commentText.trim()) {
                            Alert.alert('Comment', `Comment posted: "${commentText.trim()}"`);
                            setCommentText('');
                            setShowCommentInput(false);
                          }
                        }}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        if (commentText.trim()) {
                          Alert.alert('Comment', `Comment posted: "${commentText.trim()}"`);
                          setCommentText('');
                          setShowCommentInput(false);
                        }
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name="send"
                        size={22}
                        color={commentText.trim() ? colors.accent : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </SafeAreaView>
              </View>
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  /* ── Main Container ──────────────────────────────────────────────────── */
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 20,
  },

  /* ── Header (minimal — no title) ─────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Highlight Circles ───────────────────────────────────────────────── */
  highlightsSection: {
    paddingVertical: 10,
  },
  highlightsScrollContent: {
    paddingHorizontal: 12,
    gap: 10,
    alignItems: 'flex-start',
  },
  highlightItem: {
    alignItems: 'center',
    width: 60,
  },
  yourStoryRing: {
    width: HIGHLIGHT_SIZE + 4,
    height: HIGHLIGHT_SIZE + 4,
    borderRadius: (HIGHLIGHT_SIZE + 4) / 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    bottom: 14,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  highlightLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    marginTop: 5,
    textAlign: 'center',
    maxWidth: 58,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  highlightAvatarContainer: {
    borderRadius: HIGHLIGHT_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.bg,
  },

  /* ── Section Headers ─────────────────────────────────────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  storyCountText: {
    color: colors.textMuted,
    fontSize: 13,
  },

  /* ── Stories Grid (2-column) ─────────────────────────────────────────── */
  storyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 3,
    gap: 3,
  },
  storyCard: {
    width: (SCREEN_W - 9) / 2,
    height: SCREEN_W * 0.75,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  storyCardBg: {
    ...StyleSheet.absoluteFillObject,
  },
  storyCardTextBg: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  storyCardText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  storyCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '55%',
  },
  storyCardInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  storyCardAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  storyCardAuthor: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  storyCardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  storyCardStat: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    marginLeft: 2,
  },
  storyCardTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    marginLeft: 'auto',
  },

  /* ── Empty State ─────────────────────────────────────────────────────── */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 20,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: 'rgba(42,127,255,0.1)',
  },
  emptyUploadBtnText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ── Upload Overlay ──────────────────────────────────────────────────── */
  uploadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  uploadingText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ══════════════════════════════════════════════════════════════════════
     STORY VIEWER
     ══════════════════════════════════════════════════════════════════════ */
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerTopArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  progressBarsRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  progressTrack: {
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 1.5,
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  viewerUsername: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  viewerTimestamp: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  pausedIndicator: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  /* ── Story Content (90%) ─────────────────────────────────────────────── */
  viewerContent: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerImage: {
    width: SCREEN_W,
    height: '100%',
  },
  viewerTextContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  viewerStoryText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 32,
  },

  /* ── Heart Overlay (double-tap) ──────────────────────────────────────── */
  heartOverlay: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Bottom Reaction Bar (10%) ───────────────────────────────────────── */
  viewerReactionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  reactionGradient: {
    position: 'absolute',
    top: -60,
    left: 0,
    right: 0,
    height: 60,
  },
  reactionBarContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  reactionAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionAuthorName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  reactionAuthorUsername: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 1,
  },
  reactionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 6,
  },
  reactionBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionStatText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  reactionStatTextMuted: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '400',
  },

  /* ── Comment Input ───────────────────────────────────────────────────── */
  commentInputOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  commentInputWrapper: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  commentInput: {
    color: colors.text,
    fontSize: 14,
    padding: 0,
  },
});
