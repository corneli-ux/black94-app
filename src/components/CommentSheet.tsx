/**
 * CommentSheet.tsx — Bottom sheet modal for post comments
 *
 * Features:
 *  - Photo / Camera / GIF / Emoji replies
 *  - Image preview strip for attached media
 *  - Inline emoji picker with 4 categories
 *  - Slide-up animation via Animated.Value
 *  - Keyboard-avoiding input bar
 *  - Direct Firestore writes with imageUrls support
 *  - Optimistic comment insertion
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  ScrollView,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, tsToMillis } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { uploadFile, getFilePath } from '../lib/storage';
import { firestore } from '../lib/firebase';
import {
  ReplyIcon,
  RepostIcon,
  HeartIcon,
  BookmarkIcon,
  ShareIcon,
  ChartIcon,
  ImageIcon,
  GIFIcon,
  EmojiIcon,
  CameraIcon,
} from '../components/Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   LAZY LOAD — expo-image-picker
   ═══════════════════════════════════════════════════════════════════════════ */

let launchImageLibraryAsync: any = null;
let launchCameraAsync: any = null;

try {
  const imagePicker = require('expo-image-picker');
  launchImageLibraryAsync = imagePicker.launchImageLibrary;
  launchCameraAsync = imagePicker.launchCamera;
} catch {
  /* expo-image-picker not installed — media buttons will be no-ops */
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_H * 0.85;

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    icon: '😊',
    emojis: [
      '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊',
      '😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗',
      '🤩','🤔','🤨','😐','😑','😶','😏','😒','🙄','😬',
      '😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥',
      '😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱',
      '😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡',
      '👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻',
      '😼','😽','🙀','😿','😾','🙈','🙉','🙊',
    ],
  },
  {
    name: 'Gestures',
    icon: '👋',
    emojis: [
      '👋','🤚','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟',
      '🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎',
      '✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
      '✍️','💅','🤳','💪',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❣️','💕','💞','💓','💗','💖','💘','💝','💟',
    ],
  },
  {
    name: 'Objects',
    icon: '🎉',
    emojis: [
      '🔥','⭐','🌟','💫','✨','⚡','🎉','🎊','🎈','🎁',
      '🏆','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🎾','🎮',
      '🎯','🎵','🎶','📱','💻','🧠','💡','✅','❌','⚡',
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface ExtendedCommentData extends CommentData {
  imageUrls?: string[];
}

interface CommentSheetProps {
  visible: boolean;
  onClose: () => void;
  postId: string;
  postCaption?: string;
  onCommentSent?: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CommentSheet({
  visible,
  onClose,
  postId,
  postCaption,
  onCommentSent,
}: CommentSheetProps) {
  const { user } = useAppStore();
  const navigation = useNavigation();

  /* ── State ─────────────────────────────────────────────────────────────── */

  const [internalVisible, setInternalVisible] = useState(false);
  const [comments, setComments] = useState<ExtendedCommentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<string[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    username: string;
    displayName: string;
  } | null>(null);

  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});

  /* ── Refs ──────────────────────────────────────────────────────────────── */

  const slideAnim = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const canSend = text.trim().length > 0 || attachedMedia.length > 0;
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_HEIGHT, 0],
  });

  /* ═══════════════════════════════════════════════════════════════════════
     SLIDE ANIMATION
     ═══════════════════════════════════════════════════════════════════════ */

  useEffect(() => {
    if (visible) {
      setInternalVisible(true);
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (internalVisible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setInternalVisible(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* ═══════════════════════════════════════════════════════════════════════
     FETCH COMMENTS (direct Firestore — preserves imageUrls)
     ═══════════════════════════════════════════════════════════════════════ */

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await (firestore() as any)
        .collection('post_comments')
        .where('postId', '==', postId)
        .limit(50)
        .get();

      const results: ExtendedCommentData[] = (snapshot.docs || []).map(
        (docSnap: any) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            postId: data.postId || '',
            authorId: data.authorId || '',
            authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '',
            authorProfileImage: data.authorProfileImage || '',
            authorIsVerified: data.authorIsVerified || false,
            authorBadge: data.authorBadge || '',
            content: data.content || '',
            createdAt: tsToMillis(data.createdAt),
            imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : undefined,
          };
        },
      );

      results.sort((a, b) => a.createdAt - b.createdAt);
      setComments(results);
    } catch (e) {
      console.error('[CommentSheet] Failed to fetch comments:', e);
      setComments([]);
    }
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    if (visible) loadComments();
  }, [visible, loadComments]);

  /* ═══════════════════════════════════════════════════════════════════════
     SEND COMMENT
     ═══════════════════════════════════════════════════════════════════════ */

  const handleSend = useCallback(async () => {
    const trimmedText = text.trim();
    if ((!trimmedText && attachedMedia.length === 0) || sending || !user) return;

    setSending(true);
    Keyboard.dismiss();
    setShowEmojiPicker(false);

    try {
      /* Upload local media to Firebase Storage; keep remote URLs as-is (GIFs) */
      const imageUrls: string[] = [];
      for (const media of attachedMedia) {
        if (media.startsWith('http://') || media.startsWith('https://')) {
          imageUrls.push(media);
        } else {
          const ext = media.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
          const filename = `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filePath = getFilePath('comments', filename, user.id);
          const downloadUrl = await uploadFile(media, filePath);
          imageUrls.push(downloadUrl);
        }
      }

      /* Optimistic comment */
      const optimistic: ExtendedCommentData = {
        id: `temp_${Date.now()}`,
        postId,
        authorId: user.id,
        authorUsername: user.username || '',
        authorDisplayName: user.displayName || '',
        authorProfileImage: user.profileImage || '',
        authorIsVerified: user.isVerified || false,
        authorBadge: user.badge || '',
        content: trimmedText,
        createdAt: Date.now(),
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      };

      setComments((prev) => [...prev, optimistic]);
      setText('');
      setAttachedMedia([]);
      setReplyingTo(null);

      /* Write to Firestore with imageUrls */
      const { id: docId } = await (firestore() as any)
        .collection('post_comments')
        .add({
          postId,
          authorId: user.id,
          authorUsername: user.username || '',
          authorDisplayName: user.displayName || '',
          authorProfileImage: user.profileImage || '',
          authorIsVerified: user.isVerified || false,
          authorBadge: user.badge || '',
          content: trimmedText,
          imageUrls: imageUrls.length > 0 ? imageUrls : [],
          createdAt: (firestore as any).FieldValue.serverTimestamp(),
        });

      /* Increment comment count on parent post */
      try {
        await (firestore() as any)
          .collection('posts')
          .doc(postId)
          .update({ commentCount: (firestore as any).FieldValue.increment(1) });
      } catch (e) {
        console.warn('[CommentSheet] Failed to increment commentCount:', e);
      }

      /* Replace optimistic entry with server ID */
      setComments((prev) =>
        prev.map((c) => (c.id === optimistic.id ? { ...optimistic, id: docId } : c)),
      );

      onCommentSent?.();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('[CommentSheet] Failed to send comment:', error);
      setComments((prev) => prev.filter((c) => !c.id.startsWith('temp_')));
    } finally {
      setSending(false);
    }
  }, [text, attachedMedia, sending, user, postId, onCommentSent]);

  /* ═══════════════════════════════════════════════════════════════════════
     IMAGE / CAMERA PICKERS
     ═══════════════════════════════════════════════════════════════════════ */

  const pickImage = useCallback(async () => {
    if (!launchImageLibraryAsync) return;
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: 'Images',
        quality: 0.8,
        allowsMultipleSelection: true,
      });
      if (!result.canceled && result.assets?.length) {
        const uris = result.assets.map((a: any) => a.uri);
        setAttachedMedia((prev) => [...prev, ...uris]);
      }
    } catch (e) {
      console.error('[CommentSheet] Image picker error:', e);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    if (!launchCameraAsync) return;
    try {
      const result = await launchCameraAsync({
        mediaTypes: 'Images',
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setAttachedMedia((prev) => [...prev, result.assets[0].uri]);
      }
    } catch (e) {
      console.error('[CommentSheet] Camera error:', e);
    }
  }, []);

  const removeMedia = useCallback((index: number) => {
    setAttachedMedia((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════
     GIF PICKER
     ═══════════════════════════════════════════════════════════════════════ */

  const handleGif = useCallback(() => {
    setShowEmojiPicker(false);
    Keyboard.dismiss();
    try {
      (navigation as any).navigate('GifPicker', {
        onSelect: (gifUrl: string) => {
          setAttachedMedia((prev) => [...prev, gifUrl]);
        },
      });
    } catch {
      console.warn('[CommentSheet] GIF navigation not available');
    }
  }, [navigation]);

  /* ═══════════════════════════════════════════════════════════════════════
     EMOJI PICKER
     ═══════════════════════════════════════════════════════════════════════ */

  const toggleEmojiPicker = useCallback(() => {
    if (showEmojiPicker) {
      setShowEmojiPicker(false);
    } else {
      Keyboard.dismiss();
      setShowEmojiPicker(true);
    }
  }, [showEmojiPicker]);

  const addEmoji = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════
     REPLY-TO
     ═══════════════════════════════════════════════════════════════════════ */

  const handleReply = useCallback((comment: ExtendedCommentData) => {
    setReplyingTo({
      id: comment.authorId,
      username: comment.authorUsername,
      displayName: comment.authorDisplayName || comment.authorUsername,
    });
    inputRef.current?.focus();
  }, []);

  const cancelReply = useCallback(() => setReplyingTo(null), []);

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER — Comment Item
     ═══════════════════════════════════════════════════════════════════════ */

  const renderComment = useCallback(
    ({ item }: { item: ExtendedCommentData }) => {
      const isLiked = !!likeMap[item.id];
      const isReposted = !!repostMap[item.id];
      const isBookmarked = !!bookmarkMap[item.id];

      return (
        <View style={styles.commentRow}>
          <Avatar
            uri={item.authorProfileImage || null}
            name={item.authorDisplayName || item.authorUsername}
            size={36}
          />

          <View style={styles.commentBody}>
            {/* Name row */}
            <View style={styles.commentHeader}>
              <View style={styles.commentNameRow}>
                <Text style={styles.commentName}>
                  {item.authorDisplayName || item.authorUsername}
                </Text>
                <VerifiedBadge
                  badge={item.authorBadge}
                  isVerified={item.authorIsVerified}
                  size={14}
                />
              </View>
              <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
              <Text style={styles.commentTime}>· {timeAgo(item.createdAt)}</Text>
            </View>

            {/* Text content */}
            {item.content ? (
              <Text style={styles.commentContent}>{item.content}</Text>
            ) : null}

            {/* Attached images */}
            {item.imageUrls && item.imageUrls.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.commentImagesStrip}
              >
                {item.imageUrls.map((uri, idx) => (
                  <Image
                    key={`${uri}-${idx}`}
                    source={{ uri }}
                    style={styles.commentImageThumb}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            ) : null}

            {/* Action buttons */}
            <View style={styles.commentActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleReply(item)}
                activeOpacity={0.6}
              >
                <ReplyIcon size={18} color={colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() =>
                  setRepostMap((p) => ({ ...p, [item.id]: !p[item.id] }))
                }
                activeOpacity={0.6}
              >
                <RepostIcon
                  size={18}
                  color={isReposted ? colors.repost : colors.textSecondary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() =>
                  setLikeMap((p) => ({ ...p, [item.id]: !p[item.id] }))
                }
                activeOpacity={0.6}
              >
                <HeartIcon
                  size={18}
                  color={isLiked ? colors.like : colors.textSecondary}
                  filled={isLiked}
                />
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} disabled>
                <ChartIcon size={18} color={colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() =>
                  setBookmarkMap((p) => ({ ...p, [item.id]: !p[item.id] }))
                }
                activeOpacity={0.6}
              >
                <BookmarkIcon
                  size={18}
                  color={isBookmarked ? colors.white : colors.textSecondary}
                  filled={isBookmarked}
                />
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.6}>
                <ShareIcon size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    },
    [likeMap, repostMap, bookmarkMap, handleReply],
  );

  const commentKeyExtractor = useCallback(
    (item: ExtendedCommentData) => item.id,
    [],
  );

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER — Emoji Grid
     ═══════════════════════════════════════════════════════════════════════ */

  const renderEmojiGrid = useCallback(() => {
    const category = EMOJI_CATEGORIES[activeEmojiCategory];
    if (!category) return null;

    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.emojiGridScroll}
      >
        <View style={styles.emojiGrid}>
          {category.emojis.map((emoji, idx) => (
            <TouchableOpacity
              key={`${emoji}-${idx}`}
              style={styles.emojiButton}
              onPress={() => addEmoji(emoji)}
              activeOpacity={0.6}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }, [activeEmojiCategory, addEmoji]);

  /* ═══════════════════════════════════════════════════════════════════════
     MAIN RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  if (!internalVisible) return null;

  return (
    <Modal
      visible={internalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Tappable backdrop to dismiss */}
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />

        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            {/* ─── Drag handle ─────────────────────────────────────────── */}
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>

            {/* ─── Header ──────────────────────────────────────────────── */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.6}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Post</Text>
              <View style={styles.headerSpacer} />
            </View>

            {/* ─── Post caption preview ─────────────────────────────────── */}
            {postCaption ? (
              <View style={styles.preview}>
                <Text style={styles.previewCaption} numberOfLines={2}>
                  {postCaption}
                </Text>
              </View>
            ) : null}

            {/* ─── Comments list ───────────────────────────────────────── */}
            <FlatList
              ref={listRef}
              style={styles.list}
              contentContainerStyle={
                comments.length === 0 && !loading ? styles.emptyList : undefined
              }
              data={comments}
              keyExtractor={commentKeyExtractor}
              renderItem={renderComment}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                loading ? (
                  <View style={styles.emptyWrap}>
                    <ActivityIndicator color={colors.textSecondary} size="small" />
                  </View>
                ) : (
                  <View style={styles.emptyWrap}>
                    <ReplyIcon size={40} color={colors.textTertiary} />
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptySub}>
                      Be the first to share your thoughts.
                    </Text>
                  </View>
                )
              }
            />

            {/* ─── Replying-to indicator ───────────────────────────────── */}
            {replyingTo ? (
              <View style={styles.replyingBar}>
                <Text style={styles.replyingBarText}>
                  Replying to{' '}
                  <Text style={styles.replyingBarName}>@{replyingTo.username}</Text>
                </Text>
                <TouchableOpacity onPress={cancelReply} hitSlop={8} activeOpacity={0.6}>
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* ─── Attached media preview strip ────────────────────────── */}
            {attachedMedia.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.mediaPreviewStrip}
              >
                {attachedMedia.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.mediaPreviewThumb}>
                    <Image
                      source={{ uri }}
                      style={styles.mediaPreviewImage}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.mediaRemoveBtn}
                      onPress={() => removeMedia(index)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {/* ─── Emoji picker ────────────────────────────────────────── */}
            {showEmojiPicker ? (
              <View style={styles.emojiPickerContainer}>
                {/* Category tabs */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.emojiCategoryTabs}
                >
                  {EMOJI_CATEGORIES.map((cat, idx) => (
                    <TouchableOpacity
                      key={cat.name}
                      style={[
                        styles.emojiCategoryTab,
                        idx === activeEmojiCategory && styles.emojiCategoryTabActive,
                      ]}
                      onPress={() => setActiveEmojiCategory(idx)}
                      activeOpacity={0.6}
                    >
                      <Text
                        style={[
                          styles.emojiCategoryTabText,
                          idx === activeEmojiCategory && styles.emojiCategoryTabTextActive,
                        ]}
                      >
                        {cat.icon} {cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Emoji grid */}
                {renderEmojiGrid()}
              </View>
            ) : null}

            {/* ─── Media toolbar ───────────────────────────────────────── */}
            <View style={styles.mediaToolbar}>
              <TouchableOpacity
                style={styles.mediaToolbarBtn}
                onPress={pickImage}
                activeOpacity={0.6}
              >
                <ImageIcon size={20} color={colors.accent} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.mediaToolbarBtn}
                onPress={takePhoto}
                activeOpacity={0.6}
              >
                <CameraIcon size={20} color={colors.accentGreen} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.mediaToolbarBtn}
                onPress={handleGif}
                activeOpacity={0.6}
              >
                <GIFIcon size={20} color={colors.accentGold} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.mediaToolbarBtn,
                  showEmojiPicker && styles.mediaToolbarBtnActive,
                ]}
                onPress={toggleEmojiPicker}
                activeOpacity={0.6}
              >
                <EmojiIcon size={20} color={colors.accent} />
              </TouchableOpacity>
            </View>

            {/* ─── Input bar ───────────────────────────────────────────── */}
            <SafeAreaView edges={['bottom']}>
              <View style={styles.inputBar}>
                <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />

                <View style={styles.inputWrap}>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder={
                      replyingTo
                        ? `Reply to @${replyingTo.username}...`
                        : 'Add a comment...'
                    }
                    placeholderTextColor={colors.textMuted}
                    value={text}
                    onChangeText={setText}
                    onFocus={() => setShowEmojiPicker(false)}
                    multiline
                    maxLength={500}
                    editable={!sending}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
                  onPress={handleSend}
                  disabled={!canSend || sending}
                  activeOpacity={0.7}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Ionicons
                      name="send"
                      size={18}
                      color={canSend ? '#000' : colors.textMuted}
                    />
                  )}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const styles = StyleSheet.create({
  /* ── Backdrop ──────────────────────────────────────────────────────────── */
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { flex: 1 },

  /* ── Sheet ─────────────────────────────────────────────────────────────── */
  sheetContainer: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#000000',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SHEET_HEIGHT,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  /* ── Handle ────────────────────────────────────────────────────────────── */
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  /* ── Header ────────────────────────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
    fontFamily: 'Inter-Bold',
  },
  headerSpacer: { width: 22 },

  /* ── Post caption preview ──────────────────────────────────────────────── */
  preview: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  previewCaption: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter-Regular',
  },

  /* ── Comments list ─────────────────────────────────────────────────────── */
  list: { flex: 1 },
  emptyList: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    fontFamily: 'Inter-Bold',
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
    fontFamily: 'Inter-Regular',
  },

  /* ── Comment row ───────────────────────────────────────────────────────── */
  commentRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  commentBody: { flex: 1 },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  commentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  commentName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: 'Inter-Bold',
  },
  commentHandle: {
    color: colors.textMuted,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  commentTime: {
    color: colors.textMuted,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  commentContent: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
    fontFamily: 'Inter-Regular',
  },

  /* ── Comment images ────────────────────────────────────────────────────── */
  commentImagesStrip: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  commentImageThumb: {
    width: 160,
    height: 120,
    borderRadius: 12,
  },

  /* ── Comment action buttons (6 across) ─────────────────────────────────── */
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    justifyContent: 'space-between',
    maxWidth: 440,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Replying-to bar ───────────────────────────────────────────────────── */
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  replyingBarText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  replyingBarName: {
    color: colors.text,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },

  /* ── Media preview strip (input area) ──────────────────────────────────── */
  mediaPreviewStrip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  mediaPreviewThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    marginRight: 8,
    overflow: 'hidden',
  },
  mediaPreviewImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  mediaRemoveBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Emoji picker ──────────────────────────────────────────────────────── */
  emojiPickerContainer: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
    maxHeight: 260,
  },
  emojiCategoryTabs: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  emojiCategoryTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 4,
  },
  emojiCategoryTabActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  emojiCategoryTabText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: 'Inter-Regular',
  },
  emojiCategoryTabTextActive: {
    color: '#ffffff',
    fontWeight: '600',
    fontFamily: 'Inter-Bold',
  },
  emojiGridScroll: {
    maxHeight: 200,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  emojiButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  emojiText: {
    fontSize: 24,
  },

  /* ── Media toolbar (Image / Camera / GIF / Emoji) ──────────────────────── */
  mediaToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingBottom: 4,
    backgroundColor: '#000000',
  },
  mediaToolbarBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  mediaToolbarBtnActive: {
    backgroundColor: 'rgba(42,127,255,0.15)',
  },

  /* ── Input bar ─────────────────────────────────────────────────────────── */
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    maxHeight: 100,
    justifyContent: 'center',
  },
  input: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 80,
    fontFamily: 'Inter-Regular',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
