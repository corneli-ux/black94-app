"""
Gets the Web OAuth client ID for Google Sign-In from memora-bond.
Reads from the Identity Toolkit Google IdP config where the web client ID lives.
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
        'https://www.googleapis.com/auth/identitytoolkit',
    ]
)
creds.refresh(google.auth.transport.requests.Request())
token = creds.token
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

web_client_id = None

# METHOD 1: Read the Google IdP config — this holds the web client ID
# when Google Sign-In is enabled in the project.
r = requests.get(
    f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/defaultSupportedIdpConfigs/google.com',
    headers=headers
)
print(f"IdP config status: {r.status_code}")
if r.ok:
    cfg = r.json()
    cid = cfg.get('clientId', '')
    print(f"IdP config clientId: {cid}")
    if cid:
        web_client_id = cid

# METHOD 2: Check google-services.json for type-3 client
if not web_client_id:
    r = requests.get(
        f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps',
        headers=headers
    )
    apps = r.json().get('apps', [])
    for app in apps:
        app_id = app['appId']
        r2 = requests.get(
            f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/config',
            headers=headers
        )
        if r2.ok:
            gsf = json.loads(base64.b64decode(r2.json()['configFileContents']).decode())
            for client in gsf.get('client', []):
                for oauth in client.get('oauth_client', []):
                    if oauth.get('client_type') == 3:
                        web_client_id = oauth['client_id']
                        print(f"google-services.json web client: {web_client_id}")

if web_client_id:
    print(f"FOUND_WEB_CLIENT_ID={web_client_id}")
else:
    print("ERROR: No web client ID found. Google Sign-In needs the provider enabled with a web OAuth client.")
