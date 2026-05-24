import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';
import { AppIcon } from '../components/icons';

type ExportStatus = 'none' | 'pending' | 'processing' | 'ready';

const STATUS_CONFIG: Record<string, { label: string; icon: string; iconColor: string }> = {
  pending:    { label: 'Queued',       icon: 'time-outline',    iconColor: colors.accentGold },
  processing: { label: 'Processing',   icon: 'sync-outline',    iconColor: '#60a5fa' },
  ready:      { label: 'Ready',        icon: 'checkmark-circle', iconColor: colors.accentGreen },
};

const POLL_INTERVAL = 8000; // Poll every 8 seconds while export is pending/processing

export default function DataExportScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [exportDocId, setExportDocId] = useState<string | null>(null);
  const [status, setStatus] = useState<ExportStatus>('none');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollExportStatus = useCallback(async () => {
    if (!user?.id) return;
    try {
      const snap = await firestore()
        .collection('data_exports')
        .where('userId', '==', user.id)
        .orderBy('requestedAt', 'desc')
        .limit(1)
        .get();

      if (snap.empty) {
        setStatus('none');
        setExportDocId(null);
      } else {
        const doc = snap.docs[0];
        setExportDocId(doc.id);
        setStatus(doc.data().status || 'pending');
      }
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    // Initial fetch
    pollExportStatus();

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [user?.id, pollExportStatus]);

  // Start/stop polling based on status — only poll while pending or processing
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (status === 'pending' || status === 'processing') {
      pollRef.current = setInterval(pollExportStatus, POLL_INTERVAL);
    }
    // When status is 'none' or 'ready', no need to poll

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status, pollExportStatus]);

  const handleRequest = async () => {
    if (!user?.id) return;

    Alert.alert(
      'Request Data Export',
      'We will compile your profile, posts, comments, and message metadata into a downloadable archive. This may take a few minutes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: async () => {
            setRequesting(true);
            try {
              await firestore().collection('data_exports').add({
                userId: user.id,
                status: 'pending',
                requestedAt: firestore.FieldValue.serverTimestamp(),
              });
              // Immediately poll to pick up the new export request
              pollExportStatus();
            } catch {
              Alert.alert('Error', 'Could not request data export. Please try again.');
            } finally {
              setRequesting(false);
            }
          },
        },
      ],
    );
  };

  const handleDownload = () => {
    Alert.alert('Export Ready', 'Your data export is ready. Check your email for the download link.');
  };

  const InfoItem = ({ icon, text }: { icon: string; text: string }) => (
    <View style={styles.infoItem}>
      <AppIcon name={icon} size="md" color={colors.accent} style={styles.infoIcon} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Data Export</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <AppIcon name="arrow-back" size="lg" color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Data Export</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>GDPR / DPDP Act Compliance</Text>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <AppIcon name="verified-user" size={20} color={colors.accent} />
            <Text style={styles.cardTitle}>Your Right to Data Portability</Text>
          </View>
          <Text style={styles.cardDescription}>
            You have the right to obtain a copy of your personal data in a structured, commonly used,
            and machine-readable format. Tap the button below to request a full export.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>What's Included</Text>
        <View style={styles.card}>
          <InfoItem icon="person-outline" text="Profile information and account settings" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="document-text-outline" text="All your posts and articles" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="chatbubble-outline" text="Comments you've made" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="mail-outline" text="Message metadata (timestamps, participants)" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="images-outline" text="Media uploads and attachments" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="chatbubbles-outline" text="Direct messages (metadata: timestamps, participants)" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="call-outline" text="Call history (timestamps, duration, participants)" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="phone-portrait-outline" text="Device session history" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="heart-outline" text="Liked posts and bookmarks" />
          <View style={styles.infoSeparator} />
          <InfoItem icon="stats-chart-outline" text="Engagement data" />
        </View>

        {/* Status section */}
        {status !== 'none' && (
          <>
            <Text style={styles.sectionTitle}>Current Request</Text>
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <AppIcon
                  name={STATUS_CONFIG[status]?.icon || 'help-outline'}
                  size={20}
                  color={STATUS_CONFIG[status]?.iconColor || colors.textMuted}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.statusLabel}>
                    Status: {STATUS_CONFIG[status]?.label || status}
                  </Text>
                  <Text style={styles.statusSub}>
                    {status === 'pending' && 'Your export request is queued and will be processed shortly.'}
                    {status === 'processing' && 'We are compiling your data. This usually takes a few minutes.'}
                    {status === 'ready' && 'Your data export is complete and ready to download.'}
                  </Text>
                </View>
              </View>

              {status === 'processing' && (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8, marginLeft: 32 }} />
              )}

              {status === 'ready' && (
                <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
                  <AppIcon name="download" size="md" color={colors.bg} />
                  <Text style={styles.downloadBtnText}>Download Export</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Request button */}
        {status === 'none' && (
          <TouchableOpacity
            style={[styles.requestBtn, requesting && { opacity: 0.6 }]}
            onPress={handleRequest}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <>
                <AppIcon name="archive" size="md" color={colors.bg} />
                <Text style={styles.requestBtnText}>Request Data Export</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Pending/Processing — show disabled button or waiting message */}
        {(status === 'pending' || status === 'processing') && (
          <View style={styles.waitingCard}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.waitingText}>
              {status === 'pending'
                ? 'You already have a pending request. Please wait for it to be processed.'
                : 'Your export is currently being prepared. You\'ll be notified when it\'s ready.'}
            </Text>
          </View>
        )}

        {/* Grievance Officer */}
        <Text style={styles.sectionTitle}>Grievance Officer</Text>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <AppIcon name="gavel-outline" size={20} color={colors.accent} />
            <Text style={styles.cardTitle}>Grievance Officer</Text>
          </View>
          <Text style={styles.cardDescription}>
            Under the Digital Personal Data Protection (DPDP) Act 2023, you have the right to lodge a
            grievance regarding your personal data. Our Grievance Officer will respond within 30 days.
          </Text>
          <TouchableOpacity
            style={styles.grievanceEmailRow}
            onPress={() => Linking.openURL('mailto:grievance@black94.com')}
          >
            <AppIcon name="mail-outline" size={16} color={colors.accent} />
            <Text style={styles.grievanceEmail}>grievance@black94.com</Text>
            <AppIcon name="open-in-new" size="sm" color={colors.textMuted} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sectionTitle: {
    color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginHorizontal: 16, marginTop: 20, marginBottom: 8,
  },
  card: {
    marginHorizontal: 16, backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardDescription: {
    fontSize: 13, color: colors.textSecondary, lineHeight: 20,
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16,
  },
  infoItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  infoIcon: { marginRight: 12 },
  infoText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  infoSeparator: {
    height: 1, backgroundColor: colors.border, marginLeft: 46,
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  statusLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  statusSub: { fontSize: 13, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  requestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 20,
    backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14,
  },
  requestBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 12, backgroundColor: colors.accentGreen, borderRadius: 12, paddingVertical: 13,
  },
  downloadBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  waitingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 20, padding: 14,
    backgroundColor: colors.surfaceElevated, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  waitingText: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  grievanceEmailRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 16, paddingTop: 0, gap: 8,
  },
  grievanceEmail: {
    fontSize: 14, fontWeight: '600', color: colors.accent,
  },
});
