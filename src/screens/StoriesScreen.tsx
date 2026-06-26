/**
 * StoriesScreen — Minimalist stories feed.
 * Shows recent stories from all users. Clean Instagram-style viewer.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Modal, StatusBar, Dimensions, ActivityIndicator,
  Alert, TextInput, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { firestore, auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { tsToMillis } from '../lib/api';
import { uploadOptimizedImage, copyToSafeCache } from '../utils/imageUpload';
import { useAppStore } from '../stores/app';

const { width: W, height: H } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5s per story

interface Story {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string;
  mediaUrl?: string;
  text?: string;
  gradient?: string[];
  createdAt: number;
  viewed?: boolean;
}

export default function StoriesScreen({ navigation }: any) {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Story[] | null>(null);
  const [viewIdx, setViewIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [comment, setComment] = useState('');
  const progressAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();
  const currentUser = auth()?.currentUser;

  // Fetch stories
  const fetchStories = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('stories')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      const now = Date.now();
      const TTL = 24 * 60 * 60 * 1000;
      const loaded: Story[] = snap.docs
        .map((d: any) => ({ id: d.id, ...d.data(), createdAt: tsToMillis(d.data().createdAt) }))
        .filter((s: Story) => now - s.createdAt < TTL);
      setStories(loaded);
    } catch (e) {
      if (__DEV__) console.warn('Stories fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  // Group by author - one bubble per author, show only their latest
  const authorMap = React.useMemo(() => {
    const map = new Map<string, Story[]>();
    stories.forEach(s => {
      const arr = map.get(s.authorId) || [];
      arr.push(s);
      map.set(s.authorId, arr);
    });
    return map;
  }, [stories]);

  const authors = React.useMemo(() => {
    const seen = new Set<string>();
    const result: Story[] = [];
    // Own story first
    stories.forEach(s => {
      if (s.authorId === currentUser?.uid && !seen.has(s.authorId)) {
        seen.add(s.authorId);
        result.unshift(s);
      }
    });
    // Others
    stories.forEach(s => {
      if (s.authorId !== currentUser?.uid && !seen.has(s.authorId)) {
        seen.add(s.authorId);
        result.push(s);
      }
    });
    return result;
  }, [stories, currentUser?.uid]);

  // Story viewer timer
  const startProgress = useCallback(() => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) goNext();
    });
  }, [progressAnim]);

  const goNext = useCallback(() => {
    if (!viewing) return;
    if (viewIdx < viewing.length - 1) {
      setViewIdx(i => i + 1);
    } else {
      closeViewer();
    }
  }, [viewing, viewIdx]);

  const goPrev = useCallback(() => {
    if (viewIdx > 0) setViewIdx(i => i - 1);
  }, [viewIdx]);

  const openViewer = useCallback((authorStories: Story[]) => {
    setViewing(authorStories);
    setViewIdx(0);
    setComment('');
  }, []);

  const closeViewer = useCallback(() => {
    progressAnim.stopAnimation();
    setViewing(null);
    setViewIdx(0);
  }, [progressAnim]);

  useEffect(() => {
    if (viewing) {
      progressAnim.stopAnimation();
      startProgress();
    }
  }, [viewing, viewIdx]);

  // Upload story
  const handleAddStory = useCallback(async () => {
    if (!currentUser) { Alert.alert('Sign in required'); return; }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const uri = result.assets[0].uri;
      const safe = await copyToSafeCache(uri).catch(() => uri);
      const { downloadUrl } = await uploadOptimizedImage(safe, `stories/${currentUser.uid}/${Date.now()}.jpg`, { mimeType: 'image/jpeg' });
      await firestore().collection('stories').add({
        authorId: currentUser.uid,
        authorUsername: user?.username || '',
        authorDisplayName: user?.displayName || 'User',
        authorProfileImage: user?.profileImage || '',
        mediaUrl: downloadUrl,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
      await fetchStories();
      Alert.alert('Story posted', 'Your story is live for 24 hours.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not post story');
    } finally {
      setUploading(false);
    }
  }, [currentUser, user, fetchStories]);

  // Render story bubble
  const renderBubble = useCallback(({ item }: { item: Story }) => {
    const isOwn = item.authorId === currentUser?.uid;
    const authorStories = authorMap.get(item.authorId) || [item];
    return (
      <TouchableOpacity
        style={styles.bubble}
        onPress={() => openViewer(authorStories)}
        activeOpacity={0.8}
      >
        <View style={styles.ringOuter}>
          <View style={styles.ringInner}>
            <Avatar uri={item.authorProfileImage} name={item.authorDisplayName} size={56} />
          </View>
        </View>
        <Text style={styles.bubbleName} numberOfLines={1}>
          {isOwn ? 'Your story' : item.authorDisplayName.split(' ')[0]}
        </Text>
      </TouchableOpacity>
    );
  }, [currentUser?.uid, authorMap, openViewer]);

  const currentStory = viewing?.[viewIdx];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Stories</Text>
          <TouchableOpacity onPress={handleAddStory} disabled={uploading} hitSlop={12}>
            {uploading
              ? <ActivityIndicator color={colors.accent} size="small" />
              : <Feather name="plus" size={22} color={colors.accent} />
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : authors.length === 0 ? (
        <View style={styles.center}>
          <Feather name="camera" size={48} color="rgba(255,255,255,0.12)" />
          <Text style={styles.emptyTitle}>No stories yet</Text>
          <Text style={styles.emptySubtitle}>Tap + to share your first story</Text>
          <TouchableOpacity style={styles.addBtn} onPress={handleAddStory}>
            <Text style={styles.addBtnText}>Add Story</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={authors}
          renderItem={renderBubble}
          keyExtractor={i => i.authorId}
          horizontal={false}
          numColumns={4}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Story Viewer Modal */}
      <Modal visible={!!viewing} animationType="fade" statusBarTranslucent>
        {currentStory && (
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <StatusBar hidden />

            {/* Progress bars */}
            <View style={[styles.progressRow, { paddingTop: insets.top + 8 }]}>
              {viewing!.map((_, i) => (
                <View key={i} style={styles.progressTrack}>
                  <Animated.View style={[
                    styles.progressFill,
                    {
                      width: i < viewIdx ? '100%'
                        : i === viewIdx
                          ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                          : '0%'
                    }
                  ]} />
                </View>
              ))}
            </View>

            {/* Author row */}
            <View style={styles.viewerHeader}>
              <TouchableOpacity
                style={styles.viewerAuthor}
                onPress={() => {
                  closeViewer();
                  navigation.navigate('UserProfile', { userId: currentStory.authorId });
                }}
              >
                <Avatar uri={currentStory.authorProfileImage} name={currentStory.authorDisplayName} size={36} />
                <View>
                  <Text style={styles.viewerName}>{currentStory.authorDisplayName}</Text>
                  <Text style={styles.viewerTime}>{timeAgo(currentStory.createdAt)}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={closeViewer} hitSlop={12}>
                <Feather name="x" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Media */}
            <View style={styles.viewerMedia}>
              {currentStory.mediaUrl ? (
                <Image
                  source={{ uri: currentStory.mediaUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
                  <Text style={styles.viewerText}>{currentStory.text}</Text>
                </View>
              )}

              {/* Tap zones */}
              <View style={styles.tapZones}>
                <TouchableOpacity style={{ flex: 1 }} onPress={goPrev} />
                <TouchableOpacity style={{ flex: 1 }} onPress={goNext} />
              </View>
            </View>

            {/* Comment input */}
            <View style={[styles.commentRow, { paddingBottom: insets.bottom + 8 }]}>
              <TextInput
                style={styles.commentInput}
                value={comment}
                onChangeText={setComment}
                placeholder="Reply..."
                placeholderTextColor="rgba(255,255,255,0.35)"
                returnKeyType="send"
                onSubmitEditing={async () => {
                  if (!comment.trim() || !currentUser) return;
                  try {
                    await firestore().collection('story_comments')
                      .doc(`${currentStory.id}_${currentUser.uid}_${Date.now()}`)
                      .set({
                        storyId: currentStory.id,
                        authorId: currentUser.uid,
                        text: comment.trim(),
                        createdAt: firestore.FieldValue.serverTimestamp(),
                      });
                    setComment('');
                  } catch {}
                }}
              />
              <TouchableOpacity hitSlop={8}>
                <Feather name="heart" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  addBtn: {
    marginTop: 16, backgroundColor: colors.accent,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24,
  },
  addBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  grid: { padding: 12 },
  bubble: { flex: 1, alignItems: 'center', padding: 8, maxWidth: W / 4 },
  ringOuter: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 2, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  ringInner: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, borderColor: '#000',
    overflow: 'hidden',
  },
  bubbleName: { fontSize: 11, color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 70 },

  // Viewer
  progressRow: { flexDirection: 'row', paddingHorizontal: 8, gap: 4, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  progressTrack: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 1 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, paddingTop: 60, zIndex: 5 },
  viewerAuthor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewerName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  viewerTime: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  viewerMedia: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  tapZones: { flexDirection: 'row', ...StyleSheet.absoluteFillObject },
  viewerText: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', lineHeight: 32 },
  commentRow: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  commentInput: {
    flex: 1, height: 44, borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16, color: '#fff', fontSize: 14,
  },
});
