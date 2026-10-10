import json, os, uuid
from decimal import Decimal
from pathlib import Path
import pyotp
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from plane.db.models import User, Profile, Workspace, WorkspaceMember, Project, ProjectMember, State, Issue, Page, ProjectPage, PageVersion
from plane.license.models import Instance, InstanceAdmin
from plane.lab.models import Credential, WorkspacePolicy, Stage, Bounty, Allocation
from plane.lab.bounty_models import BountyPublication, BountyTaskAccess

if Workspace.objects.filter(slug='android-lab').exists():
    print('Existing isolated fixture retained')
    raise SystemExit(0)

with transaction.atomic():
    users = {}
    credentials = {}
    names = {'admin': '安卓测试管理员', 'member': '安卓测试成员', 'guest': '安卓测试访客', 'participant': '安卓悬赏参与者', 'reviewer': '安卓验收人', 'independent': '安卓复核人'}
    for key, display in names.items():
        user = User.objects.create(username='android-'+key, email='android-'+key+'@example.invalid', display_name=display, first_name=display, is_staff=key=='admin', is_superuser=key=='admin', user_timezone='Asia/Shanghai')
        user.set_unusable_password(); user.save(update_fields=['password'])
        secret = pyotp.random_base32()
        Credential.objects.create(user=user, encrypted_secret=Fernet(settings.LAB_TOTP_KEY.encode()).encrypt(secret.encode()).decode())
        users[key] = user
        credentials[key] = {'username': user.username, 'user_id': str(user.id), 'totp_secret': secret}
    workspace = Workspace.objects.create(name='安卓验收工作区',slug='android-lab',owner=users['admin'],timezone='Asia/Shanghai')
    WorkspacePolicy.objects.get_or_create(workspace=workspace)
    for key,user in users.items():
        WorkspaceMember.objects.create(workspace=workspace,member=user,role=20 if key=='admin' else 5 if key=='guest' else 15)
        Profile.objects.create(user=user,is_onboarded=True,language='zh-CN',start_of_the_week=1,last_workspace_id=workspace.id,onboarding_step={'profile_complete':True,'workspace_create':True,'workspace_join':True,'workspace_invite':True})
    project = Project.objects.create(workspace=workspace,name='水声安卓验收',identifier='OA',project_lead=users['admin'],timezone='Asia/Shanghai',cycle_view=True,module_view=True,issue_views_view=True)
    for key,user in users.items():
        if key != 'participant': ProjectMember.objects.create(workspace=workspace,project=project,member=user,role=20 if key=='admin' else 5 if key=='guest' else 15)
    states={}
    for name,group in [('待办','backlog'),('未开始','unstarted'),('进行中','started'),('完成','completed'),('取消','cancelled')]:
        states[group] = State.objects.create(workspace=workspace,project=project,name=name,group=group,default=group=='unstarted')
    task=Issue.objects.create(workspace=workspace,project=project,state=states['unstarted'],name='移动端任务验证',created_by=users['member'],priority='high',description_html='<p>验证安卓任务与电脑端同步。</p>',target_date=timezone.now().date())
    guesttask=Issue.objects.create(workspace=workspace,project=project,state=states['unstarted'],name='访客本人任务',created_by=users['guest'])
    bountyissue=Issue.objects.create(workspace=workspace,project=project,state=states['unstarted'],name='水声数据验证悬赏',created_by=users['admin'])
    stage=Stage.objects.create(workspace=workspace,project=project,workspace_id_snapshot=workspace.id,project_id_snapshot=project.id,project_name=project.name,name='安卓验收阶段',budget=Decimal('1000.00'),frozen_at=timezone.now())
    bounty=Bounty.objects.create(stage=stage,issue=bountyissue,issue_id_snapshot=bountyissue.id,title=bountyissue.name,deliverable='水声验证记录',criteria='记录完整',budget=Decimal('100.00'),reserved=Decimal('0.00'),status='published',publisher=users['admin'],reviewer=users['reviewer'],independent_reviewer=users['independent'],published_at=timezone.now())
    BountyPublication.objects.create(bounty=bounty,summary='公开悬赏',deliverable=bounty.deliverable,criteria=bounty.criteria)
    allocation=Allocation.objects.create(bounty=bounty,user=users['participant'],user_id_snapshot=users['participant'].id,user_name=users['participant'].display_name,deliverable=bounty.deliverable,planned=Decimal('100.00'),approved=True,confirmed=True)
    BountyTaskAccess.objects.create(allocation=allocation,granted_by=users['admin'])
    page=Page.objects.create(workspace=workspace,owned_by=users['member'],name='安卓协作实验记录',description_html='<h2>目标</h2><p>验证安卓与网页协作。</p>')
    ProjectPage.objects.create(workspace=workspace,project=project,page=page)
    PageVersion.objects.create(workspace=workspace,page=page,owned_by=users['member'],description_html=page.description_html)
    instance=Instance.objects.create(instance_name='OpenOceanAcoustic Android test',instance_id=str(uuid.uuid4()),current_version='1.4.2',last_checked_at=timezone.now(),is_setup_done=True,is_signup_screen_visited=True,is_telemetry_enabled=False,is_support_required=False)
    InstanceAdmin.objects.create(instance=instance,user=users['admin'],is_verified=True)
    output={'server':'http://127.0.0.1:18100','emulator_server':'http://10.0.2.2:18100','workspace_slug':workspace.slug,'workspace_id':str(workspace.id),'project_id':str(project.id),'issue_id':str(task.id),'guest_issue_id':str(guesttask.id),'bounty_id':str(bounty.id),'page_id':str(page.id),'accounts':credentials}
    p=Path('/test-secrets/test-credentials.json');p.write_text(json.dumps(output,ensure_ascii=False,indent=2));p.chmod(0o600)
