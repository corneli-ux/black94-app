import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import {
  createPaidChatAccess,
  fetchUserProfile,
  hasPaidChatAccess,
} from '../lib/api';
import {
  openRazorpayCheckout,
  handleRazorpayMessage,
  isRazorpayConfigured,
} from '../lib/razorpay';
import { Avatar, VerifiedBadge } from '../components/Avatar';

export default function PaidChatScreen({ route, navigation }: any) {
  const { targetUserId, chatPrice } = route.params || {};
  const currentUser = auth()?.currentUser;

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [targetUser, setTargetUser] = useState<any>(null);
  const [price, setPrice] = useState<number>(chatPrice || 0);

  // Razorpay WebView modal state
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [checkoutHTML, setCheckoutHTML] = useState('');
  const webViewRef = useRef<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!targetUserId || !currentUser?.uid) {
      navigation.goBack();
      return;
    }

    try {
      // Check if user already has paid access
      const paid = await hasPaidChatAccess(currentUser.uid, targetUserId);
      if (paid) {
        setAlreadyPaid(true);
        // Navigate directly to chat if already paid
        const chatId = await findOrCreateChat(currentUser.uid, targetUserId);
        if (chatId) {
          navigation.replace('ChatRoom' as never, { chatId } as never);
          return;
        }
      }

      // Fetch target user profile
      const userProfile = await fetchUserProfile(targetUserId);
      if (userProfile) {
        setTargetUser(userProfile);
      }

      // If price not passed in params, fetch from Firestore
      if (!chatPrice) {
        const docSnap = await firestore().collection('users').doc(targetUserId).get();
        if (docSnap.exists) {
          const privacy = docSnap.data()?.privacy;
          if (privacy?.paidChatPrice != null) {
            setPrice(privacy.paidChatPrice);
          }
        }
      }
    } catch (e) {
      console.error('[PaidChatScreen] Load error:', e);
      Alert.alert('Error', 'Failed to load chat information.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const findOrCreateChat = async (uid1: string, uid2: string): Promise<string | null> => {
    try {
      const snap1 = await firestore().collection('chats').where('user1Id', '==', uid1).get();
      const existing = snap1.docs.find((d) => d.data().user2Id === uid2);
      if (existing) return existing.id;

      const snap2 = await firestore().collection('chats').where('user2Id', '==', uid1).get();
      const existing2 = snap2.docs.find((d) => d.data().user1Id === uid2);
      if (existing2) return existing2.id;

      const chatRef = await firestore().collection('chats').add({
        user1Id: uid1,
        user2Id: uid2,
        lastMessage: '',
        lastMessageTime: firestore.FieldValue.serverTimestamp(),
        unreadUser1: 0,
        unreadUser2: 0,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
      return chatRef.id;
    } catch (e) {
      console.error('[PaidChatScreen] findOrCreateChat error:', e);
      return null;
    }
  };

  const handlePay = () => {
    if (!currentUser || paying) return;

    // Check if Razorpay is configured
    if (!isRazorpayConfigured()) {
      Alert.alert(
        'Payment Unavailable',
        'Online payment is being configured. Please try again later.',
      );
      return;
    }

    const amountInPaise = price * 100;
    const planName = `Chat with ${targetUser?.displayName || targetUser?.username || 'User'}`;

    const { html, keyMissing } = openRazorpayCheckout({
      amount: amountInPaise,
      currency: 'INR',
      planId: `paid_chat_${targetUserId}`,
      planName,
      userId: currentUser.uid,
      userEmail: currentUser.email || '',
      userName: currentUser.displayName || '',
    });

    if (keyMissing || !html) {
      Alert.alert('Payment Unavailable', 'Razorpay is not configured. Please try again later.');
      return;
    }

    setCheckoutHTML(html);
    setCheckoutModalVisible(true);
    setPaying(true);
  };

  const handleWebViewMessage = async (event: any) => {
    const result = handleRazorpayMessage(event);
    setCheckoutModalVisible(false);
    setPaying(false);

    if (result.success && result.paymentId) {
      // Payment succeeded — grant chat access
      try {
        const accessCreated = await createPaidChatAccess(
          currentUser.uid,
          targetUserId,
          price,
          result.paymentId,
        );

        if (accessCreated) {
          const chatId = await findOrCreateChat(currentUser.uid, targetUserId);
          if (chatId) {
            navigation.replace('ChatRoom' as never, { chatId } as never);
          } else {
            Alert.alert('Error', 'Payment successful but could not create chat. Please contact support.');
          }
        } else {
          Alert.alert('Error', 'Payment recorded but could not grant access. Please contact support.');
        }
      } catch (e) {
        console.error('[PaidChatScreen] Post-payment error:', e);
        Alert.alert('Error', 'Something went wrong after payment. Please contact support.');
      }
    } else {
      // Payment cancelled or failed
      if (result.error && !result.error.includes('cancelled')) {
        Alert.alert('Payment Failed', result.error);
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (alreadyPaid) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Opening chat...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Paid Chat</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* User Info Card */}
        <View style={styles.userCard}>
          <Avatar
            uri={targetUser?.profileImage || null}
            name={targetUser?.displayName || null}
            size={72}
            borderWidth={3}
            borderColor={colors.bg}
          />
          <View style={styles.userInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>
                {targetUser?.displayName || 'User'}
              </Text>
              <VerifiedBadge
                badge={targetUser?.badge || ''}
                isVerified={targetUser?.isVerified || false}
                size={18}
              />
            </View>
            <Text style={styles.username}>@{targetUser?.username || 'user'}</Text>
            {targetUser?.bio ? (
              <Text style={styles.bio} numberOfLines={2}>
                {targetUser.bio}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Price Card */}
        <View style={styles.priceCard}>
          <Ionicons
            name="lock-closed-outline"
            size={24}
            color={colors.accent}
            style={{ marginBottom: 12 }}
          />
          <Text style={styles.priceTitle}>Paid Chat</Text>
          <Text style={styles.priceAmount}>{'\u20B9'}{price}</Text>
          <Text style={styles.priceLabel}>to start a chat</Text>
          <View style={styles.priceDivider} />
          <View style={styles.priceDetails}>
            <View style={styles.detailRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.detailText}>One-time payment for chat access</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.detailText}>Chat stays open after payment</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.detailText}>Secure payment via Razorpay</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity
          style={[styles.payButton, paying && styles.payButtonDisabled]}
          onPress={handlePay}
          disabled={paying}
          activeOpacity={0.8}
        >
          {paying ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.payButtonText}>Pay {'\u20B9'}{price} & Start Chat</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          By proceeding, you agree to the paid chat terms. Payment is non-refundable.
        </Text>
      </View>

      {/* Razorpay Checkout Modal */}
      <Modal
        visible={checkoutModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {
          setCheckoutModalVisible(false);
          setPaying(false);
        }}
      >
        <View style={styles.webviewContainer}>
          <WebView
            ref={webViewRef}
            source={{ html: checkoutHTML }}
            onMessage={handleWebViewMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webviewLoader}>
                <ActivityIndicator color="#FFFFFF" size="large" />
                <Text style={styles.webviewLoaderText}>Opening payment gateway...</Text>
              </View>
            )}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 12,
  },
  /* -- Header -- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  /* -- Content -- */
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  /* -- User Card -- */
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    marginBottom: 24,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  username: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2,
  },
  bio: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  /* -- Price Card -- */
  priceCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 24,
    alignItems: 'center',
    marginBottom: 28,
  },
  priceTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  priceAmount: {
    color: colors.text,
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 56,
  },
  priceLabel: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 4,
  },
  priceDivider: {
    width: '100%',
    height: 0.5,
    backgroundColor: colors.border,
    marginVertical: 20,
  },
  priceDetails: {
    width: '100%',
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  /* -- Buttons -- */
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 16,
    marginBottom: 12,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 16,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  footnote: {
    color: '#71767b',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  /* -- Razorpay WebView Modal -- */
  webviewContainer: {
    flex: 1,
    backgroundColor: '#111111',
  },
  webviewLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111111',
    gap: 16,
  },
  webviewLoaderText: {
    color: '#888888',
    fontSize: 14,
  },
});
