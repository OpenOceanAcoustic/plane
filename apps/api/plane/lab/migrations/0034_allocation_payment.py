# Team bounty cash payout marker.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0033_agentannotation"),
    ]

    operations = [
        migrations.AddField(
            model_name="allocation",
            name="payment_operation",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="lab_team_bounty_allocations",
                to="lab.financialoperation",
            ),
        ),
        migrations.AddField(
            model_name="allocation",
            name="paid_at",
            field=models.DateTimeField(null=True),
        ),
    ]
