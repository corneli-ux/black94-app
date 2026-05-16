import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, RefreshControl,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  baseSalary: number;
  commission: number;
  incentive: number;
  total: number;
  paymentStatus: 'Paid' | 'Pending';
  profileImage: string | null;
}

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function SalaryScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      const snap = await firestore()
        .collection('teamMembers')
        .where('businessId', '==', currentUser.uid)
        .orderBy('name', 'asc')
        .limit(100)
        .get();

      const list: TeamMember[] = snap.docs.map(doc => {
        const data = doc.data();
        const base = data.baseSalary || 0;
        const comm = data.commission || 0;
        const inc = data.incentive || 0;
        return {
          id: doc.id,
          name: data.name || 'Unknown',
          role: data.role || 'Team Member',
          baseSalary: base,
          commission: comm,
          incentive: inc,
          total: base + comm + inc,
          paymentStatus: data.paymentStatus || 'Pending',
          profileImage: data.profileImage || null,
        };
      });
      setMembers(list);
    } catch (e) {
      console.error('[Salary] Failed:', e);
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

  const totals = members.reduce(
    (acc, m) => ({
      base: acc.base + m.baseSalary,
      comm: acc.comm + m.commission,
      grand: acc.grand + m.total,
    }),
    { base: 0, comm: 0, grand: 0 },
  );

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Salary</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && canRefresh}
            onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
            tintColor={colors.accent}
            enabled={canRefresh}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {members.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💰</Text>
            <Text style={styles.emptyTitle}>No team members</Text>
            <Text style={styles.emptyText}>
              Add team members to manage their payroll and commissions.
            </Text>
          </View>
        ) : (
          <>
            {/* Column Headers */}
            <View style={styles.columnHeader}>
              <Text style={[styles.colText, { flex: 2 }]}>Name</Text>
              <Text style={[styles.colText, { width: 56 }]}>Salary</Text>
              <Text style={[styles.colText, { width: 56 }]}>Comm.</Text>
              <Text style={[styles.colText, { width: 56 }]}>Total</Text>
              <Text style={[styles.colText, { width: 60 }]}>Status</Text>
            </View>

            {/* Member Rows */}
            {members.map(member => (
              <View key={member.id} style={styles.row}>
                <View style={styles.nameCell}>
                  <Avatar uri={member.profileImage} name={member.name} size={28} />
                  <View style={styles.nameInfo}>
                    <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.memberRole} numberOfLines={1}>{member.role}</Text>
                  </View>
                </View>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.baseSalary)}</Text>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.commission)}</Text>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.total)}</Text>
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: member.paymentStatus === 'Paid' ? 'rgba(0,186,124,0.15)' : 'rgba(255,215,0,0.15)' },
                ]}>
                  <Text style={[
                    styles.statusText,
                    { color: member.paymentStatus === 'Paid' ? colors.accentGreen : colors.accentGold },
                  ]}>
                    {member.paymentStatus}
                  </Text>
                </View>
              </View>
            ))}

            {/* Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Payroll Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total Salaries</Text>
                <Text style={styles.summaryValue}>{formatINR(totals.base)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total Commissions</Text>
                <Text style={styles.summaryValue}>{formatINR(totals.comm)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowLast]}>
                <Text style={styles.summaryLabelGrand}>Grand Total</Text>
                <Text style={styles.summaryValueGrand}>{formatINR(totals.grand)}</Text>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  scroll: { flex: 1 },
  columnHeader: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    paddingHorizontal: 12, marginTop: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  colText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  nameCell: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 4 },
  nameInfo: { flex: 1 },
  memberName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  memberRole: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  cellValue: { width: 56, color: colors.text, fontSize: 13, fontWeight: '500' },
  statusBadge: { width: 60, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
  statusText: { fontSize: 11, fontWeight: '700' },
  summaryCard: {
    marginHorizontal: 12, marginTop: 20, padding: 16,
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  summaryTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 14 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  summaryRowLast: { borderBottomWidth: 0, paddingTop: 12 },
  summaryLabel: { color: colors.textSecondary, fontSize: 14 },
  summaryValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  summaryLabelGrand: { color: colors.text, fontSize: 15, fontWeight: '700' },
  summaryValueGrand: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
});
