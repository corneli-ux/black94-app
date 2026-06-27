import json, sys, time, base64
import google.auth.transport.requests
from google.oauth2 import service_account
import requests

PROJECT = 'memora-bond'
PACKAGE = 'com.black94.social'
SHA1 = 'FA9C5E1009650591642C0E44CC82370D1489202A'

sa_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sa.json'
with open(sa_path) as f:
    sa = json.load(f)

creds = service_account.Credentials.from_service_account_info(
    sa,
    scopes=['https://www.googleapis.com/auth/firebase',
            'https://www.googleapis.com/auth/cloud-platform']
)
creds.refresh(google.auth.transport.requests.Request())
token = creds.token
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# Find or create Android app
r = requests.get(f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps', headers=headers)
print('List apps status:', r.status_code)
apps = r.json().get('apps', [])

app_id = None
for app in apps:
    if app.get('packageName') == PACKAGE:
        app_id = app['appId']
        print(f'Found app: {app_id}')
        break

if not app_id:
    print('Creating Android app...')
    r = requests.post(
        f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps',
        headers=headers,
        json={'packageName': PACKAGE, 'displayName': 'Black94'}
    )
    print('Create:', r.status_code)
    if r.ok:
        op_name = r.json().get('name', '')
        for i in range(30):
            time.sleep(3)
            op_r = requests.get(f'https://firebase.googleapis.com/v1beta1/{op_name}', headers=headers)
            op_data = op_r.json()
            if op_data.get('done'):
                app_id = op_data.get('response', {}).get('appId')
                print(f'App created: {app_id}')
                break

if not app_id:
    print('ERROR: no app ID')
    sys.exit(1)

# Add SHA-1 fingerprint (needed for Google Sign-In)
r = requests.post(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/sha',
    headers=headers,
    json={'shaHash': SHA1, 'certType': 'SHA_1'}
)
print('Add SHA-1:', r.status_code)

# Get google-services.json
r = requests.get(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/config',
    headers=headers
)
print('Config:', r.status_code)
if not r.ok:
    print('ERROR getting config:', r.text)
    sys.exit(1)

content = base64.b64decode(r.json()['configFileContents']).decode()
with open('google-services.json', 'w') as f:
    f.write(content)

# Output base64 for use as GitHub secret
b64 = base64.b64encode(content.encode()).decode()
print(f'GOOGLE_SERVICES_JSON_B64={b64}')
print('SUCCESS: google-services.json written')

# Extract and print API key for use as GitHub secret
gsf_data = json.loads(content)
for client in gsf_data.get('client', []):
    for api_key in client.get('api_key', []):
        key = api_key.get('current_key', '')
        if key:
            print(f'FIREBASE_API_KEY={key}')
            break

# Also update project display name to "Black94"
print('\n=== Updating project display name to Black94 ===')
r = requests.patch(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}',
    headers=headers,
    json={'displayName': 'Black94'},
    params={'updateMask': 'displayName'}
)
print(f'Project display name update: {r.status_code}', r.text[:200] if not r.ok else 'OK')

# Update Android app display name to "Black94"
if app_id:
    r = requests.patch(
        f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}',
        headers=headers,
        json={'displayName': 'Black94'},
        params={'updateMask': 'displayName'}
    )
    print(f'Android app display name update: {r.status_code}', r.text[:200] if not r.ok else 'OK')

# Update Google Cloud project name via Resource Manager
r = requests.patch(
    f'https://cloudresourcemanager.googleapis.com/v3/projects/memora-bond',
    headers=headers,
    json={'displayName': 'Black94'},
    params={'updateMask': 'displayName'}
)
print(f'Cloud project display name: {r.status_code}', r.text[:200] if not r.ok else 'OK')

# Enable Google Sign-In and Email/Password auth providers
print('\n=== Enabling Auth providers ===')

# Get the Identity Toolkit config
r = requests.get(
    f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config',
    headers=headers
)
print('Auth config:', r.status_code)

# Enable Google Sign-In
r = requests.patch(
    f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config',
    headers=headers,
    json={
        'signIn': {
            'email': {'enabled': True, 'passwordRequired': False},
            'phoneNumber': {'enabled': False},
            'anonymous': {'enabled': True},
        }
    },
    params={'updateMask': 'signIn.email.enabled,signIn.anonymous.enabled'}
)
print('Enable Email/Anonymous auth:', r.status_code, r.text[:200] if not r.ok else 'OK')

# Enable Google Sign-In provider
r = requests.patch(
    f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/defaultSupportedIdpConfigs/google.com',
    headers=headers,
    json={'name': f'projects/{PROJECT}/defaultSupportedIdpConfigs/google.com', 'enabled': True},
    params={'updateMask': 'enabled'}
)
print('Enable Google Sign-In:', r.status_code, r.text[:200] if not r.ok else 'OK')

# Create Google provider if it doesn't exist
if r.status_code == 404:
    r = requests.post(
        f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/defaultSupportedIdpConfigs',
        headers=headers,
        json={
            'name': f'projects/{PROJECT}/defaultSupportedIdpConfigs/google.com',
            'enabled': True,
            'idpId': 'google.com'
        },
        params={'idpId': 'google.com'}
    )
    print('Create Google provider:', r.status_code, r.text[:200] if not r.ok else 'OK')

# Get OAuth clients to find the web client ID for Google Sign-In
print('\n=== Getting OAuth clients for Google Sign-In ===')
r = requests.get(
    f'https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/androidApps/{app_id}/config',
    headers=headers
)
if r.ok:
    import base64
    config = r.json()
    gsf = json.loads(base64.b64decode(config['configFileContents']).decode())
    web_client_id = None
    for client in gsf.get('client', []):
        for oauth in client.get('oauth_client', []):
            ctype = oauth.get('client_type', 0)
            cid = oauth.get('client_id', '')
            print(f'OAuth client type={ctype}: {cid}')
            if ctype == 3:  # type 3 = web client
                web_client_id = cid
                print(f'WEB_CLIENT_ID={cid}')
    if web_client_id:
        print(f'Found web client ID: {web_client_id}')
    else:
        print('No web client ID found - need to create OAuth client')
