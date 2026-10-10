import json
from pathlib import Path
from plane.db.models import Project,Intake,DeployBoard
p=Path('/test-secrets/test-credentials.json');value=json.loads(p.read_text());project=Project.objects.get(pk=value['project_id'])
intake,_=Intake.objects.get_or_create(project=project,workspace=project.workspace,name='Android shared intake',defaults={'is_default':True})
board,_=DeployBoard.objects.get_or_create(entity_name='project',entity_identifier=project.id,project=project,defaults={'is_comments_enabled':True,'is_reactions_enabled':True,'is_votes_enabled':True,'intake':intake,'view_props':{'list':True,'kanban':True,'calendar':True,'gantt':True,'spreadsheet':True}})
board.is_comments_enabled=True;board.is_reactions_enabled=True;board.is_votes_enabled=True;board.intake=intake;board.save()
value['shared_anchor']=board.anchor;value['shared_project_id']=str(project.id);p.write_text(json.dumps(value,ensure_ascii=False,indent=2));p.chmod(0o600)
