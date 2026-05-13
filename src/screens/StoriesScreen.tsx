import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  PanResponder,
  Animated,
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HIGHLIGHT_SIZE = 48;
const HIGHLIGHT_PADDING = 3;
const STORY_DURATION = 5000; // 5 seconds per story

const STORY_CATEGORIES = [
  { id: 'all', label: 'All', icon: 'sparkles' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'polls', label: 'Polls', icon: 'stats-chart' },
  { id: 'cricket', label: 'Cricket', icon: 'fitness' },
  { id: 'festival', label: 'Festival', icon: 'happy' },
];

const TRENDING_MUSIC = [
  { id: 'm1', title: 'Blinding Lights', artist: 'The Weeknd' },
  { id: 'm2', title: 'Tum Hi Ho', artist: 'Arijit Singh' },
  { id: 'm3', title: 'Levitating', artist: 'Dua Lipa' },
  { id: 'm4', title: 'Shape of You', artist: 'Ed Sheeran' },
  { id: 'm5', title: 'Pasoori', artist: 'Ali Sethi' },
  { id: 'm6', title: 'Calm Down', artist: 'Rema' },
];

const TRENDING_FILTERS = [
  { id: 'f1', label: 'Warm', colors: ['#f59e0b', '#ef4444'] as const },
  { id: 'f2', label: 'Cool', colors: ['#3b82f6', '#8b5cf6'] as const },
  { id: 'f3', label: 'Vintage', colors: ['#a78bfa', '#ec4899'] as const },
  { id: 'f4', label: 'B&W', colors: ['#6b7280', '#1f2937'] as const },
  { id: 'f5', label: 'Neon', colors: ['#10b981', '#06b6d4'] as const },
  { id: 'f6', label: 'Sunset', colors: ['#f97316', '#eab308'] as const },
];

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
   GRADIENT BORDER (Instagram-style ring around highlight circles)
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
      style={[styles.gradientBorderRing, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}
    >
      {children}
    </LinearGradient>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROGRESS BAR (for story viewer)
   ═══════════════════════════════════════════════════════════════════════════ */
function StoryProgressBar({
  index,
  currentIndex,
  total,
  progress,
}: {
  index: number;
  currentIndex: number;
  total: number;
  progress: number;
}) {
  const barWidth = (SCREEN_W - 16) / total;

  return (
    <View style={[styles.progressTrack, { width: barWidth }]}>
      {index < currentIndex ? (
        <View style={[styles.progressFill, { width: '100%' }]} />
      ) : index === currentIndex ? (
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */
export default function StoriesScreen({ navigation }: any) {
  const [stories, setStories] = useState<Story[]>([]);
  const [filtered, setFiltered] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [uploading, setUploading] = useState(false);

  // Story viewer state
  const [viewingStory, setViewingStory] = useState<Story | null>(null);
  const [authorStories, setAuthorStories] = useState<Story[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
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

  /* ── Build unique author bubbles (first story per author) ─────────────── */
  const authorBubbles = React.useMemo(() => {
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

  /* ── Image picker + upload to Firestore ───────────────────────────────── */
  const pickAndUploadStory = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create a story.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);

      // Build a base64 data URI for storage
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
        category: activeCategory === 'all' ? 'all' : activeCategory,
      };

      await firestore().collection('stories').add(storyData);

      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Upload failed:', e);
      Alert.alert('Upload Failed', e?.message || 'Could not post your story.');
    } finally {
      setUploading(false);
    }
  }, [currentUser, activeCategory, loadStories]);

  /* ── Open camera for story ────────────────────────────────────────────── */
  const openCameraForStory = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create a story.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.7,
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
        category: activeCategory === 'all' ? 'all' : activeCategory,
      };

      await firestore().collection('stories').add(storyData);

      Alert.alert('Story Posted!', 'Your story is now live for 24 hours.');
      loadStories();
    } catch (e: any) {
      console.error('[StoriesScreen] Camera upload failed:', e);
      Alert.alert('Upload Failed', e?.message || 'Could not post your story.');
    } finally {
      setUploading(false);
    }
  }, [currentUser, activeCategory, loadStories]);

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

      // Sort by createdAt ascending (oldest first) like Instagram
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
      setShowCommentInput(false);
      setCommentText('');

      // Increment view count
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
    }
  }, [storyIndex, authorStories]);

  const closeStoryViewer = useCallback(() => {
    setViewingStory(null);
    setAuthorStories([]);
    setStoryIndex(0);
    setStoryProgress(0);
    setLiked(false);
    setShowCommentInput(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* ── Auto-progress timer ──────────────────────────────────────────────── */
  useEffect(() => {
    if (!viewingStory) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now();
    setStoryProgress(0);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(elapsed / STORY_DURATION, 1);
      setStoryProgress(progress);

      if (progress >= 1) {
        goToNextStory();
      }
    }, 50); // Update ~20fps for smooth animation

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [viewingStory, storyIndex, goToNextStory]);

  /* ── Tap zone handlers (left = prev, right = next) ───────────────────── */
  const handleTapContent = useCallback(
    (x: number) => {
      const third = SCREEN_W / 3;
      if (x < third) {
        goToPrevStory();
      } else {
        goToNextStory();
      }
    },
    [goToNextStory, goToPrevStory],
  );

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER — Main Screen
     ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
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
          {/* ── Highlight Circles Row ──────────────────────────────────── */}
          <View style={styles.highlightsSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.highlightsScrollContent}
            >
              {/* Your Story */}
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

              {/* Author highlight bubbles */}
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

          {/* ── Category Filter Chips ──────────────────────────────────── */}
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

          {/* ── Trending Music Row ─────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trending Music</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.musicScroll}
          >
            {TRENDING_MUSIC.map((track) => (
              <TouchableOpacity key={track.id} style={styles.musicCard}>
                <LinearGradient
                  colors={['#8b5cf6', '#ec4899']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.musicCardCover}
                >
                  <Ionicons name="musical-notes" size={22} color="#fff" />
                </LinearGradient>
                <Text style={styles.musicTitle} numberOfLines={1}>
                  {track.title}
                </Text>
                <Text style={styles.musicArtist} numberOfLines={1}>
                  {track.artist}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Filters Row ────────────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Filters</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScroll}
          >
            {TRENDING_FILTERS.map((filter) => (
              <TouchableOpacity key={filter.id} style={styles.filterCard}>
                <LinearGradient
                  colors={filter.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.filterCardGradient}
                />
                <Text style={styles.filterLabel}>{filter.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Recent Stories Grid ────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Stories</Text>
            <Text style={styles.storyCountText}>{filtered.length} stories</Text>
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No stories yet</Text>
              <Text style={styles.emptySubtext}>
                Be the first to share a moment
              </Text>
            </View>
          ) : (
            <View style={styles.storyGrid}>
              {filtered.map((story) => (
                <TouchableOpacity
                  key={story.id}
                  style={styles.storyCard}
                  onPress={() =>
                    openStoryViewer(story.authorId, story.id)
                  }
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
                    colors={['transparent', 'rgba(0,0,0,0.7)']}
                    style={styles.storyCardOverlay}
                  />

                  {/* Story info */}
                  <View style={styles.storyCardInfo}>
                    <View style={styles.storyCardAuthorRow}>
                      <Avatar uri={story.authorProfileImage} name={story.authorDisplayName} size={22} />
                      <Text style={styles.storyCardAuthor} numberOfLines={1}>
                        {story.authorDisplayName}
                      </Text>
                    </View>
                    <View style={styles.storyCardStats}>
                      <Ionicons name="eye-outline" size={12} color="rgba(255,255,255,0.7)" />
                      <Text style={styles.storyCardStat}>{story.viewCount}</Text>
                      <Ionicons name="heart-outline" size={12} color="rgba(255,255,255,0.7)" style={{ marginLeft: 8 }} />
                      <Text style={styles.storyCardStat}>{story.likeCount}</Text>
                      <Text style={styles.storyCardTime}>{timeAgo(story.createdAt)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: 40 }} />
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
          STORY VIEWER MODAL
         ═══════════════════════════════════════════════════════════════════ */}
      <Modal visible={!!viewingStory} animationType="fade" transparent statusBarTranslucent>
        {viewingStory && (
          <View style={styles.viewerContainer}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

            {/* Progress bars */}
            <SafeAreaView edges={['top']} style={styles.viewerTopArea}>
              <View style={styles.progressBarsRow}>
                {authorStories.map((_, i) => (
                  <StoryProgressBar
                    key={i}
                    index={i}
                    currentIndex={storyIndex}
                    total={authorStories.length}
                    progress={storyProgress}
                  />
                ))}
              </View>

              {/* Viewer header */}
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
                <TouchableOpacity
                  style={{ marginLeft: 'auto' }}
                  onPress={closeStoryViewer}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </SafeAreaView>

            {/* Story content area (90%) */}
            <TouchableOpacity
              style={styles.viewerContent}
              activeOpacity={1}
              onPress={(e) => handleTapContent(e.nativeEvent.locationX)}
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
            </TouchableOpacity>

            {/* Bottom reaction bar (10%) */}
            <View style={styles.viewerReactionBar}>
              <View style={styles.reactionBarContent}>
                {/* Author info */}
                <View style={styles.reactionAuthorRow}>
                  <Avatar
                    uri={viewingStory.authorProfileImage}
                    name={viewingStory.authorDisplayName}
                    size={28}
                  />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.reactionAuthorName} numberOfLines={1}>
                      {viewingStory.authorDisplayName}
                    </Text>
                    <Text style={styles.reactionAuthorUsername} numberOfLines={1}>
                      @{viewingStory.authorUsername || 'user'}
                    </Text>
                  </View>
                </View>

                {/* Action buttons */}
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
                    onPress={() => setShowCommentInput(true)}
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
                  <Ionicons name="eye" size={14} color="rgba(255,255,255,0.6)" style={{ marginLeft: 12 }} />
                  <Text style={styles.reactionStatTextMuted}>
                    {viewingStory.viewCount}
                  </Text>
                </View>
              </View>
            </View>

            {/* Comment input overlay */}
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

  /* ── Header ──────────────────────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Highlight Circles ───────────────────────────────────────────────── */
  highlightsSection: {
    paddingVertical: 12,
  },
  highlightsScrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    alignItems: 'flex-start',
  },
  highlightItem: {
    alignItems: 'center',
    width: 68,
  },
  yourStoryRing: {
    width: HIGHLIGHT_SIZE + 4,
    height: HIGHLIGHT_SIZE + 4,
    borderRadius: (HIGHLIGHT_SIZE + 4) / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    bottom: 16,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  highlightLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    maxWidth: 66,
    fontWeight: '500',
  },
  gradientBorderRing: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  highlightAvatarContainer: {
    borderRadius: HIGHLIGHT_SIZE / 2,
    overflow: 'hidden',
  },

  /* ── Category Filter Chips ───────────────────────────────────────────── */
  categoriesScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 4,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    color: '#fff',
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
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  seeAllText: {
    color: colors.accent,
    fontSize: 14,
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
    width: 120,
    alignItems: 'center',
  },
  musicCardCover: {
    width: 100,
    height: 100,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  musicTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 110,
  },
  musicArtist: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    maxWidth: 110,
  },

  /* ── Filters ─────────────────────────────────────────────────────────── */
  filtersScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  filterCard: {
    width: 80,
    height: 80,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: colors.bgInput,
  },
  filterCardGradient: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.8,
  },
  filterLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  /* ── Story Cards Grid ────────────────────────────────────────────────── */
  storyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 10,
  },
  storyCard: {
    width: (SCREEN_W - 34) / 2,
    height: ((SCREEN_W - 34) / 2) * 1.5,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  storyCardBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  storyCardTextBg: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  storyCardText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  storyCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
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
    fontWeight: '700',
    fontSize: 12,
    flex: 1,
  },
  storyCardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 3,
  },
  storyCardStat: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginLeft: 2,
  },
  storyCardTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginLeft: 'auto',
  },

  /* ── Empty State ─────────────────────────────────────────────────────── */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 40,
  },
  emptyText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },

  /* ── Uploading Overlay ───────────────────────────────────────────────── */
  uploadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  uploadingText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STORY VIEWER
     ═══════════════════════════════════════════════════════════════════════ */
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerTopArea: {
    zIndex: 10,
    backgroundColor: 'transparent',
  },

  /* ── Progress Bars ───────────────────────────────────────────────────── */
  progressBarsRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
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

  /* ── Viewer Header ───────────────────────────────────────────────────── */
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewerUsername: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  viewerTimestamp: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },

  /* ── Viewer Content Area (90%) ───────────────────────────────────────── */
  viewerContent: {
    flex: 9,
    backgroundColor: '#000',
  },
  viewerImage: {
    width: '100%',
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
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 36,
  },

  /* ── Viewer Reaction Bar (10%) ───────────────────────────────────────── */
  viewerReactionBar: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  reactionBarContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: 'space-between',
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
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  reactionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  reactionBtn: {
    padding: 4,
  },
  reactionStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionStatText: {
    color: colors.like,
    fontSize: 13,
    fontWeight: '600',
  },
  reactionStatTextMuted: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },

  /* ── Comment Input Overlay ───────────────────────────────────────────── */
  commentInputOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  commentInputWrapper: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  commentInput: {
    color: colors.text,
    fontSize: 14,
    maxHeight: 40,
  },
});
