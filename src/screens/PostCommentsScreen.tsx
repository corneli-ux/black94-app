import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image as RNImage,
  ScrollView, Dimensions,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import {
  ReplyIcon, RepostIcon, HeartIcon, BookmarkIcon, ShareIcon,
  ChartIcon, ImageIcon, GIFIcon, EmojiIcon, CameraIcon, formatCount,
} from '../components/Icons';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { CommentData, fetchPostComments, addPostComment } from '../lib/api';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { uploadFile, getFilePath } from '../lib/storage';
import { useAppStore } from '../stores/app';
import { timeAgo } from '../utils/timeAgo';

/* ═══════════════════════════════════════════════════════════════════════════
   EMOJI DATA
   ═══════════════════════════════════════════════════════════════════════════ */

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

interface AttachedImage {
  uri: string;
  localUri: string;
}

interface PostCommentsScreenProps {
  route?: any;
  navigation?: any;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PostCommentsScreen({ route, navigation }: PostCommentsScreenProps) {
  const { postId, postCaption, postAuthorUsername, postAuthorDisplayName } = route?.params || {};
  const { user } = useAppStore();
  const currentUser = auth()?.currentUser;
  const insets = useSafeAreaInsets();

  /* ── State ── */
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    username: string;
    displayName: string;
  } | null>(null);
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [postData, setPostData] = useState<any>(null);

  // Media attachments
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Emoji picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const emojiScrollViewRef = useRef<ScrollView>(null);

  // GIF picker
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [selectedGif, setSelectedGif] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  /* ── Fetch post data ── */
  useEffect(() => {
    if (postId) {
      firestore()
        .collection('posts')
        .doc(postId)
        .get()
        .then((docSnap: any) => {
          if (docSnap.exists) {
            setPostData(docSnap.data());
          }
        })
        .catch(() => {});
    }
  }, [postId]);

  /* ── Fetch comments ── */
  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  /* ── Default replying to post author ── */
  useEffect(() => {
    if (postAuthorUsername) {
      setReplyingTo({
        id: '',
        username: postAuthorUsername,
        displayName: postAuthorDisplayName || postAuthorUsername,
      });
    }
  }, [postAuthorUsername, postAuthorDisplayName]);

  /* ── Lazy-loaded image picker ── */
  const pickImage = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images' as any],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 4,
      });
      if (!result.canceled && result.assets) {
        const newImages: AttachedImage[] = result.assets.map((asset: any) => ({
          uri: asset.uri,
          localUri: asset.uri,
        }));
        setAttachedImages((prev: AttachedImage[]) => {
          const combined = [...prev, ...newImages];
          return combined.slice(0, 4); // Max 4 images
        });
      }
    } catch (e) {
      console.warn('[Comments] Image picker not available:', e);
    }
  };

  /* ── Lazy-loaded camera ── */
  const takePhoto = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images' as any],
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        setAttachedImages((prev: AttachedImage[]) => {
          const combined = [...prev, { uri: result.assets![0].uri, localUri: result.assets![0].uri }];
          return combined.slice(0, 4);
        });
      }
    } catch (e) {
      console.warn('[Comments] Camera not available:', e);
    }
  };

  /* ── Remove attached image ── */
  const removeImage = (index: number) => {
    setAttachedImages((prev: AttachedImage[]) => prev.filter((_: AttachedImage, i: number) => i !== index));
  };

  /* ── Toggle GIF ── */
  const handleGifSelect = (gifUrl: string) => {
    if (selectedGif === gifUrl) {
      setSelectedGif(null);
    } else {
      setSelectedGif(gifUrl);
    }
  };

  /* ── Add emoji to text ── */
  const addEmoji = (emoji: string) => {
    setText((prev: string) => prev + emoji);
    inputRef.current?.focus();
  };

  /* ── Check if comment has content ── */
  const hasContent = text.trim().length > 0 || attachedImages.length > 0 || !!selectedGif;

  /* ── Upload attached images ── */
  const uploadAttachedImages = async (): Promise<string[]> => {
    const uid = user?.id || currentUser?.uid || 'anon';
    const urls: string[] = [];
    for (const img of attachedImages) {
      const filename = img.uri.split('/').pop() || `photo_${Date.now()}.jpg`;
      const path = getFilePath('comments', filename, uid);
      try {
        const url = await uploadFile(img.uri, path);
        urls.push(url);
      } catch (e) {
        console.warn('[Comments] Image upload failed:', e);
      }
    }
    return urls;
  };

  /* ── Send comment ── */
  const handleSend = async () => {
    if (!hasContent || sending) return;
    setSending(true);

    // Build content with media info
    let contentText = text.trim();
    const mediaUrls: string[] = [];

    // Upload images if any
    if (attachedImages.length > 0) {
      setUploadingMedia(true);
      const urls = await uploadAttachedImages();
      mediaUrls.push(...urls);
      setUploadingMedia(false);
    }

    // Append GIF URL if selected
    if (selectedGif) {
      contentText = contentText ? `${contentText} ${selectedGif}` : selectedGif;
    }

    // If images were uploaded, append URLs
    if (mediaUrls.length > 0) {
      contentText = contentText ? `${contentText} ${mediaUrls.join(' ')}` : mediaUrls.join(' ');
    }

    if (!contentText) {
      setSending(false);
      return;
    }

    const optimistic: CommentData = {
      id: `temp_${Date.now()}`,
      postId,
      authorId: user?.id || currentUser?.uid || '',
      authorUsername: user?.username || '',
      authorDisplayName: user?.displayName || '',
      authorProfileImage: user?.profileImage || '',
      authorIsVerified: user?.isVerified || false,
      authorBadge: user?.badge || '',
      content: contentText,
      createdAt: Date.now(),
    };

    setComments((prev: CommentData[]) => [...prev, optimistic]);
    setText('');
    setAttachedImages([]);
    setSelectedGif(null);
    setShowEmojiPicker(false);
    setShowGifPicker(false);

    try {
      const real = await addPostComment(postId, contentText);
      if (real) {
        setComments((prev: CommentData[]) => prev.map((c: CommentData) => (c.id === optimistic.id ? real : c)));
      } else {
        setComments((prev: CommentData[]) => prev.filter((c: CommentData) => c.id !== optimistic.id));
      }
    } catch {
      setComments((prev: CommentData[]) => prev.filter((c: CommentData) => c.id !== optimistic.id));
    }

    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  /* ── Derived ── */
  const fullCaption = postData?.caption || postCaption || '';
  const needsSeeMore = fullCaption.length > 140;

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER: Comment
     ══════════════════════════════════════════════════════════════════════════ */

  const renderComment = ({ item }: { item: CommentData }) => {
    const isLiked = likeMap[item.id] || false;
    const isReposted = repostMap[item.id] || false;
    const isBookmarked = bookmarkMap[item.id] || false;

    // Check if comment has image URLs in content
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urlsInContent = item.content.match(urlRegex) || [];
    const textContent = item.content.replace(urlRegex, '').trim();
    const hasImages = urlsInContent.some((u) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(u));
    const imageUrls = urlsInContent.filter((u) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(u));
    const hasGif = urlsInContent.some((u) => /\.gif/i.test(u) && u.includes('giphy'));
    const gifUrl = urlsInContent.find((u) => u.includes('giphy'));

    return (
      <View style={styles.commentRow}>
        <Avatar
          uri={item.authorProfileImage || null}
          name={item.authorDisplayName || item.authorUsername}
          size={40}
        />
        <View style={styles.commentBody}>
          {/* Header: name + handle + time */}
          <View style={styles.commentHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.commentName} numberOfLines={1}>
                {item.authorDisplayName || item.authorUsername}
              </Text>
              <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={14} />
              <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
              <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
            </View>
          </View>

          {/* Content text */}
          {textContent ? (
            <Text style={styles.commentContent}>{textContent}</Text>
          ) : null}

          {/* Attached images */}
          {imageUrls.length > 0 && (
            <View style={styles.commentMediaRow}>
              {imageUrls.map((url, idx) => (
                <RNImage
                  key={idx}
                  source={{ uri: url }}
                  style={styles.commentMediaImage}
                  resizeMode="cover"
                />
              ))}
            </View>
          )}

          {/* GIF */}
          {gifUrl && (
            <RNImage
              source={{ uri: gifUrl }}
              style={styles.commentGif}
              resizeMode="cover"
            />
          )}

          {/* Action bar — improved padding & alignment */}
          <View style={styles.commentActions}>
            <TouchableOpacity
              style={styles.commentActionBtn}
              onPress={() => {
                setReplyingTo({
                  id: item.authorId,
                  username: item.authorUsername,
                  displayName: item.authorDisplayName || item.authorUsername,
                });
                inputRef.current?.focus();
              }}
            >
              <View style={styles.actionIconWrap}>
                <ReplyIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.commentActionBtn}
              onPress={() => setRepostMap((prev: Record<string, boolean>) => ({ ...prev, [item.id]: !prev[item.id] }))}
            >
              <View style={styles.actionIconWrap}>
                <RepostIcon size={18} color={isReposted ? colors.repost : '#94a3b8'} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.commentActionBtn}
              onPress={() => setLikeMap((prev: Record<string, boolean>) => ({ ...prev, [item.id]: !prev[item.id] }))}
            >
              <View style={styles.actionIconWrap}>
                <HeartIcon size={18} color={isLiked ? colors.like : '#94a3b8'} filled={isLiked} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <ChartIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <View style={styles.actionPair}>
              <TouchableOpacity
                style={styles.commentActionBtn}
                onPress={() => setBookmarkMap((prev: Record<string, boolean>) => ({ ...prev, [item.id]: !prev[item.id] }))}
              >
                <View style={styles.actionIconWrap}>
                  <BookmarkIcon
                    size={18}
                    color={isBookmarked ? colors.white : '#94a3b8'}
                    filled={isBookmarked}
                  />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.commentActionBtn}>
                <View style={styles.actionIconWrap}>
                  <ShareIcon size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER: Emoji Picker
     ══════════════════════════════════════════════════════════════════════════ */

  const renderEmojiPicker = () => {
    if (!showEmojiPicker) return null;
    const category = EMOJI_CATEGORIES[activeEmojiCategory];
    const { width: screenWidth } = Dimensions.get('window');
    const emojiSize = 44;
    const emojisPerRow = Math.floor((screenWidth - 32) / emojiSize);

    return (
      <View style={styles.emojiPickerContainer}>
        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.emojiCategoryTabs}
        >
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <TouchableOpacity
              key={cat.name}
              style={[
                styles.emojiCategoryTab,
                activeEmojiCategory === idx && styles.emojiCategoryTabActive,
              ]}
              onPress={() => {
                setActiveEmojiCategory(idx);
              }}
            >
              <Text style={styles.emojiCategoryIcon}>{cat.icon}</Text>
              <Text
                style={[
                  styles.emojiCategoryName,
                  activeEmojiCategory === idx && styles.emojiCategoryNameActive,
                ]}
              >
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Emoji grid */}
        <ScrollView
          ref={emojiScrollViewRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.emojiGrid}
          keyboardShouldPersistTaps="handled"
          bounces={true}
        >
          {Array.from({ length: Math.ceil(category.emojis.length / emojisPerRow) }).map((_, rowIdx) => {
            const rowEmojis = category.emojis.slice(
              rowIdx * emojisPerRow,
              rowIdx * emojisPerRow + emojisPerRow,
            );
            return (
              <View key={rowIdx} style={styles.emojiRow}>
                {rowEmojis.map((emoji, colIdx) => (
                  <TouchableOpacity
                    key={`${rowIdx}-${colIdx}`}
                    style={styles.emojiBtn}
                    onPress={() => addEmoji(emoji)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.emojiChar}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER: GIF Picker (placeholder grid)
     ══════════════════════════════════════════════════════════════════════════ */

  const SAMPLE_GIFS = [
    'https://media.giphy.com/media/3o7btNa0RUYa5E7iiQ/giphy.gif',
    'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'https://media.giphy.com/media/10JhviFuU2WM9m/giphy.gif',
    'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
    'https://media.giphy.com/media/26tPplGWjN0xLyJ3i/giphy.gif',
    'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif',
    'https://media.giphy.com/media/4Zo41lhzKt6iZ8xff9/giphy.gif',
    'https://media.giphy.com/media/l2YWa4Suu6TVHkvPy/giphy.gif',
  ];

  const renderGifPicker = () => {
    if (!showGifPicker) return null;
    return (
      <View style={styles.gifPickerContainer}>
        <Text style={styles.gifPickerTitle}>Select a GIF</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gifScrollContent}
        >
          {SAMPLE_GIFS.map((url, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.gifThumb,
                selectedGif === url && styles.gifThumbSelected,
              ]}
              onPress={() => handleGifSelect(url)}
              activeOpacity={0.8}
            >
              <RNImage
                source={{ uri: url }}
                style={styles.gifThumbImage}
                resizeMode="cover"
              />
              {selectedGif === url && (
                <View style={styles.gifCheckOverlay}>
                  <Text style={styles.gifCheckIcon}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER: Attached Images Strip
     ══════════════════════════════════════════════════════════════════════════ */

  const renderImageStrip = () => {
    if (attachedImages.length === 0 && !selectedGif) return null;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.imageStripContent}
      >
        {attachedImages.map((img: AttachedImage, idx: number) => (
          <View key={`img-${idx}`} style={styles.imageStripItem}>
            <RNImage
              source={{ uri: img.localUri }}
              style={styles.imageStripThumb}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={styles.imageStripRemove}
              onPress={() => removeImage(idx)}
              hitSlop={4}
            >
              <Text style={styles.imageStripRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {selectedGif ? (
          <View style={styles.imageStripItem}>
            <RNImage
              source={{ uri: selectedGif }}
              style={styles.imageStripThumb}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={styles.imageStripRemove}
              onPress={() => setSelectedGif(null)}
              hitSlop={4}
            >
              <Text style={styles.imageStripRemoveText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.imageStripGifBadge}>
              <GIFIcon size={10} color="#f59e0b" />
              <Text style={styles.imageStripGifText}>GIF</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER: Main
     ══════════════════════════════════════════════════════════════════════════ */

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ── Header ── */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={8}>
            <ReplyIcon size={22} color="#e7e9ea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* ── Full Post Preview ── */}
      {(fullCaption || postData) ? (
        <View style={styles.postPreview}>
          {/* Author row */}
          <View style={styles.postPreviewHeader}>
            <Avatar
              uri={postData?.authorProfileImage || null}
              name={postData?.authorDisplayName || postAuthorDisplayName || postAuthorUsername}
              size={40}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.postPreviewName} numberOfLines={1}>
                  {postData?.authorDisplayName || postAuthorDisplayName || 'User'}
                </Text>
                <VerifiedBadge
                  badge={postData?.authorBadge || ''}
                  isVerified={postData?.authorIsVerified || false}
                  size={14}
                />
              </View>
              <Text style={styles.postPreviewHandle}>
                @{postData?.authorUsername || postAuthorUsername || 'user'}
              </Text>
            </View>
          </View>

          {/* Caption with Show more */}
          {fullCaption ? (
            <View style={styles.postCaptionWrap}>
              <Text
                style={styles.postCaption}
                numberOfLines={captionExpanded ? undefined : 3}
              >
                {fullCaption}
              </Text>
              {needsSeeMore && !captionExpanded && (
                <TouchableOpacity onPress={() => setCaptionExpanded(true)} hitSlop={8}>
                  <Text style={styles.seeMore}>Show more</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* Post media */}
          {postData?.mediaUrls?.length > 0 && (
            <RNImage
              source={{ uri: postData.mediaUrls[0] }}
              style={styles.postMedia}
              resizeMode="cover"
            />
          )}

          {/* Stats */}
          <View style={styles.postStatsRow}>
            <Text style={styles.postStatsText}>
              {postData?.commentCount || comments.length} replies · {postData?.likeCount || 0} likes
            </Text>
          </View>

          {/* Action bar */}
          <View style={styles.postActions}>
            <TouchableOpacity style={styles.postActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <ReplyIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.postActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <RepostIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.postActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <HeartIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.postActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <ChartIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.postActionBtn} disabled>
                <View style={styles.actionIconWrap}>
                  <BookmarkIcon size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.postActionBtn} disabled>
                <View style={styles.actionIconWrap}>
                  <ShareIcon size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Separator */}
      <View style={styles.separator} />

      {/* ── Comments FlatList ── */}
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={comments}
        keyExtractor={(item: CommentData) => item.id}
        renderItem={renderComment}
        contentContainerStyle={{
          comments.length === 0 && !loading ? styles.emptyListContent : undefined
        }}
        ListEmptyComponent={{
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#94a3b8" size="small" />
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <ReplyIcon size={48} color="#64748b" />
              <Text style={styles.emptyTitle}>No replies yet</Text>
              <Text style={styles.emptySub}>Be the first to share your thoughts.</Text>
            </View>
          )
        }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      {/* ── Replying to indicator ── */}
      {replyingTo ? (
        <View style={styles.replyingBar}>
          <Text style={styles.replyingBarText}>
            Replying to{' '}
            <Text style={styles.replyingBarName}>@{replyingTo.username}</Text>
          </Text>
          <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Text style={styles.replyingBarClose}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Attached Images Strip ── */}
      {renderImageStrip()}

      {/* ── Emoji Picker ── */}
      {renderEmojiPicker()}

      {/* ── GIF Picker ── */}
      {renderGifPicker()}

      {/* ── Input Bar (SafeAreaView for bottom notch) ── */}
      <SafeAreaView edges={['bottom']}>
        <View style={styles.inputBar}>
          {/* Current user avatar */}
          <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />

          {/* Input field */}
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={{
                replyingTo
                  ? `Reply to @${replyingTo.username}...`
                  : 'Add a comment...'
              }}
              placeholderTextColor="#64748b"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={500}
              editable={!sending}
              onFocus={() => {
                // Dismiss pickers when focusing input
                if (showEmojiPicker) setShowEmojiPicker(false);
                if (showGifPicker) setShowGifPicker(false);
              }}
            />
          </View>

          {/* Send button */}
          <TouchableOpacity
            style={[styles.sendBtn, hasContent ? styles.sendBtnActive : styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!hasContent || sending || uploadingMedia}
          >
            {sending || uploadingMedia ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text
                style={[
                  styles.sendBtnText,
                  hasContent ? styles.sendBtnTextActive : styles.sendBtnTextDisabled,
                ]}
              >
                Post
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Media Action Toolbar — improved spacing */}
        <View style={styles.mediaToolbar}>
          {/* Photo gallery */}
          <TouchableOpacity style={styles.mediaToolBtn} onPress={pickImage}>
            <ImageIcon size={22} color="#2a7fff" />
          </TouchableOpacity>

          {/* Camera */}
          <TouchableOpacity style={styles.mediaToolBtn} onPress={takePhoto}>
            <CameraIcon size={22} color="#10b981" />
          </TouchableOpacity>

          {/* GIF */}
          <TouchableOpacity
            style={[styles.mediaToolBtn, showGifPicker && styles.mediaToolBtnActive]}
            onPress={() => {
              setShowGifPicker((prev: boolean) => !prev);
              setShowEmojiPicker(false);
            }}
          >
            <GIFIcon size={22} color={showGifPicker ? '#f59e0b' : '#64748b'} />
          </TouchableOpacity>

          {/* Emoji */}
          <TouchableOpacity
            style={[styles.mediaToolBtn, showEmojiPicker && styles.mediaToolBtnActive]}
            onPress={() => {
              setShowEmojiPicker((prev: boolean) => !prev);
              setShowGifPicker(false);
            }}
          >
            <EmojiIcon size={22} color={showEmojiPicker ? '#2a7fff' : '#64748b'} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES — Improved padding & alignment for reply sheet + reactions
   ═══════════════════════════════════════════════════════════════════════════ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  headerTitle: {
    color: '#e7e9ea',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'Inter-Bold',
  },

  /* ── Post Preview ── */
  postPreview: {
    backgroundColor: '#000000',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  postPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  postPreviewName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: 'Inter-Bold',
  },
  postPreviewHandle: {
    color: '#71767b',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  postCaptionWrap: {
    marginBottom: 8,
  },
  postCaption: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    fontFamily: 'Inter-Regular',
  },
  seeMore: {
    color: '#1d9bf0',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
    fontFamily: 'Inter-Bold',
  },
  postMedia: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    marginTop: 8,
    backgroundColor: '#111',
  },
  postStatsRow: {
    flexDirection: 'row',
    marginTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
  },
  postStatsText: {
    color: '#71767b',
    fontSize: 13,
    fontFamily: 'Inter-Regular',
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 360,
    marginTop: 6,
    paddingBottom: 4,
  },
  postActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  /* ── Separator ── */
  separator: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* ── Comments ── */
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    color: '#e7e9ea',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    fontFamily: 'Inter-Bold',
  },
  emptySub: {
    color: '#64748b',
    fontSize: 15,
    marginTop: 4,
    fontFamily: 'Inter-Regular',
  },
  commentRow: {
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 6,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  commentName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: 'Inter-Bold',
  },
  commentHandle: {
    color: '#71767b',
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  commentTime: {
    color: '#71767b',
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
  commentContent: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
    fontFamily: 'Inter-Regular',
  },

  /* ── Comment Media ── */
  commentMediaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  commentMediaImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  commentGif: {
    width: 180,
    height: 120,
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: '#111',
  },

  /* ── Action Bar — improved padding & alignment */}
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  commentActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  /* ── Replying Bar ── */
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  replyingBarText: {
    color: '#94a3b8',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  replyingBarName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },
  replyingBarClose: {
    color: '#94a3b8',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },

  /* ── Image Strip ── */
  imageStripContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: '#000000',
  },
  imageStripItem: {
    position: 'relative',
  },
  imageStripThumb: {
    width: 68,
    height: 68,
    borderRadius: 12,
    backgroundColor: '#16181c',
  },
  imageStripRemove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  imageStripRemoveText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },
  imageStripGifBadge: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  imageStripGifText: {
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },

  /* ── Emoji Picker ── */
  emojiPickerContainer: {
    backgroundColor: '#0a0a0a',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
    maxHeight: 280,
  },
  emojiCategoryTabs: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  emojiCategoryTab: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 6,
  },
  emojiCategoryTabActive: {
    backgroundColor: 'rgba(42,127,255,0.15)',
    borderColor: 'rgba(42,127,255,0.4)',
  },
  emojiCategoryIcon: {
    fontSize: 18,
  },
  emojiCategoryName: {
    color: '#71767b',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter-SemiBold',
  },
  emojiCategoryNameActive: {
    color: '#2a7fff',
  },
  emojiGrid: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  emojiBtn: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiChar: {
    fontSize: 28,
  },

  /* ── GIF Picker ── */
  gifPickerContainer: {
    backgroundColor: '#0a0a0a',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  gifPickerTitle: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
    marginBottom: 10,
  },
  gifScrollContent: {
    gap: 10,
    paddingBottom: 6,
  },
  gifThumb: {
    width: 104,
    height: 104,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#16181c',
  },
  gifThumbSelected: {
    borderColor: '#2a7fff',
  },
  gifThumbImage: {
    width: '100%',
    height: '100%',
  },
  gifCheckOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2a7fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gifCheckIcon: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },

  /* ── Input Bar ── */
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: '#16181c',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
    maxHeight: 110,
    justifyContent: 'center',
  },
  input: {
    color: '#e7e9ea',
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 90,
    fontFamily: 'Inter-Regular',
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: '#2a7fff',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtnText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter-Bold',
  },
  sendBtnTextActive: {
    color: '#000000',
  },
  sendBtnTextDisabled: {
    color: '#555',
  },

  /* ── Media Toolbar — improved spacing */}
  mediaToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 6,
    backgroundColor: '#000000',
  },
  mediaToolBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  mediaToolBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});