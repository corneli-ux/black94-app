import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Alert, TextInput, Modal, KeyboardAvoidingView, Platform, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar } from '../components/Avatar';
import { auth, firestore } from '../lib/firebase';

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

  // Form modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formSalary, setFormSalary] = useState('');
  const [formCommission, setFormCommission] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const currentUid = auth()?.currentUser?.uid;
    if (!currentUid) { setLoading(false); return; }
    try {
      const snap = await firestore()
        .collection('teamMembers')
        .where('businessId', '==', currentUid)
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
  }, []);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAddModal = () => {
    setEditingId(null);
    setFormName('');
    setFormRole('');
    setFormSalary('');
    setFormCommission('');
    setModalVisible(true);
  };

  const openEditModal = (member: TeamMember) => {
    setEditingId(member.id);
    setFormName(member.name);
    setFormRole(member.role);
    setFormSalary(String(member.baseSalary));
    setFormCommission(String(member.commission));
    setModalVisible(true);
  };

  const handleSaveMember = async () => {
    const saveUid = auth()?.currentUser?.uid;
    if (!saveUid || !formName.trim()) {
      Alert.alert('Validation', 'Name is required.');
      return;
    }
    setSaving(true);
    try {
      const salary = Number(formSalary) || 0;
      const commission = Number(formCommission) || 0;
      const total = salary + commission;

      if (editingId) {
        // Update existing
        await firestore().collection('teamMembers').doc(editingId).update({
          name: formName.trim(),
          role: formRole.trim() || 'Team Member',
          baseSalary: salary,
          commission,
          total,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // Create new
        await firestore().collection('teamMembers').add({
          businessId: saveUid,
          name: formName.trim(),
          role: formRole.trim() || 'Team Member',
          baseSalary: salary,
          commission,
          total,
          paymentStatus: 'Pending',
          createdAt: firestore.FieldValue.serverTimestamp(),
        });
      }
      setModalVisible(false);
      load();
    } catch (e) {
      console.error('[Salary] Save failed:', e);
      Alert.alert('Error', 'Failed to save member.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMember = (member: TeamMember) => {
    Alert.alert(
      'Delete Member',
      `Remove ${member.name} from the team?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await firestore().collection('teamMembers').doc(member.id).delete();
              load();
            } catch (e) {
              console.error('[Salary] Delete failed:', e);
              Alert.alert('Error', 'Failed to delete member.');
            }
          },
        },
      ],
    );
  };

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
          <TouchableOpacity onPress={openAddModal} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
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
                <TouchableOpacity style={styles.nameCell} onPress={() => openEditModal(member)}>
                  <Avatar uri={member.profileImage} name={member.name} size={28} />
                  <View style={styles.nameInfo}>
                    <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.memberRole} numberOfLines={1}>{member.role}</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.baseSalary)}</Text>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.commission)}</Text>
                <Text style={styles.cellValue} numberOfLines={1}>{formatINR(member.total)}</Text>
                <View style={styles.statusAndActions}>
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
                  <TouchableOpacity onPress={() => handleDeleteMember(member)} hitSlop={8}>
                    <Text style={styles.deleteIcon}>✕</Text>
                  </TouchableOpacity>
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

      {/* Add/Edit Member Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit Member' : 'Add Member'}</Text>
            <TextInput
              style={styles.formInput}
              placeholder="Name *"
              placeholderTextColor={colors.textSecondary}
              value={formName}
              onChangeText={setFormName}
              autoFocus
            />
            <TextInput
              style={styles.formInput}
              placeholder="Role"
              placeholderTextColor={colors.textSecondary}
              value={formRole}
              onChangeText={setFormRole}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Salary (₹)"
              placeholderTextColor={colors.textSecondary}
              value={formSalary}
              onChangeText={setFormSalary}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.formInput}
              placeholder="Commission (₹)"
              placeholderTextColor={colors.textSecondary}
              value={formCommission}
              onChangeText={setFormCommission}
              keyboardType="numeric"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveMember} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  // Add/Edit modal
  addBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  deleteIcon: { color: '#f43f5e', fontSize: 16, fontWeight: '700', marginLeft: 4 },
  statusAndActions: { width: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  formInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 15, marginBottom: 10 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modalCancelText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
