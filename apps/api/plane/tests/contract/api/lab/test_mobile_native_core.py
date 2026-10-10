"""Native endpoints needed to complete mobile project workflows."""
import pytest
from plane.db.models import DraftIssue, DraftIssueAssignee, DraftIssueLabel, Label, Project, ProjectMember, Workspace, WorkspaceMember

pytestmark=[pytest.mark.django_db(transaction=True),pytest.mark.contract]

def test_project_feature_switch_writes_canonical_intake_view(laboratory, mocker):
    lab = laboratory
    mocker.patch('plane.app.views.project.base.model_activity.delay')
    mocker.patch('plane.app.views.project.base.recent_visited_task.delay')
    path = f"/api/workspaces/lab/projects/{lab['project'].id}/"
    client = lab['client'](lab['lead'])
    for enabled in (False, True, False):
        response = client.patch(path, {'intake_view': enabled}, format='json')
        assert response.status_code == 200
        saved = client.get(path)
        assert saved.status_code == 200
        assert saved.json()['intake_view'] is enabled
        assert saved.json()['inbox_view'] is enabled


def test_project_feature_switch_keeps_browser_alias_and_canonical_precedence(laboratory, mocker):
    lab = laboratory
    mocker.patch('plane.app.views.project.base.model_activity.delay')
    mocker.patch('plane.app.views.project.base.recent_visited_task.delay')
    path = f"/api/workspaces/lab/projects/{lab['project'].id}/"
    client = lab['client'](lab['lead'])
    assert client.patch(path, {'inbox_view': True}, format='json').status_code == 200
    assert client.get(path).json()['intake_view'] is True
    assert client.patch(path, {'intake_view': False, 'inbox_view': True}, format='json').status_code == 200
    assert client.get(path).json()['intake_view'] is False

def test_native_intake_creation_checks_request_role_and_binds_project(laboratory):
    lab=laboratory
    path=f"/api/workspaces/lab/projects/{lab['project'].id}/intakes/"
    client=lab['client'](lab['member'])
    created=client.post(path,{'name':'Mobile intake'},format='json')
    assert created.status_code == 201
    assert created.json()['project'] == str(lab['project'].id)
    assert created.json()['workspace'] == str(lab['workspace'].id)
    ProjectMember.objects.filter(project=lab['project'],member=lab['member']).update(role=5)
    assert client.post(path,{'name':'Guest cannot create'},format='json').status_code == 403
    assert client.get(path).status_code == 403

def test_draft_project_assignment_and_move_bind_new_relations(laboratory):
    lab=laboratory
    draft=DraftIssue(workspace=lab['workspace'],name='Mobile draft',created_by=lab['member']);draft.save(disable_auto_set_user=True)
    path=f"/api/workspaces/lab/draft-issues/{draft.id}/"
    client=lab['client'](lab['member'])
    assert client.get(path).status_code == 200
    assert client.patch(path,{'project_id':str(lab['project'].id),'state_id':str(lab['states']['todo'].id),'assignee_ids':[str(lab['member'].id)]},format='json').status_code == 204
    draft.refresh_from_db()
    assert draft.project_id == lab['project'].id
    assert DraftIssueAssignee.objects.get(draft_issue=draft).project_id == lab['project'].id
    label=Label.objects.create(workspace=lab['workspace'],project=lab['project'],name='old label')
    DraftIssueLabel.objects.create(workspace=lab['workspace'],project=lab['project'],draft_issue=draft,label=label)
    new_project=Project.objects.create(workspace=lab['workspace'],name='New mobile project',identifier='NEW')
    ProjectMember.objects.create(project=new_project,member=lab['member'],role=15)
    assert client.patch(path,{'project_id':str(new_project.id)},format='json').status_code == 204
    draft.refresh_from_db()
    assert draft.project_id == new_project.id
    assert draft.state_id is None
    assert not DraftIssueAssignee.objects.filter(draft_issue=draft).exists()
    assert not DraftIssueLabel.objects.filter(draft_issue=draft).exists()

def test_draft_guest_creator_and_denied_project_assignments(laboratory):
    lab=laboratory
    draft=DraftIssue(workspace=lab['workspace'],name='Guest draft',created_by=lab['member']);draft.save(disable_auto_set_user=True)
    path=f"/api/workspaces/lab/draft-issues/{draft.id}/"
    WorkspaceMember.objects.filter(workspace=lab['workspace'],member=lab['member']).update(role=5)
    ProjectMember.objects.filter(project=lab['project'],member=lab['member']).update(role=5)
    client=lab['client'](lab['member'])
    assert client.patch(path,{'name':'Own guest draft'},format='json').status_code == 204
    assert client.get(path).status_code == 200
    other_project=Project.objects.create(workspace=lab['workspace'],name='Restricted project',identifier='NO')
    assert client.patch(path,{'project_id':str(other_project.id)},format='json').status_code == 400
    other_workspace=Workspace.objects.create(name='Other',slug='other',owner=lab['lead'])
    other=Project.objects.create(workspace=other_workspace,name='Other workspace project',identifier='OW')
    ProjectMember.objects.create(project=other,member=lab['member'],role=15)
    assert client.patch(path,{'project_id':str(other.id)},format='json').status_code == 400

def test_draft_publication_requires_owner_and_active_project_member(laboratory,mocker):
    lab=laboratory
    mocker.patch('plane.app.views.workspace.draft.issue_activity.delay')
    draft=DraftIssue(workspace=lab['workspace'],project=lab['project'],name='Private draft',created_by=lab['member']);draft.save(disable_auto_set_user=True)
    path=f"/api/workspaces/lab/draft-to-issue/{draft.id}/"
    assert lab['client'](lab['reviewer']).post(path,{'name':'Cannot publish another draft'},format='json').status_code == 404
    ProjectMember.objects.filter(project=lab['project'],member=lab['member']).update(is_active=False)
    assert lab['client'](lab['member']).post(path,{'name':'Cannot publish revoked project'},format='json').status_code == 403
