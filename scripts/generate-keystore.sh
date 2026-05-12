#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  generate-keystore.sh
#  Generates a new Android release keystore for signing APK/AAB builds.
#  Run this if you don't already have a keystore file.
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

KEYSTORE_FILE="${1:-black94-release.keystore}"
KEY_ALIAS="${2:-upload}"
VALIDITY="${3:-10000}"

if [ -f "$KEYSTORE_FILE" ]; then
    echo "Warning: '$KEYSTORE_FILE' already exists!"
    read -p "Overwrite? [y/N] " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
fi

echo "Generating keystore: $KEYSTORE_FILE"
echo "  Alias:   $KEY_ALIAS"
echo "  Valid:   $VALIDITY days (~27 years)"
echo ""

# Prompt for passwords
read -sp "Enter keystore password (STORE_PASSWORD): " STORE_PASSWORD
echo ""
read -sp "Enter key password (KEY_PASSWORD): " KEY_PASSWORD
echo ""

if [ -z "$STORE_PASSWORD" ] || [ -z "$KEY_PASSWORD" ]; then
    echo "Error: Passwords cannot be empty."
    exit 1
fi

keytool -genkeypair -v \
    -storetype PKCS12 \
    -keystore "$KEYSTORE_FILE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity "$VALIDITY" \
    -storepass "$STORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -dname "CN=Black94, OU=Development, O=Black94, L=Unknown, ST=Unknown, C=US"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Keystore generated: $KEYSTORE_FILE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Now set these GitHub Secrets:"
echo "  KEY_ALIAS       = $KEY_ALIAS"
echo "  KEY_PASSWORD    = (the key password you entered)"
echo "  STORE_PASSWORD  = (the store password you entered)"
echo ""
echo "Then encode the keystore for GitHub:"
echo "  ./scripts/encode-keystore.sh $KEYSTORE_FILE"
echo "  → Paste output to GitHub → Secrets → KEYSTORE_BASE64"
