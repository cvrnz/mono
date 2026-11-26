#!/bin/sh
# Creates a self-signed code-signing certificate in the login keychain, so every build can be
# signed with the same identity and macOS keeps privacy permissions across builds:
#   APPLE_SIGNING_IDENTITY="Mono Local Signing" pnpm bundle
# Remove it with: security delete-identity -c "Mono Local Signing"
set -eu
NAME="${1:-Mono Local Signing}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "\"$NAME\" already exists"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# macOS's own openssl (LibreSSL) writes a PKCS#12 file that `security import` reads
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/id.p12" -passout pass:mono
security import "$TMP/id.p12" -k "$KEYCHAIN" -P mono -T /usr/bin/codesign >/dev/null
echo "Created \"$NAME\""
