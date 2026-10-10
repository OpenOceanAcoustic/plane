"""Real isolated HTTP acceptance. Reads private fixture credentials, never prints secrets.

Requires business-test-credentials.json and test-credentials.json prepared outside Git.
Only mutates the dedicated android-business-* workspace; no deployment data.
"""
import base64, hashlib, hmac, http.cookiejar, json, os, struct, time, uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.parse import urlencode

private=Path(os.environ.get('ANDROID_PRIVATE_TEST_DIR','/mnt/repo/ly/.android-release'))
fixture=json.loads((private/'business-test-credentials.json').read_text())
shared=json.loads((private/'test-credentials.json').read_text())
accounts={**shared['accounts'],**fixture['accounts']}
server=fixture['server']; slug=fixture['workspace_slug']; project=fixture['project_id'];issue=fixture['issue_id']
assert slug.startswith('android-business-'), 'This script requires an isolated business workspace'
base=f'/api/workspaces/{slug}';lab=base+'/lab/';cases=[]
def totp(secret,offset=0):
 step=int(time.time())//30+offset
 digest=hmac.new(base64.b32decode(secret),struct.pack('>Q',step),hashlib.sha1).digest();i=digest[-1]&15
 return f'{(struct.unpack(">I",digest[i:i+4])[0]&0x7fffffff)%1000000:06d}'
class Client:
 def __init__(self,label,persist=True):
  self.cookies=http.cookiejar.MozillaCookieJar(str(private/f'business-cookies-{label}.txt'))
  if persist:
   try:self.cookies.load(ignore_discard=True,ignore_expires=True)
   except FileNotFoundError:pass
  self.opener=build_opener(HTTPCookieProcessor(self.cookies));self.csrf=None
 def call(self,path,method='GET',data=None,expected=(200,201,204)):
  if method!='GET' and not self.csrf:self.csrf=self.call('/auth/get-csrf-token/')['csrf_token']
  headers={'Content-Type':'application/json','Origin':server,'Referer':server+'/'}
  if self.csrf:headers['X-CSRFToken']=self.csrf
  request=Request(server+path,data=None if data is None else json.dumps(data).encode(),method=method,headers=headers)
  try:response=self.opener.open(request,timeout=25)
  except HTTPError as failure:response=failure
  status=response.code;content=response.read()
  try:value=json.loads(content) if content else None
  except (ValueError,UnicodeDecodeError):value=None
  if status not in expected:
   detail=value.get('error',value.get('detail','')) if isinstance(value,dict) else value if isinstance(value,list) else ''
   raise AssertionError(f'{method} {path.split("?")[0]} -> {status}: {str(detail)[:150]}')
  return value if len(expected)!=1 or expected[0]<300 else status
 def login(self,label,desktop=False):
  value=self.call('/api/lab/session/',expected=(200,401))
  if isinstance(value,dict) and value.get('user',{}).get('id')==accounts[label]['user_id']:return value
  self.csrf=self.call('/auth/get-csrf-token/')['csrf_token']
  login=self.call('/auth/lab/sign-in/' if desktop else '/auth/lab/mobile/sign-in/','POST',{'username':accounts[label]['username'],'code':totp(accounts[label]['totp_secret'],1 if desktop else 0)})
  self.csrf=self.call('/auth/get-csrf-token/')['csrf_token'];self.cookies.save(ignore_discard=True,ignore_expires=True);os.chmod(self.cookies.filename,0o600)
  return self.call('/api/lab/session/')
def check(name,action):
 action();cases.append(name);print(json.dumps({'passed':len(cases),'case':name},ensure_ascii=False),flush=True)
def exact(value,expected):assert value==expected,(value,expected)
def assert_link(result,issue_id):assert any(row["id"]==issue_id for row in result["tasks"])
lead=Client('lead'); reviewer=Client('reviewer'); participant=Client('participant'); guest=Client('guest')
try:
 for label,client in [('lead',lead),('reviewer',reviewer),('participant',participant),('guest',guest)]:
  session=client.login(label);exact(session['client_platform'],'android');exact(session['capabilities']['data_export'],False)
 cases.append('four real Android sessions restore role identity and disable exports')
 check('Android direct planning export refused',lambda:exact(lead.call(lab+'planning-export/',expected=(403,)),403))
 check('Android direct finance CSV refused',lambda:exact(lead.call(lab+'finance/entries/?format=csv',expected=(403,)),403))
 check('guest team schedule refused',lambda:exact(guest.call(lab+'calendar/?team=1',expected=(403,)),403))
 check('restricted participant native project issue list refused',lambda:exact(participant.call(base+f'/projects/{project}/issues/',expected=(403,)),403))
 planner=reviewer.call(lab+'planner/'); item=reviewer.call(lab+'items/','POST',{'title':'独立HTTP排期验证','description':'测试隔离数据','category_id':planner['default_category_id']})['id']
 start=datetime.now(timezone.utc).replace(hour=1,minute=0,second=0,microsecond=0)+timedelta(days=3);end=start+timedelta(hours=1)
 block=reviewer.call(lab+'calendar/','POST',{'item_id':item,'start':start.isoformat(),'end':end.isoformat()})
 revision=block['revision'];block_id=block['id'];mutation={'start':start.isoformat(),'end':(end+timedelta(minutes=15)).isoformat(),'expected_revision':revision}
 updated=reviewer.call(lab+f'calendar/{block_id}/','PATCH',mutation);exact(updated['revision'],revision+1)
 check('stale schedule revision returns conflict',lambda:exact(reviewer.call(lab+f'calendar/{block_id}/','PATCH',mutation,expected=(409,)),409))
 blocks=reviewer.call(lab+'calendar/?'+urlencode({'start':start.isoformat(),'end':(start+timedelta(days=1)).isoformat()}))
 assert any(row['id']==block_id for row in blocks['events'] if isinstance(blocks,dict)) if isinstance(blocks,dict) else any(row['id']==block_id for row in blocks)
 cases.append('real planner create/update/query synchronized with revision increment')
 reviewer.call(lab+f'calendar/{block_id}/','DELETE',{'expected_revision':updated['revision']});reviewer.call(lab+f'items/{item}/','DELETE')
 baseline=Decimal(next((row['balance'] for row in lead.call(lab+'finance/overview/')['accounts'] if row['kind']=='public'),'0.00'))
 key=str(uuid.uuid4());opening={'request_key':key,'reason':'隔离财务幂等验证','kind':'public','amount':'10.25','source':'测试期初登记','evidence':'test-only:proof'}
 first=lead.call(lab+'finance/opening/','POST',opening);second=lead.call(lab+'finance/opening/','POST',opening);exact(first['operation_id'],second['operation_id'])
 check('financial retry creates exactly one operation',lambda:exact(first['id'],second['id']))
 check('reusing financial key with changed amount refused',lambda:exact(lead.call(lab+'finance/opening/','POST',{**opening,'amount':'10.26'},expected=(400,)),400))
 overview=lead.call(lab+'finance/overview/');public=next(row for row in overview['accounts'] if row['kind']=='public');exact(Decimal(public['balance']),baseline+Decimal('10.25'))
 cases.append('financial decimal amount remains exactly 10.25')
 check('non-manager cannot import public funds',lambda:exact(reviewer.call(lab+'finance/opening/','POST',{**opening,'request_key':str(uuid.uuid4())},expected=(403,)),403))
 reverse={'request_key':str(uuid.uuid4()),'operation_id':first['operation_id'],'reason':'清理隔离财务验收登记','evidence':'test-only:reverse-proof'}
 lead.call(lab+'finance/reverse/','POST',reverse);lead.call(lab+'finance/reverse/','POST',reverse);overview=lead.call(lab+'finance/overview/');exact(Decimal(next(row for row in overview['accounts'] if row['kind']=='public')['balance']),baseline);cases.append('financial reversal is append-only and idempotent')
 document=reviewer.call(lab+f'projects/{project}/documents/','POST',{'name':'HTTP关联验证记录','access':0})
 page=document['id']; reviewer.call(lab+f'documents/{page}/tasks/','POST',{'issue_id':issue})
 links=reviewer.call(lab+f'tasks/{issue}/documents/');assert any(row['id']==page for row in links['documents'])
 check('document-task association is visible through both routes',lambda:assert_link(lead.call(lab+f'documents/{page}/tasks/?project_id={project}'),issue))
 check('guest cannot bind a document',lambda:exact(guest.call(lab+f'documents/{page}/tasks/','POST',{'issue_id':issue},expected=(404,)),404))
 reviewer.call(lab+f'documents/{page}/tasks/','DELETE',{'issue_id':issue});assert not any(row['id']==page for row in reviewer.call(lab+f'tasks/{issue}/documents/')['documents']);cases.append('document association delete is immediately synchronized')
 draft=reviewer.call(base+'/draft-issues/','POST',{'name':'真实HTTP草稿发布','description_html':'<p>完整草稿描述</p>'})
 reviewer.call(base+f'/draft-issues/{draft["id"]}/','PATCH',{'project_id':project,'state_id':fixture['states']['unstarted'],'priority':'high','assignee_ids':[accounts['reviewer']['user_id']]})
 latest=reviewer.call(base+f'/draft-issues/{draft["id"]}/');exact(latest['project_id'],project);exact(latest['assignee_ids'],[accounts['reviewer']['user_id']])
 payload={key:latest[key] for key in ['name','description_html','priority','state_id','assignee_ids','label_ids','start_date','target_date'] if key in latest}
 published=reviewer.call(base+f'/draft-to-issue/{draft["id"]}/','POST',payload);exact(published['description_html'],'<p>完整草稿描述</p>');cases.append('draft created without project can be assigned and published with relations intact')
 guest_draft=guest.call(base+'/draft-issues/','POST',{'name':'访客私有草稿'})
 guest.call(base+f'/draft-issues/{guest_draft["id"]}/','PATCH',{'name':'访客更新私有草稿'});exact(guest.call(base+f'/draft-issues/{guest_draft["id"]}/')['name'],'访客更新私有草稿');guest.call(base+f'/draft-issues/{guest_draft["id"]}/','DELETE');cases.append('guest may edit and delete own draft without publish permission')
 saved_view=reviewer.call(base+'/views/','POST',{'name':'HTTP真实视图','filters':{'project':[project],'priority':['high']}})
 reviewer.call(base+f'/views/{saved_view["id"]}/','PATCH',{'name':'HTTP筛选视图','filters':{'project':[project],'state_group':['unstarted']}});exact(reviewer.call(base+f'/views/{saved_view["id"]}/')['name'],'HTTP筛选视图');reviewer.call(base+f'/views/{saved_view["id"]}/','DELETE');cases.append('workspace saved views create/update/delete through real endpoints')
 states=fixture['states'];project_states=lead.call(base+f'/projects/{project}/states/');review_state=next((row['id'] for row in project_states if row['name']=='待验收'),None)
 if not review_state:review_state=lead.call(base+f'/projects/{project}/states/','POST',{'name':'待验收','group':'started','color':'#3274ad'})['id']
 lead.call(lab+f'flows/{project}/','PUT',{'todo':states['unstarted'],'active':states['started'],'review':review_state,'done':states['completed']})
 stage=lead.call(lab+'stages/','POST',{'project_id':project,'name':'HTTP悬赏验收阶段','budget':'1000.00'})['id']
 task=lead.call(base+f'/projects/{project}/issues/','POST',{'name':'独立悬赏闭环验证','priority':'none'})
 bounty=lead.call(lab+'bounties/','POST',{'stage_id':stage,'issue_id':task['id'],'budget':'20.00','deliverable':'HTTP验证记录','criteria':'操作完整可重现','reviewer_id':accounts['reviewer']['user_id'],'independent_reviewer_id':accounts['independent']['user_id']})['id']
 action=lambda client,verb,data={}:client.call(lab+f'bounties/{bounty}/{verb}/','POST',data)
 claim=action(participant,'claim',{'planned':'20.00','deliverable':'验证结果'})['id'];action(lead,'approve',{'allocation_id':claim})
 check('team start requires participant confirmation',lambda:exact(lead.call(lab+f'bounties/{bounty}/start/','POST',{},expected=(400,)),400))
 action(participant,'confirm');action(lead,'start');action(participant,'submit',{'evidence':'test-only:HTTP闭环记录'})
 acceptance={'request_key':str(uuid.uuid4()),'result':'pass','reason':'记录满足验收标准','targets':{claim:'20.00'}}
 check('participant cannot accept own bounty',lambda:exact(participant.call(lab+f'bounties/{bounty}/accept/','POST',acceptance,expected=(403,)),403))
 action(reviewer,'accept',acceptance);action(reviewer,'accept',acceptance);detail=participant.call(lab+f'bounties/{bounty}/detail/');exact(detail['allocations'][0]['awarded'],'20.00');cases.append('restricted bounty complete claim/approve/confirm/start/submit/accept flow with idempotent VC')
 check('restricted participant materials use dedicated endpoint',lambda:participant.call(lab+f'bounties/{bounty}/materials/'))
 desktop=Client('lead-desktop');desktop_session=desktop.login('lead',desktop=True);exact(desktop_session['client_platform'],'web')
 check('desktop sees Android-created task from shared backend',lambda:exact(desktop.call(base+f'/projects/{project}/issues/{task["id"]}/')['name'],'独立悬赏闭环验证'))
 desktop.call(base+f'/projects/{project}/issues/{issue}/','PATCH',{'name':'桌面更新→移动同步验证'})
 check('Android immediately sees desktop update',lambda:exact(lead.call(base+f'/projects/{project}/issues/{issue}/')['name'],'桌面更新→移动同步验证'))
 print(json.dumps({'passed':len(cases),'cases':cases,'transport':'real HTTP, PostgreSQL isolated containers','device':'host Python HTTP clients; not Android emulator'},ensure_ascii=False,indent=2))
except Exception:
 print(json.dumps({'passed_before_failure':len(cases),'cases':cases},ensure_ascii=False));raise
