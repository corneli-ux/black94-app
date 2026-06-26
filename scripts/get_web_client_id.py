"""
Gets or creates the Web OAuth client ID needed for Google Sign-In.
This is different from the Android OAuth client in google-services.json.
"""
import json, sys, base64
import google.auth.transport.requests
from google.oauth2 import service_account
import requests

sa_path = sys.argv[1]
with open(sa_path) as f:
    sa = json.load(f)

PROJECT = sa['project_id']

creds = service_account.Credentials.from_service_account_info(
    sa, scopes=[
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/firebase',
    ]
)
creds.refresh(google.auth.transport.requests.Request())
token = creds.token
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# Method 1: Check google-services.json for any web client
r = requests.get(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps',
    headers=headers
)
apps = r.json().get('apps', [])
print(f"Android apps: {len(apps)}")

for app in apps:
    app_id = app['appId']
    r2 = requests.get(
        f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/config',
        headers=headers
    )
    if r2.ok:
        content = base64.b64decode(r2.json()['configFileContents']).decode()
        gsf = json.loads(content)
        for client in gsf.get('client', []):
            for oauth in client.get('oauth_client', []):
                ctype = oauth.get('client_type', 0)
                cid = oauth.get('client_id', '')
                print(f"OAuth client type={ctype}: {cid[:50]}...")
                # type 3 = web application
                if ctype == 3:
                    print(f"FOUND_WEB_CLIENT_ID={cid}")

# Method 2: Check Identity Toolkit for the web client
r = requests.get(
    f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config',
    headers=headers
)
print(f"Identity Toolkit config: {r.status_code}")
if r.ok:
    config = r.json()
    # Look for client config
    client_config = config.get('client', {})
    print(f"Client config keys: {list(client_config.keys())}")
    api_key = client_config.get('apiKey', '')
    if api_key:
        print(f"API Key from Identity Toolkit: {api_key[:20]}...")

# Method 3: Get project info to find web client
r = requests.get(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}',
    headers=headers
)
if r.ok:
    project = r.json()
    print(f"Project displayName: {project.get('displayName')}")
    print(f"Project state: {project.get('state')}")

