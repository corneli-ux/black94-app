import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';

interface Affiliate {
  id: string;
  name: string;
  profileImage: string | null;
  badge: 'None' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  commissionRate: number;
  totalCommissionsEarned: number;
  status: 'Active' | 'Revoked';
  joinedAt: number;
}

const BADGE_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  None: { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: 'ribbon-outline' },
  Bronze: { color: '#CD7F32', bg: 'rgba(205,127,50,0.15)', icon: 'medal-outline' },
  Silver: { color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)', icon: 'medal-outline' },
  Gold: { color: colors.accentGold, bg: 'rgba(255,215,0,0.15)', icon: 'trophy-outline' },
  Platinum: { color: '#E5E4E2', bg: 'rgba(229,228,226,0.15)', icon: 'diamond-outline' },
};

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function AffiliatesScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
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
          name: data.name || 'Unknown',
          profileImage: data.profileImage || null,
          badge: data.badge || 'Bronze',
          commissionRate: data.commissionRate || 0,
          totalCommissionsEarned: data.totalCommissionsEarned || 0,
          status: data.status || 'Active',
          joinedAt: (() => { try { return tsToMillis(data.joinedAt); } catch { return Date.now(); } })(),
        };
      });
      setAffiliates(list);
    } catch (e) {
      console.error('[Affiliates] Failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => { load(); }, []);

  // Badge tier counts for summary
  const getBadgeCounts = useCallback(() => {
    const counts: Record<string, number> = { None: 0, Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 };
    for (const a of affiliates) {
      const tier = a.badge || 'None';
      counts[tier] = (counts[tier] || 0) + 1;
    }
    return counts;
  }, [affiliates]);

  const renderItem = ({ item }: { item: Affiliate }) => {
    const badgeCfg = BADGE_CONFIG[item.badge] || BADGE_CONFIG.Bronze;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Avatar uri={item.profileImage} name={item.name} size={44} borderWidth={1} borderColor={colors.border} />
          <View style={styles.cardInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.affiliateName}>{item.name}</Text>
            </View>
            <Text style={styles.joinDate}>Joined {timeAgo(item.joinedAt)}</Text>
          </View>

          {/* Prominent badge tier display */}
          <View style={[styles.badgeDisplay, { backgroundColor: badgeCfg.bg, borderColor: badgeCfg.color }]}>
            <Ionicons name={badgeCfg.icon as any} size={14} color={badgeCfg.color} />
            <Text style={[styles.badgeDisplayText, { color: badgeCfg.color }]}>
              {item.badge}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Commission</Text>
            <Text style={styles.statValue}>{item.commissionRate}%</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Earned</Text>
            <Text style={styles.statValue}>{formatINR(item.totalCommissionsEarned)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Status</Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: item.status === 'Active' ? 'rgba(0,186,124,0.15)' : 'rgba(244,33,46,0.15)' },
            ]}>
              <Text style={[
                styles.statusText,
                { color: item.status === 'Active' ? colors.accentGreen : colors.accentRed },
              ]}>
                {item.status}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  // Badge breakdown section
  const renderBadgeBreakdown = () => {
    const counts = getBadgeCounts();
    const tierEntries = Object.entries(counts).filter(([, count]) => count > 0);
    if (tierEntries.length === 0) return null;

    return (
      <View style={styles.badgeBreakdown}>
        <Text style={styles.badgeBreakdownLabel}>Badge Breakdown</Text>
        <View style={styles.badgeBreakdownRow}>
          {Object.entries(BADGE_CONFIG).map(([tier, cfg]) => {
            const count = counts[tier] || 0;
            if (count === 0) return null;
            return (
              <View key={tier} style={styles.badgeBreakdownItem}>
                <View style={[styles.badgeBreakdownPill, { backgroundColor: cfg.bg }]}>
                  <Text style={[styles.badgeBreakdownPillText, { color: cfg.color }]}>{tier}</Text>
                </View>
                <Text style={styles.badgeBreakdownCount}>{count}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Affiliates</Text>
          {/* Assign Badges button in header */}
          <TouchableOpacity
            style={styles.assignBadgeBtn}
            onPress={() => navigation.navigate('AssignBadge')}
            activeOpacity={0.7}
          >
            <Ionicons name="ribbon-outline" size={20} color={colors.accentGold} />
            <Text style={styles.assignBadgeBtnText}>Badges</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Summary bar */}
      {!loading && affiliates.length > 0 && (
        <>
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNumber}>{affiliates.length}</Text>
              <Text style={styles.summaryLabel}>Total</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNumber}>
                {affiliates.filter(a => a.status === 'Active').length}
              </Text>
              <Text style={styles.summaryLabel}>Active</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNumber}>
                {formatINR(affiliates.reduce((sum, a) => sum + a.totalCommissionsEarned, 0))}
              </Text>
              <Text style={styles.summaryLabel}>Paid Out</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="ribbon-outline" size={14} color={colors.accentGold} style={{ marginBottom: 2 }} />
              <Text style={styles.summaryNumber}>
                {affiliates.filter(a => a.badge && a.badge !== 'None').length}
              </Text>
              <Text style={styles.summaryLabel}>Badged</Text>
            </View>
          </View>
          {renderBadgeBreakdown()}
        </>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={affiliates}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && canRefresh}
              onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
              tintColor={colors.accent}
              enabled={canRefresh}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#64748b" />
              <Text style={styles.emptyTitle}>No affiliates yet</Text>
              <Text style={styles.emptyText}>
                Invite affiliates to promote your products and earn commissions.
              </Text>
              <TouchableOpacity
                style={styles.emptyActionBtn}
                onPress={() => navigation.navigate('AssignBadge')}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={20} color={colors.accent} />
                <Text style={styles.emptyActionBtnText}>Add Team Members & Assign Badges</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  assignBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  assignBadgeBtnText: {
    color: colors.accentGold,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 16, paddingHorizontal: 16,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  summaryItem: { alignItems: 'center', gap: 2 },
  summaryNumber: { color: colors.text, fontSize: 18, fontWeight: '800' },
  summaryLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500', marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.border },

  /* ── Badge Breakdown ── */
  badgeBreakdown: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  badgeBreakdownLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  badgeBreakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badgeBreakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeBreakdownPill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeBreakdownPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeBreakdownCount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },

  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    padding: 16, marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardInfo: { flex: 1, minWidth: 0 },
  affiliateName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  joinDate: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },

  /* ── Prominent Badge Display ── */
  badgeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 80,
    justifyContent: 'center',
  },
  badgeDisplayText: {
    fontSize: 13,
    fontWeight: '700',
  },

  statsRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  statBox: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, alignItems: 'center',
  },
  statLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 100, paddingHorizontal: 32 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(42,127,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(42,127,255,0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 24,
  },
  emptyActionBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
