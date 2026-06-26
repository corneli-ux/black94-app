#!/usr/bin/env python3
"""
Extracts the Web OAuth client ID from google-services.json.

In a Firebase project with Google Sign-In enabled, google-services.json
contains an `oauth_client` entry with `client_type: 3` (Web Application).
This is the client ID that must be passed to GoogleSignin.configure({
  webClientId: <this value>
}) so that the Google ID token's audience matches what Firebase Auth expects
when verifying the token via signInWithIdp.

If the web client ID is NOT found in google-services.json, Google Sign-In
has not been enabled in the Firebase Console (Authentication → Sign-in method
→ Google). The script exits with code 1 in that case so the build fails
loudly instead of silently baking in a wrong/placeholder client ID.

Usage:
    python3 scripts/extract_web_client_id.py [google-services.json]

Prints the client ID to stdout (nothing else) on success.
Exits 1 with an error message on stderr if not found.
"""
import json
import os
import sys


def find_web_client_id(gsf: dict) -> str:
    """Return the web OAuth client ID (client_type 3) from google-services.json."""

    # Strategy 1: oauth_client with client_type == 3 (the canonical location)
    for client in gsf.get("client", []):
        for oauth in client.get("oauth_client", []):
            ctype = oauth.get("client_type", 0)
            cid = oauth.get("client_id", "")
            # client_type 3 = Web Application client
            if ctype == 3 and cid and cid.endswith(".apps.googleusercontent.com"):
                return cid

    # Strategy 2: Some older google-services.json versions store the web
    # client ID under services.google_signin_service (now deprecated, but
    # still present in configs generated before ~2022).
    for client in gsf.get("client", []):
        services = client.get("services", {})
        gss = services.get("google_signin_service", {})
        # The web client ID can appear under "web_client_id" or in the
        # "server_client_id" field.
        for key in ("web_client_id", "server_client_id", "default_web_client_id"):
            val = gss.get(key, "")
            if val and val.endswith(".apps.googleusercontent.com"):
                return val

    # Strategy 3: Last-resort fallback — find any oauth_client whose client_id
    # ends with .apps.googleusercontent.com AND has no android_info (i.e. not
    # an Android client). This catches mis-typed client_type values.
    for client in gsf.get("client", []):
        for oauth in client.get("oauth_client", []):
            cid = oauth.get("client_id", "")
            if (
                cid.endswith(".apps.googleusercontent.com")
                and "android_info" not in oauth
            ):
                # Skip the "Other" client type (type 2) if a real web client exists
                if oauth.get("client_type", 0) != 2:
                    return cid

    return ""


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "google-services.json"
    if not os.path.exists(path):
        print(f"ERROR: {path} not found", file=sys.stderr)
        return 2

    try:
        with open(path) as f:
            gsf = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: {path} is not valid JSON: {e}", file=sys.stderr)
        return 2

    # Log all oauth clients found, for debugging build failures
    print("=== OAuth clients in google-services.json ===", file=sys.stderr)
    for client in gsf.get("client", []):
        package = client.get("client_info", {}).get("android_client_info", {}).get("package_name", "?")
        print(f"Package: {package}", file=sys.stderr)
        for oauth in client.get("oauth_client", []):
            ctype = oauth.get("client_type", 0)
            cid = oauth.get("client_id", "")
            masked = cid[:20] + "..." if len(cid) > 23 else cid
            print(f"  client_type={ctype}: {masked}", file=sys.stderr)
    print("==============================================", file=sys.stderr)

    web_client_id = find_web_client_id(gsf)
    if not web_client_id:
        print("", end="")  # empty stdout
        print(
            "ERROR: No Web OAuth client (client_type 3) found in google-services.json.\n"
            "Google Sign-In will NOT work without it.\n"
            "Fix: In Firebase Console → Authentication → Sign-in method → Google → Enable.\n"
            "Then re-run the setup-firebase workflow to regenerate google-services.json.",
            file=sys.stderr,
        )
        return 1

    # Print ONLY the client ID to stdout (parsed by the workflow)
    print(web_client_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
