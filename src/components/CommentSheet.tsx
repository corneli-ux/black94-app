import { colors } from '../theme/colors';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, FlatList, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment, toggleCommentLike, toggleCommentRepost, toggleCommentBookmark } from '../lib/api';
import { useAppStore } from '../stores/app';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Polyline } from 'react-native-svg';

function RepostIcon({ size = 16, color = colors.textSecondary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
}

const SHEET_HEIGHT_RATIO = 0.75;

interface CommentSheetProps {
  visible: boolean;
  onClose: () => void;
  postId: string;
  postCaption?: string;
  onCommentSent?: () => void;
}

export default function CommentSheet({ visible, onClose, postId, postCaption, onCommentSent }: CommentSheetProps) {
  const { user } = useAppStore();
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});
  const slideAnim = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList>(null);
  // Keep the modal mounted during close animation so the slide-out is visible.
  // Without this, setting visible=false unmounts the Modal immediately,
  // making the close animation invisible.
  const [modalVisible, setModalVisible] = useState(false);

  // ── Enrich comment author profiles from user docs ──
  const enrichCommentAuthors = useCallback(async (commentsToEnrich: CommentData[]) => {
    const uniqueIds = [...new Set(commentsToEnrich.map(c => c.authorId).filter(Boolean))];
    if (uniqueIds.length === 0) return;
    const CHUNK = 10;
    const profileMap: Record<string, any> = {};
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const chunk = uniqueIds.slice(i, i + CHUNK);
      try {
        const docs = await Promise.all(
          chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null))
        );
        for (const snap of docs) {
          if (snap && snap.exists) {
            const d = snap.data()!;
            profileMap[snap.id] = {
              username: d.username || '',
              displayName: d.displayName || '',
              profileImage: d.profileImage || null,
              badge: d.badge || '',
              isVerified: d.isVerified || false,
            };
          }
        }
      } catch (e) { console.warn('[CommentSheet] Author enrichment failed:', e); }
    }
    let changed = false;
    for (const c of commentsToEnrich) {
      const p = profileMap[c.authorId];
      if (!p) continue;
      // Always use the latest user doc data (matches feed enrichment behavior)
      // so profile name/avatar changes reflect immediately on comments.
      if (p.displayName && p.displayName !== c.authorDisplayName) { c.authorDisplayName = p.displayName; changed = true; }
      if (p.username && p.username !== c.authorUsername) { c.authorUsername = p.username; changed = true; }
      if (p.profileImage && p.profileImage !== c.authorProfileImage) { c.authorProfileImage = p.profileImage; changed = true; }
      if (p.badge && p.badge !== c.authorBadge) { c.authorBadge = p.badge; changed = true; }
      if (p.isVerified !== c.authorIsVerified) { c.authorIsVerified = p.isVerified; changed = true; }
    }
    if (changed) setComments(prev => [...prev]);
  }, []);

  const loadComments = useCallback(async () => {
    setLoading(true);
    setCommentsError(null);
    try {
      const data = await fetchPostComments(postId);
      setComments(data);
      enrichCommentAuthors(data);
      // BUG FIX: Populate like/repost/bookmark maps from API data so existing
      // engagement state is reflected when the sheet opens (not always empty).
      const likeM: Record<string, boolean> = {};
      const repostM: Record<string, boolean> = {};
      const bookmarkM: Record<string, boolean> = {};
      (data || []).forEach(c => {
        likeM[c.id] = !!c.isLiked;
        repostM[c.id] = !!c.isReposted;
        bookmarkM[c.id] = !!c.isBookmarked;
      });
      setLikeMap(likeM);
      setRepostMap(repostM);
      setBookmarkMap(bookmarkM);
    } catch (e: any) {
      console.error('[CommentSheet] loadComments error:', e?.message);
      setCommentsError(e?.message || 'Failed to load comments');
      setComments([]);
    }
    setLoading(false);
  }, [postId, enrichCommentAuthors]);

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      // Small delay to ensure Modal is mounted before animating
      requestAnimationFrame(() => {
        Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
      loadComments();
      setReplyingTo(null);
      setText('');
    } else {
      // Animate out, then unmount the modal AFTER animation completes
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setModalVisible(false);
      });
    }
  }, [visible, loadComments]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const optimistic: CommentData = {
      id: `temp_${Date.now()}`,
      postId, authorId: user?.id || '', authorUsername: user?.username || '',
      authorDisplayName: user?.displayName || '', authorProfileImage: user?.profileImage || '',
      authorIsVerified: user?.isVerified || false, authorBadge: user?.badge || '',
      content: text.trim(), createdAt: Date.now(),
    };
    setComments(prev => [...prev, optimistic]);
    setText('');
    setReplyingTo(null);
    try {
      const real = await addPostComment(postId, text.trim(), replyingTo?.id, replyingTo?.username);
      if (real) {
        setComments(prev => prev.map(c => c.id === optimistic.id ? real : c));
        onCommentSent?.();
      } else {
        setComments(prev => prev.filter(c => c.id !== optimistic.id));
      }
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
    }
    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sheetHeight = Dimensions.get('window').height * SHEET_HEIGHT_RATIO;
  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] });

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView style={styles.sheetContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            {/* Handle */}
            <View style={styles.handleWrap}><View style={styles.handle} /></View>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.text} /></TouchableOpacity>
              <Text style={styles.headerTitle}>Post</Text>
              <View style={{ width: 22 }} />
            </View>
            {/* Post preview */}
            {postCaption ? (
              <View style={styles.preview}>
                <Text style={styles.previewCaption} numberOfLines={2}>{postCaption}</Text>
              </View>
            ) : null}
            {/* Comments list */}
            <FlatList
              ref={listRef}
              style={styles.list}
              data={comments}
              keyExtractor={item => item.id}
              ListEmptyComponent={
                loading ? (
                  <View style={styles.emptyWrap}><ActivityIndicator color={colors.textSecondary} size="small" /></View>
                ) : commentsError ? (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="alert-circle-outline" size={40} color={colors.like} />
                    <Text style={styles.emptyTitle}>Could not load comments</Text>
                    <Text style={styles.emptySub}>{commentsError}</Text>
                    <TouchableOpacity onPress={loadComments} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="chatbubble-outline" size={40} color={colors.textTertiary} />
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptySub}>Be the first to share your thoughts.</Text>
                  </View>
                )
              }
              renderItem={({ item }) => (
                <View style={styles.commentRow}>
                  <Avatar uri={item.authorProfileImage || null} name={item.authorDisplayName || item.authorUsername} size={36} />
                  <View style={styles.commentBody}>
                    <View style={styles.commentHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.commentName}>{item.authorDisplayName || item.authorUsername}</Text>
                        <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={14} />
                      </View>
                      <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
                      <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                    {/* Reply-to indicator */}
                    {item.replyToUsername ? (
                      <Text style={styles.replyToIndicator}>
                        Replying to <Text style={styles.replyToName}>@{item.replyToUsername}</Text>
                      </Text>
                    ) : null}
                    <Text style={styles.commentContent}>{item.content}</Text>
                    <View style={styles.commentActions}>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
                        setReplyingTo({
                          id: item.id,
                          username: item.authorUsername,
                          displayName: item.authorDisplayName || item.authorUsername,
                        });
                      }}>
                        <View style={styles.actionIconWrap}>
                          <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
                        const wasReposted = repostMap[item.id] || false;
                        setRepostMap(prev => ({ ...prev, [item.id]: !wasReposted }));
                        // Persist to Firestore (fire-and-forget)
                        toggleCommentRepost(item.id, wasReposted).catch(() => {
                          setRepostMap(prev => ({ ...prev, [item.id]: wasReposted }));
                        });
                      }}>
                        <View style={styles.actionIconWrap}>
                          {repostMap[item.id] ? <RepostIcon size={18} color={colors.accentGreen} /> : <RepostIcon size={18} color={colors.textSecondary} />}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
                        const wasLiked = likeMap[item.id] || false;
                        setLikeMap(prev => ({ ...prev, [item.id]: !wasLiked }));
                        // Persist to Firestore (fire-and-forget)
                        toggleCommentLike(item.id, wasLiked).catch(() => {
                          setLikeMap(prev => ({ ...prev, [item.id]: wasLiked }));
                        });
                      }}>
                        <View style={styles.actionIconWrap}>
                          <Ionicons name={likeMap[item.id] ? "heart" : "heart-outline"} size={18} color={likeMap[item.id] ? colors.like : colors.textSecondary} />
                        </View>
                      </TouchableOpacity>
                      {/* Share — opens native share sheet */}
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
                        try {
                          const { Share } = require('react-native');
                          Share.share({ message: item.content.slice(0, 200) });
                        } catch {}
                      }}>
                        <View style={styles.actionIconWrap}>
                          <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                        </View>
                      </TouchableOpacity>
                      <View style={styles.actionPair}>
                        <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
                          const wasBookmarked = bookmarkMap[item.id] || false;
                          setBookmarkMap(prev => ({ ...prev, [item.id]: !wasBookmarked }));
                          // Persist to Firestore (fire-and-forget)
                          toggleCommentBookmark(item.id, wasBookmarked).catch(() => {
                            setBookmarkMap(prev => ({ ...prev, [item.id]: wasBookmarked }));
                          });
                        }}>
                          <View style={styles.actionIconWrap}>
                            <Ionicons name={bookmarkMap[item.id] ? "bookmark" : "bookmark-outline"} size={18} color={bookmarkMap[item.id] ? colors.white : colors.textSecondary} />
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              )}
            />
            {/* Replying to indicator */}
            {replyingTo ? (
              <View style={styles.replyingBar}>
                <Text style={styles.replyingBarText}>Replying to <Text style={styles.replyingBarName}>@{replyingTo.username}</Text></Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
            {/* Input bar */}
            <SafeAreaView edges={['bottom']}>
              <View style={styles.inputBar}>
                <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : "Add a comment..."}
                    placeholderTextColor={colors.textTertiary}
                    value={text}
                    onChangeText={setText}
                    multiline
                    maxLength={500}
                    editable={!sending}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
                  onPress={handleSend}
                  disabled={!text.trim() || sending}
                >
                  {sending ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="send" size={18} color={text.trim() ? colors.primaryForeground : colors.textMuted} />}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheetContainer: { justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: Dimensions.get('window').height * 0.75, overflow: 'hidden', borderWidth: 1, borderColor: colors.separator },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { color: colors.white, fontWeight: '700', fontSize: 16 },
  preview: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  previewCaption: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  list: { flex: 1, paddingHorizontal: 16 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 12 },
  emptySub: { color: colors.textTertiary, fontSize: 14, marginTop: 4 },
  commentRow: { flexDirection: 'row', gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  commentBody: { flex: 1 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
  commentName: { color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  commentHandle: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  commentTime: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  commentContent: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 4 },
  replyToIndicator: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  replyToName: { color: colors.accent, fontWeight: '500' },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: colors.bg },
  inputWrap: { flex: 1, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, maxHeight: 100, justifyContent: 'center' },
  input: { color: colors.text, fontSize: 15, lineHeight: 20, maxHeight: 80 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  commentActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.bg,
  },
  replyingBarText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  replyingBarName: {
    color: colors.text,
    fontWeight: '700',
  },
});
