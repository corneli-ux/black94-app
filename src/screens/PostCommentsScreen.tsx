import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment } from '../lib/api';
import { useAppStore } from '../stores/app';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { ReplyIcon, RepostIcon as SharedRepostIcon } from '../components/Icons';

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
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Auto-set replyingTo when navigating from a post card with postAuthorUsername
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

  const renderComment = ({ item }: { item: CommentData }) => (
    <View style={styles.commentRow}>
      <Avatar uri={item.authorProfileImage || null} name={item.authorDisplayName || item.authorUsername} size={40} />
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.commentName} numberOfLines={1}>{item.authorDisplayName || item.authorUsername}</Text>
            <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={16} />
            <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
            <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>
        <Text style={styles.commentContent}>{item.content}</Text>
        {/* Action bar — matches feed PostCard exactly */}
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
              {repostMap[item.id] ? <SharedRepostIcon size={18} color={colors.repost} /> : <SharedRepostIcon size={18} color="#94a3b8" />}
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.commentActionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
            <View style={styles.actionIconWrap}>
              <Ionicons name={likeMap[item.id] ? 'heart' : 'heart-outline'} size={18} color={likeMap[item.id] ? '#f43f5e' : '#94a3b8'} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.commentActionBtn} disabled>
            <View style={styles.actionIconWrap}>
              <Ionicons name="trending-up-outline" size={18} color="#94a3b8" />
            </View>
          </TouchableOpacity>
          <View style={styles.actionPair}>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
              <View style={styles.actionIconWrap}>
                <Ionicons name={bookmarkMap[item.id] ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarkMap[item.id] ? '#ffffff' : '#94a3b8'} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="share-outline" size={18} color="#94a3b8" />
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
            <Ionicons name="arrow-back" size={22} color="#e7e9ea" />
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

      {/* Sticky input bar — KeyboardAvoidingView handles both platforms */}
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
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  headerTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '800' },
  preview: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  previewLabel: { color: '#71767b', fontSize: 13, fontWeight: '500', marginBottom: 2 },
  previewAuthor: { color: '#e7e9ea', fontSize: 15, fontWeight: '700' },
  previewHandle: { color: '#71767b', fontSize: 15, fontWeight: '400' },
  previewCaption: { color: '#94a3b8', fontSize: 15, lineHeight: 21, marginTop: 4 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', paddingTop: 100 },
  emptyTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySub: { color: '#64748b', fontSize: 15, marginTop: 4 },
  commentRow: {
    flexDirection: 'row', gap: 12,
    paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 2, flexWrap: 'wrap',
  },
  commentName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  commentHandle: { color: '#71767b', fontSize: 15 },
  commentTime: { color: '#71767b', fontSize: 15 },
  commentContent: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 2 },
  /* Action bar — matches feed PostCard exactly */
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: 0,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  commentActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  /* Black themed input bar */
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
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
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
    color: '#94a3b8',
    fontSize: 14,
  },
  replyingBarName: {
    color: '#e7e9ea',
    fontWeight: '700',
  },
});
