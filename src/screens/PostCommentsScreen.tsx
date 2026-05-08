import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image as RNImage,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment } from '../lib/api';
import { useAppStore } from '../stores/app';
import { auth, firestore } from '../lib/firebase';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import {
  ReplyIcon, RepostIcon, HeartIcon, BookmarkIcon,
  ShareIcon, ViewsIcon, BackArrowIcon,
} from '../components/Icons';

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
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  // Fetch post data for full preview
  const [postData, setPostData] = useState<any>(null);

  useEffect(() => {
    if (postId) {
      firestore().collection('posts').doc(postId).get().then(docSnap => {
        if (docSnap.exists) {
          setPostData(docSnap.data());
        }
      }).catch(() => {});
    }
  }, [postId]);

  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  useEffect(() => {
    if (postAuthorUsername) {
      setReplyingTo({
        id: '',
        username: postAuthorUsername,
        displayName: postAuthorDisplayName || postAuthorUsername,
      });
    }
  }, [postAuthorUsername, postAuthorDisplayName]);

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
      createdAt: Date.now(),
    };
    setComments(prev => [...prev, optimistic]);
    setText('');
    setReplyingTo(null);
    try {
      const real = await addPostComment(postId, text.trim());
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

  const fullCaption = postData?.caption || postCaption || '';
  const needsSeeMore = fullCaption.length > 140;

  const renderComment = ({ item }: { item: CommentData }) => (
    <View style={styles.commentRow}>
      <Avatar uri={item.authorProfileImage || null} name={item.authorDisplayName || item.authorUsername} size={40} />
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.commentName} numberOfLines={1}>{item.authorDisplayName || item.authorUsername}</Text>
            <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={14} />
            <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
            <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>
        <Text style={styles.commentContent}>{item.content}</Text>
        <View style={styles.commentActions}>
          <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
            setReplyingTo({
              id: item.authorId,
              username: item.authorUsername,
              displayName: item.authorDisplayName || item.authorUsername,
            });
          }}>
            <View style={styles.actionIconWrap}>
              <ReplyIcon size={18} color="#94a3b8" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.commentActionBtn} onPress={() => setRepostMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
            <View style={styles.actionIconWrap}>
              <RepostIcon size={18} color={repostMap[item.id] ? '#10b981' : '#94a3b8'} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.commentActionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
            <View style={styles.actionIconWrap}>
              <HeartIcon size={18} color={likeMap[item.id] ? '#f43f5e' : '#94a3b8'} filled={likeMap[item.id]} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.commentActionBtn} disabled>
            <View style={styles.actionIconWrap}>
              <ViewsIcon size={18} color="#94a3b8" />
            </View>
          </TouchableOpacity>
          <View style={styles.actionPair}>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
              <View style={styles.actionIconWrap}>
                <BookmarkIcon size={18} color={bookmarkMap[item.id] ? '#ffffff' : '#94a3b8'} filled={bookmarkMap[item.id]} />
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={0}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <BackArrowIcon size={22} color="#e7e9ea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Full post preview with See More */}
      {(fullCaption || postData) ? (
        <View style={styles.postPreview}>
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
              <Text style={styles.postPreviewHandle}>@{postData?.authorUsername || postAuthorUsername || 'user'}</Text>
            </View>
          </View>

          {/* Caption with See More */}
          {fullCaption ? (
            <View style={styles.postCaptionWrap}>
              <Text style={styles.postCaption} numberOfLines={captionExpanded ? undefined : 3}>
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

          {/* Post stats */}
          <View style={styles.postStatsRow}>
            <Text style={styles.postStatsText}>
              {postData?.commentCount || 0} replies · {postData?.likeCount || 0} likes
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
                <ViewsIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.postActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <ShareIcon size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Separator */}
      <View style={styles.separator} />

      {/* Comments list */}
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={comments}
        keyExtractor={item => item.id}
        renderItem={renderComment}
        contentContainerStyle={comments.length === 0 && !loading ? styles.emptyListContent : undefined}
        ListEmptyComponent={
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
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      {/* Replying to indicator */}
      {replyingTo ? (
        <View style={styles.replyingBar}>
          <Text style={styles.replyingBarText}>Replying to <Text style={styles.replyingBarName}>@{replyingTo.username}</Text></Text>
          <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Sticky input bar */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(8, insets.bottom || 0) }]}>
        <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : 'Add a comment...'}
            placeholderTextColor="#64748b"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
            editable={!sending}
          />
        </View>
        <TouchableOpacity
          style={[styles.sendBtn, text.trim() ? styles.sendBtnActive : styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#000" />
            : <Ionicons name="send" size={18} color={text.trim() ? '#000' : '#555'} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  /* ── Header ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  headerTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '800' },

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
  postPreviewName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  postPreviewHandle: { color: '#71767b', fontSize: 14 },
  postCaptionWrap: { marginBottom: 8 },
  postCaption: { color: '#e7e9ea', fontSize: 15, lineHeight: 20 },
  seeMore: { color: '#2a7fff', fontSize: 15, fontWeight: '600', marginTop: 2 },
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
  postStatsText: { color: '#71767b', fontSize: 13 },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 360,
    marginTop: 4,
    paddingBottom: 4,
  },
  postActionBtn: { flexDirection: 'row', alignItems: 'center' },

  /* ── Separator ── */
  separator: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* ── Comments ── */
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', paddingTop: 100 },
  emptyTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySub: { color: '#64748b', fontSize: 15, marginTop: 4 },
  commentRow: {
    flexDirection: 'row', gap: 10,
    paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginBottom: 2, flexWrap: 'wrap',
  },
  commentName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  commentHandle: { color: '#71767b', fontSize: 15 },
  commentTime: { color: '#71767b', fontSize: 15 },
  commentContent: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 2 },

  /* ── Action bar ── */
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  commentActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },

  /* ── Input Bar ── */
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  inputWrap: {
    flex: 1, backgroundColor: '#16181c',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    minHeight: 36, maxHeight: 100, justifyContent: 'center',
  },
  input: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, maxHeight: 80 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnActive: { backgroundColor: '#2a7fff' },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },

  /* ── Replying bar ── */
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
  replyingBarText: { color: '#94a3b8', fontSize: 14 },
  replyingBarName: { color: '#e7e9ea', fontWeight: '700' },
});
