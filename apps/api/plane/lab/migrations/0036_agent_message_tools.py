from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("lab", "0035_invitation_project")]
    operations = [
        migrations.AddField(
            model_name="agentmessage",
            name="tools",
            field=models.JSONField(blank=True, default=list),
        )
    ]
