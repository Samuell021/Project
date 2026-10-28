from .. import models


def pipeline_stage(obj):
    if obj.status == models.CaseStatus.COMPLETED:
        return "COMPLETED"
    if obj.status in (models.CaseStatus.CLOSED, models.CaseStatus.DUPLICATE):
        return obj.status
    if obj.lead_status != models.LeadStatus.ACCEPTED:
        return "LEAD"
    if obj.acceptance_status == models.AcceptanceStatus.UNASSIGNED:
        return "ASSIGNMENT"
    if obj.acceptance_status in (
        models.AcceptanceStatus.PENDING,
        models.AcceptanceStatus.WITHDRAWAL_PENDING,
    ):
        return "ACCEPTANCE"
    if isinstance(obj, models.Inquiry):
        if obj.deals.filter(stage=models.Deal.Stage.FINALIZED).exists():
            return "COMPLETED"
        if obj.deals.filter(
            stage__in=[models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED]
        ).exists():
            return "NEGOTIATION"
        if obj.introductions.filter(viewings__isnull=False).exists():
            return "VIEWING"
        if obj.introductions.filter(status=models.Introduction.Status.OPEN).exists():
            return "INTRODUCTION"
        return "NEEDS"
    from apps.properties.models import Property

    prop = obj.resulting_property
    if prop and prop.review_status == Property.ReviewStatus.APPROVED:
        return "LISTING"
    if prop and prop.review_status == Property.ReviewStatus.PENDING:
        return "REVIEW"
    return "APPRAISAL"
