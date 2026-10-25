from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("lab", "0034_allocation_payment")]
    operations = [
        migrations.AddField(
            model_name="invitation",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="lab_invitations",
                to="db.project",
            ),
        )
    ]
