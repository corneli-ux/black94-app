import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { CommentData, fetchPostComments, addPostComment, fetchActiveAdCampaigns } from '../lib/api';
import FactCheckBottomSheet from './FactCheckBottomSheet';
import { useAppStore } from '../stores/app';
import { auth, firestore } from '../lib/firebase';
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

interface PostCommentsScreenProps {
  route?: any;
  navigation?: any;
}

/* ── Feed item union type for interleaved comments + ads ── */
type CommentFeedItem =
  | { type: 'comment'; id: string; comment: CommentData }
  | { type: 'ad'; id: string; ad: any };

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
  const [ads, setAds] = useState<any[]>([]);
  const [factCheckVisible, setFactCheckVisible] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  const loadComments = useCallback(async () => {
    setLoading(true);
    const data = await fetchPostComments(postId);
    setComments(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Fetch active ad campaigns on mount
  useEffect(() => {
    (async () => {
      try {
        const adList = await fetchActiveAdCampaigns(5);
        setAds(adList);
      } catch {
        // silently ignore
      }
    })();
  }, []);

  // Auto-set replyingTo only when replying to a DIFFERENT user
  useEffect(() => {
    const currentUserUsername = user?.username || currentUser?.displayName || '';
    if (postAuthorUsername && postAuthorUsername.toLowerCase() !== currentUserUsername.toLowerCase()) {
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

  // Build interleaved feed: comments with ads inserted after every 5th comment
  const feedItems: CommentFeedItem[] = (() => {
    if (ads.length === 0) return comments.map(c => ({ type: 'comment' as const, id: c.id, comment: c }));
    const items: CommentFeedItem[] = [];
    let adIndex = 0;
    comments.forEach((comment, idx) => {
      items.push({ type: 'comment', id: comment.id, comment });
      if ((idx + 1) % 5 === 0 && adIndex < ads.length) {
        items.push({ type: 'ad', id: `ad_${ads[adIndex].id}_${idx}`, ad: ads[adIndex] });
        adIndex++;
      }
    });
    return items;
  })();

  const renderItem = ({ item }: { item: CommentFeedItem }) => {
    if (item.type === 'ad') {
      return (
        <View style={styles.adCard}>
          <View style={styles.adBadgeRow}>
            <Ionicons name="megaphone-outline" size={14} color={colors.accentGold} />
            <Text style={styles.adBadgeText}>Promoted</Text>
          </View>
          <View style={styles.adBody}>
            <Text style={styles.adHeadline} numberOfLines={1}>{item.ad.headline || 'Ad'}</Text>
            {item.ad.description ? <Text style={styles.adDescription} numberOfLines={2}>{item.ad.description}</Text> : null}
            {item.ad.ctaText ? (
              <TouchableOpacity style={styles.adCtaBtn} activeOpacity={0.7}>
                <Text style={styles.adCtaText}>{item.ad.ctaText}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.adSponsored}>Sponsored</Text>
        </View>
      );
    }
    const item2 = item.comment;
    return (
      <View style={styles.commentRow}>
        <Avatar uri={item2.authorProfileImage || null} name={item2.authorDisplayName || item2.authorUsername} size={40} />
        <View style={styles.commentBody}>
          <View style={styles.commentHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.commentName} numberOfLines={1}>{item2.authorDisplayName || item2.authorUsername}</Text>
              <VerifiedBadge badge={item2.authorBadge} isVerified={item2.authorIsVerified} size={16} />
              <Text style={styles.commentHandle}>@{item2.authorUsername}</Text>
              <Text style={styles.commentTime}>{timeAgo(item2.createdAt)}</Text>
            </View>
          </View>
          <Text style={styles.commentContent}>{item2.content}</Text>
          {/* Action bar — matches feed PostCard exactly */}
          <View style={styles.commentActions}>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => {
              setReplyingTo({
                id: item2.authorId,
                username: item2.authorUsername,
                displayName: item2.authorDisplayName || item2.authorUsername,
              });
            }}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => setRepostMap(prev => ({ ...prev, [item2.id]: !prev[item2.id] }))}>
              <View style={styles.actionIconWrap}>
                {repostMap[item2.id] ? <RepostIcon size={18} color="#10b981" /> : <RepostIcon size={18} color="#94a3b8" />}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [item2.id]: !prev[item2.id] }))}>
              <View style={styles.actionIconWrap}>
                <Ionicons name={likeMap[item2.id] ? 'heart' : 'heart-outline'} size={18} color={likeMap[item2.id] ? '#f43f5e' : '#94a3b8'} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.commentActionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [item2.id]: !prev[item2.id] }))}>
                <View style={styles.actionIconWrap}>
                  <Ionicons name={bookmarkMap[item2.id] ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarkMap[item2.id] ? '#ffffff' : '#94a3b8'} />
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
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
    >
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

      {/* Comments list with interleaved ads — flex:1 fills remaining space above input bar */}
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={feedItems}
        keyExtractor={item => item.id}
        renderItem={renderItem}
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
  commentName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15, lineHeight: 20 },
  commentHandle: { color: '#71767b', fontSize: 15, lineHeight: 20 },
  commentTime: { color: '#71767b', fontSize: 15, lineHeight: 20 },
  commentContent: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 4 },
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
    backgroundColor: '#111111',
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
    color: '#71767b',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  adBody: {
    marginBottom: 8,
  },
  adHeadline: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 4,
  },
  adDescription: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  adCtaBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  adCtaText: {
    color: '#e7e9ea',
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
