# Add worker proposals and lead review fields for simple cash bounties.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0026_cashbounty"),
    ]

    operations = [
        migrations.AddField(
            model_name="cashbounty",
            name="reviewed_at",
            field=models.DateTimeField(null=True),
        ),
        migrations.AddField(
            model_name="cashbounty",
            name="review_note",
            field=models.TextField(blank=True),
        ),
        migrations.RemoveConstraint(
            model_name="cashbounty",
            name="lab_cash_bounty_status",
        ),
        migrations.AddConstraint(
            model_name="cashbounty",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("status__in", ("proposed", "open", "claimed", "submitted", "accepted", "paid", "cancelled"))
                ),
                name="lab_cash_bounty_status",
            ),
        ),
    ]
