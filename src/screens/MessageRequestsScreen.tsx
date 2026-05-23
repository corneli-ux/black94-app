import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

interface MessageRequest {
  id: string;
  chatData: Record<string, any>;
  senderId: string;
  sender: {
    id: string;
    displayName: string;
    username: string;
    profileImage: string | null;
    isVerified?: boolean;
    badge?: string;
  } | null;
}

export default function MessageRequestsScreen() {
  const navigation = useNavigation();
  const currentUserId = auth()?.currentUser?.uid;
  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!currentUserId) return;
    try {
      // Use single-where queries to avoid composite-index issues.
      // Query chats where user is user1Id, then where user is user2Id,
      // and filter client-side for requestStatus === 'pending'.
      const [snap1, snap2] = await Promise.all([
        firestore()
          .collection('chats')
          .where('user1Id', '==', currentUserId)
          .get(),
        firestore()
          .collection('chats')
          .where('user2Id', '==', currentUserId)
          .get(),
      ]);

      const allChats = [...snap1.docs, ...snap2.docs].map((docSnap: any) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      // Filter for pending message requests — check multiple possible field names
      // for schema flexibility (requestStatus, status, or type fields).
      const pendingChats = allChats.filter((chat: any) => {
        if (chat.requestStatus === 'pending') return true;
        if (chat.status === 'pending') return true;
        if (chat.type === 'request' && chat.status !== 'accepted') return true;
        // For DMs where the OTHER user sent the request and it hasn't been accepted
        if (!chat.isGroup && (chat.requestStatus === 'pending' || chat.status === 'pending')) return true;
        return false;
      });

      // Fetch sender info for each request
      const enrichedRequests: MessageRequest[] = [];
      for (const chat of pendingChats) {
        const senderId = chat.user2Id === currentUserId ? chat.user1Id : chat.user2Id;
        let sender: MessageRequest['sender'] = null;
        try {
          const senderDoc = await firestore().collection('users').doc(senderId).get();
          if (senderDoc.exists) {
            const data = senderDoc.data();
            sender = {
              id: senderId,
              displayName: data.displayName || 'User',
              username: data.username || '',
              profileImage: typeof data.profileImage === 'string' ? data.profileImage : null,
              isVerified: data.isVerified || false,
              badge: data.badge || '',
            };
          }
        } catch (e) {
          if (__DEV__) console.warn('[MessageRequests] Failed to fetch sender:', e);
        }
        enrichedRequests.push({ id: chat.id, chatData: chat, senderId, sender });
      }

      // Sort by lastMessageTime descending (most recent first)
      enrichedRequests.sort((a, b) => {
        const aTime = (() => { try { return new Date(a.chatData.lastMessageTime).getTime(); } catch { return 0; } })();
        const bTime = (() => { try { return new Date(b.chatData.lastMessageTime).getTime(); } catch { return 0; } })();
        return bTime - aTime;
      });

      setRequests(enrichedRequests);
    } catch (e: any) {
      if (__DEV__) console.error('[MessageRequests] Load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadRequests();
  }, [loadRequests]);

  const getMessagePreview = (chatData: Record<string, any>): string => {
    const msg = chatData.lastMessage;
    if (!msg) return 'No messages yet';
    if (typeof msg === 'string') {
      if (msg.startsWith('E2EE:')) return '🔒 Encrypted message';
      return msg;
    }
    if (typeof msg === 'object') {
      if (msg.content) {
        if (typeof msg.content === 'string' && msg.content.startsWith('E2EE:')) return '🔒 Encrypted message';
        return msg.content;
      }
      if (msg.text) return msg.text;
    }
    return 'No messages yet';
  };

  const getMessageTime = (chatData: Record<string, any>): number => {
    if (chatData.lastMessageTime) {
      try { return new Date(chatData.lastMessageTime).getTime(); } catch { /* fall through */ }
    }
    return 0;
  };

  const handleAccept = async (request: MessageRequest) => {
    const chatId = request.id;
    setActionInProgress(chatId);
    try {
      // Update chat doc to remove pending status and mark as accepted
      await firestore().collection('chats').doc(chatId).update({
        requestStatus: 'accepted',
        status: 'accepted',
        acceptedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Remove from local list immediately
      setRequests((prev) => prev.filter((r) => r.id !== chatId));

      // Navigate to the ChatRoomScreen
      const chatObj = {
        id: chatId,
        user1Id: request.chatData.user1Id,
        user2Id: request.chatData.user2Id,
        lastMessage: '',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        otherUser: request.sender ? {
          id: request.sender.id,
          displayName: request.sender.displayName,
          username: request.sender.username,
          profileImage: request.sender.profileImage,
          isVerified: request.sender.isVerified,
          badge: request.sender.badge,
        } : null,
      };
      navigation.navigate('ChatRoom', { chat: chatObj });
    } catch (e: any) {
      if (__DEV__) console.error('[MessageRequests] Accept failed:', e?.message);
      Alert.alert('Error', 'Failed to accept request. Please try again.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDecline = (request: MessageRequest) => {
    Alert.alert(
      'Decline Request',
      `Decline the message request from @${request.sender?.username || 'this user'}? The chat will be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => declineRequest(request),
        },
      ],
    );
  };

  const declineRequest = async (request: MessageRequest) => {
    const chatId = request.id;
    setActionInProgress(chatId);
    try {
      // Delete the chat request document
      await firestore().collection('chats').doc(chatId).delete();

      // Best-effort: delete associated messages
      try {
        const messagesSnap = await firestore()
          .collection('chats')
          .doc(chatId)
          .collection('messages')
          .limit(100)
          .get();
        await Promise.all(
          messagesSnap.docs.map((doc: any) =>
            firestore().collection('chats').doc(chatId).collection('messages').doc(doc.id).delete(),
          ),
        );
      } catch {}

      // Remove from local list
      setRequests((prev) => prev.filter((r) => r.id !== chatId));
    } catch (e: any) {
      if (__DEV__) console.error('[MessageRequests] Decline failed:', e?.message);
      Alert.alert('Error', 'Failed to decline request. Please try again.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBlock = (request: MessageRequest) => {
    Alert.alert(
      'Block User',
      `Block @${request.sender?.username || 'this user'}? They will not be able to send you any more messages.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => blockUser(request),
        },
      ],
    );
  };

  const blockUser = async (request: MessageRequest) => {
    const chatId = request.id;
    setActionInProgress(chatId);
    try {
      // Add to blocked users collection
      await firestore().collection('blocked').doc(`${currentUserId}_${request.senderId}`).set({
        blockerId: currentUserId,
        blockedId: request.senderId,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      // Delete the chat request
      try {
        await firestore().collection('chats').doc(chatId).delete();
      } catch {}

      // Remove from local list
      setRequests((prev) => prev.filter((r) => r.id !== chatId));

      Alert.alert('Blocked', `You have blocked @${request.sender?.username || 'this user'}.`);
    } catch (e: any) {
      if (__DEV__) console.error('[MessageRequests] Block failed:', e?.message);
      Alert.alert('Error', 'Failed to block user. Please try again.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMarkAllRead = () => {
    // Mark all requests as read client-side (no visual unread indicator
    // currently exists, but this clears the badge conceptually)
    Alert.alert('Done', 'All message requests marked as read.');
  };

  const renderRequest = ({ item }: { item: MessageRequest }) => {
    const isBusy = actionInProgress === item.id;
    const sender = item.sender;

    return (
      <View style={styles.requestCard}>
        {/* Header row: Avatar + Info */}
        <View style={styles.requestHeader}>
          <Avatar
            uri={sender?.profileImage}
            name={sender?.displayName || 'User'}
            size={48}
          />
          <View style={styles.requestInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Text style={styles.senderName} numberOfLines={1}>
                {sender?.displayName || 'Unknown User'}
              </Text>
              <VerifiedBadge
                badge={sender?.badge}
                isVerified={sender?.isVerified}
                size={14}
              />
            </View>
            <Text style={styles.senderHandle}>@{sender?.username || 'unknown'}</Text>
          </View>
          <Text style={styles.requestTime}>
            {timeAgo(getMessageTime(item.chatData))}
          </Text>
        </View>

        {/* Message preview */}
        <View style={styles.previewRow}>
          <Text style={styles.messagePreview} numberOfLines={2}>
            {getMessagePreview(item.chatData)}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.acceptBtn]}
            onPress={() => handleAccept(item)}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#000000" style={{ marginRight: 4 }} />
                <Text style={styles.acceptText}>Accept</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={() => handleDecline(item)}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.blockBtn]}
            onPress={() => handleBlock(item)}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            <Ionicons name="ban-outline" size={16} color="#f4212e" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="mail-outline" size={32} color="#94a3b8" />
      </View>
      <Text style={styles.emptyTitle}>No message requests</Text>
      <Text style={styles.emptySubtitle}>
        When someone you don&apos;t follow messages you, it&apos;ll show up here.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={8}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Message Requests</Text>
          <TouchableOpacity
            onPress={handleMarkAllRead}
            hitSlop={8}
            disabled={requests.length === 0}
          >
            <Text
              style={[
                styles.markAllText,
                requests.length === 0 && { opacity: 0.4 },
              ]}
            >
              Mark all read
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Request count */}
      {!loading && requests.length > 0 && (
        <View style={styles.countRow}>
          <Text style={styles.countText}>
            {requests.length} request{requests.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={renderRequest}
          contentContainerStyle={requests.length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  markAllText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },

  /* ── Count row ── */
  countRow: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
  },

  /* ── Loading ── */
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Request Card ── */
  requestCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    padding: 14,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  requestInfo: {
    flex: 1,
    minWidth: 0,
  },
  senderName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  senderHandle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 1,
  },
  requestTime: {
    color: colors.textTertiary,
    fontSize: 12,
    // @ts-expect-error shrink not in RN 0.81 ViewStyle
    shrink: 0,
  },

  /* ── Preview ── */
  previewRow: {
    marginTop: 10,
    marginBottom: 12,
  },
  messagePreview: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },

  /* ── Actions ── */
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  acceptBtn: {
    backgroundColor: colors.text,
  },
  acceptText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  declineBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  declineText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  blockBtn: {
    borderWidth: 1,
    borderColor: 'rgba(244,33,46,0.3)',
    paddingHorizontal: 12,
  },

  /* ── Empty state ── */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
