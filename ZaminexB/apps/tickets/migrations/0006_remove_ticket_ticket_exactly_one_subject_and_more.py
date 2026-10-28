from django.conf import settings
from django.db import migrations, models


def unify_listing_subjects(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.using(schema_editor.connection.alias).filter(subject_type="PROPERTY_FILE").update(subject_type="LISTING")


def restore_property_file_subjects(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.using(schema_editor.connection.alias).filter(subject_type="LISTING").update(subject_type="PROPERTY_FILE")


class Migration(migrations.Migration):

    dependencies = [
        ('followups', '0008_alter_followup_consultant'),
        ('listings', '0014_propertyfile_terms_propertyfileversion'),
        ('properties', '0030_remove_property_idx_property_deal_created_and_more'),
        ('tasks', '0006_alter_task_assigned_to'),
        ('tickets', '0005_property_file_relationship'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(unify_listing_subjects, restore_property_file_subjects),
        migrations.RemoveConstraint(
            model_name='ticket',
            name='ticket_exactly_one_subject',
        ),
        migrations.AlterField(
            model_name='ticket',
            name='subject_type',
            field=models.CharField(choices=[('PROPERTY', 'املاک موجود'), ('LISTING', 'فایل\u200cهای عرضه'), ('PROPERTY_FILE', 'فایل\u200cهای موجود (نام پیشین)'), ('FOLLOWUP', 'پیگیری\u200cهای موجود'), ('TASK', 'وظایف موجود'), ('TICKET', 'تیکت\u200cهای موجود')], db_index=True, max_length=20, verbose_name='موضوع تیکت'),
        ),
        migrations.AddConstraint(
            model_name='ticket',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('subject_type', 'PROPERTY'), ('property__isnull', False), ('property_file__isnull', True), ('followup__isnull', True), ('task__isnull', True), ('related_ticket__isnull', True)), models.Q(('subject_type__in', ['LISTING', 'PROPERTY_FILE']), ('property__isnull', True), ('property_file__isnull', False), ('followup__isnull', True), ('task__isnull', True), ('related_ticket__isnull', True)), models.Q(('subject_type', 'FOLLOWUP'), ('property__isnull', True), ('property_file__isnull', True), ('followup__isnull', False), ('task__isnull', True), ('related_ticket__isnull', True)), models.Q(('subject_type', 'TASK'), ('property__isnull', True), ('property_file__isnull', True), ('followup__isnull', True), ('task__isnull', False), ('related_ticket__isnull', True)), models.Q(('subject_type', 'TICKET'), ('property__isnull', True), ('property_file__isnull', True), ('followup__isnull', True), ('task__isnull', True), ('related_ticket__isnull', False)), _connector='OR'), name='ticket_exactly_one_subject'),
        ),
    ]
