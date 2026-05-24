import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
  Modal,
  Pressable,
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
  createRazorpayOrder,
  verifyRazorpayPayment,
  openRazorpayCheckout,
  handleRazorpayMessage,
  isRazorpayConfigured,
} from '../lib/razorpay';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { scale } from '../theme/responsive';

// ── Payment flow states ──
type PaymentPhase = 'idle' | 'opening_gateway' | 'processing' | 'success' | 'error';

export default function PaidChatScreen({ route, navigation }: any) {
  const { targetUserId, chatPrice } = route.params || {};
  const currentUser = auth()?.currentUser;

  const [loading, setLoading] = useState(true);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [targetUser, setTargetUser] = useState<any>(null);
  const [price, setPrice] = useState<number>(chatPrice || 0);

  // Enhanced payment state machine
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Razorpay WebView modal state
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [checkoutHTML, setCheckoutHTML] = useState('');
  const webViewRef = useRef<any>(null);

  // Success modal state
  const [successModalVisible, setSuccessModalVisible] = useState(false);

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
      Alert.alert('Error', 'Failed to load chat information. Please try again.');
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

  // Store Razorpay order ID for verification
  const pendingOrderIdRef = useRef<string | null>(null);

  const handlePay = async () => {
    if (!currentUser) return;
    if (paymentPhase !== 'idle') return;

    // Check if Razorpay is configured
    if (!isRazorpayConfigured()) {
      Alert.alert(
        'Payment Unavailable',
        'Online payment is being configured. Please try again later or contact the user directly.',
      );
      return;
    }

    setPaymentError(null);
    setPaymentPhase('opening_gateway');

    try {
      // Step 1: Create Razorpay order server-side
      const orderResult = await createRazorpayOrder({
        amount: price * 100,
        currency: 'INR',
        receipt: `chat_${currentUser.uid}_${targetUserId}_${Date.now()}`,
        notes: {
          userId: currentUser.uid,
          targetUserId,
          type: 'paid_chat',
        },
      });

      // Step 2: Open checkout with server-created order
      const amountInPaise = price * 100;
      const planName = `Chat with ${targetUser?.displayName || targetUser?.username || 'User'}`;

      const { html, keyMissing } = openRazorpayCheckout(
        {
          amount: amountInPaise,
          currency: 'INR',
          receipt: orderResult.receipt,
          planName,
          userName: currentUser.displayName || '',
          userEmail: currentUser.email || '',
          notes: {
            userId: currentUser.uid,
            targetUserId,
            type: 'paid_chat',
          },
        },
        orderResult.orderId,
      );

      if (keyMissing || !html) {
        setPaymentPhase('idle');
        setPaymentError('Payment gateway is not available. Please try again later.');
        Alert.alert('Payment Unavailable', 'Razorpay is not configured. Please try again later.');
        return;
      }

      pendingOrderIdRef.current = orderResult.orderId;
      setCheckoutHTML(html);
      setCheckoutModalVisible(true);
    } catch (e: any) {
      setPaymentPhase('idle');
      setPaymentError(e.message || 'Failed to create payment order.');
      Alert.alert('Error', e.message || 'Could not create payment order.');
    }
  };

  const handleWebViewMessage = async (event: any) => {
    const result = handleRazorpayMessage(event);

    if (result.success && result.paymentId) {
      // Payment succeeded — verify server-side + grant access
      setCheckoutModalVisible(false);
      setPaymentPhase('processing');

      try {
        // Verify payment & grant chat access server-side
        const verifyResult = await verifyRazorpayPayment({
          razorpayOrderId: result.razorpayOrderId || '',
          razorpayPaymentId: result.paymentId,
          razorpaySignature: result.razorpaySignature || '',
          type: 'paid_chat',
          targetUserId,
          chatPrice: price,
        });

        if (verifyResult.verified) {
          setPaymentPhase('success');
          const chatId = await findOrCreateChat(currentUser.uid, targetUserId);
          if (chatId) {
            setSuccessModalVisible(true);
            setTimeout(() => {
              setSuccessModalVisible(false);
              navigation.replace('ChatRoom' as never, { chatId } as never);
            }, 1500);
          } else {
            setPaymentPhase('error');
            setPaymentError('Payment successful but could not create chat room.');
            Alert.alert(
              'Almost There',
              'Payment successful but we could not open the chat. Please contact support with your payment ID.',
            );
          }
        } else {
          setPaymentPhase('error');
          setPaymentError('Payment verification failed.');
          Alert.alert(
            'Payment Issue',
            'Payment verification failed. Please contact support with your payment ID for manual activation.',
          );
        }
      } catch (e: any) {
        console.error('[PaidChatScreen] Post-payment error:', e);
        setPaymentPhase('error');
        setPaymentError(e.message || 'Something went wrong after payment.');
        Alert.alert(
          'Error',
          e.message || 'Something went wrong after your payment. Please contact support — your payment was not lost.',
        );
      }
    } else {
      // Payment cancelled or failed
      setCheckoutModalVisible(false);
      setPaymentPhase('idle');

      if (result.error && !result.error.includes('cancelled')) {
        setPaymentError(result.error);
        Alert.alert('Payment Failed', result.error);
      }
    }
  };

  const handleRetry = () => {
    setPaymentError(null);
    setPaymentPhase('idle');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading chat info...</Text>
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

  const isProcessing = paymentPhase === 'opening_gateway' || paymentPhase === 'processing';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (isProcessing) {
              Alert.alert('Payment in Progress', 'Please wait or close the payment window to cancel.');
              return;
            }
            navigation.goBack();
          }}
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

        {/* Payment Error Banner */}
        {paymentError && paymentPhase === 'error' && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
            <Text style={styles.errorText}>{paymentError}</Text>
            <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Processing Indicator */}
        {paymentPhase === 'processing' && (
          <View style={styles.processingBanner}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.processingText}>
              Payment received! Setting up your chat...
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        {paymentPhase !== 'success' && (
          <>
            <TouchableOpacity
              style={[styles.payButton, isProcessing && styles.payButtonDisabled]}
              onPress={handlePay}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              {isProcessing ? (
                <>
                  <ActivityIndicator color={colors.white} size="small" />
                  <Text style={styles.payButtonText}>
                    {paymentPhase === 'processing' ? 'Processing...' : 'Opening Payment...'}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="card-outline" size={20} color={colors.white} style={{ marginRight: 8 }} />
                  <Text style={styles.payButtonText}>Pay {'\u20B9'}{price} & Start Chat</Text>
                </>
              )}
            </TouchableOpacity>

            {!isProcessing && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </>
        )}

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
          if (paymentPhase === 'processing') return; // Don't allow closing during processing
          setCheckoutModalVisible(false);
          setPaymentPhase('idle');
        }}
      >
        <View style={styles.webviewContainer}>
          <View style={styles.webviewHeader}>
            <TouchableOpacity
              onPress={() => {
                if (paymentPhase === 'processing') return;
                setCheckoutModalVisible(false);
                setPaymentPhase('idle');
              }}
              hitSlop={8}
              style={{ padding: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.webviewTitle}>Secure Payment</Text>
            <View style={{ width: 40 }} />
          </View>
          <WebView
            ref={webViewRef}
            source={{ html: checkoutHTML }}
            onMessage={handleWebViewMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webviewLoader}>
                <ActivityIndicator color={colors.white} size="large" />
                <Text style={styles.webviewLoaderText}>Opening secure payment...</Text>
              </View>
            )}
          />
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={successModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <Pressable style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark-circle" size={56} color={colors.accentGreen} />
            </View>
            <Text style={styles.successTitle}>Payment Successful!</Text>
            <Text style={styles.successDesc}>Opening your chat now...</Text>
            <ActivityIndicator color={colors.accent} size="small" style={{ marginTop: 12 }} />
          </View>
        </Pressable>
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
    borderColor: colors.separator,
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
    color: colors.textSecondary,
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
    borderColor: colors.separator,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
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
  /* -- Error Banner -- */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderRadius: 8,
  },
  retryText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  /* -- Processing Banner -- */
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(42,127,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(42,127,255,0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  processingText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '500',
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
    gap: 8,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: colors.white,
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
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  /* -- Razorpay WebView Modal -- */
  webviewContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  webviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  webviewTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  webviewLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    gap: 16,
  },
  webviewLoaderText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  /* -- Success Modal -- */
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: scale(300),
    alignItems: 'center',
  },
  successIconWrap: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
