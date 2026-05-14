#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  encode-keystore.sh
#  Encodes your Android release keystore as base64 for GitHub Actions.
#  Run this script and copy the output to GitHub Secrets → KEYSTORE_BASE64
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

KEYSTORE_FILE="${1:-black94-release.keystore}"

if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "Error: Keystore file '$KEYSTORE_FILE' not found."
    echo ""
    echo "Usage:  ./scripts/encode-keystore.sh [path/to/keystore.jks]"
    echo ""
    echo "If you don't have a keystore yet, generate one with:"
    echo "  keytool -genkeypair -v \\"
    echo "    -storetype PKCS12 \\"
    echo "    -keystore black94-release.keystore \\"
    echo "    -alias upload \\"
    echo "    -keyalg RSA \\"
    echo "    -keysize 2048 \\"
    echo "    -validity 10000 \\"
    echo "    -storepassword YOUR_STORE_PASSWORD \\"
    echo "    -keypassword YOUR_KEY_PASSWORD"
    exit 1
fi

echo "Encoding '$KEYSTORE_FILE' to base64..."
echo ""

# Encode and print (this is what you paste into GitHub Secrets)
BASE64_VALUE=$(base64 -w 0 "$KEYSTORE_FILE")

echo "═══════════════════════════════════════════════════════"
echo "  Copy the line below to GitHub → Secrets → KEYSTORE_BASE64"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "$BASE64_VALUE"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  File size: $(du -h "$KEYSTORE_FILE" | cut -f1)"
echo "  Base64 length: ${#BASE64_VALUE} chars"
echo "═══════════════════════════════════════════════════════"
