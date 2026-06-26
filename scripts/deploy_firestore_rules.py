#!/usr/bin/env python3
"""
Deploys Firestore security rules directly via REST APIs.

WHY THIS EXISTS
---------------
The `firebase deploy --only firestore:rules` CLI does a pre-flight check on
serviceusage.googleapis.com that requires `serviceusage.services.get`
permission — NOT included in Firebase Admin / Firebase Rules Admin roles.

This script bypasses the CLI and calls the REST APIs directly. It tries
two approaches in order:

  1. Firebase Rules API (firebaserules.googleapis.com) — create ruleset
     + update release. Needs firebaserules.rulesets.create +
     firebaserules.releases.update.

  2. Firestore Admin API (firestore.googleapis.com) — update database
     securityRules field. Needs datastore permissions.

Usage:
    python3 scripts/deploy_firestore_rules.py /path/to/service-account.json
"""
import json
import os
import sys
import urllib.request
import urllib.error

import google.auth.transport.requests
from google.oauth2 import service_account

PROJECT = "memora-bond"
RULES_FILE = "firestore.rules"
RELEASE_NAME = "cloud.firestore"  # Firestore release name (fixed by Firebase)


def get_access_token(sa_path: str, scopes: list) -> str:
    """Get an OAuth2 access token with the specified scopes."""
    with open(sa_path) as f:
        sa = json.load(f)
    creds = service_account.Credentials.from_service_account_info(sa, scopes=scopes)
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def read_rules_content() -> str:
    if not os.path.exists(RULES_FILE):
        print(f"ERROR: {RULES_FILE} not found in current directory", file=sys.stderr)
        sys.exit(2)
    with open(RULES_FILE) as f:
        return f.read()


# ═══════════════════════════════════════════════════════════════════════════
# APPROACH 1: Firebase Rules API (firebaserules.googleapis.com)
# ═══════════════════════════════════════════════════════════════════════════

def deploy_via_firebase_rules_api(token: str, rules_content: str) -> bool:
    """Deploy via firebaserules.googleapis.com.

    Returns True on success, False if we should try another approach.
    """
    print("[Approach 1] Firebase Rules API (firebaserules.googleapis.com)")

    # Step 1: Create ruleset
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/rulesets"
    body = json.dumps({
        "source": {
            "files": [{"name": "firestore.rules", "content": rules_content}]
        }
    }).encode()

    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            ruleset_name = data.get("name", "")
            print(f"  Ruleset created: {ruleset_name}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"  ERROR creating ruleset: HTTP {e.code}", file=sys.stderr)
        print(f"  Response: {body_text[:500]}", file=sys.stderr)
        if e.code == 403:
            print("  Service account lacks firebaserules.rulesets.create — trying Approach 2", file=sys.stderr)
            return False
        return False

    # Step 2: Update the release. Try multiple method + body shape combos
    # because the API has subtle differences across versions.
    release_full_name = f"projects/{PROJECT}/releases/{RELEASE_NAME}"
    release_url = f"https://firebaserules.googleapis.com/v1/{release_full_name}"

    body_variants = [
        {"name": release_full_name, "rulesetName": ruleset_name},
        {"name": release_full_name, "ruleset_name": ruleset_name},
        {"rulesetName": ruleset_name},
        {"ruleset_name": ruleset_name},
    ]

    methods = [
        ("PATCH updateMask=ruleset_name", "PATCH", f"{release_url}?updateMask=ruleset_name"),
        ("PATCH updateMask=rulesetName", "PATCH", f"{release_url}?updateMask=rulesetName"),
        ("PATCH no mask", "PATCH", release_url),
        ("PUT full replace", "PUT", release_url),
    ]

    for method_desc, method, url_for_method in methods:
        for body_variant in body_variants:
            body = json.dumps(body_variant).encode()
            req = urllib.request.Request(
                url_for_method, data=body, method=method,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    print(f"  Release updated via {method_desc} (body: {list(body_variant.keys())})")
                    print(f"  SUCCESS — release now points to {ruleset_name}")
                    return True
            except urllib.error.HTTPError as e:
                body_text = e.read().decode()
                if e.code == 404:
                    if try_create_release(token, ruleset_name, release_full_name):
                        return True
                elif e.code == 403:
                    print(f"  {method_desc} → 403 permission denied")
                    print(f"  Service account lacks firebaserules.releases.update")
                    return False
                # 400 — try next variant
                continue
            except Exception:
                continue

    print(f"  All Firebase Rules API variants failed", file=sys.stderr)
    return False


def try_create_release(token: str, ruleset_name: str, release_full_name: str) -> bool:
    """POST-create the release (when PATCH returns 404)."""
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases"
    for body_variant in [
        {"name": release_full_name, "rulesetName": ruleset_name},
        {"name": release_full_name, "ruleset_name": ruleset_name},
    ]:
        body = json.dumps(body_variant).encode()
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as resp:
                print(f"  Release created via POST")
                return True
        except urllib.error.HTTPError as e:
            if e.code == 403:
                print(f"  POST create → 403 — lacks firebaserules.releases.create")
                return False
            continue
    return False


# ═══════════════════════════════════════════════════════════════════════════
# APPROACH 2: Firestore Admin API (firestore.googleapis.com)
# ═══════════════════════════════════════════════════════════════════════════

def deploy_via_firestore_admin_api(token: str, rules_content: str) -> bool:
    """Deploy via firestore.googleapis.com database update."""
    print("[Approach 2] Firestore Admin API (firestore.googleapis.com)")

    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)"
    body = json.dumps({"securityRules": rules_content}).encode()

    req = urllib.request.Request(
        f"{url}?updateMask=securityRules",
        data=body, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  Database security rules updated via Firestore Admin API")
            return True
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"  ERROR: HTTP {e.code}", file=sys.stderr)
        print(f"  Response: {body_text[:500]}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main() -> int:
    sa_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sa.json"

    print(f"Deploying Firestore rules to project '{PROJECT}'...")
    print(f"  Service account: {sa_path}")
    print(f"  Rules file: {RULES_FILE}")
    print()

    rules_content = read_rules_content()
    print(f"Read {len(rules_content)} bytes from {RULES_FILE}")
    print()

    # Approach 1: Firebase Rules API
    print("=" * 60)
    token1 = get_access_token(sa_path, [
        "https://www.googleapis.com/auth/firebase",
        "https://www.googleapis.com/auth/firebase.readonly",
    ])
    if deploy_via_firebase_rules_api(token1, rules_content):
        print()
        print("SUCCESS: Firestore rules deployed via Firebase Rules API")
        return 0

    print()
    print("=" * 60)
    # Approach 2: Firestore Admin API
    token2 = get_access_token(sa_path, [
        "https://www.googleapis.com/auth/datastore",
        "https://www.googleapis.com/auth/cloud-platform",
    ])
    if deploy_via_firestore_admin_api(token2, rules_content):
        print()
        print("SUCCESS: Firestore rules deployed via Firestore Admin API")
        return 0

    print()
    print("FAILED: Could not deploy Firestore rules via any API approach.", file=sys.stderr)
    print(file=sys.stderr)
    print("The service account needs one of these IAM roles:", file=sys.stderr)
    print("  - roles/firebaserules.admin  (for Approach 1)", file=sys.stderr)
    print("  - roles/datastore.owner      (for Approach 2)", file=sys.stderr)
    print("  - roles/editor               (covers both)", file=sys.stderr)
    print("  - roles/owner                (covers both)", file=sys.stderr)
    print(file=sys.stderr)
    print("Grant one in Google Cloud Console → IAM & Admin → IAM.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
