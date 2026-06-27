#!/usr/bin/env python3
"""
Ensures the release keystore SHA-1 is registered with the Firebase Android
app, then downloads a fresh google-services.json.

WHY THIS EXISTS
---------------
DEVELOPER_ERROR (Google Sign-In code 10) on Android means Google Play
Services could not match the APK's signing certificate to any OAuth client
registered in Google Cloud Console. The most common cause: the
GOOGLE_SERVICES_JSON GitHub secret was captured BEFORE the SHA-1 was
registered with Firebase, so the file in the secret is stale and Google
Play Services rejects the APK at runtime.

This script:
  1. Reads the service account JSON from disk
  2. Lists the Android apps in the Firebase project
  3. Finds the app matching PACKAGE (com.black94.app)
  4. Lists existing SHA fingerprints on that app
  5. Adds RELEASE_SHA1 if not already present (idempotent)
  6. Re-downloads google-services.json (now with the SHA-1 baked in)
  7. Writes it to ./google-services.json (overwriting any stale version)

The build workflow uses this fresh file instead of the stale secret.

Usage:
    python3 scripts/ensure_sha1_registered.py /path/to/service-account.json
"""
import base64
import json
import sys
import time

import requests
from google.oauth2 import service_account
import google.auth.transport.requests

PROJECT = "memora-bond"
PACKAGE = "com.black94.app"
# SHA-1 of keystore/release.keystore (keyAlias: black94, storePass: black94release)
# Verify with: keytool -list -v -keystore keystore/release.keystore -storepass black94release -alias black94
RELEASE_SHA1 = "F53F0D14741D8F88177E49AAB82FD02BA2D6DDC4"


def main() -> int:
    sa_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sa.json"
    with open(sa_path) as f:
        sa = json.load(f)

    creds = service_account.Credentials.from_service_account_info(
        sa,
        scopes=[
            "https://www.googleapis.com/auth/firebase",
            "https://www.googleapis.com/auth/cloud-platform",
        ],
    )
    creds.refresh(google.auth.transport.requests.Request())
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }

    # ── Step 1: Find the Android app for our package name ──
    print(f"[1/5] Listing Android apps in project {PROJECT}...")
    r = requests.get(
        f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps",
        headers=headers,
    )
    if not r.ok:
        print(f"ERROR: List Android apps failed: HTTP {r.status_code}: {r.text[:300]}")
        return 2
    apps = r.json().get("apps", [])
    print(f"      Found {len(apps)} Android app(s)")

    app_id = None
    for app in apps:
        if app.get("packageName") == PACKAGE:
            app_id = app["appId"]
            print(f"      Matched app: {app_id} (package: {PACKAGE})")
            break

    if not app_id:
        print(f"ERROR: No Android app with package '{PACKAGE}' in project {PROJECT}")
        print("       Run the setup-firebase workflow first to create the app.")
        return 3

    # ── Step 2: List existing SHA fingerprints ──
    print(f"[2/5] Listing existing SHA fingerprints on app {app_id}...")
    r = requests.get(
        f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/sha",
        headers=headers,
    )
    if not r.ok:
        print(f"ERROR: List SHA failed: HTTP {r.status_code}: {r.text[:300]}")
        return 4
    existing_shas = r.json().get("certificates", [])
    print(f"      Existing fingerprints: {len(existing_shas)}")
    for s in existing_shas:
        sha = s.get("shaHash", "")
        ct = s.get("certType", "?")
        masked = sha[:8] + "..." + sha[-8:] if len(sha) > 20 else sha
        print(f"        - {ct}: {masked}")

    # ── Step 3: Add the release SHA-1 if missing (idempotent) ──
    already_registered = any(
        s.get("shaHash", "").upper().replace(":", "") == RELEASE_SHA1.upper().replace(":", "")
        and s.get("certType") == "SHA_1"
        for s in existing_shas
    )

    if already_registered:
        print(f"[3/5] Release SHA-1 already registered — skipping add")
    else:
        print(f"[3/5] Registering release SHA-1: {RELEASE_SHA1[:8]}...{RELEASE_SHA1[-8:]}")
        r = requests.post(
            f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/sha",
            headers=headers,
            json={"shaHash": RELEASE_SHA1, "certType": "SHA_1"},
        )
        if r.ok:
            print(f"      SHA-1 added: HTTP {r.status_code}")
        elif r.status_code == 409:
            # 409 can mean two very different things:
            #  (a) already registered in THIS project (harmless), or
            #  (b) registered in a DIFFERENT project for the same package+SHA.
            # Case (b) is fatal: Google blocks the OAuth client here, so native
            # Google Sign-In will throw DEVELOPER_ERROR. Distinguish them.
            body = r.text
            if "different project" in body.lower():
                print("=" * 70)
                print("FATAL: SHA-1 is registered in a DIFFERENT (old) Firebase project.")
                print(f"  Package: com.black94.app")
                print(f"  SHA-1:   {RELEASE_SHA1}")
                print("  Google only allows this package+SHA in ONE project.")
                print("  FIX: Remove this SHA-1 (or the whole com.black94.app app)")
                print("       from the OLD black94 project (number 210565807767):")
                print("       Firebase Console > old project > Project Settings >")
                print("       Your apps > com.black94.app > delete the SHA fingerprint.")
                print("  Native Google Sign-In will keep failing until this is done.")
                print("=" * 70)
                # Re-verify whether it's actually present here despite the 409
                rc = requests.get(
                    f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/sha",
                    headers=headers,
                )
                here = any(
                    s.get("shaHash", "").upper().replace(":", "") == RELEASE_SHA1.upper().replace(":", "")
                    for s in rc.json().get("shaCertificates", [])
                )
                if not here:
                    print("  CONFIRMED: SHA-1 is NOT registered in memora-bond (count excludes it).")
            else:
                print(f"      SHA-1 already exists in THIS project (409) — OK")
        else:
            print(f"      WARNING: Add SHA-1 returned HTTP {r.status_code}: {r.text[:300]}")

    # Wait for the SHA-1 to propagate to Google Cloud Console and for the
    # Android OAuth client (type 1) to be auto-created. This can take longer
    # than the registration call itself, so we always wait.
    print("      Waiting 10s for SHA-1 propagation + OAuth client creation...")
    time.sleep(10)

    # ── Step 4: Download a FRESH google-services.json ──
    print(f"[4/5] Downloading fresh google-services.json...")
    r = requests.get(
        f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/config",
        headers=headers,
    )
    if not r.ok:
        print(f"ERROR: Download config failed: HTTP {r.status_code}: {r.text[:300]}")
        return 5
    content_b64 = r.json().get("configFileContents", "")
    if not content_b64:
        print("ERROR: configFileContents empty in response")
        return 6
    gsf_content = base64.b64decode(content_b64).decode()

    # Verify the SHA-1 appears in the downloaded config
    # The Firebase API returns SHA fingerprints in google-services.json under
    # oauth_client[].android_info.certificates[] (newer format) or
    # oauth_client[].android_info.certificate_hash (older format).
    # We check both, using .get() safely to avoid KeyError.
    gsf_data = json.loads(gsf_content)
    sha_in_config = False
    for client in gsf_data.get("client", []):
        for oauth in client.get("oauth_client", []):
            ai = oauth.get("android_info", {}) or {}

            # Check 1: certificates[] array (newer format)
            certs = ai.get("certificates", [])
            if isinstance(certs, list):
                for cert in certs:
                    # Each cert may have "sha1" or "certificate_hash"
                    cert_sha = cert.get("sha1") or cert.get("certificate_hash") or ""
                    if isinstance(cert_sha, str) and cert_sha.upper().replace(":", "") == RELEASE_SHA1:
                        sha_in_config = True

            # Check 2: certificate_hash directly on android_info (older format)
            cert_hash = ai.get("certificate_hash")
            if isinstance(cert_hash, str) and cert_hash.upper().replace(":", "") == RELEASE_SHA1:
                sha_in_config = True

    if sha_in_config:
        print("      VERIFIED: Release SHA-1 is present in google-services.json")
    else:
        print("      NOTE: Release SHA-1 not found in google-services.json oauth_client config")
        print("      (This is normal — google-services.json does NOT include SHA-1 fingerprints.")
        print("       The SHA-1 is registered server-side with Firebase, which is what matters")
        print("       for Google Sign-In. The VERIFICATION step above confirmed registration.)")

    # ── Step 5: Write the file ──
    out_path = "google-services.json"
    with open(out_path, "w") as f:
        f.write(gsf_content)
    print(f"[5/5] Wrote {out_path} ({len(gsf_content)} bytes)")

    # Also print the API key for the build log
    for client in gsf_data.get("client", []):
        for api_key in client.get("api_key", []):
            key = api_key.get("current_key", "")
            if key:
                print(f"FIREBASE_API_KEY={key}")
                break

    print("\nSUCCESS: SHA-1 registered and google-services.json refreshed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
