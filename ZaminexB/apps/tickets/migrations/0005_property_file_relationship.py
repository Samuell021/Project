import django.db.models.deletion
from django.db import migrations, models


def rename_listing_subjects(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.using(schema_editor.connection.alias).filter(
        subject_type="LISTING"
    ).update(subject_type="PROPERTY_FILE")


def restore_listing_subjects(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.using(schema_editor.connection.alias).filter(
        subject_type="PROPERTY_FILE"
    ).update(subject_type="LISTING")


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0004_ticketparticipant_visible_reply_count"),
        ("listings", "0012_property_file_names"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="ticket",
            name="ticket_exactly_one_subject",
        ),
        migrations.AlterField(
            model_name="ticket",
            name="listing",
            field=models.ForeignKey(
                blank=True,
                db_column="listing_id",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="tickets",
                to="listings.propertyfile",
                verbose_name="فایل مرتبط",
            ),
        ),
        migrations.RenameField(
            model_name="ticket",
            old_name="listing",
            new_name="property_file",
        ),
        migrations.RunPython(rename_listing_subjects, restore_listing_subjects),
        migrations.AlterField(
            model_name="ticket",
            name="subject_type",
            field=models.CharField(
                choices=[
                    ("PROPERTY", "املاک موجود"),
                    ("PROPERTY_FILE", "فایل‌های موجود"),
                    ("FOLLOWUP", "پیگیری‌های موجود"),
                    ("TASK", "وظایف موجود"),
                    ("TICKET", "تیکت‌های موجود"),
                ],
                db_index=True,
                max_length=20,
                verbose_name="موضوع تیکت",
            ),
        ),
        migrations.AddConstraint(
            model_name="ticket",
            constraint=models.CheckConstraint(
                condition=(
                    (
                        models.Q(subject_type="PROPERTY")
                        & models.Q(property__isnull=False)
                        & models.Q(property_file__isnull=True)
                        & models.Q(followup__isnull=True)
                        & models.Q(task__isnull=True)
                        & models.Q(related_ticket__isnull=True)
                    )
                    | (
                        models.Q(subject_type="PROPERTY_FILE")
                        & models.Q(property__isnull=True)
                        & models.Q(property_file__isnull=False)
                        & models.Q(followup__isnull=True)
                        & models.Q(task__isnull=True)
                        & models.Q(related_ticket__isnull=True)
                    )
                    | (
                        models.Q(subject_type="FOLLOWUP")
                        & models.Q(property__isnull=True)
                        & models.Q(property_file__isnull=True)
                        & models.Q(followup__isnull=False)
                        & models.Q(task__isnull=True)
                        & models.Q(related_ticket__isnull=True)
                    )
                    | (
                        models.Q(subject_type="TASK")
                        & models.Q(property__isnull=True)
                        & models.Q(property_file__isnull=True)
                        & models.Q(followup__isnull=True)
                        & models.Q(task__isnull=False)
                        & models.Q(related_ticket__isnull=True)
                    )
                    | (
                        models.Q(subject_type="TICKET")
                        & models.Q(property__isnull=True)
                        & models.Q(property_file__isnull=True)
                        & models.Q(followup__isnull=True)
                        & models.Q(task__isnull=True)
                        & models.Q(related_ticket__isnull=False)
                    )
                ),
                name="ticket_exactly_one_subject",
            ),
        ),
    ]
