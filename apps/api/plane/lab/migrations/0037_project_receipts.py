from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("lab", "0036_agent_message_tools")]
    operations = [
        migrations.AlterField(
            model_name="cashbatch",
            name="budget",
            field=models.ForeignKey(
                to="lab.stagebudget", on_delete=django.db.models.deletion.PROTECT,
                related_name="batches", null=True,
            ),
        ),
    ]
