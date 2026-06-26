#!/usr/bin/env python3
"""
Deploys Firestore security rules directly via the Firebase Rules REST API.

WHY THIS EXISTS
---------------
The `firebase deploy --only firestore:rules` CLI command does a pre-flight
check that calls `serviceusage.googleapis.com` to verify the Firestore
service is enabled. This requires the `serviceusage.services.get` permission,
which is NOT included in the Firebase Admin or Firebase Rules Admin roles.

If the service account only has Firebase-specific roles (not broad Editor/
Owner), the CLI fails with:
  403, Permission denied to get service [firestore.googleapis.com]

This script bypasses the CLI entirely and calls the Firebase Rules REST API
directly:
  1. POST /v1/projects/{project}/rulesets  — create a new ruleset from the
     firestore.rules file content
  2. PATCH /v1/projects/{project}/releases/cloud.firestore — point the
     `cloud.firestore` release at the new ruleset

These calls only require:
  - firebaserules.rulesets.create
  - firebaserules.releases.update

Both are granted by `roles/firebaserules.admin`, `roles/firebase.admin`,
`roles/editor`, or `roles/owner`.

Usage:
    python3 scripts/deploy_firestore_rules.py /path/to/service-account.json

Reads ./firestore.rules from the current directory.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

import google.auth.transport.requests
from google.oauth2 import service_account

PROJECT = "memora-bond"
RULES_FILE = "firestore.rules"
RELEASE_NAME = "cloud.firestore"  # Firestore release name (fixed by Firebase)


def get_access_token(sa_path: str) -> str:
    """Get an OAuth2 access token with Firebase Rules scopes."""
    with open(sa_path) as f:
        sa = json.load(f)

    creds = service_account.Credentials.from_service_account_info(
        sa,
        scopes=[
            "https://www.googleapis.com/auth/firebase",        # Firebase Rules
            "https://www.googleapis.com/auth/firebase.readonly",
        ],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def read_rules_content() -> str:
    """Read the firestore.rules file content."""
    if not os.path.exists(RULES_FILE):
        print(f"ERROR: {RULES_FILE} not found in current directory", file=sys.stderr)
        sys.exit(2)
    with open(RULES_FILE) as f:
        return f.read()


def create_ruleset(token: str, rules_content: str) -> str:
    """Create a new ruleset via POST /v1/projects/{project}/rulesets.

    Returns the ruleset name (e.g. "projects/memora-bond/rulesets/abc123").
    """
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/rulesets"
    body = json.dumps({
        "source": {
            "files": [
                {
                    "name": "firestore.rules",
                    "content": rules_content,
                }
            ]
        }
    }).encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            ruleset_name = data.get("name", "")
            print(f"[1/3] Ruleset created: {ruleset_name}")
            return ruleset_name
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[1/3] ERROR creating ruleset: HTTP {e.code}", file=sys.stderr)
        print(f"      Response: {body[:500]}", file=sys.stderr)
        # If it's a permission error, give a helpful message
        if e.code == 403:
            print(
                "\n      The service account lacks firebaserules.rulesets.create permission.\n"
                "      Grant one of: roles/firebaserules.admin, roles/firebase.admin,\n"
                "      roles/editor, or roles/owner in Google Cloud Console → IAM.",
                file=sys.stderr,
            )
        sys.exit(1)
    except Exception as e:
        print(f"[1/3] ERROR: {e}", file=sys.stderr)
        sys.exit(1)


def get_current_release(token: str) -> dict:
    """Get the current release info (to know what we're replacing)."""
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases/{RELEASE_NAME}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"[2/3] No existing release '{RELEASE_NAME}' — will create one")
            return None
        # Other errors are non-fatal — we'll try to update anyway
        print(f"[2/3] Warning: could not get current release (HTTP {e.code}) — continuing")
        return None
    except Exception:
        return None


def update_release(token: str, ruleset_name: str) -> None:
    """Point the cloud.firestore release at the new ruleset.

    Uses PATCH so we only update the ruleset_name field, preserving any
    other release metadata.
    """
    # First try PATCH (update existing release)
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases/{RELEASE_NAME}"
    body = json.dumps({
        "name": RELEASE_NAME,
        "rulesetName": ruleset_name,
    }).encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    # PATCH requires an updateMask query param to specify which fields to update
    req.full_url = url + "?updateMask=rulesetName"

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            print(f"[3/3] Release '{RELEASE_NAME}' updated to {ruleset_name}")
            return
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        if e.code == 404:
            # Release doesn't exist — create it with POST
            print(f"[3/3] Release doesn't exist — creating with POST")
            create_release(token, ruleset_name)
            return
        print(f"[3/3] ERROR updating release: HTTP {e.code}", file=sys.stderr)
        print(f"      Response: {body_text[:500]}", file=sys.stderr)
        if e.code == 403:
            print(
                "\n      The service account lacks firebaserules.releases.update permission.\n"
                "      Grant one of: roles/firebaserules.admin, roles/firebase.admin,\n"
                "      roles/editor, or roles/owner in Google Cloud Console → IAM.",
                file=sys.stderr,
            )
        sys.exit(1)
    except Exception as e:
        print(f"[3/3] ERROR: {e}", file=sys.stderr)
        sys.exit(1)


def create_release(token: str, ruleset_name: str) -> None:
    """Create a new release (POST) when PATCH returns 404."""
    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases"
    body = json.dumps({
        "name": RELEASE_NAME,
        "rulesetName": ruleset_name,
    }).encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            print(f"[3/3] Release '{RELEASE_NAME}' created pointing to {ruleset_name}")
            return
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"[3/3] ERROR creating release: HTTP {e.code}", file=sys.stderr)
        print(f"      Response: {body_text[:500]}", file=sys.stderr)
        sys.exit(1)


def main() -> int:
    sa_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sa.json"

    print(f"Deploying Firestore rules to project '{PROJECT}' via REST API...")
    print(f"  Service account: {sa_path}")
    print(f"  Rules file: {RULES_FILE}")
    print()

    # Step 1: Get OAuth2 access token
    print("[1/3] Getting access token...")
    token = get_access_token(sa_path)
    print(f"      Token acquired (scope: firebase)")
    print()

    # Step 2: Read rules file
    rules_content = read_rules_content()
    print(f"[2/3] Read {len(rules_content)} bytes from {RULES_FILE}")
    print()

    # Step 3: Create ruleset
    ruleset_name = create_ruleset(token, rules_content)
    print()

    # Step 4: Check current release (informational)
    current = get_current_release(token)
    if current:
        old_ruleset = current.get("rulesetName", "?")
        print(f"[2/3] Current release points to: {old_ruleset}")
    print()

    # Step 5: Update (or create) the release
    update_release(token, ruleset_name)

    print()
    print("SUCCESS: Firestore rules deployed via REST API")
    print(f"  Project: {PROJECT}")
    print(f"  Release: {RELEASE_NAME}")
    print(f"  Ruleset: {ruleset_name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
