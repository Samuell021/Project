from django.contrib import admin
from django.core.exceptions import ValidationError

from . import models


class ReadOnlyHistoryAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]


class PublishedImmutableAdmin(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj is not None and getattr(obj, "status", None) == "PUBLISHED":
            readonly += [field.name for field in self.model._meta.fields if field.name not in readonly]
        return readonly

    def has_delete_permission(self, request, obj=None):
        if obj is not None and getattr(obj, "status", None) == "PUBLISHED":
            return False
        return super().has_delete_permission(request, obj)

    def save_model(self, request, obj, form, change):
        if change:
            previous = self.model.objects.filter(pk=obj.pk).only("status").first()
            if previous is not None and previous.status == "PUBLISHED" and obj.status == "PUBLISHED":
                raise ValidationError("نسخه منتشرشده تغییرناپذیر است؛ نسخه جدید بسازید.")
        super().save_model(request, obj, form, change)


class ContactPhoneInline(admin.TabularInline):
    model = models.ContactPhone
    extra = 0
    fields = ("phone", "normalized_phone", "label", "is_primary")


class PropertyContactInline(admin.TabularInline):
    model = models.PropertyContact
    extra = 0
    autocomplete_fields = ("contact", "property")


@admin.register(models.Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ("full_name", "national_code", "email", "created_by", "created_at")
    search_fields = ("full_name", "national_code", "email", "phones__normalized_phone")
    list_filter = ("created_at",)
    autocomplete_fields = ("created_by",)
    readonly_fields = ("created_at", "updated_at")
    inlines = [ContactPhoneInline]


@admin.register(models.ContactPhone)
class ContactPhoneAdmin(admin.ModelAdmin):
    list_display = ("phone", "contact", "label", "is_primary")
    search_fields = ("phone", "normalized_phone", "contact__full_name")
    list_filter = ("is_primary",)
    autocomplete_fields = ("contact",)


@admin.register(models.PropertyContact)
class PropertyContactAdmin(admin.ModelAdmin):
    list_display = ("property", "contact", "role", "is_primary", "created_at")
    search_fields = ("property__title", "property__internal_code", "contact__full_name")
    list_filter = ("role", "is_primary")
    autocomplete_fields = ("property", "contact")
    readonly_fields = ("created_at",)


class RegistrationRequestDealTypeInline(admin.TabularInline):
    model = models.RegistrationRequestDealType
    extra = 0
    autocomplete_fields = ("deal_type",)


class PropertyAppraisalInline(admin.StackedInline):
    model = models.PropertyAppraisal
    extra = 0
    autocomplete_fields = ("property", "updated_by")
    readonly_fields = ("created_at", "updated_at")


class AssignmentHistoryInline(admin.TabularInline):
    model = models.AssignmentHistory
    extra = 0
    fields = ("action", "from_user", "to_user", "actor", "reason", "old_due_at", "new_due_at", "created_at")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


class RescheduleInline(admin.TabularInline):
    model = models.AssignmentRescheduleRequest
    extra = 0
    autocomplete_fields = ("requested_by", "decided_by")


class WithdrawalInline(admin.TabularInline):
    model = models.ConsultantWithdrawalRequest
    extra = 0
    autocomplete_fields = ("requested_by", "decided_by")


class CaseAdminBase(admin.ModelAdmin):
    list_filter = ("lead_status", "acceptance_status", "status", "sales_range", "created_at")
    search_fields = ("code", "contact__full_name", "description")
    autocomplete_fields = ("contact", "sales_range", "created_by", "lead_accepted_by", "assigned_to", "duplicate_of")
    readonly_fields = ("code", "version", "created_at", "updated_at")
    date_hierarchy = "created_at"


@admin.register(models.PropertyRegistrationRequest)
class PropertyRegistrationRequestAdmin(CaseAdminBase):
    list_display = ("code", "contact", "sales_range", "lead_status", "acceptance_status", "assigned_to", "due_at", "status", "resulting_property")
    autocomplete_fields = CaseAdminBase.autocomplete_fields + ("resulting_property",)
    inlines = [RegistrationRequestDealTypeInline, PropertyAppraisalInline, AssignmentHistoryInline, RescheduleInline, WithdrawalInline]


@admin.register(models.RegistrationRequestDealType)
class RegistrationRequestDealTypeAdmin(admin.ModelAdmin):
    list_display = ("registration_request", "deal_type")
    list_filter = ("deal_type",)
    search_fields = ("registration_request__code",)
    autocomplete_fields = ("registration_request", "deal_type")


@admin.register(models.PropertyAppraisal)
class PropertyAppraisalAdmin(admin.ModelAdmin):
    list_display = ("registration_request", "property", "is_complete", "version", "updated_by", "updated_at")
    list_filter = ("is_complete",)
    search_fields = ("registration_request__code", "property__title", "property__internal_code", "report_text")
    autocomplete_fields = ("registration_request", "property", "updated_by")
    readonly_fields = ("version", "created_at", "updated_at")


@admin.register(models.PropertyReview)
class PropertyReviewAdmin(admin.ModelAdmin):
    list_display = ("property", "registration_request", "decision", "version", "submitted_by", "reviewed_by", "reviewed_at")
    list_filter = ("decision", "submitted_at")
    search_fields = ("property__title", "property__internal_code", "registration_request__code", "reason")
    autocomplete_fields = ("property", "registration_request", "submitted_by", "reviewed_by")
    readonly_fields = ("version", "submitted_at")


@admin.register(models.AssignmentHistory)
class AssignmentHistoryAdmin(ReadOnlyHistoryAdmin):
    list_display = ("subject_type", "action", "from_user", "to_user", "actor", "created_at")
    list_filter = ("subject_type", "action", "created_at")
    search_fields = ("reason",)
    autocomplete_fields = ("property_case", "inquiry", "from_user", "to_user", "actor")


@admin.register(models.AssignmentRescheduleRequest)
class AssignmentRescheduleRequestAdmin(admin.ModelAdmin):
    list_display = ("status", "requested_due_at", "requested_by", "decided_by", "requested_at")
    list_filter = ("status", "requested_at")
    search_fields = ("reason", "decision_reason")
    autocomplete_fields = ("property_case", "inquiry", "requested_by", "decided_by")
    readonly_fields = ("requested_at",)


@admin.register(models.ConsultantWithdrawalRequest)
class ConsultantWithdrawalRequestAdmin(admin.ModelAdmin):
    list_display = ("status", "requested_by", "decided_by", "requested_at")
    list_filter = ("status", "requested_at")
    search_fields = ("reason", "decision_reason")
    autocomplete_fields = ("property_case", "inquiry", "requested_by", "decided_by")
    readonly_fields = ("requested_at",)


class InquiryPreferenceInline(admin.TabularInline):
    model = models.InquiryPreference
    extra = 0
    autocomplete_fields = ("deal_type", "deal_type_version")
    filter_horizontal = ("districts", "property_types")


@admin.register(models.Inquiry)
class InquiryAdmin(CaseAdminBase):
    list_display = ("code", "contact", "sales_range", "lead_status", "acceptance_status", "assigned_to", "due_at", "status")
    inlines = [InquiryPreferenceInline, AssignmentHistoryInline, RescheduleInline, WithdrawalInline]


@admin.register(models.InquiryPreference)
class InquiryPreferenceAdmin(admin.ModelAdmin):
    list_display = ("inquiry", "deal_type", "deal_type_version", "min_amount", "max_amount", "min_area", "max_area")
    list_filter = ("deal_type",)
    search_fields = ("inquiry__code",)
    autocomplete_fields = ("inquiry", "deal_type", "deal_type_version")
    filter_horizontal = ("districts", "property_types")


@admin.register(models.Introduction)
class IntroductionAdmin(admin.ModelAdmin):
    list_display = ("inquiry", "property_file", "status", "introduced_by", "buyer_consultant", "seller_consultant", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("inquiry__code", "property_file__title", "feedback")
    autocomplete_fields = ("inquiry", "property_file", "introduced_by", "buyer_consultant", "seller_consultant")
    readonly_fields = ("created_at", "updated_at")


@admin.register(models.Viewing)
class ViewingAdmin(admin.ModelAdmin):
    list_display = ("introduction", "scheduled_at", "result", "assigned_to", "completed_at")
    list_filter = ("result", "scheduled_at")
    search_fields = ("introduction__inquiry__code", "notes")
    autocomplete_fields = ("introduction", "assigned_to", "task")
    readonly_fields = ("created_at", "updated_at")


class DealParticipantInline(admin.TabularInline):
    model = models.DealParticipant
    extra = 0
    autocomplete_fields = ("contact",)


@admin.register(models.Deal)
class DealAdmin(admin.ModelAdmin):
    list_display = ("property_file", "inquiry", "stage", "assigned_to", "started_at", "closed_at")
    list_filter = ("stage", "started_at")
    search_fields = ("property_file__title", "inquiry__code", "result_notes", "closure_reason")
    autocomplete_fields = ("introduction", "viewing", "property_file", "inquiry", "assigned_to", "deal_type_version")
    readonly_fields = ("version", "started_at")
    inlines = [DealParticipantInline]


@admin.register(models.DealParticipant)
class DealParticipantAdmin(admin.ModelAdmin):
    list_display = ("deal", "contact", "participant_role", "is_primary")
    list_filter = ("participant_role", "is_primary")
    search_fields = ("contact__full_name",)
    autocomplete_fields = ("deal", "contact")


class ContractPartyInline(admin.TabularInline):
    model = models.ContractParty
    extra = 0
    autocomplete_fields = ("contact",)


class ContractAttachmentInline(admin.TabularInline):
    model = models.ContractAttachment
    extra = 0
    autocomplete_fields = ("uploaded_by",)


class ContractAmendmentInline(admin.StackedInline):
    model = models.ContractAmendment
    extra = 0
    autocomplete_fields = ("approved_by",)


@admin.register(models.Contract)
class ContractAdmin(admin.ModelAdmin):
    list_display = ("contract_number", "deal", "status", "sale_price", "deposit", "monthly_rent", "finalized_at")
    list_filter = ("status", "created_at")
    search_fields = ("contract_number", "deal__property_file__title")
    autocomplete_fields = ("deal", "deal_type_version", "created_by", "finalized_by")
    readonly_fields = ("version", "created_at", "updated_at")
    inlines = [ContractPartyInline, ContractAttachmentInline, ContractAmendmentInline]


@admin.register(models.ContractParty)
class ContractPartyAdmin(admin.ModelAdmin):
    list_display = ("contract", "contact", "party_role")
    list_filter = ("party_role",)
    search_fields = ("contract__contract_number", "contact__full_name")
    autocomplete_fields = ("contract", "contact")


@admin.register(models.ContractSignature)
class ContractSignatureAdmin(admin.ModelAdmin):
    list_display = ("contract_party", "status", "signed_at", "recorded_by")
    list_filter = ("status", "signed_at")
    autocomplete_fields = ("contract_party", "recorded_by")


@admin.register(models.ContractAttachment)
class ContractAttachmentAdmin(admin.ModelAdmin):
    list_display = ("contract", "document_type", "filename", "uploaded_by", "uploaded_at")
    list_filter = ("document_type", "uploaded_at")
    search_fields = ("contract__contract_number", "filename")
    autocomplete_fields = ("contract", "uploaded_by")
    readonly_fields = ("uploaded_at",)


@admin.register(models.ContractAmendment)
class ContractAmendmentAdmin(admin.ModelAdmin):
    list_display = ("contract", "amendment_number", "status", "approved_by", "effective_at", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("contract__contract_number", "reason")
    autocomplete_fields = ("contract", "approved_by")
    readonly_fields = ("created_at",)


@admin.register(models.CommissionPolicyVersion)
class CommissionPolicyVersionAdmin(PublishedImmutableAdmin):
    list_display = ("name", "deal_type", "version_number", "calculation_method", "status", "effective_from", "created_by")
    list_filter = ("status", "calculation_method", "deal_type")
    search_fields = ("name",)
    autocomplete_fields = ("deal_type", "created_by")
    readonly_fields = ("created_at",)


class CommissionShareInline(admin.TabularInline):
    model = models.CommissionShare
    extra = 0
    autocomplete_fields = ("beneficiary_user",)


class PaymentAllocationInline(admin.TabularInline):
    model = models.PaymentAllocation
    extra = 0
    autocomplete_fields = ("commission", "commission_share")


@admin.register(models.Commission)
class CommissionAdmin(admin.ModelAdmin):
    list_display = ("contract", "debtor_contact", "policy_version", "final_amount", "status", "due_at")
    list_filter = ("status", "due_at")
    search_fields = ("contract__contract_number", "debtor_contact__full_name", "adjustment_reason")
    autocomplete_fields = ("contract", "debtor_contact", "policy_version")
    readonly_fields = ("created_at", "updated_at")
    inlines = [CommissionShareInline]


@admin.register(models.CommissionShare)
class CommissionShareAdmin(admin.ModelAdmin):
    list_display = ("commission", "beneficiary_type", "beneficiary_user", "share_percent", "amount", "status")
    list_filter = ("beneficiary_type", "status")
    search_fields = ("beneficiary_user__username",)
    autocomplete_fields = ("commission", "beneficiary_user")


@admin.register(models.Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("direction", "amount", "paid_at", "contact", "user", "method", "reference_number", "status", "recorded_by")
    list_filter = ("direction", "status", "paid_at")
    search_fields = ("reference_number", "contact__full_name", "user__username")
    autocomplete_fields = ("contact", "user", "recorded_by", "reversal_of")
    readonly_fields = ("created_at",)
    inlines = [PaymentAllocationInline]


@admin.register(models.PaymentAllocation)
class PaymentAllocationAdmin(admin.ModelAdmin):
    list_display = ("payment", "commission", "commission_share", "amount")
    search_fields = ("payment__reference_number",)
    autocomplete_fields = ("payment", "commission", "commission_share")


@admin.register(models.StageTransitionHistory)
class StageTransitionHistoryAdmin(ReadOnlyHistoryAdmin):
    list_display = ("subject_type", "subject_id", "from_stage", "to_stage", "changed_by", "changed_at")
    list_filter = ("subject_type", "changed_at")
    search_fields = ("operation_id", "reason")


@admin.register(models.CommandReceipt)
class CommandReceiptAdmin(ReadOnlyHistoryAdmin):
    list_display = ("action", "actor", "idempotency_key", "created_at")
    list_filter = ("action", "created_at")
    search_fields = ("idempotency_key", "action", "actor__username")


@admin.register(models.WorkflowSettings)
class WorkflowSettingsAdmin(admin.ModelAdmin):
    list_display = ("assignment_waiting_hours", "default_assignment_due_days", "updated_by", "updated_at")
    readonly_fields = ("updated_at",)
    autocomplete_fields = ("updated_by",)

    def has_add_permission(self, request):
        return not models.WorkflowSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
