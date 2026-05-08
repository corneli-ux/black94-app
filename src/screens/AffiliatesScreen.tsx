import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, RefreshControl,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

interface Affiliate {
  id: string;
  name: string;
  profileImage: string | null;
  badge: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  commissionRate: number;
  totalCommissionsEarned: number;
  status: 'Active' | 'Revoked';
  joinedAt: number;
}

const BADGE_CONFIG: Record<string, { color: string; bg: string }> = {
  Bronze: { color: '#CD7F32', bg: 'rgba(205,127,50,0.15)' },
  Silver: { color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)' },
  Gold: { color: colors.accentGold, bg: 'rgba(255,215,0,0.15)' },
  Platinum: { color: '#E5E4E2', bg: 'rgba(229,228,226,0.15)' },
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
          joinedAt: tsToMillis(data.joinedAt),
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

  const renderItem = ({ item }: { item: Affiliate }) => {
    const badgeCfg = BADGE_CONFIG[item.badge] || BADGE_CONFIG.Bronze;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Avatar uri={item.profileImage} size={44} borderWidth={1} borderColor={colors.border} />
          <View style={styles.cardInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.affiliateName}>{item.name}</Text>
              <View style={[styles.badgePill, { backgroundColor: badgeCfg.bg }]}>
                <Text style={[styles.badgePillText, { color: badgeCfg.color }]}>{item.badge}</Text>
              </View>
            </View>
            <Text style={styles.joinDate}>Joined {timeAgo(item.joinedAt)}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Commission Rate</Text>
            <Text style={styles.statValue}>{item.commissionRate}%</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Earned</Text>
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

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Affiliates</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {/* Summary bar */}
      {!loading && affiliates.length > 0 && (
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
        </View>
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
              <Text style={styles.emptyIcon}>🤝</Text>
              <Text style={styles.emptyTitle}>No affiliates yet</Text>
              <Text style={styles.emptyText}>
                Invite affiliates to promote your products and earn commissions.
              </Text>
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
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  summaryBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 16, paddingHorizontal: 20,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  summaryItem: { alignItems: 'center' },
  summaryNumber: { color: colors.text, fontSize: 18, fontWeight: '800' },
  summaryLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.border },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    padding: 16, marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardInfo: { flex: 1 },
  affiliateName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  badgePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgePillText: { fontSize: 11, fontWeight: '700' },
  joinDate: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  statsRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  statBox: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, alignItems: 'center',
  },
  statLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
});
