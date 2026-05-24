import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { AppIcon } from '../components/icons';

interface MemberInfo {
  id: string;
  displayName: string;
  username: string;
  profileImage: string | null;
  isVerified: boolean;
  badge: string;
}

interface GroupChatData {
  id: string;
  groupName: string;
  groupImage: string | null;
  participants: string[];
  createdBy: string;
  isGroup: boolean;
  description?: string;
  createdAt?: any;
}

export default function GroupInfoScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const chatId = route.params?.chatId;
  const { user } = useAppStore();
  const currentUserId = auth()?.currentUser?.uid;

  const [chatData, setChatData] = useState<GroupChatData | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [muted, setMuted] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const isAdmin = chatData?.createdBy === currentUserId;

  const loadGroupInfo = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch chat document
      const chatSnap = await firestore().collection('chats').doc(chatId).get();
      if (!chatSnap.exists) {
        setError('Group not found');
        setLoading(false);
        return;
      }

      const data = chatSnap.data();
      const groupData: GroupChatData = {
        id: chatSnap.id,
        groupName: data.groupName || 'Unnamed Group',
        groupImage: typeof data.groupImage === 'string' ? data.groupImage : null,
        participants: data.members || data.participants || [],
        createdBy: data.createdBy || '',
        isGroup: data.isGroup || false,
        description: data.description || '',
        createdAt: data.createdAt,
      };
      setChatData(groupData);

      // Check mute status — load from local preference stored on the chat doc
      // or from a subcollection. We'll check a mutedUsers array on the chat doc.
      const mutedString = data.mutedUsers || [];
      if (Array.isArray(mutedString) && currentUserId) {
        setMuted(mutedString.includes(currentUserId));
      }

      // Fetch user data for each participant
      const participantIds = groupData.participants || [];
      const memberPromises = participantIds.map(async (uid: string) => {
        try {
          const userDoc = await firestore().collection('users').doc(uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            return {
              id: uid,
              displayName: userData.displayName || 'User',
              username: userData.username || '',
              profileImage: typeof userData.profileImage === 'string' ? userData.profileImage : null,
              isVerified: userData.isVerified || false,
              badge: userData.badge || '',
            };
          }
        } catch (e) {
          if (__DEV__) console.warn('[GroupInfo] Failed to fetch member:', uid, e);
        }
        return {
          id: uid,
          displayName: 'User',
          username: '',
          profileImage: null,
          isVerified: false,
          badge: '',
        };
      });

      const fetchedMembers = await Promise.all(memberPromises);
      // Sort: creator first, then alphabetically by displayName
      fetchedMembers.sort((a, b) => {
        if (a.id === groupData.createdBy) return -1;
        if (b.id === groupData.createdBy) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
      setMembers(fetchedMembers);
    } catch (e: any) {
      if (__DEV__) console.error('[GroupInfo] Load error:', e?.message);
      setError('Failed to load group info. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [chatId, currentUserId]);

  useEffect(() => {
    loadGroupInfo();
  }, [loadGroupInfo]);

  const handleAddMembers = () => {
    Alert.alert('Add Members', 'Feature coming soon');
  };

  const handleLeaveGroup = () => {
    if (!chatData) return;
    const isCreator = chatData.createdBy === currentUserId;
    Alert.alert(
      isCreator ? 'Delete Group' : 'Leave Group',
      isCreator
        ? 'You are the creator of this group. Leaving will delete it for all members. This cannot be undone.'
        : 'Are you sure you want to leave this group? You can be added back later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isCreator ? 'Delete' : 'Leave',
          style: 'destructive',
          onPress: () => executeLeave(),
        },
      ],
    );
  };

  const executeLeave = async () => {
    if (!chatId || !chatData || !currentUserId) return;
    setLeaving(true);
    try {
      if (chatData.createdBy === currentUserId) {
        // Creator leaving — delete the entire group
        await firestore().collection('chats').doc(chatId).delete();
        // Best-effort delete messages
        try {
          const msgsSnap = await firestore()
            .collection('chats')
            .doc(chatId)
            .collection('messages')
            .limit(100)
            .get();
          await Promise.all(
            msgsSnap.docs.map((doc: any) =>
              firestore().collection('chats').doc(chatId).collection('messages').doc(doc.id).delete(),
            ),
          );
        } catch {}
        navigation.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages' } });
      } else {
        // Regular member leaving — remove from members
        const updatedParticipants = (chatData.participants || []).filter(
          (uid: string) => uid !== currentUserId,
        );
        await firestore().collection('chats').doc(chatId).update({
          members: updatedParticipants,
        });
        // Go back to chat list
        navigation.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages' } });
      }
    } catch (e: any) {
      if (__DEV__) console.error('[GroupInfo] Leave failed:', e?.message);
      Alert.alert('Error', 'Failed to leave group. Please try again.');
    } finally {
      setLeaving(false);
    }
  };

  const handleRemoveMember = (member: MemberInfo) => {
    Alert.alert(
      'Remove Member',
      `Remove @${member.username || member.displayName} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMember(member.id),
        },
      ],
    );
  };

  const removeMember = async (memberId: string) => {
    if (!chatId || !chatData) return;
    setRemoving(memberId);
    try {
      const updatedParticipants = (chatData.participants || []).filter(
        (uid: string) => uid !== memberId,
      );
      await firestore().collection('chats').doc(chatId).update({
        members: updatedParticipants,
      });
      // Update local state
      setChatData({ ...chatData, participants: updatedParticipants });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e: any) {
      if (__DEV__) console.error('[GroupInfo] Remove member failed:', e?.message);
      Alert.alert('Error', 'Failed to remove member. Please try again.');
    } finally {
      setRemoving(null);
    }
  };

  const handleToggleMute = async (value: boolean) => {
    if (!chatId || !currentUserId || !chatData) return;
    setMuted(value);
    try {
      // Read the current doc's mutedUsers array
      const chatSnap = await firestore().collection('chats').doc(chatId).get();
      const data = chatSnap.exists ? chatSnap.data() : {};
      let mutedUsers: string[] = Array.isArray(data.mutedUsers) ? [...data.mutedUsers] : [];

      if (value) {
        if (!mutedUsers.includes(currentUserId)) {
          mutedUsers.push(currentUserId);
        }
      } else {
        mutedUsers = mutedUsers.filter((uid: string) => uid !== currentUserId);
      }

      await firestore().collection('chats').doc(chatId).update({
        mutedUsers,
      });
    } catch (e: any) {
      if (__DEV__) console.error('[GroupInfo] Mute toggle failed:', e?.message);
      setMuted(!value); // Revert
      Alert.alert('Error', 'Failed to update notification settings.');
    }
  };

  const renderMember = ({ item }: { item: MemberInfo }) => {
    const isSelf = item.id === currentUserId;
    const isCreator = item.id === chatData?.createdBy;
    const canRemove = isAdmin && !isSelf && !isCreator;
    const isRemoving = removing === item.id;

    return (
      <View style={styles.memberRow}>
        <Avatar uri={item.profileImage} name={item.displayName} size={40} />
        <View style={styles.memberInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={styles.memberName} numberOfLines={1}>
              {item.displayName}
            </Text>
            <VerifiedBadge badge={item.badge} isVerified={item.isVerified} size={14} />
          </View>
          <Text style={styles.memberHandle}>
            @{item.username}
            {isSelf && ' (You)'}
            {isCreator && !isSelf && ' — Creator'}
          </Text>
        </View>
        {canRemove && (
          <TouchableOpacity
            onPress={() => handleRemoveMember(item)}
            disabled={isRemoving}
            hitSlop={8}
            style={styles.removeBtn}
          >
            {isRemoving ? (
              <ActivityIndicator size="small" color={colors.accentRed} />
            ) : (
              <AppIcon name="remove-circle-outline" size={20} color={colors.accentRed} />
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderMemberHeader = () => (
    <>
      {/* Add Members button */}
      <TouchableOpacity
        style={styles.addMembersBtn}
        onPress={handleAddMembers}
        activeOpacity={0.7}
      >
        <View style={styles.addMembersIcon}>
          <AppIcon name="person-add-outline" size="md" color={colors.accent} />
        </View>
        <Text style={styles.addMembersText}>Add members</Text>
      </TouchableOpacity>

      <Text style={styles.membersSectionTitle}>
        Members · {members.length}
      </Text>
    </>
  );

  // ── Error state ──
  if (error && !loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={8}
              style={styles.backBtn}
            >
              <AppIcon name="arrow-back" size="lg" color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Group Info</Text>
            <View style={{ width: 36 }} />
          </View>
        </SafeAreaView>
        <View style={styles.errorContainer}>
          <AppIcon name="error-outline" size="hero" color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadGroupInfo}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Loading state ──
  if (loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={8}
              style={styles.backBtn}
            >
              <AppIcon name="arrow-back" size="lg" color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Group Info</Text>
            <View style={{ width: 36 }} />
          </View>
        </SafeAreaView>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

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
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Group Info</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={renderMember}
        ListHeaderComponent={renderMemberHeader}
        ListFooterComponent={
          <View style={styles.footerActions}>
            {/* Mute Notifications */}
            <View style={styles.footerActionRow}>
              <View style={styles.footerActionInfo}>
                <AppIcon name={muted ? 'notifications-off' : 'notifications-outlined'} size={20} color={colors.text} />
                <Text style={styles.footerActionLabel}>Mute Notifications</Text>
              </View>
              <Switch
                value={muted}
                onValueChange={handleToggleMute}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={muted ? colors.white : colors.textMuted}
              />
            </View>

            {/* Leave Group */}
            <TouchableOpacity
              style={styles.leaveBtn}
              onPress={handleLeaveGroup}
              disabled={leaving}
              activeOpacity={0.7}
            >
              {leaving ? (
                <ActivityIndicator size="small" color={colors.accentRed} />
              ) : (
                <>
                  <AppIcon name="exit-outline" size="md" color={colors.accentRed} style={{ marginRight: 8 }} />
                  <Text style={styles.leaveText}>
                    {chatData?.createdBy === currentUserId ? 'Delete Group' : 'Leave Group'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      {/* Group header overlay — positioned at top of FlatList content */}
      {chatData && (
        <View style={styles.groupHeaderCard}>
          {/* Group avatar */}
          <View style={styles.groupAvatarContainer}>
            {chatData.groupImage ? (
              <Avatar uri={chatData.groupImage} name={chatData.groupName} size={80} />
            ) : (
              <View style={styles.groupAvatarFallback}>
                <Text style={styles.groupAvatarLetter}>
                  {chatData.groupName?.charAt(0)?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>

          {/* Group name */}
          <Text style={styles.groupName} numberOfLines={1}>
            {chatData.groupName}
          </Text>

          {/* Description */}
          {chatData.description ? (
            <Text style={styles.groupDescription} numberOfLines={2}>
              {chatData.description}
            </Text>
          ) : null}

          {/* Member count */}
          <Text style={styles.memberCount}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </Text>
        </View>
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

  /* ── Loading ── */
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Error ── */
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  retryText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '700',
  },

  /* ── Group Header Card ── */
  groupHeaderCard: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: colors.bg,
    zIndex: 1,
  },
  groupAvatarContainer: {
    marginBottom: 12,
  },
  groupAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.separator,
  },
  groupAvatarLetter: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
  },
  groupName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  groupDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  memberCount: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 6,
  },

  /* ── Members Section ── */
  addMembersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: 160,
    marginBottom: 4,
  },
  addMembersIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(212,175,55,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMembersText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  membersSectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
    marginTop: 4,
  },

  /* ── Member Row ── */
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  memberHandle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 1,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Footer Actions ── */
  footerActions: {
    marginTop: 20,
    marginHorizontal: 16,
    borderTopWidth: 0.5,
    borderTopColor: colors.separator,
    paddingTop: 8,
  },
  footerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  footerActionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerActionLabel: {
    color: colors.text,
    fontSize: 15,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244,33,46,0.3)',
  },
  leaveText: {
    color: colors.accentRed,
    fontSize: 15,
    fontWeight: '600',
  },
});
