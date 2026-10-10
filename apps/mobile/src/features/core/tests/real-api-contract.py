"""Exercise mobile core operations against the isolated 18100 backend only."""
import base64
import hashlib
import hmac
import json
import struct
import pickle
import sys
import time
import uuid
from pathlib import Path

import requests

fixture = json.loads(Path(sys.argv[1]).read_text())
assert fixture['server'] == 'http://127.0.0.1:18100', 'This runner requires the isolated backend'
account = fixture['accounts']['independent']
session = requests.Session()
session.headers['Referer'] = fixture['server'] + '/'
checks = []

def call(path, method='GET', body=None, statuses=(200, 201, 204)):
    if method != 'GET':
        csrf = session.get(fixture['server'] + '/auth/get-csrf-token/', timeout=30)
        csrf.raise_for_status()
        session.headers['X-CSRFToken'] = csrf.json()['csrf_token']
    response = session.request(method, fixture['server'] + path, json=body, timeout=60)
    checks.append({'method': method, 'path': path, 'status': response.status_code})
    if response.status_code not in statuses:
        raise AssertionError(f'{method} {path} returned {response.status_code}: {response.text[:150]}')
    return response.json() if response.content and 'json' in response.headers.get('Content-Type', '') else None

def totp(secret):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)

cookie_path=Path(sys.argv[1]).resolve().parent / 'core-test-session.pkl'
if cookie_path.exists():
    session.cookies.update(pickle.loads(cookie_path.read_bytes()))
else:
    call('/auth/lab/mobile/sign-in/', 'POST', {'username': account['username'], 'code': totp(account['totp_secret'])})
    cookie_path.write_bytes(pickle.dumps(session.cookies));cookie_path.chmod(0o600)
capabilities = call('/api/lab/session/')
assert capabilities['client_platform'] == 'android' and capabilities['capabilities']['data_export'] is False
workspace = '/api/workspaces/' + fixture['workspace_slug']
call(workspace + '/projects/')
project = call(workspace + '/projects/', 'POST', {'name': 'Android core contract ' + uuid.uuid4().hex[:6], 'identifier': 'A' + uuid.uuid4().hex[:6].upper(), 'network': 0, 'cycle_view': True, 'module_view': True, 'issue_views_view': True, 'project_lead': account['user_id']})
base = workspace + '/projects/' + project['id']
assert call(base + '/')['member_role'] == 20
states = call(base + '/states/')
state_id = next(row['id'] for row in states if row['default'])
call(base + '/members/')
label = call(base + '/issue-labels/', 'POST', {'name': 'Android contract', 'color': '#2E6F84'})
rich_html = '<h2>Core contract</h2><table><tbody><tr><td>阵列</td><td>32</td></tr></tbody></table><p><strong>校准记录</strong></p>'
task = call(base + '/issues/', 'POST', {'name': 'Android contract task', 'state_id': state_id, 'priority': 'high', 'start_date': '2026-10-10', 'target_date': '2026-10-20', 'description_html': rich_html, 'assignee_ids': [account['user_id']], 'label_ids': [label['id']]})
issue = base + '/issues/' + task['id'] + '/'
updated = call(issue, 'PATCH', {'priority': 'urgent', 'start_date': None})
assert '<table>' in call(issue)['description_html']
call(base + '/issues/?per_page=100&state=' + state_id + '&priority=urgent&order_by=target_date')
call(workspace + '/search/?search=contract&entities=issue&project_id=' + project['id'] + '&workspace_search=false')
props = call(base + '/user-properties/')
props.update(filters={'state': [state_id], 'priority': ['urgent']}, display_filters={'layout': 'spreadsheet', 'order_by': 'target_date', 'group_by': 'priority'}, display_properties={'key': True, 'due_date': True, 'priority': False})
call(base + '/user-properties/', 'PATCH', {key: props[key] for key in ('filters', 'display_filters', 'display_properties')})
assert call(base + '/user-properties/')['display_filters']['layout'] == 'spreadsheet'
comment = call(issue + 'comments/', 'POST', {'comment_html': '<p><strong>协作验收</strong></p>'})
call(issue + 'comments/' + comment['id'] + '/', 'PATCH', {'comment_html': '<p>已验证 <em>API</em></p>'})
call(issue + 'comments/')
reaction_path = base + '/comments/' + comment['id'] + '/reactions/'
call(reaction_path, 'POST', {'reaction': '1f44d'})
assert any(row['reaction'] == '1f44d' for row in call(issue + 'comments/')[0]['comment_reactions'])
call(reaction_path + '1f44d/', 'DELETE')
link = call(issue + 'issue-links/', 'POST', {'title': '协议', 'url': 'https://example.org/contract'})
call(issue + 'issue-links/' + link['id'] + '/', 'PATCH', {'title': '协议参考', 'url': 'https://example.org/reference'})
child = call(base + '/issues/', 'POST', {'name': 'Android contract child', 'parent_id': task['id']})
call(issue + 'sub-issues/')
other = call(base + '/issues/', 'POST', {'name': 'Android contract relation'})
call(issue + 'issue-relation/', 'POST', {'relation_type': 'relates_to', 'issues': [other['id']]})
call(issue + 'issue-relation/')
call(issue + 'remove-relation/', 'POST', {'related_issue': other['id']})
if call(issue)['is_subscribed']:
    call(issue + 'subscribe/', 'DELETE')
call(issue + 'subscribe/', 'POST')
assert call(issue)['is_subscribed'] is True
call(issue + 'subscribe/', 'DELETE')
cycle = call(base + '/cycles/', 'POST', {'name': 'Android cycle', 'start_date': '2026-10-10T00:00:00+08:00', 'end_date': '2026-10-20T23:59:59+08:00'})
call(base + '/cycles/' + cycle['id'] + '/cycle-issues/', 'POST', {'issues': [task['id']]})
call(base + '/cycles/' + cycle['id'] + '/cycle-issues/')
call(base + '/cycles/' + cycle['id'] + '/')
assert isinstance(call(base + '/cycles/' + cycle['id'] + '/analytics/')['completion_chart'], dict)
module = call(base + '/modules/', 'POST', {'name': 'Android module', 'status': 'planned', 'lead_id': account['user_id']})
call(base + '/modules/' + module['id'] + '/issues/', 'POST', {'issues': [task['id']]})
call(base + '/modules/' + module['id'] + '/issues/')
assert isinstance(call(base + '/modules/' + module['id'] + '/')['distribution'], dict)
view = call(base + '/views/', 'POST', {'name': 'Android saved view', 'filters': {'priority': ['urgent']}, 'display_filters': {'layout': 'calendar'}, 'access': 0})
call(base + '/views/' + view['id'] + '/', 'PATCH', {'name': 'Android saved view edited'})
call(base + '/views/')
intake = call(base + '/intakes/')
if not intake.get('id'):
    call(base + '/intakes/', 'POST', {'name': 'Intake', 'is_default': True})
request = call(base + '/intake-issues/', 'POST', {'issue': {'name': 'Android intake request', 'description_html': '<p>真实需求</p>', 'priority': 'high'}})
intake_path = base + '/intake-issues/' + request['issue']['id'] + '/'
call(base + '/intake-issues/?status=-2')
call(intake_path, 'PATCH', {'issue': {'description_html': rich_html}})
call(intake_path, 'PATCH', {'status': 0, 'snoozed_till': '2026-12-31T10:00:00+08:00'})
call(intake_path, 'PATCH', {'status': 2, 'duplicate_to': task['id']})
call(intake_path, 'PATCH', {'status': -2, 'duplicate_to': None, 'snoozed_till': None})
call(intake_path, 'PATCH', {'status': 1})
assert call(intake_path)['status'] == 1
call(issue, 'PATCH', {'state_id': next(row['id'] for row in states if row['group'] == 'completed')})
call(issue + 'archive/', 'POST')
call(base + '/archived-issues/')
call(issue + 'archive/', 'DELETE')
call(base + '/cycles/' + cycle['id'] + '/', 'PATCH', {'start_date': '2026-09-01T00:00:00+08:00', 'end_date': '2026-09-10T23:59:59+08:00'})
call(base + '/cycles/' + cycle['id'] + '/archive/', 'POST')
call(base + '/archived-cycles/')
call(base + '/cycles/' + cycle['id'] + '/archive/', 'DELETE')
call(base + '/modules/' + module['id'] + '/', 'PATCH', {'status': 'completed'})
call(base + '/modules/' + module['id'] + '/archive/', 'POST')
call(base + '/archived-modules/')
call(base + '/modules/' + module['id'] + '/archive/', 'DELETE')
attachment_path='/api/assets/v2/workspaces/'+fixture['workspace_slug']+'/projects/'+project['id']+'/issues/'+task['id']+'/attachments/'
content='安卓授权附件'.encode()
signed=call(attachment_path,'POST',{'name':'android-contract.txt','type':'text/plain','size':len(content)})
assert call(attachment_path)==[]
# The unconfirmed upload remains unavailable through the authenticated endpoint.
call(attachment_path+signed['asset_id']+'/',statuses=(400,))
upload=requests.post(signed['upload_data']['url'],data=signed['upload_data']['fields'],files={'file':('android-contract.txt',content,'text/plain')},timeout=30)
assert upload.status_code in (201,204)
call(attachment_path+signed['asset_id']+'/','PATCH')
assert len(call(attachment_path))==1
download=session.get(fixture['server']+attachment_path+signed['asset_id']+'/',timeout=30)
assert download.status_code==200 and download.content==content
call(attachment_path+signed['asset_id']+'/','DELETE')
call(issue + 'history/?activity_type=issue-property')
call(base + '/work-items/' + task['id'] + '/description-versions/')
call(workspace + '/project-stats/?project_ids=' + project['id'])
call(workspace + '/lab/planning-export/?format=json', statuses=(403,))
Path('/tmp/ooa-android-core-api-results.json').write_text(json.dumps({'project_id': project['id'], 'issue_id': task['id'], 'checks': checks}, ensure_ascii=False, indent=2))
print(f'{len(checks)} isolated core API requests passed; evidence /tmp/ooa-android-core-api-results.json')
