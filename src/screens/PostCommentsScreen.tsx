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

interface PostCommentsScreenProps {
  route?: any;
  navigation?: any;
}

export default function PostCommentsScreen({ route, navigation }: PostCommentsScreenProps) {
  const { postId, postCaption } = route?.params || {};
  const { user } = useAppStore();
  const currentUser = auth()?.currentUser;
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => { loadComments(); }, [loadComments]);

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
      <Avatar uri={item.authorProfileImage || null} name={item.authorDisplayName || item.authorUsername} size={36} />
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.commentName} numberOfLines={1}>{item.authorDisplayName || item.authorUsername}</Text>
            <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={14} />
          </View>
          <Text style={styles.commentHandle}>@{item.authorUsername}</Text>
          <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
        </View>
        <Text style={styles.commentContent}>{item.content}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={[styles.header, { paddingTop: insets.top || 8 }]}>
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
          <Text style={styles.previewCaption} numberOfLines={2}>{postCaption}</Text>
        </View>
      ) : null}

      {/* Comments list */}
      <FlatList
        ref={listRef}
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
              <Ionicons name="chatbubble-outline" size={48} color="#64748b" />
              <Text style={styles.emptyTitle}>No replies yet</Text>
              <Text style={styles.emptySub}>Be the first to share your thoughts.</Text>
            </View>
          )
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      {/* Sticky input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={[styles.inputBar, { paddingBottom: Math.max(8, (insets.bottom || 0)) }]}>
            <Avatar uri={user?.profileImage || null} name={user?.displayName} size={32} />
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Add a comment..."
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
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '800' },
  preview: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  previewCaption: { color: '#94a3b8', fontSize: 15, lineHeight: 21 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyListContent: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', paddingTop: 100 },
  emptyTitle: { color: '#e7e9ea', fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySub: { color: '#64748b', fontSize: 15, marginTop: 4 },
  commentRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  commentBody: { flex: 1, minWidth: 0 },
  commentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 2, flexWrap: 'wrap',
  },
  commentName: { color: '#e7e9ea', fontWeight: '700', fontSize: 14 },
  commentHandle: { color: '#94a3b8', fontSize: 13 },
  commentTime: { color: '#64748b', fontSize: 12 },
  commentContent: { color: '#e7e9ea', fontSize: 15, lineHeight: 21, marginTop: 2 },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000000',
  },
  inputWrap: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    minHeight: 36, maxHeight: 100, justifyContent: 'center',
  },
  input: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, maxHeight: 80 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
});
