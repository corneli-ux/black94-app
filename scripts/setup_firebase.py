import json, sys, time, base64
import google.auth.transport.requests
from google.oauth2 import service_account
import requests

PROJECT = 'memora-bond'
PACKAGE = 'com.black94.app'
SHA1 = 'F53F0D14741D8F88177E49AAB82FD02BA2D6DDC4'

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
