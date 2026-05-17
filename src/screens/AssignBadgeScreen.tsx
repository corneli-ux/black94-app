import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, assignAffiliateBadge, searchUsers, User } from '../lib/api';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Affiliate {
  id: string;
  userId: string;
  name: string;
  username: string;
  profileImage: string | null;
  badge: 'None' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  commissionRate: number;
  totalCommissionsEarned: number;
  status: 'Active' | 'Revoked';
  joinedAt: number;
}

const BADGE_TIERS: { value: Affiliate['badge']; label: string; color: string; bg: string }[] = [
  { value: 'None', label: 'None', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { value: 'Bronze', label: 'Bronze', color: '#CD7F32', bg: 'rgba(205,127,50,0.15)' },
  { value: 'Silver', label: 'Silver', color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)' },
  { value: 'Gold', label: 'Gold', color: '#ffd700', bg: 'rgba(255,215,0,0.15)' },
  { value: 'Platinum', label: 'Platinum', color: '#E5E4E2', bg: 'rgba(229,228,226,0.15)' },
];

const FREE_BADGE_LIMIT = 2;
const PAID_BADGE_COST = 99;

export default function AssignBadgeScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;

  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  // Badge assignment state
  const [assigningBadge, setAssigningBadge] = useState<string | null>(null); // affiliate doc id

  // Add team member modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<User[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    try {
      const snap = await firestore()
        .collection('affiliates')
        .where('businessId', '==', currentUser.uid)
        .orderBy('joinedAt', 'desc')
        .limit(100)
        .get();

      const list: Affiliate[] = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId || data.affiliateId || '',
          name: data.name || 'Unknown',
          username: data.username || '',
          profileImage: data.profileImage || null,
          badge: data.badge || 'None',
          commissionRate: data.commissionRate || 0,
          totalCommissionsEarned: data.totalCommissionsEarned || 0,
          status: data.status || 'Active',
          joinedAt: (() => { try { return tsToMillis(data.joinedAt); } catch { return Date.now(); } })(),
        };
      });
      setAffiliates(list);
    } catch (e) {
      console.error('[AssignBadge] Failed to load affiliates:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  useEffect(() => {
    load();
  }, []);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    setCanRefresh(false);
  }, []);

  const handleScrollEndDrag = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset <= 0) setCanRefresh(true);
  }, []);

  // Badge count calculations
  const getBadgeStats = useCallback(() => {
    const assignedBadges = affiliates.filter(a => a.badge !== 'None');
    const freeBadges = Math.min(assignedBadges.length, FREE_BADGE_LIMIT);
    const paidBadges = Math.max(0, assignedBadges.length - FREE_BADGE_LIMIT);
    return { assignedBadges: assignedBadges.length, freeBadges, paidBadges };
  }, [affiliates]);

  const handleAssignBadge = useCallback(async (affiliateId: string, tier: Affiliate['badge']) => {
    if (!currentUser) return;

    // Show confirmation dialog before assigning
    const affiliate = affiliates.find(a => a.id === affiliateId);
    const displayName = affiliate?.name || 'this team member';

    if (tier === 'None') {
      Alert.alert(
        'Remove Badge',
        `Are you sure you want to remove the badge from ${displayName}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => executeBadgeAssign(affiliateId, tier, displayName),
          },
        ],
      );
    } else {
      Alert.alert(
        `Assign ${tier} Badge`,
        `Assign the ${tier} badge to ${displayName}?\n\nThis badge will be visible on their profile and indicates they are verified by your business account.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Assign',
            style: 'default',
            onPress: () => executeBadgeAssign(affiliateId, tier, displayName),
          },
        ],
      );
    }
  }, [currentUser, affiliates]);

  const executeBadgeAssign = useCallback(async (affiliateId: string, tier: Affiliate['badge'], displayName: string) => {
    if (!currentUser) return;
    setAssigningBadge(affiliateId);
    try {
      const success = await assignAffiliateBadge(currentUser.uid, affiliateId, tier);
      if (success) {
        // Update local state
        setAffiliates(prev =>
          prev.map(a => (a.id === affiliateId ? { ...a, badge: tier } : a)),
        );
        const tierLabel = tier === 'None' ? 'badge removed' : `${tier} badge assigned`;
        Alert.alert('Badge Updated', `${tierLabel} for ${displayName} successfully.`);
      } else {
        Alert.alert('Error', 'Failed to assign badge. Please try again.');
      }
    } catch (e) {
      console.error('[AssignBadge] Assign error:', e);
      Alert.alert('Error', 'Failed to assign badge. Please try again.');
    } finally {
      setAssigningBadge(null);
    }
  }, [currentUser]);

  // Add team member handlers
  const handleAddSearch = useCallback(async (query: string) => {
    setAddSearch(query);
    if (!query.trim() || query.trim().length < 2) {
      setAddResults([]);
      setAddSearching(false);
      return;
    }
    setAddSearching(true);
    try {
      const results = await searchUsers(query);
      const existingIds = new Set(affiliates.map(a => a.userId));
      const filtered = results.filter(
        u => u.id !== currentUser?.uid && !existingIds.has(u.id),
      );
      setAddResults(filtered);
    } catch (e) {
      console.error('[AssignBadge] Add search error:', e);
      setAddResults([]);
    } finally {
      setAddSearching(false);
    }
  }, [currentUser, affiliates]);

  const handleAddTeamMember = useCallback(async (user: User) => {
    if (!currentUser) return;
    setAddingUserId(user.id);
    try {
      // Create affiliate document
      await firestore().collection('affiliates').add({
        businessId: currentUser.uid,
        userId: user.id,
        name: user.displayName || user.username,
        username: user.username,
        profileImage: user.profileImage || null,
        badge: 'None',
        commissionRate: 0,
        totalCommissionsEarned: 0,
        status: 'Active',
        joinedAt: firestore.FieldValue.serverTimestamp(),
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      setAddModalVisible(false);
      setAddSearch('');
      setAddResults([]);
      Alert.alert('Team Member Added', `${user.displayName || user.username} has been added to your team.`);
      load();
    } catch (e) {
      console.error('[AssignBadge] Failed to add team member:', e);
      Alert.alert('Error', 'Failed to add team member. Please try again.');
    } finally {
      setAddingUserId(null);
    }
  }, [currentUser, load]);

  const renderBadgeStats = () => {
    const { assignedBadges, freeBadges, paidBadges } = getBadgeStats();
    return (
      <View style={styles.badgeStatsBar}>
        <View style={styles.badgeStatsItem}>
          <Ionicons name="ribbon-outline" size={16} color={colors.accentGold} />
          <Text style={styles.badgeStatsText}>
            {assignedBadges} badge{assignedBadges !== 1 ? 's' : ''} assigned
          </Text>
        </View>
        <View style={styles.badgeStatsDivider} />
        <View style={styles.badgeStatsItem}>
          <Text style={styles.badgeStatsDetail}>
            {freeBadges} of {FREE_BADGE_LIMIT} free used
            {paidBadges > 0 && ` + ${paidBadges} paid (₹${PAID_BADGE_COST * paidBadges})`}
          </Text>
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: Affiliate }) => {
    const currentTierConfig = BADGE_TIERS.find(t => t.value === item.badge) || BADGE_TIERS[0];
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Avatar uri={item.profileImage} name={item.name} size={44} borderWidth={1} borderColor={colors.border} />
          <View style={styles.cardInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.affiliateName}>{item.name}</Text>
              {item.username ? (
                <Text style={styles.affiliateUsername}>@{item.username}</Text>
              ) : null}
            </View>
            <View style={styles.currentBadgeRow}>
              <View style={[styles.badgePill, { backgroundColor: currentTierConfig.bg }]}>
                <Text style={[styles.badgePillText, { color: currentTierConfig.color }]}>
                  {item.badge}
                </Text>
              </View>
              {item.badge !== 'None' && (
                <Text style={styles.verifiedByLabel}>Verified by your business</Text>
              )}
              <Text style={styles.joinDate}>Joined {new Date(item.joinedAt).toLocaleDateString()}</Text>
            </View>
          </View>
        </View>

        {/* Badge tier selector */}
        <View style={styles.tierSelector}>
          <Text style={styles.tierSelectorLabel}>Assign Badge</Text>
          <View style={styles.tierOptions}>
            {BADGE_TIERS.map(tier => {
              const isActive = item.badge === tier.value;
              const isAssigning = assigningBadge === item.id;
              return (
                <TouchableOpacity
                  key={tier.value}
                  style={[
                    styles.tierOption,
                    isActive && { backgroundColor: tier.bg, borderColor: tier.color },
                  ]}
                  onPress={() => handleAssignBadge(item.id, tier.value)}
                  disabled={isAssigning}
                  activeOpacity={0.7}
                >
                  {isAssigning && isActive ? (
                    <ActivityIndicator size="small" color={tier.color} />
                  ) : (
                    <View
                      style={[
                        styles.tierRadioOuter,
                        isActive && { borderColor: tier.color },
                      ]}
                    >
                      {isActive && (
                        <View style={[styles.tierRadioInner, { backgroundColor: tier.color }]} />
                      )}
                    </View>
                  )}
                  <Text
                    style={[
                      styles.tierOptionText,
                      isActive && { color: tier.color, fontWeight: '700' },
                    ]}
                  >
                    {tier.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  // Add team member modal
  const renderAddModal = () => (
    <Modal
      visible={addModalVisible}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setAddModalVisible(false)}
    >
      <View style={styles.addModalContainer}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          {/* Modal Header */}
          <View style={styles.addModalHeader}>
            <TouchableOpacity onPress={() => setAddModalVisible(false)} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.addModalTitle}>Add Team Member</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Search */}
          <View style={styles.addSearchContainer}>
            <Ionicons name="search" size={18} color="#64748b" />
            <TextInput
              style={styles.addSearchInput}
              placeholder="Search by username or name..."
              placeholderTextColor="#64748b"
              value={addSearch}
              onChangeText={handleAddSearch}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />
            {addSearching && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 8 }} />
            )}
          </View>

          {/* Results */}
          <View style={styles.addResultsContainer}>
            {addSearch.trim().length >= 2 && !addSearching && addResults.length === 0 && (
              <View style={styles.addEmptyContainer}>
                <Ionicons name="person-add-outline" size={36} color="#64748b" />
                <Text style={styles.addEmptyText}>No users found</Text>
                <Text style={styles.addEmptySubtext}>Try a different search term</Text>
              </View>
            )}

            {addSearch.trim().length < 2 && (
              <View style={styles.addEmptyContainer}>
                <Ionicons name="people-outline" size={36} color="#64748b" />
                <Text style={styles.addEmptyText}>Find a user to add</Text>
                <Text style={styles.addEmptySubtext}>Enter a username or display name (min. 2 characters)</Text>
              </View>
            )}

            {addResults.map(user => (
              <TouchableOpacity
                key={user.id}
                style={styles.addResultRow}
                onPress={() => handleAddTeamMember(user)}
                disabled={addingUserId === user.id}
                activeOpacity={0.7}
              >
                <Avatar uri={user.profileImage} name={user.displayName} size={40} />
                <View style={styles.addResultInfo}>
                  <Text style={styles.addResultName}>{user.displayName || user.username}</Text>
                  <Text style={styles.addResultUsername}>@{user.username}</Text>
                </View>
                {addingUserId === user.id ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="add-circle-outline" size={28} color={colors.accentGreen} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Assign Badges</Text>
            <View style={{ width: 32 }} />
          </View>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Assign Badges</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {/* Badge stats bar */}
      {renderBadgeStats()}

      {/* Add team member button */}
      <View style={styles.addBtnContainer}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModalVisible(true)} activeOpacity={0.7}>
          <Ionicons name="person-add-outline" size={18} color={colors.accent} />
          <Text style={styles.addBtnText}>Add Team Member</Text>
        </TouchableOpacity>
      </View>

      {/* Affiliates list */}
      <FlatList
        data={affiliates}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        onScroll={handleScroll}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onScrollEndDrag={handleScrollEndDrag}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && canRefresh}
            onRefresh={() => {
              if (canRefresh) {
                setRefreshing(true);
                load();
              }
            }}
            tintColor={colors.accent}
            enabled={canRefresh}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏅</Text>
            <Text style={styles.emptyTitle}>No team members yet</Text>
            <Text style={styles.emptyText}>
              Add team members to assign badges and manage your affiliate team.
            </Text>
          </View>
        }
      />

      {/* Add team member modal */}
      {renderAddModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },

  /* ── Badge Stats Bar ── */
  badgeStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,215,0,0.05)',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,215,0,0.1)',
  },
  badgeStatsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeStatsText: {
    color: colors.accentGold,
    fontSize: 14,
    fontWeight: '600',
  },
  badgeStatsDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,215,0,0.2)',
    marginHorizontal: 12,
  },
  badgeStatsDetail: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },

  /* ── Add Button ── */
  addBtnContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(42,127,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(42,127,255,0.3)',
    borderRadius: 12,
    paddingVertical: 12,
  },
  addBtnText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ── List ── */
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
  },

  /* ── Card ── */
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  affiliateName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  affiliateUsername: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  currentBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  badgePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  joinDate: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  verifiedByLabel: {
    color: colors.accentGreen,
    fontSize: 11,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  /* ── Tier Selector ── */
  tierSelector: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  tierSelectorLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tierOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tierRadioOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tierOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },

  /* ── Empty State ── */
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  /* ── Add Modal ── */
  addModalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  addModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  addModalTitle: {
    color: '#e7e9ea',
    fontSize: 17,
    fontWeight: '700',
  },
  addSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  addSearchInput: {
    flex: 1,
    color: '#e7e9ea',
    fontSize: 15,
    height: 44,
    paddingVertical: 0,
  },
  addResultsContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  addEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  addEmptyText: {
    color: '#e7e9ea',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
  },
  addEmptySubtext: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  addResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  addResultInfo: {
    flex: 1,
    minWidth: 0,
  },
  addResultName: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
  },
  addResultUsername: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
  },
});
