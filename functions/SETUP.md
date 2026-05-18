# Razorpay Integration — Setup Guide

## Overview

This integration adds **server-side verified Razorpay payments** with three payment flows:
1. **Subscription** — Premium/Business plan upgrades
2. **E-Commerce Checkout** — Product orders (prepaid + COD)
3. **Paid Chat** — One-time payment to unlock DMs

### Architecture

```
Client (React Native)          Cloud Functions              Razorpay
       │                            │                          │
       ├─ createRazorpayOrder() ──► │                          │
       │                            ├── orders.create() ──────►│
       │                            │◄── order_id ─────────────┤
       │◄── { orderId, amount } ────┤                          │
       │                            │                          │
       ├─ Open WebView Checkout ──► │  (client-side WebView)   │
       │                            │        ─────────────────►│
       │                            │◄── payment response ─────┤
       │◄── { paymentId, sig } ──── │                          │
       │                            │                          │
       ├─ verifyRazorpayPayment() ► │                          │
       │                            ├── verify signature ──────│
       │                            ├── payments.fetch() ─────►│
       │                            │◄── payment details ──────┤
       │                            ├── activate subscription   │
       │                            │   or create order         │
       │                            │   or grant chat access    │
       │◄── { verified: true } ────┤                          │
```

## Prerequisites

1. [Razorpay account](https://dashboard.razorpay.com/) with API keys
2. [Firebase CLI](https://firebase.google.com/docs/cli) installed
3. Firebase project: `black94`

## Setup Steps

### 1. Set Razorpay API Keys in Firebase Secrets

```bash
cd /home/z/black94-app

# Login to Firebase
firebase login

# Set the Razorpay Key ID (starts with rzp_test_ or rzp_live_)
firebase functions:secrets:set RAZORPAY_KEY_ID

# Set the Razorpay Key Secret
firebase functions:secrets:set RAZORPAY_KEY_SECRET

# Set the Webhook Secret (from Razorpay Dashboard → Settings → Webhooks)
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

### 2. Configure the Client-Side Key

Edit `app.json` and set the `razorpayKeyId`:

```json
{
  "expo": {
    "extra": {
      "razorpayKeyId": "rzp_test_xxxxxxxxxxxxx"
    }
  }
}
```

> Note: The key ID is safe to embed in the client — it's a public identifier.
> The key secret NEVER goes to the client.

### 3. Install Cloud Function Dependencies

```bash
cd /home/z/black94-app/functions
npm install
```

### 4. Deploy Cloud Functions

```bash
cd /home/z/black94-app

# Deploy all functions
firebase deploy --only functions

# Or deploy specific functions
firebase deploy --only functions:createRazorpayOrder,functions:verifyRazorpayPayment
firebase deploy --only functions:razorpayWebhook
```

### 5. Configure Webhook in Razorpay Dashboard

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/) → Settings → Webhooks
2. Add a new webhook endpoint:
   - URL: `https://asia-south1-black94.cloudfunctions.net/razorpayWebhook`
   - Events to capture:
     - `payment.captured`
     - `payment.failed`
     - `payment.refunded`
     - `order.paid`
3. Copy the webhook secret and set it:
   ```bash
   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
   ```

### 6. Test with Test Mode

1. Use test keys (start with `rzp_test_`)
2. Test payments with:
   - Card: `4111 1111 1111 1111` (Visa)
   - UPI: Any test UPI ID
   - Net Banking: Any test bank

### 7. Go Live

1. Switch to live keys (start with `rzp_live_`)
2. Update `app.json` with the live key ID
3. Update Firebase secrets with live key secret
4. Redeploy functions
5. Configure live webhook in Razorpay Dashboard

## Firestore Collections Used

| Collection | Purpose | Created By |
|---|---|---|
| `subscriptions/{paymentId}` | Subscription records | `handleSubscriptionPayment` |
| `orders/{autoId}` | E-commerce orders | `handleOrderPayment` |
| `paid_chat_access/{payerId}_{receiverId}` | Chat access grants | `handlePaidChatPayment` |
| `chat_payments/{paymentId}` | Chat payment records | `handlePaidChatPayment` |
| `users/{uid}` | User subscription/badge updates | `handleSubscriptionPayment` |

## Troubleshooting

- **"Razorpay key not configured"** → Set `razorpayKeyId` in `app.json`
- **"Failed to create payment order"** → Check Cloud Functions are deployed and secrets are set
- **"Signature mismatch"** → Ensure key secret matches between Razorpay and Firebase secrets
- **WebView blank/not loading** → Check internet connection; Razorpay Checkout.js loads from CDN
