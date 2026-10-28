from __future__ import annotations

import getpass
import os
import re
import sys
from datetime import timedelta
from decimal import Decimal
from io import BytesIO, StringIO

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connections, transaction
from django.utils import timezone

from apps.accounts.models import (
    LoginSettings,
    SalesRange,
    ScopeMembership,
    ScopeTransferHistory,
    SmsProviderSettings,
    StaffProfile,
    User,
)
from apps.activity.models import ActivityLog
from apps.basics.models import (
    Attribute,
    City,
    DealType,
    DealTypeAttribute,
    DealTypeVersion,
    District,
    PropertyType,
    PropertyUsage,
    Province,
)
from apps.basics.terms import default_terms_schema
from apps.crm import models as crm
from apps.crm.services import refresh_commission_status, refresh_share_status
from apps.followups.models import FollowUp, FollowUpStatus, FollowUpType
from apps.listings.models import (
    PropertyFile,
    PropertyFileAttributeValue,
    PropertyFilePriceHistory,
)
from apps.notifications.models import Notification
from apps.properties.models import (
    Property,
    PropertyAppraisalReport,
    PropertyAttributeValue,
    PropertyImage,
)
from apps.properties.validators import validate_appraisal_pdf, validate_property_image
from apps.tasks.models import Task
from apps.tickets.models import (
    Ticket,
    TicketAttachment,
    TicketAuditAction,
    TicketAuditEvent,
    TicketMessage,
    TicketParticipant,
    TicketParticipantRole,
    TicketPriority,
    TicketStatus,
    TicketSubject,
    TicketType,
    validate_ticket_file,
)


DEMO_MARKER = "[DEMO DATA — SYNTHETIC, NOT REAL CUSTOMER OR PROPERTY INFORMATION]"
RANGE_NAMES = ("رنج نمونه — شمال تهران", "رنج نمونه — غرب تهران", "رنج نمونه — مرکز")
LEGACY_RANGE_NAMES = ("شمال تهران", "غرب تهران", "مرکز")

# Eight fictional logins cover every role currently implemented by the backend.
# demo.contract is intentionally a FINANCE user: the application has no
# CONTRACT_OFFICER role, and contract mutation is restricted to general managers.
DEMO_USERS = (
    ("demo.general", "GENERAL_MANAGER", "مدیر کل نمونه", None),
    ("demo.north", "RANGE_MANAGER", "مدیر رنج شمال نمونه", 0),
    ("demo.west", "RANGE_MANAGER", "مدیر رنج غرب نمونه", 1),
    ("demo.agent1", "AGENT", "مشاور نمونه یک", 0),
    ("demo.agent2", "AGENT", "مشاور نمونه دو", 1),
    ("demo.agent3", "AGENT", "مشاور نمونه سه", 2),
    ("demo.contract", "FINANCE", "کارشناس مالی و کنترل قرارداد نمونه", None),
    ("demo.finance", "FINANCE", "کارشناس مالی نمونه", None),
)

CONTACT_NAMES = (
    "آرمان پارسا",
    "بهار مهران",
    "کیان راد",
    "نیلوفر شایان",
    "سامان نیکو",
    "رها فرهمند",
    "پویا روشن",
    "مینا فرزان",
    "سپهر آرا",
    "نگار دادگر",
)

DEAL_TYPE_DATA = (
    ("sale", "SALE"),
    ("mortgage_rent", "RENT"),
    ("full_mortgage", "FULL_MORTGAGE"),
    ("presale", "PRE_SALE"),
    ("partnership", "PARTNERSHIP"),
    ("exchange", "EXCHANGE"),
)

DEAL_TERMS = (
    {"sale_price": 6_000_000_000},
    {"deposit": 500_000_000, "monthly_rent": 15_000_000},
    {"deposit": 1_200_000_000},
    {"down_payment": 2_000_000_000, "installments": "چهار قسط ساختگی"},
    {"owner_share": 50, "contribution": "آورده ساخت صرفاً نمایشی"},
    {"exchange_asset": "آپارتمان ساختگی", "cash_difference": 300_000_000},
)

PROPERTY_REVIEW_STATES = (
    "APPROVED",
    "APPROVED",
    "APPROVED",
    "APPROVED",
    "APPROVED",
    "APPROVED",
    "CHANGES_REQUIRED",
    "PENDING",
    "APPROVED",
    "NOT_SUBMITTED",
)

CASE_SCENARIOS = (
    # lead, assignment, case status, resulting property index
    ("PENDING", "UNASSIGNED", "ACTIVE", None),
    ("ACCEPTED", "UNASSIGNED", "ACTIVE", None),
    ("ACCEPTED", "PENDING", "ACTIVE", None),
    ("ACCEPTED", "ACCEPTED", "ACTIVE", 3),
    ("ACCEPTED", "ACCEPTED", "COMPLETED", 4),
    ("ACCEPTED", "ACCEPTED", "COMPLETED", 5),
    ("ACCEPTED", "ACCEPTED", "ACTIVE", 6),
    ("ACCEPTED", "ACCEPTED", "ACTIVE", 7),
    ("ACCEPTED", "ACCEPTED", "COMPLETED", 8),
    ("ACCEPTED", "UNASSIGNED", "CANCELLED", None),
    ("ACCEPTED", "UNASSIGNED", "CLOSED", None),
    ("ACCEPTED", "UNASSIGNED", "DUPLICATE", None),
)

INQUIRY_SCENARIOS = (
    "COMPLETED",  # finalized sale
    "ACTIVE",     # negotiation lost; request remains open
    "ACTIVE",     # negotiation
    "ACTIVE",     # agreement
    "ACTIVE",     # contract draft
    "ACTIVE",     # assignment withdrawal pending
)


class Command(BaseCommand):
    help = "ثبت داده‌های ساختگیِ کامل برای آزمون بک‌اند Zaminex؛ بدون حذف داده و با اجرای تکرارپذیر"

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default=os.environ.get("CRM_DEMO_PASSWORD", ""),
            help="رمز حساب‌های نمایشیِ جدید؛ بهتر است به‌جای آرگومان، از CRM_DEMO_PASSWORD یا prompt امن استفاده شود.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="فقط وضعیت فعلی را می‌خواند و برنامه را چاپ می‌کند؛ هیچ داده‌ای نمی‌نویسد.",
        )
        parser.add_argument(
            "--allow-remote",
            action="store_true",
            help="اجازه اجرا روی PostgreSQL راه‌دورِ توسعه‌ای؛ DEBUG باید همچنان فعال باشد.",
        )

    def handle(self, *args, **options):
        self._assert_safe_database(allow_remote=options["allow_remote"])
        if options["dry_run"]:
            self._print_dry_run()
            return

        password = self._resolve_password(options["password"])
        now = timezone.now().replace(second=0, microsecond=0)

        with transaction.atomic():
            # This command is deliberately additive. seed_basics does not use
            # --force, so locally edited reference labels are not reset.
            call_command("seed_basics", stdout=StringIO(), stderr=StringIO())

            ranges, users = self._seed_users_and_ranges(password, now)
            contacts = self._seed_contacts(users)
            references = self._seed_reference_data(users["demo.general"], now)
            properties = self._seed_properties(users, contacts, references)
            cases = self._seed_property_cases(users, contacts, ranges, properties, references, now)
            listings = self._seed_listings(users, properties, references, now)
            inquiries = self._seed_inquiries(users, contacts, ranges, references, now)
            tasks, introductions, viewings, deals, contracts = self._seed_pipeline(
                users, contacts, properties, listings, inquiries, now
            )
            followups = self._seed_followups(users, contacts, properties, cases, inquiries, now)
            self._seed_finance(users, contacts, deals, contracts, references, now)
            tickets = self._seed_tickets(users, properties, tasks, now)
            self._seed_notifications(users, tasks, tickets, now)
            self._seed_activity_examples(users, tickets)

            # These singleton settings are created by post_migrate on a normal
            # installation. get_solo/load only create missing rows; they never
            # replace credentials, AI configuration, or existing company data.
            LoginSettings.get_solo()
            SmsProviderSettings.get_solo()
            crm.WorkflowSettings.load()

        self.stdout.write(
            self.style.SUCCESS(
                "داده‌های نمایشی ثبت شد: ۸ حساب، ۱۰ شخص، ۱۰ ملک، ۱۲ پرونده ثبت، "
                "۶ فایل/نوع معامله، ۶ درخواست متقاضی، مسیرهای CRM، مالی، وظایف، "
                "پیگیری، تیکت، اعلان، سابقه و رسانه نمونه."
            )
        )
        self.stdout.write(
            "همه موارد مصنوعی و قابل‌شناسایی هستند؛ رمز حساب‌های موجود تغییر نکرده "
            "و هیچ ایمیل، پیامک یا تماس خارجی ارسال نشده است."
        )

    def _is_test_database(self, database):
        name = str(database.get("NAME") or "").lower()
        return name.startswith("test_") or name.endswith("_test") or "test" in sys.argv[1:3]

    def _assert_safe_database(self, *, allow_remote):
        database = connections["default"].settings_dict
        if self._is_test_database(database):
            return

        if not settings.DEBUG:
            raise CommandError(
                "فرمان seed فقط برای محیط توسعه مجاز است (DEBUG=True). "
                "روی staging/production اجرا نکنید."
            )

        name = str(database.get("NAME") or "").strip().lower()
        if not name:
            raise CommandError("نام دیتابیس خالی است؛ برای جلوگیری از نوشتن ناخواسته اجرا متوقف شد.")
        if re.search(r"(^|[_-])(prod|production|live)([_-]|$)", name):
            raise CommandError("نام دیتابیس شبیه محیط production است؛ seed روی آن ممنوع است.")

        host = str(database.get("HOST") or "").strip().lower()
        local_hosts = {"", "localhost", "127.0.0.1", "::1"}
        if host not in local_hosts and not allow_remote:
            raise CommandError(
                f"میزبان دیتابیس «{host}» محلی نیست. فقط دیتابیس توسعه را انتخاب کنید؛ "
                "برای PostgreSQL راه‌دورِ توسعه‌ای باید صریحاً --allow-remote بدهید."
            )
        if host not in local_hosts and allow_remote:
            self.stderr.write(
                self.style.WARNING(
                    "هشدار: داده‌های ساختگی روی دیتابیس راه‌دور ثبت خواهند شد. "
                    "اطمینان حاصل کنید این دیتابیس production نیست."
                )
            )

    def _print_dry_run(self):
        demo_users = User.objects.filter(username__startswith="demo.").count()
        demo_cases = crm.PropertyRegistrationRequest.objects.filter(code__startswith="DEMO-CASE-").count()
        demo_inquiries = crm.Inquiry.objects.filter(code__startswith="DEMO-INQ-").count()
        self.stdout.write("برنامه seed نمایشی (بدون هیچ نوشتنی):")
        self.stdout.write(f"  حساب‌های نمایشی موجود: {demo_users}/8")
        self.stdout.write(f"  پرونده‌های ملک موجود: {demo_cases}/12")
        self.stdout.write(f"  درخواست‌های متقاضی موجود: {demo_inquiries}/6")
        self.stdout.write("  اجرا فقط رکوردهای مفقود را اضافه می‌کند؛ هیچ رکوردی حذف نمی‌شود.")

    def _resolve_password(self, supplied_password):
        usernames = [item[0] for item in DEMO_USERS]
        existing = set(User.objects.filter(username__in=usernames).values_list("username", flat=True))
        missing = [username for username in usernames if username not in existing]
        if not missing:
            return supplied_password or ""

        password = supplied_password
        if not password:
            if not sys.stdin.isatty():
                raise CommandError(
                    "برای ساخت حساب‌های جدید، CRM_DEMO_PASSWORD را تنظیم کنید یا فرمان را "
                    "در ترمینال تعاملی اجرا کنید تا رمز به‌صورت امن پرسیده شود."
                )
            password = getpass.getpass("رمز مشترک حساب‌های نمایشی جدید: ")
            confirmation = getpass.getpass("تکرار رمز: ")
            if password != confirmation:
                raise CommandError("دو رمز واردشده یکسان نیستند.")
        if not password:
            raise CommandError("رمز حساب‌های نمایشی جدید نمی‌تواند خالی باشد.")

        for username in missing:
            candidate = User(username=username, email=f"{username.replace('.', '_')}@example.invalid")
            try:
                validate_password(password, user=candidate)
            except Exception as exc:
                raise CommandError(f"رمز انتخاب‌شده برای حساب‌های نمایشی امن نیست: {exc}") from exc
        return password

    def _seed_users_and_ranges(self, password, now):
        ranges = []
        for index, name in enumerate(RANGE_NAMES):
            sales_range = SalesRange.objects.filter(name=name).first()
            if sales_range is None:
                legacy = SalesRange.objects.filter(name=LEGACY_RANGE_NAMES[index]).first()
                legacy_memberships = (
                    ScopeMembership.objects.filter(sales_range=legacy)
                    .select_related("user")
                    if legacy
                    else ScopeMembership.objects.none()
                )
                membership_users = list(legacy_memberships.values_list("user__username", flat=True))
                if membership_users and all(username.startswith("demo.") for username in membership_users):
                    legacy.name = name
                    legacy.save(update_fields=["name"])
                    sales_range = legacy
                else:
                    sales_range = SalesRange.objects.create(name=name)
            else:
                has_demo_membership = ScopeMembership.objects.filter(
                    sales_range=sales_range,
                    user__username__startswith="demo.",
                ).exists()
                has_other_membership = ScopeMembership.objects.filter(
                    sales_range=sales_range,
                ).exclude(user__username__startswith="demo.").exists()
                if has_other_membership and not has_demo_membership:
                    raise CommandError(
                        f"رنج «{name}» داده غیرنمایشی دارد؛ seed از پیوندزدن حساب‌های demo به آن خودداری کرد."
                    )
            ranges.append(sales_range)
        users = {}

        for index, (username, group_name, full_name, range_index) in enumerate(DEMO_USERS):
            group, _ = Group.objects.get_or_create(name=group_name)
            email = f"{username.replace('.', '_')}@example.invalid"
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"email": email, "first_name": full_name, "is_active": True},
            )
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
                user.groups.set([group])
            else:
                profile = StaffProfile.objects.filter(user=user).first()
                marked_as_demo = (
                    (user.email or "").endswith("@example.invalid")
                    or bool(profile and (profile.staff_code or "").startswith("DEMO-"))
                    or bool(profile and profile.branch == "دفتر نمایشی")
                )
                if not marked_as_demo:
                    raise CommandError(
                        f"حساب «{username}» از قبل وجود دارد اما به‌عنوان حساب نمایشی قابل‌شناسایی نیست؛ "
                        "برای جلوگیری از تغییر یا استفاده از حساب واقعی، seed متوقف شد."
                    )
                # A previous seed version used a role that is not implemented
                # by the current backend. Correct only this clearly synthetic account.
                if username == "demo.contract" and user.groups.filter(name="CONTRACT_OFFICER").exists():
                    user.groups.remove(Group.objects.get(name="CONTRACT_OFFICER"))
                    user.groups.add(group)

            profile, _ = StaffProfile.objects.get_or_create(
                user=user,
                defaults={
                    "full_name": full_name,
                    "mobile": None,
                    "staff_code": f"DEMO-STAFF-{index + 1:03d}",
                    "branch": "دفتر نمایشی",
                    "notes": DEMO_MARKER,
                },
            )
            # Old demo seeds used realistic-looking mobile numbers. Remove only
            # those exact generated values so demo accounts cannot receive SMS.
            if profile.mobile and re.fullmatch(r"099900000\d{2}", profile.mobile):
                profile.mobile = None
                profile.save(update_fields=["mobile"])
            if range_index is not None:
                sales_range = ranges[range_index]
                role = "MANAGER" if group_name == "RANGE_MANAGER" else "MEMBER"
                ScopeMembership.objects.get_or_create(
                    sales_range=sales_range,
                    user=user,
                    membership_role=role,
                    ended_at=None,
                    defaults={"started_at": now},
                )
            users[username] = user

        return ranges, users

    def _seed_contacts(self, users):
        contacts = []
        for index, name in enumerate(CONTACT_NAMES):
            national_code = f"9999900{index:03d}"
            email = f"demo.contact.{index + 1:03d}@example.invalid"
            contact, created = crm.Contact.objects.get_or_create(
                national_code=national_code,
                defaults={
                    "full_name": f"{name} ـ نمونه",
                    "email": email,
                    "created_by": users["demo.north"],
                    "notes": DEMO_MARKER,
                },
            )
            if not created and not (
                "نمونه" in contact.full_name or DEMO_MARKER in (contact.notes or "")
            ):
                raise CommandError(
                    f"کد تماس ساختگی {national_code} از قبل برای شخصی بدون نشان demo ثبت شده است؛ seed متوقف شد."
                )
            if not contact.email:
                contact.email = email
                contact.save(update_fields=["email", "updated_at"])

            # All generated customer numbers are deliberately invalid, so they
            # cannot accidentally reach a real phone or SMS provider.
            demo_phone = f"000000000{index + 1:02d}"
            legacy_phone = f"099911100{index:02d}"
            old_demo_phone = crm.ContactPhone.objects.filter(
                contact=contact, normalized_phone=legacy_phone
            ).first()
            if old_demo_phone:
                old_demo_phone.phone = demo_phone
                old_demo_phone.is_primary = True
                old_demo_phone.save(update_fields=["phone", "is_primary"])
            else:
                phone, phone_created = crm.ContactPhone.objects.get_or_create(
                    contact=contact,
                    normalized_phone=demo_phone,
                    defaults={"phone": demo_phone, "is_primary": True, "label": "شماره ساختگی"},
                )
                if not phone_created and not phone.is_primary:
                    phone.is_primary = True
                    phone.save(update_fields=["is_primary"])
            contacts.append(contact)
        return contacts

    def _seed_reference_data(self, general_manager, now):
        property_usage = PropertyUsage.objects.get(name="residential")
        property_type = PropertyType.objects.get(name="apartment")
        deal_types = {}
        deal_versions = {}

        for code, family in DEAL_TYPE_DATA:
            deal_type = DealType.objects.get(name=code)
            if deal_type.family != family:
                # These are canonical system codes; their behavioral family is
                # not user content and must match the schema used by workflows.
                deal_type.family = family
                deal_type.save(update_fields=["family", "updated_at"])
            version = self._ensure_deal_type_version(deal_type, family, general_manager, now)
            deal_types[code] = deal_type
            deal_versions[code] = version

        province, _ = Province.objects.get_or_create(
            name="demo-tehran", defaults={"display_name": "تهران نمونه"}
        )
        city, _ = City.objects.get_or_create(
            name="demo-tehran-city",
            province=province,
            defaults={"display_name": "شهر نمونه"},
        )
        district, _ = District.objects.get_or_create(
            name="demo-center",
            city=city,
            defaults={"display_name": "محله نمونه"},
        )
        return {
            "property_usage": property_usage,
            "property_type": property_type,
            "deal_types": deal_types,
            "deal_versions": deal_versions,
            "district": district,
        }

    def _ensure_deal_type_version(self, deal_type, family, general_manager, now):
        schema = default_terms_schema(family)
        matching = DealTypeVersion.objects.filter(
            deal_type=deal_type,
            family=family,
            status=DealTypeVersion.Status.PUBLISHED,
        ).order_by("-version_number")
        for version in matching:
            if version.terms_schema == schema:
                return version

        latest_number = (
            DealTypeVersion.objects.filter(deal_type=deal_type)
            .order_by("-version_number")
            .values_list("version_number", flat=True)
            .first()
            or 0
        )
        roles = (
            ["TENANT", "LANDLORD"]
            if family in {"RENT", "FULL_MORTGAGE"}
            else ["BUYER", "SELLER"]
        )
        return DealTypeVersion.objects.create(
            deal_type=deal_type,
            version_number=latest_number + 1,
            family=family,
            terms_schema=schema,
            financial_fields=[field["key"] for field in schema["fields"]],
            required_roles=roles,
            rules={"demo_seed": True},
            status=DealTypeVersion.Status.PUBLISHED,
            published_at=now,
            created_by=general_manager,
        )

    def _seed_properties(self, users, contacts, references):
        properties = []
        for index in range(10):
            agent = users[f"demo.agent{index % 3 + 1}"]
            review_state = PROPERTY_REVIEW_STATES[index]
            initial_status = (
                Property.Status.DRAFT
                if index in {6, 7, 9}
                else Property.Status.INACTIVE
                if index == 8
                else Property.Status.AVAILABLE
            )
            prop, created = Property.objects.get_or_create(
                title=f"ملک نمایشی {index + 1}",
                consultant=agent,
                defaults={
                    "internal_code": "",
                    "property_type": "APARTMENT",
                    "property_type_ref": references["property_type"],
                    "property_usage": references["property_usage"],
                    "area": 80 + index * 5,
                    "rooms": 1 + index % 4,
                    "floor": index % 8 + 1,
                    "built_year": 1390 + index,
                    "address": f"{DEMO_MARKER} نشانی ساختگی {index + 1}؛ شماره پلاک و موقعیت واقعی ندارد.",
                    "district": references["district"],
                    "description": f"ملک آزمایشی برای آزمون فیلترها و مراحل CRM؛ کد سناریو DEMO-PROP-{index + 1:03d}.",
                    "status": initial_status,
                    "review_status": review_state,
                    "review_version": 0 if review_state == "NOT_SUBMITTED" else 1,
                    "submitted_review_version": 0 if review_state == "NOT_SUBMITTED" else 1,
                    "is_shared": index % 3 == 0,
                },
            )
            if not created and not (
                "نمایشی" in (prop.address or "")
                or DEMO_MARKER in (prop.address or "")
                or "DEMO-PROP-" in (prop.description or "")
            ):
                raise CommandError(
                    f"ملک «{prop.title}» با کارشناس نمونه از قبل وجود دارد اما ساختگی‌بودنش قابل‌تأیید نیست."
                )
            crm.PropertyParty.objects.get_or_create(
                property=prop,
                contact=contacts[index],
                role=crm.PropertyParty.Role.OWNER,
                defaults={"is_primary": True, "share_percent": Decimal("100")},
            )
            properties.append(prop)

        self._seed_property_attributes(properties)
        self._seed_property_media(properties, users)
        return properties

    def _seed_property_attributes(self, properties):
        values = {
            "building_direction": ("north", "south", "east", "west", "north_south"),
            "document_type": ("single_deed", "agreement", "shared_deed", "single_deed", "endowment"),
            "renovation_status": ("new", "renovated", "needs_renovation"),
            "has_balcony": (True, False),
            "parking": (True, False),
            "elevator": (True, False),
            "storage": (True, False),
            "security_guard": (False, True),
        }
        for index, prop in enumerate(properties):
            for name, options in values.items():
                attribute = Attribute.objects.filter(name=name, deleted_at__isnull=True).first()
                if attribute is None or attribute.is_core or attribute.entity != Attribute.Entity.PROPERTY:
                    continue
                value_row, created = PropertyAttributeValue.objects.get_or_create(
                    property=prop,
                    attribute=attribute,
                )
                if created:
                    value_row.set_value(options[index % len(options)])
                    value_row.save()

    def _seed_property_media(self, properties, users):
        for index, prop in enumerate(properties):
            image_file = ContentFile(self._demo_png(index), name=f"demo-property-{index + 1:03d}.png")
            validate_property_image(image_file)
            PropertyImage.objects.get_or_create(
                property=prop,
                sort_order=0,
                defaults={"image": image_file},
            )

        # Structured appraisal reports are available for the six properties
        # that have a linked, reviewed registration case.
        for index in range(3, 9):
            prop = properties[index]
            pdf_data = self._demo_pdf(f"SYNTHETIC APPRAISAL REPORT {index + 1}")
            report_file = ContentFile(pdf_data, name=f"demo-appraisal-{index + 1:03d}.pdf")
            validate_appraisal_pdf(report_file)
            PropertyAppraisalReport.objects.get_or_create(
                property=prop,
                defaults={
                    "file": report_file,
                    "original_filename": f"DEMO-appraisal-{index + 1:03d}.pdf",
                    "file_size": len(pdf_data),
                    "uploaded_by": users[f"demo.agent{index % 3 + 1}"],
                },
            )

    @staticmethod
    def _demo_png(index):
        from PIL import Image, ImageDraw

        palette = (
            (70, 118, 138),
            (102, 134, 102),
            (166, 126, 91),
            (92, 115, 157),
            (144, 102, 124),
        )
        accent = palette[index % len(palette)]
        image = Image.new("RGB", (640, 400), (232, 238, 233))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 640, 240), fill=(202, 224, 226))
        draw.ellipse((500, 36, 570, 106), fill=(246, 211, 133))
        draw.rectangle((0, 260, 640, 400), fill=(128, 157, 117))
        draw.polygon([(155, 190), (320, 105), (485, 190)], fill=accent)
        draw.rectangle((180, 190, 460, 335), fill=(242, 232, 209))
        draw.rectangle((285, 240, 350, 335), fill=(115, 91, 75))
        for x in (205, 370):
            draw.rectangle((x, 215, x + 48, 260), fill=(130, 185, 197))
            draw.line((x + 24, 215, x + 24, 260), fill=(242, 232, 209), width=4)
        draw.rounded_rectangle((18, 18, 392, 62), radius=8, fill=(255, 255, 255))
        draw.text((30, 31), f"DEMO DATA ONLY  |  PROPERTY {index + 1:02d}", fill=(39, 52, 58))
        draw.text((20, 368), "SYNTHETIC ILLUSTRATION - NOT A REAL PROPERTY PHOTO", fill=(255, 255, 255))
        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()

    @staticmethod
    def _demo_pdf(label):
        # Small, valid single-page PDF. Every generated document is visibly
        # marked as non-legal, synthetic demonstration material.
        text = (f"DEMO DATA ONLY - NOT A REAL OR LEGAL DOCUMENT - {label}").replace("(", "[").replace(")", "]")
        stream = f"BT /F1 12 Tf 40 740 Td ({text}) Tj ET".encode("ascii", errors="replace")
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        ]
        output = bytearray(b"%PDF-1.4\n% synthetic demo file\n")
        offsets = [0]
        for index, body in enumerate(objects, start=1):
            offsets.append(len(output))
            output.extend(f"{index} 0 obj\n".encode("ascii"))
            output.extend(body)
            output.extend(b"\nendobj\n")
        xref_offset = len(output)
        output.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
        output.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        output.extend(
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
        )
        return bytes(output)

    def _seed_property_cases(self, users, contacts, ranges, properties, references, now):
        cases = []
        sources = tuple(crm.LeadSource.values)
        for index, (lead_status, acceptance_status, status, property_index) in enumerate(CASE_SCENARIOS):
            assigned_to = users[f"demo.agent{index % 3 + 1}"] if acceptance_status in {"PENDING", "ACCEPTED"} else None
            accepted_by = users["demo.general"] if lead_status == "ACCEPTED" else None
            resulting_property = properties[property_index] if property_index is not None else None
            case, created = crm.PropertyRegistrationRequest.objects.get_or_create(
                code=f"DEMO-CASE-{index + 1:03d}",
                defaults={
                    "contact": contacts[index % len(contacts)],
                    "created_by": users["demo.north"],
                    "sales_range": ranges[index % len(ranges)],
                    "lead_source": sources[index % len(sources)],
                    "lead_status": lead_status,
                    "lead_accepted_by": accepted_by,
                    "lead_accepted_at": now - timedelta(days=index + 1) if accepted_by else None,
                    "acceptance_status": acceptance_status,
                    "assigned_to": assigned_to,
                    "assigned_at": now - timedelta(days=index + 1) if assigned_to else None,
                    "accepted_at": now - timedelta(days=max(1, index)) if acceptance_status == "ACCEPTED" else None,
                    "due_at": now + timedelta(days=2 + index % 5),
                    "resulting_property": resulting_property,
                    "property_title": resulting_property.title if resulting_property else f"ملک پیشنهادی ساختگی {index + 1}",
                    "status": status,
                    "status_snapshot": {"demo": True, "previous_status": "ACTIVE"} if status in {"CLOSED", "CANCELLED", "DUPLICATE"} else {},
                    "closure_reason": (
                        "نمونه: مالک از ثبت منصرف شد."
                        if status == "CANCELLED"
                        else "نمونه: پرونده پس از پیگیری بسته شد."
                        if status == "CLOSED"
                        else "نمونه: این پرونده تکراری است."
                        if status == "DUPLICATE"
                        else ""
                    ),
                    "description": f"{DEMO_MARKER} شرح پرونده آزمایشی {index + 1:02d}.",
                },
            )
            if not created and not (
                "نمایشی" in (case.description or "")
                or DEMO_MARKER in (case.description or "")
            ):
                raise CommandError(
                    f"کد «{case.code}» به پرونده‌ای بدون نشان demo تعلق دارد؛ seed متوقف شد."
                )
            if index == 11 and not case.duplicate_of_id:
                case.duplicate_of = cases[0]
                case.save(update_fields=["duplicate_of", "updated_at"])

            deal_type = references["deal_types"][DEAL_TYPE_DATA[index % len(DEAL_TYPE_DATA)][0]]
            crm.RegistrationRequestDealType.objects.get_or_create(
                registration_request=case,
                deal_type=deal_type,
            )
            if case.assigned_to_id:
                manager = users["demo.north"] if index % 2 == 0 else users["demo.west"]
                self._ensure_assignment_history(
                    subject_type=crm.AssignmentHistory.SubjectType.PROPERTY_CASE,
                    subject=case,
                    action=crm.AssignmentHistory.Action.ASSIGNED,
                    actor=manager,
                    to_user=case.assigned_to,
                    reason="ارجاع ساختگی برای آزمون حوزه و گردش‌کار.",
                    due_at=case.due_at,
                )
                if case.acceptance_status == crm.AcceptanceStatus.ACCEPTED:
                    self._ensure_assignment_history(
                        subject_type=crm.AssignmentHistory.SubjectType.PROPERTY_CASE,
                        subject=case,
                        action=crm.AssignmentHistory.Action.ACCEPTED,
                        actor=case.assigned_to,
                        to_user=case.assigned_to,
                        reason="پذیرش ارجاع نمونه.",
                    )
            cases.append(case)

        self._seed_case_reviews(users, cases, properties, now)
        self._seed_assignment_requests(users, cases, now)
        self._seed_scope_transfer(users, ranges, cases[4])
        return cases

    def _seed_case_reviews(self, users, cases, properties, now):
        case_by_property = {
            case.resulting_property_id: case
            for case in cases
            if case.resulting_property_id
        }
        for index, prop in enumerate(properties):
            decision = PROPERTY_REVIEW_STATES[index]
            if decision == "NOT_SUBMITTED":
                continue
            case = case_by_property.get(prop.pk)
            submitted_by = users[f"demo.agent{index % 3 + 1}"]
            crm.PropertyReview.objects.get_or_create(
                property=prop,
                version=1,
                defaults={
                    "registration_request": case,
                    "submitted_by": submitted_by,
                    "snapshot": {
                        "demo": True,
                        "title": prop.title,
                        "area": prop.area,
                        "property_type": prop.property_type,
                    },
                    "appraisal_snapshot": {
                        "demo": True,
                        "summary": "ارزیابی ساختگی؛ فاقد ارزش حقوقی یا مالی.",
                    },
                    "decision": decision,
                    "reason": "نمونه: تکمیل تصویر سند و نشانی غیرواقعی لازم است." if decision == "CHANGES_REQUIRED" else "",
                    "reviewed_by": None if decision == "PENDING" else users["demo.general"],
                    "reviewed_at": None if decision == "PENDING" else now - timedelta(days=1),
                },
            )
            if prop.review_status != decision:
                prop.review_status = decision
                prop.review_version = max(prop.review_version, 1)
                prop.submitted_review_version = max(prop.submitted_review_version, 1)
                prop.save(update_fields=["review_status", "review_version", "submitted_review_version", "updated_at"])

            if case:
                complete = index in {3, 4, 5, 6, 7, 8}
                crm.PropertyAppraisal.objects.get_or_create(
                    registration_request=case,
                    defaults={
                        "property": prop,
                        "findings": {
                            "demo": True,
                            "area_check": "گزارش اندازه‌گیری ساختگی",
                            "document_check": "اطلاعات هویتی واقعی ثبت نشده است",
                            "market_comparison": "مقادیر مالی صرفاً نمونه هستند",
                        },
                        "report_text": f"{DEMO_MARKER} گزارش کارشناسی ساخت‌یافته برای ملک نمونه {index + 1}.",
                        "visit_notes": "بازدید میدانی واقعی انجام نشده است.",
                        "is_complete": complete,
                        "updated_by": submitted_by,
                    },
                )

    def _seed_assignment_requests(self, users, cases, now):
        pending_case = cases[2]
        crm.AssignmentRescheduleRequest.objects.get_or_create(
            property_case=pending_case,
            inquiry=None,
            status=crm.AssignmentRescheduleRequest.Status.PENDING,
            reason="نمونه: برای تکمیل بررسی مدارک به دو روز مهلت بیشتر نیاز است.",
            defaults={
                "requested_due_at": now + timedelta(days=7),
                "requested_by": pending_case.assigned_to,
            },
        )
        approved_case = cases[4]
        request, _ = crm.AssignmentRescheduleRequest.objects.get_or_create(
            property_case=approved_case,
            inquiry=None,
            status=crm.AssignmentRescheduleRequest.Status.APPROVED,
            reason="نمونه: زمان کارشناسی به علت هماهنگی با مالک جابه‌جا شد.",
            defaults={
                "requested_due_at": now + timedelta(days=8),
                "requested_by": approved_case.assigned_to,
                "decided_by": users["demo.north"],
                "decided_at": now - timedelta(days=1),
                "decision_reason": "نمونه: با تمدید کوتاه‌مدت موافقت شد.",
            },
        )
        self._ensure_assignment_history(
            subject_type=crm.AssignmentHistory.SubjectType.PROPERTY_CASE,
            subject=approved_case,
            action=crm.AssignmentHistory.Action.EXTENSION_APPROVED,
            actor=users["demo.north"],
            to_user=approved_case.assigned_to,
            reason=request.decision_reason,
            old_due_at=approved_case.due_at,
            new_due_at=request.requested_due_at,
        )

    def _seed_scope_transfer(self, users, ranges, case):
        from_range = ranges[0]
        to_range = case.sales_range
        if from_range.pk == to_range.pk:
            to_range = ranges[1]
        reason = "انتقال ساختگی بین دو رنج برای آزمون تاریخچهٔ حوزه."
        ScopeTransferHistory.objects.get_or_create(
            subject_type=ScopeTransferHistory.SubjectType.PROPERTY_CASE,
            subject_id=case.pk,
            from_sales_range=from_range,
            to_sales_range=to_range,
            reason=reason,
            defaults={"actor": users["demo.general"]},
        )

    def _ensure_assignment_history(
        self,
        *,
        subject_type,
        subject,
        action,
        actor,
        to_user=None,
        from_user=None,
        reason="",
        due_at=None,
        old_due_at=None,
        new_due_at=None,
    ):
        lookups = {
            "subject_type": subject_type,
            "action": action,
            "actor": actor,
            "to_user": to_user,
            "from_user": from_user,
            "reason": reason,
        }
        if subject_type == crm.AssignmentHistory.SubjectType.PROPERTY_CASE:
            lookups["property_case"] = subject
        else:
            lookups["inquiry"] = subject
        defaults = {
            "old_due_at": old_due_at,
            "new_due_at": new_due_at or due_at,
        }
        crm.AssignmentHistory.objects.get_or_create(**lookups, defaults=defaults)

    def _seed_listings(self, users, properties, references, now):
        listings = []
        channels = ("WEBSITE", "INSTAGRAM", "TELEGRAM", "WEBSITE", "OTHER", "WEBSITE")
        for index, code_family in enumerate(DEAL_TYPE_DATA):
            code, family = code_family
            prop = properties[index]
            deal_type = references["deal_types"][code]
            version = references["deal_versions"][code]
            terms = DEAL_TERMS[index]
            defaults = {
                "title": f"فایل نمایشی {index + 1:02d} ـ {deal_type.display_name}",
                "description": f"{DEMO_MARKER} شرایط، نشانی و قیمت این فایل ساختگی است.",
                "created_by": users["demo.general"],
                "assigned_to": prop.consultant,
                "deal_type_version": version,
                "terms": terms,
                "publish_channel": channels[index],
                "start_date": now - timedelta(days=45 - index),
                "priority": PropertyFile.Priority.HIGH if index in {0, 4} else PropertyFile.Priority.NORMAL,
                "is_featured": index == 0,
                "sale_price": terms.get("sale_price"),
                "deposit": terms.get("deposit"),
                "monthly_rent": terms.get("monthly_rent"),
                "price_details": terms,
                "status": PropertyFile.Status.DRAFT if index == 5 else PropertyFile.Status.ACTIVE,
            }
            listing = PropertyFile.objects.filter(property=prop, deal_type=deal_type).first()
            if listing is None and code in {"mortgage_rent", "presale"}:
                legacy_name = "rent" if code == "mortgage_rent" else "pre_sale"
                legacy = PropertyFile.objects.filter(
                    property=prop,
                    deal_type__name=legacy_name,
                    property__title__startswith="ملک نمایشی",
                ).first()
                if legacy:
                    listing = legacy
                    for field, value in defaults.items():
                        setattr(listing, field, value)
                    listing.deal_type = deal_type
                    listing.save()
            if listing is None:
                listing = PropertyFile.objects.create(property=prop, deal_type=deal_type, **defaults)
            listings.append(listing)

            current_price = {
                "sale_price": listing.sale_price,
                "deposit": listing.deposit,
                "monthly_rent": listing.monthly_rent,
                "price_details": terms,
            }
            if index == 0:
                self._ensure_price_history(
                    listing,
                    users["demo.agent1"],
                    sale_price=5_800_000_000,
                    deposit=None,
                    monthly_rent=None,
                    details={"sale_price": 5_800_000_000, "note": "قیمت قبلی ساختگی"},
                )
            self._ensure_price_history(
                listing,
                users[f"demo.agent{index % 3 + 1}"],
                sale_price=current_price["sale_price"],
                deposit=current_price["deposit"],
                monthly_rent=current_price["monthly_rent"],
                details=current_price["price_details"],
            )

        # Older revisions of the seed made every file ACTIVE. Keep those
        # records recognizable and transition only the synthetic demo files.
        for index, target in ((5, PropertyFile.Status.DRAFT),):
            listing = listings[index]
            if listing.status != target:
                listing.status = target
                listing.save(update_fields=["status", "updated_at"])
        self._seed_listing_attributes(listings)
        return listings

    def _seed_listing_attributes(self, listings):
        attribute, _ = Attribute.objects.get_or_create(
            name="demo_listing_note",
            defaults={
                "display_name": "یادداشت نمایشی فایل عرضه",
                "sort_order": Decimal("999"),
                "data_type": Attribute.DataType.TEXT,
                "entity": Attribute.Entity.PROPERTY_FILE,
                "filter_type": Attribute.FilterType.NONE,
                "category": Attribute.Category.NON_ESSENTIAL,
                "is_core": False,
                "core_field": "",
            },
        )
        if (
            attribute.entity != Attribute.Entity.PROPERTY_FILE
            or attribute.data_type != Attribute.DataType.TEXT
            or attribute.is_core
        ):
            raise CommandError(
                "ویژگی demo_listing_note از قبل با تعریفی ناسازگار وجود دارد؛ تغییری اعمال نشد."
            )

        for deal_type in {listing.deal_type for listing in listings}:
            DealTypeAttribute.objects.get_or_create(
                deal_type=deal_type,
                attribute=attribute,
                defaults={"sort_order": Decimal("999"), "is_active": True},
            )

        for index, listing in enumerate(listings):
            value, created = PropertyFileAttributeValue.objects.get_or_create(
                property_file=listing,
                attribute=attribute,
            )
            if created:
                value.set_value(
                    f"{DEMO_MARKER} یادداشت فایل شماره {index + 1:02d}; داده‌ای برای تصمیم واقعی نیست."
                )
                value.save()

    def _ensure_price_history(self, listing, changed_by, *, sale_price, deposit, monthly_rent, details):
        PropertyFilePriceHistory.objects.get_or_create(
            property_file=listing,
            changed_by=changed_by,
            sale_price=sale_price,
            deposit=deposit,
            monthly_rent=monthly_rent,
            price_details=details,
        )

    def _seed_inquiries(self, users, contacts, ranges, references, now):
        inquiries = []
        for index, state in enumerate(INQUIRY_SCENARIOS):
            assigned = users[f"demo.agent{index % 3 + 1}"]
            lead_manager = users["demo.north"] if index % 2 == 0 else users["demo.west"]
            inquiry, created = crm.Inquiry.objects.get_or_create(
                code=f"DEMO-INQ-{index + 1:03d}",
                defaults={
                    "contact": contacts[4 + index],
                    "created_by": lead_manager,
                    "sales_range": ranges[index % len(ranges)],
                    "lead_status": crm.LeadStatus.ACCEPTED,
                    "lead_accepted_by": users["demo.general"],
                    "lead_accepted_at": now - timedelta(days=index + 2),
                    "acceptance_status": "ACCEPTED",
                    "assigned_to": assigned,
                    "assigned_at": now - timedelta(days=index + 1),
                    "accepted_at": now - timedelta(days=index + 1),
                    "due_at": now + timedelta(days=3 + index),
                    "needs_confirmed_at": now - timedelta(days=index + 1),
                    "status": state,
                    "description": f"{DEMO_MARKER} نیاز متقاضی آزمایشی شماره {index + 1:02d}.",
                },
            )
            if not created and not (
                "نمایشی" in (inquiry.description or "")
                or DEMO_MARKER in (inquiry.description or "")
            ):
                raise CommandError(
                    f"کد «{inquiry.code}» به درخواست بدون نشان demo تعلق دارد؛ seed متوقف شد."
                )
            deal_type_code = DEAL_TYPE_DATA[index][0]
            deal_type = references["deal_types"][deal_type_code]
            version = references["deal_versions"][deal_type_code]
            preference_defaults = {
                "deal_type_version": version,
                "min_area": 60 + index * 5,
                "max_area": 180 + index * 5,
                "criteria": {"demo": True, "synthetic": True},
            }
            if family_for_deal_type(deal_type_code) == "RENT":
                preference_defaults.update({"max_deposit": 700_000_000, "max_monthly_rent": 25_000_000})
            elif family_for_deal_type(deal_type_code) == "FULL_MORTGAGE":
                preference_defaults.update({"max_deposit": 1_500_000_000})
            else:
                preference_defaults.update({"min_amount": 1_000_000_000, "max_amount": 10_000_000_000})
            preference, _ = crm.InquiryPreference.objects.get_or_create(
                inquiry=inquiry,
                deal_type=deal_type,
                defaults=preference_defaults,
            )
            preference.districts.add(references["district"])
            preference.property_types.add(references["property_type"])
            self._ensure_assignment_history(
                subject_type=crm.AssignmentHistory.SubjectType.INQUIRY,
                subject=inquiry,
                action=crm.AssignmentHistory.Action.ASSIGNED,
                actor=lead_manager,
                to_user=assigned,
                reason="ارجاع ساختگی درخواست برای آزمون گردش‌کار.",
                due_at=inquiry.due_at,
            )
            self._ensure_assignment_history(
                subject_type=crm.AssignmentHistory.SubjectType.INQUIRY,
                subject=inquiry,
                action=crm.AssignmentHistory.Action.ACCEPTED,
                actor=assigned,
                to_user=assigned,
                reason="پذیرش ساختگی ارجاع درخواست.",
            )
            inquiries.append(inquiry)

        pending = inquiries[5]
        withdrawal, _ = crm.ConsultantWithdrawalRequest.objects.get_or_create(
            inquiry=pending,
            status=crm.ConsultantWithdrawalRequest.Status.PENDING,
            reason="نمونه: مشاور درخواست انتقال این متقاضی به همکار دیگری را ثبت کرده است.",
            defaults={"requested_by": pending.assigned_to},
        )
        if pending.acceptance_status != crm.AcceptanceStatus.WITHDRAWAL_PENDING:
            pending.acceptance_status = crm.AcceptanceStatus.WITHDRAWAL_PENDING
            pending.save(update_fields=["acceptance_status", "updated_at"])
        self._ensure_assignment_history(
            subject_type=crm.AssignmentHistory.SubjectType.INQUIRY,
            subject=pending,
            action=crm.AssignmentHistory.Action.WITHDRAWAL_REQUESTED,
            actor=pending.assigned_to,
            from_user=pending.assigned_to,
            to_user=pending.assigned_to,
            reason=withdrawal.reason,
        )
        return inquiries

    def _seed_pipeline(self, users, contacts, properties, listings, inquiries, now):
        # A completed viewing task is attached to each of the five deal paths.
        viewing_results = (
            crm.Viewing.Result.INTERESTED,
            crm.Viewing.Result.NOT_INTERESTED,
            crm.Viewing.Result.INTERESTED,
            crm.Viewing.Result.INTERESTED,
            crm.Viewing.Result.INTERESTED,
        )
        introduction_states = (
            (crm.Introduction.Status.CLOSED, crm.Introduction.Interest.INTERESTED, "توافق نهایی ساختگی"),
            (crm.Introduction.Status.CLOSED, crm.Introduction.Interest.NOT_INTERESTED, "متقاضی این فایل را نپسندید؛ ادامه مذاکره متوقف شد."),
            (crm.Introduction.Status.OPEN, crm.Introduction.Interest.INTERESTED, "شرایط اولیه مناسب است."),
            (crm.Introduction.Status.OPEN, crm.Introduction.Interest.INTERESTED, "در انتظار تنظیم جزئیات توافق."),
            (crm.Introduction.Status.OPEN, crm.Introduction.Interest.INTERESTED, "در انتظار تهیه پیش‌نویس قرارداد."),
        )
        deal_stages = (
            crm.Deal.Stage.FINALIZED,
            crm.Deal.Stage.LOST,
            crm.Deal.Stage.NEGOTIATION,
            crm.Deal.Stage.AGREED,
            crm.Deal.Stage.CONTRACT,
        )
        tasks = {}
        introductions = []
        viewings = []
        deals = []
        contracts = {}

        for index in range(5):
            inquiry = inquiries[index]
            listing = listings[index]
            agent = users[f"demo.agent{index % 3 + 1}"]
            status, interest, feedback = introduction_states[index]
            intro, _ = crm.Introduction.objects.get_or_create(
                inquiry=inquiry,
                property_file=listing,
                defaults={
                    "introduced_by": agent,
                    "buyer_consultant": agent,
                    "seller_consultant": listing.assigned_to,
                    "introduced_terms_snapshot": DEAL_TERMS[index],
                    "status": status,
                    "customer_interest": interest,
                    "feedback": feedback,
                    "rejection_reason": feedback if interest == crm.Introduction.Interest.NOT_INTERESTED else "",
                },
            )
            if intro.status != status or intro.customer_interest != interest:
                intro.status = status
                intro.customer_interest = interest
                intro.feedback = feedback
                intro.rejection_reason = feedback if interest == crm.Introduction.Interest.NOT_INTERESTED else ""
                intro.save(update_fields=["status", "customer_interest", "feedback", "rejection_reason", "updated_at"])
            introductions.append(intro)

            task_title = "بازدید نمایشی ملک اول" if index == 0 else f"بازدید نمایشی ملک {index + 1}"
            task, _ = Task.objects.get_or_create(
                title=task_title,
                created_by=users["demo.general"],
                defaults={
                    "description": f"{DEMO_MARKER} بازدید نمایشی؛ ملاقات واقعی انجام نشده است.",
                    "assigned_to": agent,
                    "property": properties[index],
                    "inquiry": inquiry,
                    "due_date": (now - timedelta(days=index + 1)).date(),
                    "task_type": Task.TaskType.VIEWING,
                    "status": Task.Status.COMPLETED,
                    "completed_at": now - timedelta(days=index),
                    "priority": Task.Priority.HIGH if index == 0 else Task.Priority.MEDIUM,
                    "note": "فقط داده آزمایشی؛ هیچ تماس واقعی برقرار نشده است.",
                },
            )
            tasks[f"viewing_{index}"] = task
            viewing, _ = crm.Viewing.objects.get_or_create(
                introduction=intro,
                defaults={
                    "task": task,
                    "scheduled_at": now - timedelta(days=index + 1),
                    "assigned_to": agent,
                    "result": viewing_results[index],
                    "notes": "نتیجه ساختگی برای آزمون؛ بازدید واقعی انجام نشده است.",
                    "completed_at": now - timedelta(days=index),
                },
            )
            viewings.append(viewing)

            stage = deal_stages[index]
            deal, _ = crm.Deal.objects.get_or_create(
                introduction=intro,
                viewing=viewing,
                defaults={
                    "property_file": listing,
                    "inquiry": inquiry,
                    "assigned_to": agent,
                    "deal_type_version": listing.deal_type_version,
                    "stage": stage,
                    "result_notes": "نتیجه مذاکره کاملاً ساختگی.",
                    "closure_reason": "عدم انطباق شرایط نمونه." if stage == crm.Deal.Stage.LOST else "",
                    "closed_at": now - timedelta(days=1) if stage in {crm.Deal.Stage.LOST, crm.Deal.Stage.FINALIZED} else None,
                },
            )
            deals.append(deal)
            self._seed_deal_participants(deal, inquiry, listing, contacts, index)
            self._seed_deal_history(deal, stage, users["demo.general"], index)

            if index in {0, 4}:
                contract = self._ensure_contract(
                    deal=deal,
                    listing=listing,
                    inquiry=inquiry,
                    contacts=contacts,
                    general_manager=users["demo.general"],
                    index=index,
                    now=now,
                )
                contracts[index] = contract
                self._seed_contract_parties(contract, deal, contacts, users, index, now)

        # The first fictional sale is finalized. The listing, property and
        # inquiry projections are kept consistent with the contract outcome.
        finalized_contract = contracts[0]
        if finalized_contract.status == crm.Contract.Status.FINALIZED:
            listing = listings[0]
            if listing.status != PropertyFile.Status.SOLD:
                listing.transition_to(PropertyFile.Status.SOLD)
                listing.save(update_fields=["status", "updated_at"])
            prop = properties[0]
            if prop.status != Property.Status.SOLD:
                prop.status = Property.Status.SOLD
                prop.save(update_fields=["status", "updated_at"])
            if inquiries[0].status != crm.CaseStatus.COMPLETED:
                inquiries[0].status = crm.CaseStatus.COMPLETED
                inquiries[0].save(update_fields=["status", "updated_at"])

        # A previously lost negotiation leaves its listing paused for review.
        if listings[1].status == PropertyFile.Status.ACTIVE:
            listings[1].transition_to(PropertyFile.Status.PAUSED)
            listings[1].save(update_fields=["status", "updated_at"])

        self._seed_contract_amendment(contracts[0], users["demo.general"], now)
        self._seed_contract_media(contracts[0], users["demo.general"])
        self._seed_pipeline_tasks(users, properties, inquiries, tasks, now)
        return tasks, introductions, viewings, deals, contracts

    def _seed_deal_participants(self, deal, inquiry, listing, contacts, index):
        family = listing.deal_type.family
        buyer_role = "TENANT" if family in {"RENT", "FULL_MORTGAGE"} else "BUYER"
        seller_role = "LANDLORD" if family in {"RENT", "FULL_MORTGAGE"} else "SELLER"
        buyer = inquiry.contact
        owner = contacts[index]
        crm.DealParticipant.objects.get_or_create(
            deal=deal,
            contact=buyer,
            participant_role=buyer_role,
            defaults={"is_primary": True},
        )
        crm.DealParticipant.objects.get_or_create(
            deal=deal,
            contact=owner,
            participant_role=seller_role,
            defaults={"is_primary": True},
        )

    def _seed_deal_history(self, deal, stage, actor, index):
        paths = {
            crm.Deal.Stage.NEGOTIATION: [("", "NEGOTIATION")],
            crm.Deal.Stage.LOST: [("", "NEGOTIATION"), ("NEGOTIATION", "LOST")],
            crm.Deal.Stage.AGREED: [("", "NEGOTIATION"), ("NEGOTIATION", "AGREED")],
            crm.Deal.Stage.CONTRACT: [("", "NEGOTIATION"), ("NEGOTIATION", "AGREED"), ("AGREED", "CONTRACT")],
            crm.Deal.Stage.FINALIZED: [("", "NEGOTIATION"), ("NEGOTIATION", "AGREED"), ("AGREED", "CONTRACT"), ("CONTRACT", "FINALIZED")],
        }
        for previous, following in paths[stage]:
            operation_id = f"demo:deal:{index + 1:02d}:{following.lower()}"
            crm.StageTransitionHistory.objects.get_or_create(
                operation_id=operation_id,
                defaults={
                    "subject_type": "DEAL",
                    "subject_id": deal.pk,
                    "from_stage": previous,
                    "to_stage": following,
                    "reason": "سابقه گردش‌کار ساختگی برای آزمون.",
                    "changed_by": actor,
                },
            )

    def _ensure_contract(self, *, deal, listing, inquiry, contacts, general_manager, index, now):
        contract_number = "DEMO-CONTRACT-001" if index == 0 else "DEMO-CONTRACT-002"
        terms = DEAL_TERMS[index]
        final = index == 0
        contract, _ = crm.Contract.objects.get_or_create(
            deal=deal,
            defaults={
                "contract_number": contract_number,
                "deal_type_version": listing.deal_type_version,
                "terms_snapshot": terms,
                "terms_history": [{"demo": True, "terms": terms}],
                "sale_price": terms.get("sale_price"),
                "deposit": terms.get("deposit"),
                "monthly_rent": terms.get("monthly_rent"),
                "status": crm.Contract.Status.FINALIZED if final else crm.Contract.Status.DRAFT,
                "signed_at": now - timedelta(days=1) if final else None,
                "effective_at": now - timedelta(days=1) if final else None,
                "finalized_at": now - timedelta(days=1) if final else None,
                "created_by": general_manager,
                "finalized_by": general_manager if final else None,
            },
        )
        return contract

    def _seed_contract_parties(self, contract, deal, contacts, users, index, now):
        family = deal.property_file.deal_type.family
        buyer_role = "TENANT" if family in {"RENT", "FULL_MORTGAGE"} else "BUYER"
        seller_role = "LANDLORD" if family in {"RENT", "FULL_MORTGAGE"} else "SELLER"
        parties = (
            (deal.inquiry.contact, buyer_role),
            (contacts[index], seller_role),
        )
        for contact, role in parties:
            party, _ = crm.ContractParty.objects.get_or_create(
                contract=contract,
                contact=contact,
                party_role=role,
                defaults={
                    "identity_snapshot": {
                        "demo": True,
                        "full_name": contact.full_name,
                        "national_code": contact.national_code,
                    }
                },
            )
            signed = contract.status == crm.Contract.Status.FINALIZED
            crm.ContractSignature.objects.get_or_create(
                contract_party=party,
                defaults={
                    "status": crm.ContractSignature.Status.SIGNED if signed else crm.ContractSignature.Status.PENDING,
                    "signed_at": now - timedelta(days=1) if signed else None,
                    "recorded_by": users["demo.general"],
                },
            )

    def _seed_contract_amendment(self, contract, general_manager, now):
        previous = {"sale_price": 6_000_000_000}
        updated = {"sale_price": 6_100_000_000}
        crm.ContractAmendment.objects.get_or_create(
            contract=contract,
            amendment_number=1,
            defaults={
                "reason": "نمونه: اصلاح آزمایشیِ مبلغ قرارداد؛ سند واقعی نیست.",
                "previous_terms_snapshot": previous,
                "new_terms_snapshot": updated,
                "effective_at": now,
                "status": crm.ContractAmendment.Status.APPROVED,
                "approved_by": general_manager,
            },
        )

    def _seed_contract_media(self, contract, general_manager):
        pdf_data = self._demo_pdf("SYNTHETIC CONTRACT SAMPLE - NOT A VALID CONTRACT")
        file = ContentFile(pdf_data, name="DEMO-contract-sample.pdf")
        crm.ContractAttachment.objects.get_or_create(
            contract=contract,
            document_type="DEMO_SAMPLE",
            defaults={
                "file": file,
                "filename": "DEMO-contract-sample.pdf",
                "uploaded_by": general_manager,
            },
        )

    def _seed_pipeline_tasks(self, users, properties, inquiries, tasks, now):
        for index in range(6):
            case = crm.PropertyRegistrationRequest.objects.filter(code=f"DEMO-CASE-{index + 3:03d}").first()
            if case is None:
                continue
            agent = users[f"demo.agent{index % 3 + 1}"]
            task, _ = Task.objects.get_or_create(
                title=f"بررسی پرونده ساختگی {case.code}",
                created_by=users["demo.general"],
                defaults={
                    "description": f"{DEMO_MARKER} بررسی مرحله‌ای پرونده؛ پیگیری واقعی انجام نمی‌شود.",
                    "assigned_to": agent,
                    "property": case.resulting_property,
                    "property_case": case,
                    "due_date": (now + timedelta(days=index - 2)).date(),
                    "task_type": Task.TaskType.INSPECTION if index < 3 else Task.TaskType.DOCUMENT,
                    "status": (Task.Status.PENDING, Task.Status.IN_PROGRESS, Task.Status.COMPLETED)[index % 3],
                    "completed_at": now - timedelta(days=1) if index % 3 == 2 else None,
                    "priority": (Task.Priority.LOW, Task.Priority.MEDIUM, Task.Priority.HIGH)[index % 3],
                    "note": "یادداشت داخلی ساختگی برای نمایش تاریخچه.",
                },
            )
            tasks[f"case_{index}"] = task

        task, _ = Task.objects.get_or_create(
            title="تهیه پیش‌نویس قرارداد نمایشی",
            created_by=users["demo.general"],
            defaults={
                "description": f"{DEMO_MARKER} پیش‌نویس قرارداد ساختگی برای آزمون.",
                "assigned_to": users["demo.agent2"],
                "property": properties[4],
                "inquiry": inquiries[4],
                "due_date": (now + timedelta(days=2)).date(),
                "task_type": Task.TaskType.CONTRACT,
                "status": Task.Status.IN_PROGRESS,
                "priority": Task.Priority.HIGH,
            },
        )
        tasks["contract"] = task

    def _seed_followups(self, users, contacts, properties, cases, inquiries, now):
        followups = []
        types = (FollowUpType.CALL, FollowUpType.MEETING, FollowUpType.EMAIL, FollowUpType.SITE_VISIT)
        for index, inquiry in enumerate(inquiries):
            agent = users[f"demo.agent{index % 3 + 1}"]
            is_complete = index in {0, 3}
            is_archived = index == 5
            due = now - timedelta(days=2) if index == 2 else now + timedelta(days=index + 1)
            followup, _ = FollowUp.objects.get_or_create(
                title=f"پیگیری نمایشی درخواست {inquiry.code}",
                consultant=agent,
                defaults={
                    "follow_up_type": types[index % len(types)],
                    "contact_name": contacts[4 + index].full_name,
                    "scheduled_at": due,
                    "property": properties[index] if index < len(properties) else None,
                    "inquiry": inquiry,
                    "notes": f"{DEMO_MARKER} هیچ تماس واقعی با این شخص گرفته نشده است.",
                    "outcome": "نتیجه تماس ساختگی و بدون اقدام بیرونی." if is_complete else "",
                    "next_action": "بررسی درخواست در محیط آزمون" if not is_complete else "",
                    "next_action_at": now + timedelta(days=3) if not is_complete else None,
                    "completed_at": now - timedelta(days=1) if is_complete else None,
                    "status": FollowUpStatus.COMPLETED if is_complete else FollowUpStatus.SCHEDULED,
                    "probability": (20, 35, 50, 65, 75, 10)[index],
                    "is_archived": is_archived,
                    "archived_at": now - timedelta(days=1) if is_archived else None,
                },
            )
            followups.append(followup)

        # One completed case-related follow-up covers the property workflow link.
        case = cases[4]
        followup, _ = FollowUp.objects.get_or_create(
            title=f"پیگیری نمایشی پرونده {case.code}",
            consultant=users["demo.agent2"],
            defaults={
                "follow_up_type": FollowUpType.SITE_VISIT,
                "contact_name": case.contact.full_name,
                "scheduled_at": now - timedelta(days=3),
                "property": case.resulting_property,
                "property_case": case,
                "notes": f"{DEMO_MARKER} بازدید میدانی واقعی انجام نشده است.",
                "outcome": "گزارش ساختگی پرونده ثبت شد.",
                "completed_at": now - timedelta(days=2),
                "status": FollowUpStatus.COMPLETED,
            },
        )
        followups.append(followup)
        return followups

    def _seed_finance(self, users, contacts, deals, contracts, references, now):
        contract = contracts[0]
        buyer = deals[0].inquiry.contact
        policies = {}
        for code, _family in DEAL_TYPE_DATA:
            deal_type = references["deal_types"][code]
            is_sale = code == "sale"
            policies[code] = self._ensure_demo_commission_policy(
                deal_type=deal_type,
                name=(
                    "سیاست کمیسیون نمایشی فروش"
                    if is_sale
                    else f"سیاست نمایشی {deal_type.display_name}"
                ),
                calculation_method=(
                    crm.CommissionPolicyVersion.CalculationMethod.FLAT
                    if is_sale
                    else crm.CommissionPolicyVersion.CalculationMethod.PERCENT
                ),
                parameters=(
                    {"flat_amount": "10000000", "demo": True}
                    if is_sale
                    else {"percent": "1.5", "demo": True}
                ),
                users=users,
                now=now,
            )
        policy = policies["sale"]

        commission, _ = crm.Commission.objects.get_or_create(
            contract=contract,
            debtor_contact=buyer,
            defaults={
                "policy_version": policy,
                "calculation_snapshot": {
                    "demo": True,
                    "policy_version": policy.version_number,
                    "base_amount": 6_000_000_000,
                    "calculated_amount": 10_000_000,
                },
                "calculated_amount": 10_000_000,
                "final_amount": 10_000_000,
                "due_at": now + timedelta(days=30),
                "status": crm.Commission.Status.APPROVED,
            },
        )
        agent_share, _ = crm.CommissionShare.objects.get_or_create(
            commission=commission,
            beneficiary_type=crm.CommissionShare.BeneficiaryType.USER,
            beneficiary_user=users["demo.agent1"],
            defaults={
                "share_percent": Decimal("40.00"),
                "amount": 4_000_000,
                "status": crm.CommissionShare.Status.APPROVED,
            },
        )
        company_share, _ = crm.CommissionShare.objects.get_or_create(
            commission=commission,
            beneficiary_type=crm.CommissionShare.BeneficiaryType.COMPANY,
            beneficiary_user=None,
            defaults={
                "share_percent": Decimal("60.00"),
                "amount": 6_000_000,
                "status": crm.CommissionShare.Status.APPROVED,
            },
        )
        for share in (agent_share, company_share):
            if share.status == crm.CommissionShare.Status.PENDING:
                share.status = crm.CommissionShare.Status.APPROVED
                share.save(update_fields=["status"])

        incoming, payment_created = crm.Payment.objects.get_or_create(
            reference_number="DEMO-PAY-001",
            defaults={
                "direction": crm.Payment.Direction.IN,
                "contact": buyer,
                "amount": 3_000_000,
                "paid_at": now - timedelta(days=7),
                "method": "واریز بانکی ساختگی",
                "status": crm.Payment.Status.CONFIRMED,
                "recorded_by": users["demo.finance"],
            },
        )
        if not payment_created and not self._is_demo_payment(incoming):
            raise CommandError(
                "شماره مرجع DEMO-PAY-001 به وجهی بدون نشان demo تعلق دارد؛ تخصیص ایجاد نشد."
            )
        crm.PaymentAllocation.objects.get_or_create(
            payment=incoming,
            commission=commission,
            defaults={"amount": 3_000_000},
        )
        outgoing, payment_created = crm.Payment.objects.get_or_create(
            reference_number="DEMO-PAY-OUT-001",
            defaults={
                "direction": crm.Payment.Direction.OUT,
                "user": users["demo.agent1"],
                "amount": 1_000_000,
                "paid_at": now - timedelta(days=3),
                "method": "پرداخت نمونه",
                "status": crm.Payment.Status.CONFIRMED,
                "recorded_by": users["demo.finance"],
            },
        )
        if not payment_created and not self._is_demo_payment(outgoing):
            raise CommandError(
                "شماره مرجع DEMO-PAY-OUT-001 به وجهی بدون نشان demo تعلق دارد؛ تخصیص ایجاد نشد."
            )
        crm.PaymentAllocation.objects.get_or_create(
            payment=outgoing,
            commission_share=agent_share,
            defaults={"amount": 1_000_000},
        )
        refresh_commission_status(commission)
        refresh_share_status(agent_share)
        refresh_share_status(company_share)

    def _ensure_demo_commission_policy(
        self, *, deal_type, name, calculation_method, parameters, users, now
    ):
        policy = crm.CommissionPolicyVersion.objects.filter(
            deal_type=deal_type,
            name=name,
            parameters__demo=True,
        ).order_by("-version_number").first()
        if policy:
            return policy

        latest_version = (
            crm.CommissionPolicyVersion.objects.filter(deal_type=deal_type)
            .order_by("-version_number")
            .values_list("version_number", flat=True)
            .first()
            or 0
        )
        return crm.CommissionPolicyVersion.objects.create(
            deal_type=deal_type,
            version_number=latest_version + 1,
            name=name,
            calculation_method=calculation_method,
            parameters=parameters,
            rounding_rule="تومان صحیح",
            status=crm.CommissionPolicyVersion.Status.PUBLISHED,
            effective_from=now - timedelta(days=30),
            created_by=users["demo.general"],
        )

    @staticmethod
    def _is_demo_payment(payment):
        method = (payment.method or "").lower()
        method_markers = ("demo", "ساختگی", "نمونه", "نمایشی")
        recorded_by_demo = bool(
            payment.recorded_by_id
            and payment.recorded_by.username.startswith("demo.")
        )
        return any(marker in method for marker in method_markers) or recorded_by_demo

    def _seed_tickets(self, users, properties, tasks, now):
        cases = (
            {
                "key": "property-question",
                "title": "[DEMO] پرسش درباره پرونده ملک نمونه",
                "subject_type": TicketSubject.PROPERTY,
                "subject_id": properties[6].pk,
                "property": properties[6],
                "task": None,
                "owner": users["demo.agent3"],
                "recipient": users["demo.general"],
                "status": TicketStatus.WAITING_REPLY,
                "priority": TicketPriority.IMPORTANT,
                "ticket_type": TicketType.QUESTION,
                "reply": None,
            },
            {
                "key": "task-answer",
                "title": "[DEMO] گزارش مشکل در وظیفه بازدید",
                "subject_type": TicketSubject.TASK,
                "subject_id": tasks["viewing_2"].pk,
                "property": None,
                "task": tasks["viewing_2"],
                "owner": users["demo.agent3"],
                "recipient": users["demo.north"],
                "status": TicketStatus.ANSWERED,
                "priority": TicketPriority.NORMAL,
                "ticket_type": TicketType.ISSUE,
                "reply": "پاسخ نمونه: مورد برای آزمون ثبت و بسته‌نشده باقی ماند.",
            },
        )
        result = []
        for item in cases:
            ticket, _ = Ticket.objects.get_or_create(
                title=item["title"],
                created_by=item["owner"],
                defaults={
                    "ticket_type": item["ticket_type"],
                    "priority": item["priority"],
                    "status": item["status"],
                    "subject_type": item["subject_type"],
                    "subject_id": item["subject_id"],
                    "property": item["property"],
                    "task": item["task"],
                    "tags": ["demo", "synthetic"],
                    "sla_due_at": now + timedelta(days=2),
                },
            )
            TicketParticipant.objects.get_or_create(
                ticket=ticket,
                user=item["owner"],
                defaults={"role": TicketParticipantRole.OWNER},
            )
            TicketParticipant.objects.get_or_create(
                ticket=ticket,
                user=item["recipient"],
                defaults={"role": TicketParticipantRole.RECIPIENT},
            )
            initial, _ = TicketMessage.objects.get_or_create(
                ticket=ticket,
                is_initial=True,
                defaults={
                    "sender": item["owner"],
                    "body": f"{DEMO_MARKER} متن اولیه تیکت آزمایشی؛ مسئله واقعی گزارش نشده است.",
                },
            )
            messages = [initial]
            if item["reply"]:
                reply, _ = TicketMessage.objects.get_or_create(
                    ticket=ticket,
                    sender=item["recipient"],
                    body=item["reply"],
                    is_initial=False,
                )
                messages.append(reply)
                self._ensure_ticket_audit(ticket, TicketAuditAction.REPLIED, item["recipient"], "reply")
            latest = max(messages, key=lambda message: (message.created_at, message.pk))
            ticket.reply_count = max(0, len(messages) - 1)
            ticket.last_message_at = latest.created_at
            ticket.last_message_sender = latest.sender
            ticket.status = item["status"]
            ticket.save(update_fields=["reply_count", "last_message_at", "last_message_sender", "status", "updated_at"])
            self._ensure_ticket_audit(ticket, TicketAuditAction.CREATED, item["owner"], "created")
            if item["reply"]:
                pdf_data = self._demo_pdf("SYNTHETIC TICKET ATTACHMENT - NOT EVIDENCE")
                file = ContentFile(pdf_data, name="DEMO-ticket-attachment.pdf")
                validate_ticket_file(file)
                TicketAttachment.objects.get_or_create(
                    message=messages[-1],
                    original_name="DEMO-ticket-attachment.pdf",
                    defaults={"file": file, "content_type": "application/pdf", "size": len(pdf_data)},
                )
            result.append(ticket)
        return result

    def _ensure_ticket_audit(self, ticket, action, actor, key):
        TicketAuditEvent.objects.get_or_create(
            ticket=ticket,
            action=action,
            actor=actor,
            metadata__demo_seed_key=f"{ticket.pk}:{key}",
            defaults={"metadata": {"demo_seed_key": f"{ticket.pk}:{key}", "synthetic": True}},
        )

    def _seed_notifications(self, users, tasks, tickets, now):
        for index, (username, _group, _name, _range) in enumerate(DEMO_USERS):
            user = users[username]
            Notification.objects.get_or_create(
                event_key=f"demo:seed:v1:welcome:{username}",
                defaults={
                    "user": user,
                    "type": Notification.NotificationType.TASK_ASSIGNED,
                    "title": "فضای آزمون آماده است",
                    "message": "تمام رکوردهای این فضا ساختگی هستند و با پیشوند DEMO مشخص شده‌اند.",
                    "is_read": index % 2 == 0,
                    "metadata": {"demo": True, "url": "/app/crm/"},
                },
            )
        Notification.objects.get_or_create(
            event_key="demo:welcome:general",
            defaults={
                "user": users["demo.general"],
                "type": Notification.NotificationType.TASK_ASSIGNED,
                "title": "پرونده‌های نمایشی آماده‌اند",
                "message": "داده‌های این فضای نمایش واقعی نیستند.",
                "metadata": {"url": "/app/crm/", "demo": True},
            },
        )
        Notification.objects.get_or_create(
            event_key="demo:seed:v1:ticket:general",
            defaults={
                "user": users["demo.general"],
                "type": Notification.NotificationType.TICKET_CREATED,
                "title": "تیکت نمونه جدید",
                "message": f"تیکت {tickets[0].ticket_number} فقط برای آزمون رابط کاربری ساخته شده است.",
                "metadata": {"demo": True, "ticket_id": tickets[0].pk},
            },
        )
        Notification.objects.get_or_create(
            event_key="demo:seed:v1:finance:payment",
            defaults={
                "user": users["demo.finance"],
                "type": Notification.NotificationType.PAYMENT_RECORDED,
                "title": "دریافت وجه ساختگی ثبت شد",
                "message": "این رویداد مالی فقط برای آزمون است؛ تراکنش واقعی انجام نشده است.",
                "metadata": {"demo": True},
            },
        )

    def _seed_activity_examples(self, users, tickets):
        for ticket in tickets:
            ActivityLog.objects.get_or_create(
                user=ticket.created_by,
                action=ActivityLog.ActionType.CREATE,
                target_type=ActivityLog.TargetType.TICKET,
                target_id=ticket.pk,
                description=f"[DEMO] تیکت ساختگی {ticket.ticket_number} ایجاد شد",
                defaults={"metadata": {"synthetic": True, "demo_seed": "seed_demo_data_v1"}},
            )
        ActivityLog.objects.get_or_create(
            user=users["demo.finance"],
            action=ActivityLog.ActionType.CREATE,
            target_type=ActivityLog.TargetType.SYSTEM,
            target_id=None,
            description="[DEMO] سند مالی ساختگی برای آزمون ثبت شد",
            defaults={"metadata": {"synthetic": True, "demo_seed": "seed_demo_data_v1"}},
        )


# Keep all workflow data explicitly synthetic in the content as well as the IDs.
def family_for_deal_type(code):
    return dict(DEAL_TYPE_DATA)[code]
