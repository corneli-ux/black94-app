import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment, toggleCommentLike, toggleCommentRepost, toggleCommentBookmark, tsToMillis } from '../lib/api';
import FactCheckBottomSheet from './FactCheckBottomSheet';
import { useAppStore } from '../stores/app';
import { auth, firestore } from '../lib/firebase';
import { colors } from '../theme/colors';
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

interface PostCommentsScreenProps {
  route?: any;
  navigation?: any;
}

export default function PostCommentsScreen({ route, navigation }: PostCommentsScreenProps) {
  const { postId, postCaption, postAuthorUsername, postAuthorDisplayName } = route?.params || {};
  const { user } = useAppStore();
  const currentUser = auth()?.currentUser;
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});
  const [factCheckVisible, setFactCheckVisible] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  const [commentsError, setCommentsError] = useState<string | null>(null);

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
      } catch (e) { console.warn('[PostComments] Author enrichment failed:', e); }
    }
    let changed = false;
    for (const c of commentsToEnrich) {
      const p = profileMap[c.authorId];
      if (!p) continue;
      if (p.username && !c.authorUsername) { c.authorUsername = p.username; changed = true; }
      if (p.displayName && !c.authorDisplayName) { c.authorDisplayName = p.displayName; changed = true; }
      if (p.profileImage && !c.authorProfileImage) { c.authorProfileImage = p.profileImage; changed = true; }
      if (p.badge && !c.authorBadge) { c.authorBadge = p.badge; changed = true; }
      if (p.isVerified && !c.authorIsVerified) { c.authorIsVerified = p.isVerified; changed = true; }
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
      // BUG FIX: Correct the post's commentCount with the actual count.
      // The stored commentCount can drift from reality (e.g., if increment
      // failed, or comments were deleted). Every time someone opens the
      // comments screen, sync the count to the actual query result.
      try {
        const actualCount = data.length;
        const postDoc = await firestore().collection('posts').doc(postId).get();
        if (postDoc.exists) {
          const storedCount = postDoc.data()?.commentCount || 0;
          if (storedCount !== actualCount) {
            await firestore().collection('posts').doc(postId).update({
              commentCount: actualCount,
            });
            if (__DEV__) console.log(`[PostComments] Corrected commentCount: ${storedCount} → ${actualCount}`);
          }
        }
      } catch (e) {
        // Non-critical — don't block comment loading
        console.warn('[PostComments] Failed to correct commentCount:', e);
      }
    } catch (e: any) {
      console.error('[PostComments] loadComments error:', e?.message);
      setCommentsError(e?.message || 'Failed to load comments');
      setComments([]);
    }
    setLoading(false);
  }, [postId, enrichCommentAuthors]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Load more comments (pagination)
  const loadMoreComments = useCallback(async () => {
    if (loadingMore || allLoaded || comments.length === 0) return;
    setLoadingMore(true);
    try {
      // Use the oldest comment's createdAt as cursor with proper orderBy
      const oldestCreatedAt = comments[comments.length - 1].createdAt;
      const snap = await firestore()
        .collection('post_comments')
        .where('postId', '==', postId)
        .orderBy('createdAt', 'asc')
        .startAfter({ __fs_type: 'timestamp', value: new Date(oldestCreatedAt).toISOString() })
        .limit(30)
        .get();
      const newComments = snap.docs
        .map(docSnap => {
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
            replyToId: data.replyToId || null,
            replyToUsername: data.replyToUsername || null,
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
          };
        });
      if (newComments.length === 0) {
        setAllLoaded(true);
      } else {
        setComments(prev => [...prev, ...newComments]);
      }
    } catch (e) {
      console.warn('[PostComments] loadMoreComments error:', e);
    }
    setLoadingMore(false);
  }, [loadingMore, allLoaded, comments, postId]);

  // Note: We intentionally do NOT auto-set replyingTo here.
  // The first comment on a post is a top-level comment, not a "reply".
  // Setting replyToId to '' caused inconsistent Firestore state
  // (replyToUsername set but replyToId null). Users can tap reply on
  // any comment to explicitly reply to it.

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const optimistic: CommentData = {
      id: `temp_${Date.now()}`,
      postId,
      authorId: user?.id || currentUser?.uid || '',
      authorUsername: user?.username || '',
      authorDisplayName: user?.displayName || '',
      authorProfileImage: user?.profileImage || '',
      authorIsVerified: user?.isVerified || false,
      authorBadge: user?.badge || '',
      content: text.trim(),
      replyToId: replyingTo?.id || null,
      replyToUsername: replyingTo?.username || null,
      createdAt: Date.now(),
    };
    setComments(prev => [...prev, optimistic]);
    setText('');
    setReplyingTo(null);
    try {
      const real = await addPostComment(postId, text.trim(), replyingTo?.id, replyingTo?.username);
      if (real) {
        setComments(prev => prev.map(c => c.id === optimistic.id ? real : c));
      } else {
        setComments(prev => prev.filter(c => c.id !== optimistic.id));
      }
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
    }
    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const renderItem = ({ item }: { item: CommentData }) => {
    const item2 = item;
    const isReply = !!item2.replyToId;
    return (
      <View style={[styles.commentRow, isReply && styles.commentReplyIndent]}>
        <Avatar uri={item2.authorProfileImage || null} name={item2.authorDisplayName || item2.authorUsername} size={isReply ? 32 : 40} />
        <View style={styles.commentBody}>
          <View style={styles.commentHeader}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              onPress={() => {
                const currentUserId = user?.id || currentUser?.uid;
                if (item2.authorId && item2.authorId === currentUserId) {
                  navigation.navigate('ProfileSelf');
                } else if (item2.authorId) {
                  navigation.navigate('UserProfile', { userId: item2.authorId });
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.commentName} numberOfLines={1}>{item2.authorDisplayName || item2.authorUsername}</Text>
              <VerifiedBadge badge={item2.authorBadge} isVerified={item2.authorIsVerified} size={16} />
              <Text style={styles.commentHandle}>@{item2.authorUsername}</Text>
            </TouchableOpacity>
            <Text style={styles.commentTime}>{timeAgo(item2.createdAt)}</Text>
          </View>
          {/* Reply-to indicator — shows when this comment is replying to another */}
          {item2.replyToUsername ? (
            <Text style={styles.replyToIndicator}>
              Replying to <Text style={styles.replyToName}>@{item2.replyToUsername}</Text>
            </Text>
          ) : null}
          <Text style={styles.commentContent}>{item2.content}</Text>
          {/* Action bar — matches feed PostCard exactly */}
          <View style={styles.commentActions}>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
              setReplyingTo({
                id: item2.id,
                username: item2.authorUsername,
                displayName: item2.authorDisplayName || item2.authorUsername,
              });
            }}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
              const wasReposted = repostMap[item2.id] || false;
              setRepostMap(prev => ({ ...prev, [item2.id]: !wasReposted }));
              toggleCommentRepost(item2.id, wasReposted).catch(() => {
                setRepostMap(prev => ({ ...prev, [item2.id]: wasReposted }));
              });
            }}>
              <View style={styles.actionIconWrap}>
                {repostMap[item2.id] ? <RepostIcon size={18} color={colors.accentGreen} /> : <RepostIcon size={18} color={colors.textSecondary} />}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
              const wasLiked = likeMap[item2.id] || false;
              setLikeMap(prev => ({ ...prev, [item2.id]: !wasLiked }));
              toggleCommentLike(item2.id, wasLiked).catch(() => {
                setLikeMap(prev => ({ ...prev, [item2.id]: wasLiked }));
              });
            }}>
              <View style={styles.actionIconWrap}>
                <Ionicons name={likeMap[item2.id] ? 'heart' : 'heart-outline'} size={18} color={likeMap[item2.id] ? colors.like : colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.commentActionBtn} onPress={async () => {
                const wasBookmarked = bookmarkMap[item2.id] || false;
                setBookmarkMap(prev => ({ ...prev, [item2.id]: !wasBookmarked }));
                toggleCommentBookmark(item2.id, wasBookmarked).catch(() => {
                  setBookmarkMap(prev => ({ ...prev, [item2.id]: wasBookmarked }));
                });
              }}>
                <View style={styles.actionIconWrap}>
                  <Ionicons name={bookmarkMap[item2.id] ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarkMap[item2.id] ? colors.white : colors.textSecondary} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.commentActionBtn}>
                <View style={styles.actionIconWrap}>
                  <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Replies</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Post caption preview */}
      {postCaption ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Replying to</Text>
          {postAuthorDisplayName ? (
            <Text style={styles.previewAuthor}>{postAuthorDisplayName} <Text style={styles.previewHandle}>@{postAuthorUsername}</Text></Text>
          ) : null}
          <Text style={styles.previewCaption} numberOfLines={2}>{postCaption}</Text>
        </View>
      ) : null}

      {/* Comments list — flex:1 fills remaining space above input bar */}
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={comments}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={comments.length === 0 && !loading ? styles.emptyListContent : undefined}
        onEndReached={loadMoreComments}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
            </View>
          ) : commentsError ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="alert-circle-outline" size={48} color={colors.like} />
              <Text style={styles.emptyTitle}>Could not load replies</Text>
              <Text style={styles.emptySub}>{commentsError}</Text>
              <TouchableOpacity onPress={loadComments} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.bgInput }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubble-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No replies yet</Text>
              <Text style={styles.emptySub}>Be the first to share your thoughts.</Text>
            </View>
          )
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
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

      {/* Sticky input bar — KeyboardAvoidingView handles both platforms */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(8, insets.bottom || 0) }]}>
        <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : 'Add a comment...'}
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
          {sending
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Ionicons name="send" size={18} color={text.trim() ? colors.primaryForeground : colors.textMuted} />
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.factCheckBtn]}
          onPress={() => setFactCheckVisible(true)}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name={'shield-checkmark-outline' as any} size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>
      <FactCheckBottomSheet
        postId={postId}
        visible={factCheckVisible}
        onClose={() => setFactCheckVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  preview: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  previewLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '500', marginBottom: 2 },
  previewAuthor: { color: colors.text, fontSize: 15, fontWeight: '700' },
  previewHandle: { color: colors.textMuted, fontSize: 15, fontWeight: '400' },
  previewCaption: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 4 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', paddingTop: 100 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySub: { color: colors.textTertiary, fontSize: 15, marginTop: 4 },
  commentRow: {
    flexDirection: 'row', gap: 12,
    paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.separator,
  },
  commentReplyIndent: {
    paddingLeft: 44, // Indent replies under parent (16 base + 28 for child offset)
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 2, flexWrap: 'wrap',
  },
  commentName: { color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  commentHandle: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  commentTime: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  commentContent: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 4 },
  replyToIndicator: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  replyToName: { color: colors.accent, fontWeight: '500' },
  /* Action bar — matches feed PostCard exactly */
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
  /* ── Ad Card (inline in comments) ── */
  adCard: {
    backgroundColor: colors.bg,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  adBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  adBadgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  adBody: {
    marginBottom: 8,
  },
  adHeadline: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 4,
  },
  adDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  adCtaBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgInput,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  adCtaText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  adSponsored: {
    color: 'rgba(113,118,123,0.6)',
    fontSize: 11,
    marginTop: 6,
  },
  /* Black themed input bar */
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  inputWrap: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    minHeight: 36, maxHeight: 100, justifyContent: 'center',
  },
  input: { color: colors.text, fontSize: 15, lineHeight: 20, maxHeight: 80 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.bgInput },
  factCheckBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(42,127,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: colors.separator,
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
