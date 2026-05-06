import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, FlatList, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated, Dimensions, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Polyline } from 'react-native-svg';

function RepostIcon({ size = 16, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
}

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_H * 0.75;

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
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});
  const slideAnim = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      loadComments();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible]);

  const loadComments = async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  };

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
      const real = await addPostComment(postId, text.trim());
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

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_HEIGHT, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView style={styles.sheetContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            {/* Handle */}
            <View style={styles.handleWrap}><View style={styles.handle} /></View>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color="#e7e9ea" /></TouchableOpacity>
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
                  <View style={styles.emptyWrap}><ActivityIndicator color="#94a3b8" size="small" /></View>
                ) : (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="chatbubble-outline" size={40} color="#64748b" />
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
                    <Text style={styles.commentContent}>{item.content}</Text>
                    <View style={styles.commentActions}>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
                        setReplyingTo({
                          id: item.authorId,
                          username: item.authorUsername,
                          displayName: item.authorDisplayName || item.authorUsername,
                        });
                      }}>
                        <Ionicons name="chatbubble-outline" size={14} color="#64748b" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => setRepostMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
                        {repostMap[item.id] ? <RepostIcon size={14} color="#10b981" /> : <RepostIcon size={14} color="#64748b" />}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
                        <Ionicons name={likeMap[item.id] ? "heart" : "heart-outline"} size={14} color={likeMap[item.id] ? "#f43f5e" : "#64748b"} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn}>
                        <Ionicons name="trending-up-outline" size={14} color="#64748b" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
                        <Ionicons name={bookmarkMap[item.id] ? "bookmark" : "bookmark-outline"} size={14} color={bookmarkMap[item.id] ? "#ffffff" : "#64748b"} />
                      </TouchableOpacity>
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
                  <Ionicons name="close" size={16} color="#94a3b8" />
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
                  {sending ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="send" size={18} color="#000" />}
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
  sheet: { backgroundColor: '#000000', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SHEET_HEIGHT, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  preview: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  previewCaption: { color: '#94a3b8', fontSize: 14, lineHeight: 20 },
  list: { flex: 1, paddingHorizontal: 16 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { color: '#e7e9ea', fontSize: 16, fontWeight: '700', marginTop: 12 },
  emptySub: { color: '#64748b', fontSize: 14, marginTop: 4 },
  commentRow: { flexDirection: 'row', gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  commentBody: { flex: 1 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
  commentName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  commentHandle: { color: '#71767b', fontSize: 15 },
  commentTime: { color: '#71767b', fontSize: 15 },
  commentContent: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: '#000000' },
  inputWrap: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, maxHeight: 100, justifyContent: 'center' },
  input: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, maxHeight: 80 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: -4,
    gap: 20,
  },
  commentActionBtn: {
    padding: 4,
    borderRadius: 12,
  },
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
    fontSize: 13,
  },
  replyingBarName: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
