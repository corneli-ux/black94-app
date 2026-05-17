/**
 * razorpay.ts — Razorpay Checkout via WebView
 *
 * Opens the Razorpay Checkout.js SDK inside a react-native-webview.
 * The Razorpay key ID is loaded from app.json → extra.razorpayKeyId.
 *
 * Usage (inside a React component that renders a <Modal> + <WebView>):
 *   const { html, handleMessage } = openRazorpayCheckout(options, webViewRef);
 *   // set the modal visible, then:
 *   <WebView source={{ html }} onMessage={handleMessage} />
 */

import Constants from 'expo-constants';

// ── Razorpay key from app.json extra field ───────────────────────────────────

const RAZORPAY_KEY_ID = (Constants.expoConfig?.extra?.razorpayKeyId as string) || '';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RazorpayCheckoutOptions {
  amount: number;       // amount in paise (e.g. 44900 = ₹449)
  currency: string;     // 'INR'
  planId: string;
  planName: string;
  userId: string;
  userEmail: string;
  userPhone?: string;
  userName?: string;
}

export interface RazorpayResult {
  success: boolean;
  paymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  error?: string;
}

// ── HTML generator ───────────────────────────────────────────────────────────

export function generateCheckoutHTML(
  options: RazorpayCheckoutOptions,
  keyId: string,
): string {
  // JSON-encode user strings safely for embedding in HTML
  const safeName = JSON.stringify(options.userName || '');
  const safeEmail = JSON.stringify(options.userEmail || '');
  const safePhone = JSON.stringify(options.userPhone || '');
  const safeDescription = options.planName
    ? options.planName.replace(/'/g, "\\'")
    : 'Payment';

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #111; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; padding: 20px; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top: 3px solid #fff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Opening payment gateway...</p>
  </div>
  <script>
    try {
      var options = {
        key: '${keyId}',
        amount: ${options.amount},
        currency: '${options.currency}',
        name: 'Black94',
        description: '${safeDescription}',
        image: '',
        prefill: {
          name: ${safeName},
          email: ${safeEmail},
          contact: ${safePhone},
        },
        theme: {
          color: '#111111'
        },
        handler: function(response) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'success',
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signature: response.razorpay_signature,
          }));
        },
        modal: {
          ondismiss: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'cancelled',
            }));
          }
        },
      };

      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(response) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          error: response.error.description || 'Payment failed',
        }));
      });

      rzp.open();
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        error: e.message || 'Failed to initialize payment',
      }));
    }
  </script>
</body>
</html>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Prepare Razorpay checkout data for use in a WebView-based modal.
 *
 * Returns:
 *  - `html`          — the full HTML string to load in a WebView
 *  - `handleMessage` — callback for WebView's onMessage; returns a RazorpayResult
 *
 * Example usage inside a screen component:
 * ```tsx
 * const [modalVisible, setModalVisible] = useState(false);
 * const webViewRef = useRef<WebView>(null);
 *
 * const openCheckout = () => {
 *   const { html } = openRazorpayCheckout(options, webViewRef);
 *   setCheckoutHTML(html);
 *   setModalVisible(true);
 * };
 *
 * const onWebViewMessage = (event) => {
 *   const result = handleRazorpayMessage(event);
 *   setModalVisible(false);
 *   if (result.success) { /* activate subscription *\/ }
 * };
 * ```
 */
export function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
): { html: string; keyMissing: boolean } {
  if (!RAZORPAY_KEY_ID) {
    return {
      html: '',
      keyMissing: true,
    };
  }

  return {
    html: generateCheckoutHTML(options, RAZORPAY_KEY_ID),
    keyMissing: false,
  };
}

/**
 * Parse the WebView onMessage event into a RazorpayResult.
 */
export function handleRazorpayMessage(event: any): RazorpayResult {
  try {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'success') {
      return {
        success: true,
        paymentId: data.paymentId,
        razorpayOrderId: data.orderId,
        razorpaySignature: data.signature,
      };
    }
    if (data.type === 'cancelled') {
      return {
        success: false,
        error: 'Payment was cancelled.',
      };
    }
    // data.type === 'error'
    return {
      success: false,
      error: data.error || 'Payment failed',
    };
  } catch {
    return { success: false, error: 'Failed to process payment response' };
  }
}

/** Returns true when a Razorpay key is configured in app.json. */
export function isRazorpayConfigured(): boolean {
  return !!RAZORPAY_KEY_ID;
}
