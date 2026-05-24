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
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { firestore, auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { tsToMillis } from '../lib/api';
import { uploadOptimizedImage } from '../utils/imageUpload';
import { useAppStore } from '../stores/app';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatList } from 'react-native';
import { AppIcon } from '../components/icons';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HIGHLIGHT_SIZE = 48;
const HIGHLIGHT_RING_PADDING = 3;
const STORY_DURATION = 5000;
const DOUBLE_TAP_DELAY = 300;
const HEART_ANIM_DURATION = 900;

const STORY_CATEGORIES = [
  { id: 'all', label: 'All', icon: 'sparkles' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'polls', label: 'Polls', icon: 'stats-chart' },
  { id: 'cricket', label: 'Cricket', icon: 'fitness' },
  { id: 'festival', label: 'Festival', icon: 'flower' },
];

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
    ? ['#000000', '#000000', '#000000']
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
              width: `${progress * 100}%`,
              backgroundColor: paused ? colors.white50 : colors.white,
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
      <AppIcon name="favorite" size="overlay" color={colors.like} />
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */
export default function StoriesScreen({ navigation }: any) {
  /* ── State ──────────────────────────────────────────────────────────────── */
  const [stories, setStories] = useState<Story[]>([]);
  const [filtered, setFiltered] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [uploading, setUploading] = useState(false);

  // Story viewer
  const [viewingStory, setViewingStory] = useState<Story | null>(null);
  const [authorStories, setAuthorStories] = useState<Story[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const likedRef = useRef(false); // Synced ref for toggleLike to avoid stale closure
  const likingRef = useRef(false); // In-flight guard for toggleLike
  // Keep likedRef in sync with liked state (useEffect fires synchronously after render)
  useEffect(() => { likedRef.current = liked; }, [liked]);
  const [paused, setPaused] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<Array<{ uid: string; displayName: string; username: string; profileImage: string | null; viewedAt: number }>>([]);

  // Double-tap heart
  const [heartVisible, setHeartVisible] = useState(false);
  const [heartPos, setHeartPos] = useState({ x: 0, y: 0 });
  const lastTapRef = useRef<number>(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const storyNavTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressingRef = useRef(false);

  useEffect(() => {
    return () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); };
  }, []);
  const VIEWED_STORIES_KEY = 'stories_viewed_ids';
  const viewedStoriesRef = useRef<Set<string>>(new Set());
  const currentUser = auth()?.currentUser;

  // Load previously viewed story IDs from AsyncStorage on mount (survives remounts)
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(VIEWED_STORIES_KEY);
        if (stored) {
          const ids: string[] = JSON.parse(stored);
          viewedStoriesRef.current = new Set(ids);
        }
      } catch (e) {
        if (__DEV__) console.warn('[StoriesScreen] Failed to load viewed stories from AsyncStorage:', e);
      }
    })();
  }, []);

  // ── Get user profile from Zustand store (Firestore data, not just auth) ──
  const storeUser = useAppStore((s) => s.user);
  const userProfileImage = storeUser?.profileImage || currentUser?.photoURL || null;
  const userDisplayName = storeUser?.displayName || currentUser?.displayName || 'Anonymous';

  /* ── Story Comment Handler — saves comment to Firestore ─────────────── */
  const handleStoryComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text || !viewingStory || !currentUser) return;
    const storyId = viewingStory.id;
    setCommentText('');
    setShowCommentInput(false);
    try {
      await firestore()
        .collection('story_comments')
        .doc(`${storyId}_${currentUser.uid}_${Date.now()}`)
        .set({
          storyId,
          authorId: currentUser.uid,
          authorDisplayName: userDisplayName,
          authorUsername: storeUser?.username || '',
          authorProfileImage: userProfileImage,
          content: text,
          createdAt: firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (e) {
      if (__DEV__) console.warn('[Stories] Failed to save comment:', e);
    }
  }, [commentText, viewingStory, currentUser, userDisplayName, storeUser, userProfileImage]);

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
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
            category: data.category || 'all',
          };
        })
        .filter((s: Story) => now - s.createdAt < twentyFourHours);

      setStories(loaded);
      setFiltered(loaded);
    } catch (e) {
      console.error('[StoriesScreen] Failed to load stories:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  /* ── Category filter ──────────────────────────────────────────────────── */
  const filterCategory = useCallback(
    (cat: string) => {
      setActiveCategory(cat);
      if (cat === 'all') {
        setFiltered(stories);
      } else {
        setFiltered(stories.filter((s) => s.category === cat));
      }
    },
    [stories],
  );

  /* ── Unique author bubbles (first story per author, excluding self) ──── */
  const authorBubbles = useMemo(() => {
    const seen = new Set<string>();
    const result: Story[] = [];
    for (const s of stories) {
      // Skip current user — they already have the "Your story" circle
      if (s.authorId === currentUser?.uid) continue;
      if (!seen.has(s.authorId)) {
        seen.add(s.authorId);
        result.push(s);
      }
    }
    return result;
  }, [stories, currentUser?.uid]);

  /* ── Image picker + upload ───────────────────────────────────────────── */
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
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);

      // Upload image to Firebase Storage first (Firestore has 1MB doc limit — no inline base64)
      const storagePath = `stories/${currentUser.uid}/${Date.now()}.jpg`;
      const uploadResult = await uploadOptimizedImage(asset.uri, storagePath, {
        mimeType: 'image/jpeg',
      });

      const storyData = {
        authorId: currentUser.uid,
        authorDisplayName: userDisplayName,
        authorUsername: storeUser?.username || currentUser.email?.split('@')[0] || 'user',
        authorProfileImage: userProfileImage,
        content: '',
        mediaUrl: uploadResult.downloadUrl,
        type: 'image',
        viewCount: 0,
        likeCount: 0,
        createdAt: firestore.FieldValue.serverTimestamp(),
        category: activeCategory === 'all' ? 'all' : activeCategory,
      };

      await firestore().collection('stories').add(storyData);
      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Upload failed:', e);
      Alert.alert('Upload', 'Could not post your story. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }, [currentUser, activeCategory, loadStories, storeUser, userDisplayName, userProfileImage]);

  /* ── Camera upload ───────────────────────────────────────────────────── */
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
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);

      // Upload image to Firebase Storage first
      const storagePath = `stories/${currentUser.uid}/${Date.now()}.jpg`;
      const uploadResult = await uploadOptimizedImage(asset.uri, storagePath, {
        mimeType: 'image/jpeg',
      });

      const storyData = {
        authorId: currentUser.uid,
        authorDisplayName: userDisplayName,
        authorUsername: storeUser?.username || currentUser.email?.split('@')[0] || 'user',
        authorProfileImage: userProfileImage,
        content: '',
        mediaUrl: uploadResult.downloadUrl,
        type: 'image',
        viewCount: 0,
        likeCount: 0,
        createdAt: firestore.FieldValue.serverTimestamp(),
        category: activeCategory === 'all' ? 'all' : activeCategory,
      };

      await firestore().collection('stories').add(storyData);
      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Camera upload failed:', e);
      Alert.alert('Upload', 'Could not post your story. Please check your connection and try again.');
    } finally {
      setUploading(false);
}
  }, [currentUser, activeCategory, loadStories, storeUser, userDisplayName, userProfileImage]);

  /* ── Increment view count (once per story, persisted across remounts) ── */
  const incrementViewCount = useCallback(async (storyId: string) => {
    if (viewedStoriesRef.current.has(storyId)) return;
    viewedStoriesRef.current.add(storyId);
    // Persist viewed story ID to AsyncStorage so it survives remounts
    try {
      const ids = Array.from(viewedStoriesRef.current);
      await AsyncStorage.setItem(VIEWED_STORIES_KEY, JSON.stringify(ids));
    } catch (e) {
      if (__DEV__) console.warn('[StoriesScreen] Failed to save viewed story to AsyncStorage:', e);
    }
    // BUG FIX: Update local story state so highlight ring turns gray after viewing
    setStories(prev => prev.map(s => s.id === storyId ? { ...s, viewed: true } : s));
    try {
      const userId = currentUser?.uid;
      const displayName = storeUser?.displayName || currentUser?.displayName || 'Anonymous';
      const username = storeUser?.username || '';
      const profileImage = storeUser?.profileImage || currentUser?.photoURL || null;
      await firestore()
        .collection('stories')
        .doc(storyId)
        .update({ viewCount: firestore.FieldValue.increment(1) });
      // Record viewer identity for viewer list
      if (userId) {
        await firestore()
          .collection('stories')
          .doc(storyId)
          .collection('views')
          .doc(userId)
          .set({
            uid: userId,
            displayName,
            username,
            profileImage,
            viewedAt: Date.now(),
          }, { merge: true });
      }
    } catch (e) {
      if (__DEV__) console.warn('[StoriesScreen] Failed to increment view count:', e);
    }
  }, [currentUser, storeUser]);

  /* ── Load story viewers list ───────────────────────────────────────────── */
  const loadViewers = useCallback(async (storyId: string) => {
    try {
      const snap = await firestore()
        .collection('stories')
        .doc(storyId)
        .collection('views')
        .orderBy('viewedAt', 'desc')
        .limit(50)
        .get();
      setViewers(snap.docs.map(d => d.data() as any));
    } catch (e) {
      if (__DEV__) console.warn('[StoriesScreen] Failed to load viewers:', e);
    }
  }, []);

  /* ── Check if current user already liked a story (from Firestore) ─────── */
  const checkStoryLiked = useCallback(async (storyId: string) => {
    const userId = currentUser?.uid;
    if (!userId) {
      setLiked(false);
      return;
    }
    try {
      const doc = await firestore()
        .collection('stories')
        .doc(storyId)
        .collection('likes')
        .doc(userId)
        .get();
      setLiked(doc.exists);
    } catch (e) {
      if (__DEV__) console.warn('[StoriesScreen] Failed to check liked status:', e);
      setLiked(false);
    }
  }, [currentUser]);

  const toggleLike = useCallback(async () => {
    if (!viewingStory || !currentUser || likingRef.current) return;
    likingRef.current = true;
    // Read latest value from ref to avoid stale closure
    const currentLiked = likedRef.current;
    const newLiked = !currentLiked;
    setLiked(newLiked);
    try {
      const storyRef = firestore().collection('stories').doc(viewingStory.id);
      const likeDocRef = storyRef.collection('likes').doc(currentUser.uid);
      if (newLiked) {
        const batch = firestore().batch();
        batch.update(storyRef, { likeCount: firestore.FieldValue.increment(1) });
        batch.set(likeDocRef, {
          uid: currentUser.uid,
          likedAt: firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
      } else {
        const batch = firestore().batch();
        batch.update(storyRef, { likeCount: firestore.FieldValue.increment(-1) });
        batch.delete(likeDocRef);
        await batch.commit();
      }
      // Update local story state so grid card reflects new count
      setStories(prev => prev.map(s => s.id === viewingStory.id ? { ...s, likeCount: s.likeCount + (newLiked ? 1 : -1) } : s));
    } catch (e) {
      if (__DEV__) console.warn('[StoriesScreen] Failed to toggle like:', e);
      setLiked(currentLiked); // rollback on failure
    } finally {
      likingRef.current = false;
    }
  }, [viewingStory, currentUser]);

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
      // Check if user already liked this story (persists across opens)
      checkStoryLiked(authorStoryList[startIndex].id);
    },
    [stories, incrementViewCount, checkStoryLiked],
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
      checkStoryLiked(authorStories[next].id);
    } else {
      closeStoryViewer();
    }
  }, [storyIndex, authorStories, incrementViewCount, checkStoryLiked]);

  const goToPrevStory = useCallback(() => {
    if (storyIndex > 0) {
      const prev = storyIndex - 1;
      setStoryIndex(prev);
      setViewingStory(authorStories[prev]);
      setStoryProgress(0);
      setLiked(false);
      setPaused(false);
      pausedElapsedRef.current = 0;
      checkStoryLiked(authorStories[prev].id);
    }
  }, [storyIndex, authorStories, checkStoryLiked]);

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
        lastTapRef.current = 0; // BUG FIX: Set BEFORE setTimeout to prevent navigation
        if (storyNavTimerRef.current) clearTimeout(storyNavTimerRef.current);
        setHeartPos({ x, y });
        setHeartVisible(false);
        setTimeout(() => setHeartVisible(true), 10);
        toggleLike();
      } else {
        lastTapRef.current = now;

        // After delay, if no second tap → navigate
        storyNavTimerRef.current = setTimeout(() => {
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
    [goToNextStory, goToPrevStory, toggleLike],
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

      {/* ── Header (no "Stories" text) ──────────────────────────────────── */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={openCameraForStory} style={styles.headerBtn}>
            <AppIcon name="camera-alt" size="xl" color={colors.text} />
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
                    uri={userProfileImage}
                    name={userDisplayName}
                    size={HIGHLIGHT_SIZE}
                  />
                </View>
                <View style={styles.plusBadge}>
                  <AppIcon name="add" size="sm" color={colors.accent} />
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

          {/* ── Category Filter Chips ────────────────────────────────────── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesScroll}
          >
            {STORY_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  activeCategory === cat.id && styles.categoryChipActive,
                ]}
                onPress={() => filterCategory(cat.id)}
              >
                <AppIcon
                  name={cat.icon}
                  size="sm"
                  color={activeCategory === cat.id ? colors.primary : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    activeCategory === cat.id && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Recent Stories Grid ──────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <AppIcon name="grid-view" size="md" color={colors.accent} />
              <Text style={styles.sectionTitle}>Recent</Text>
            </View>
            <Text style={styles.storyCountText}>{filtered.length} stories</Text>
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <AppIcon name="photo-library" size={56} color={colors.textMuted} />
              <Text style={styles.emptyText}>No stories yet</Text>
              <Text style={styles.emptySubtext}>Be the first to share a moment</Text>
            </View>
          ) : (
            <View style={styles.storyGrid}>
              {filtered.map((story) => (
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
                      colors={[colors.accent, colors.bg]}
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
                    colors={['transparent', colors.overlayDarker]}
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
                      <AppIcon name="visibility" size={11} color={'#e7e9ea'} />
                      <Text style={styles.storyCardStat}>{story.viewCount}</Text>
                      <AppIcon name="favorite-border" size={11} color={'#e7e9ea'} style={{ marginLeft: 6 }} />
                      <Text style={styles.storyCardStat}>{story.likeCount}</Text>
                      <Text style={styles.storyCardTime}>{timeAgo(story.createdAt)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
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
                    <AppIcon name="pause" size={10} color={colors.white} />
                  </View>
                )}
                <TouchableOpacity
                  style={{ marginLeft: 'auto' }}
                  onPress={closeStoryViewer}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <AppIcon name="close" size="xl" color={colors.white} />
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
                colors={['transparent', colors.overlayDark]}
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
                    <AppIcon
                      name={liked ? 'favorite' : 'favorite-border'}
                      size={26}
                      color={liked ? colors.like : colors.primary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reactionBtn}
                    onPress={() => setShowCommentInput(!showCommentInput)}
                  >
                    <AppIcon name="chat-bubble-outline" size="xl" color={colors.white} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reactionBtn}>
                    <AppIcon name="send-outline" size="xl" color={colors.white} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reactionBtn}>
                    <AppIcon name="more-horiz" size="xl" color={colors.white} />
                  </TouchableOpacity>
                </View>

                {/* Stats row */}
                <View style={styles.reactionStats}>
                  <AppIcon name="favorite" size="sm" color={colors.like} />
                  <Text style={styles.reactionStatText}>
                    {viewingStory.likeCount}
                  </Text>
                  <View style={{ width: 16 }} />
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      if (viewingStory) {
                        loadViewers(viewingStory.id);
                        setShowViewers(true);
                      }
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                  >
                    <AppIcon name="visibility" size="sm" color={colors.textSecondary} />
                    <Text style={styles.reactionStatTextMuted}>
                      {viewingStory.viewCount}
                    </Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </View>

            {/* ── Comment input overlay ──────────────────────────────────── */}
            {showCommentInput && (
              <View style={styles.commentInputOverlay}>
                <SafeAreaView edges={['bottom']}>
                  <View style={styles.commentInputRow}>
                    <Avatar
                      uri={userProfileImage}
                      name={userDisplayName}
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
                          handleStoryComment();
                        }}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        handleStoryComment();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <AppIcon
                        name="send"
                        size="lg"
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

      {/* ── Story Viewers Modal ──────────────────────────────────────────── */}
      <Modal visible={showViewers} transparent animationType="slide" onRequestClose={() => setShowViewers(false)}>
        <View style={styles.viewersOverlay}>
          <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
            <View style={styles.viewersContainer}>
              <View style={styles.viewersHeader}>
                <Text style={styles.viewersTitle}>Story Views</Text>
                <TouchableOpacity onPress={() => setShowViewers(false)}>
                  <AppIcon name="close" size="xl" color={colors.text} />
                </TouchableOpacity>
              </View>
              {viewers.length === 0 ? (
                <View style={styles.viewersEmpty}>
                  <AppIcon name="visibility" size={40} color={colors.textMuted} />
                  <Text style={styles.viewersEmptyText}>No views yet</Text>
                </View>
              ) : (
                <FlatList
                  data={viewers}
                  keyExtractor={(item) => item.uid}
                  renderItem={({ item }) => (
                    <View style={styles.viewerItem}>
                      <Avatar uri={item.profileImage} name={item.displayName} size={40} />
                      <View style={styles.viewerInfo}>
                        <Text style={styles.viewerName}>{item.displayName}</Text>
                        <Text style={styles.viewerHandle}>@{item.username || 'user'}</Text>
                      </View>
                      <Text style={styles.viewerTime}>{timeAgo(item.viewedAt)}</Text>
                    </View>
                  )}
                />
              )}
            </View>
          </SafeAreaView>
        </View>
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

  /* ── Category Filter Chips ───────────────────────────────────────────── */
  categoriesScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: colors.white,
    fontWeight: '700',
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
  seeAllText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  storyCountText: {
    color: colors.textMuted,
    fontSize: 13,
  },

  /* ── Trending Music ──────────────────────────────────────────────────── */
  musicScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  musicCard: {
    width: 110,
    alignItems: 'center',
  },
  musicCardCoverWrap: {
    position: 'relative',
    marginBottom: 8,
  },
  musicCardCover: {
    width: 100,
    height: 100,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicPlayBtn: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentBorderStrong,
  },
  musicTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 100,
  },
  musicArtist: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    maxWidth: 100,
    marginTop: 1,
  },

  /* ── Filters (circular, Instagram-style) ─────────────────────────────── */
  filtersScroll: {
    paddingHorizontal: 16,
    gap: 16,
    alignItems: 'center',
  },
  filterItem: {
    alignItems: 'center',
    width: 70,
  },
  filterCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCircleInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.borderSubtleStrong,
  },
  filterLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },

  /* ── Recent Stories Grid ─────────────────────────────────────────────── */
  storyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 2,
    gap: 2,
  },
  storyCard: {
    width: (SCREEN_W - 4) / 3,
    height: SCREEN_W * 0.55,
    position: 'relative',
    overflow: 'hidden',
  },
  storyCardBg: {
    ...StyleSheet.absoluteFillObject,
  },
  storyCardTextBg: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  storyCardText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  storyCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  storyCardInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
  },
  storyCardAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  storyCardAuthor: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  storyCardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
  },
  storyCardStat: {
    color: '#e7e9ea',
    fontSize: 10,
    marginLeft: 2,
  },
  storyCardTime: {
    color: colors.white50,
    fontSize: 10,
    marginLeft: 'auto',
  },

  /* ── Empty State ─────────────────────────────────────────────────────── */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
  },

  /* ── Upload Overlay ──────────────────────────────────────────────────── */
  uploadingOverlay: {
    flex: 1,
    backgroundColor: colors.overlayHeavy,
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
    backgroundColor: colors.bg,
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
    backgroundColor: colors.separator,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.white,
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
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  viewerTimestamp: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  pausedIndicator: {
    backgroundColor: colors.accentBorderStrong,
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
    backgroundColor: colors.bg,
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
    color: colors.white,
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
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  reactionAuthorUsername: {
    color: colors.textSecondary,
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
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  reactionStatTextMuted: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '400',
  },

  /* ── Comment Input ───────────────────────────────────────────────────── */
  commentInputOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.overlayFull,
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
  /* ── Viewers Modal ──────────────────────────────────────────────────── */
  viewersOverlay: {
    flex: 1,
    backgroundColor: colors.overlayDark,
  },
  viewersContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    marginTop: 80,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  viewersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  viewersTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  viewersEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  viewersEmptyText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  viewerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  viewerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  viewerName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  viewerHandle: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  viewerTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
