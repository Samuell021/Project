from getpass import getpass

from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import AdminProfile, User, UserRole


class Command(BaseCommand):
    help = "Create or explicitly promote a general-manager account with a securely prompted password."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--email", default="")
        parser.add_argument("--first-name", default="")
        parser.add_argument("--last-name", default="")
        parser.add_argument("--branch", default="شعبه مرکزی")
        parser.add_argument(
            "--promote-existing",
            action="store_true",
            help="Allow an existing account to be elevated to general manager.",
        )

    def handle(self, *args, **options):
        username = options["username"].strip()
        if not username:
            raise CommandError("نام کاربری نمی‌تواند خالی باشد.")

        user = User.objects.filter(username=username).first()
        if user and not options["promote_existing"]:
            raise CommandError(
                "این نام کاربری از قبل وجود دارد. برای ارتقای صریح حساب موجود، "
                "گزینه --promote-existing را به‌کار ببرید."
            )
        if user and not user.is_active:
            raise CommandError("حساب غیرفعال را از این فرمان ارتقا نمی‌دهیم؛ ابتدا وضعیت آن را بررسی کنید.")

        user = user or User(username=username)
        user.first_name = options["first_name"].strip() or user.first_name
        user.last_name = options["last_name"].strip() or user.last_name
        user.email = options["email"].strip() or user.email
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True

        password = self._prompt_for_password(user)
        with transaction.atomic():
            user.set_password(password)
            user.save()
            user.groups.clear()
            general_manager_group, _ = Group.objects.get_or_create(name="GENERAL_MANAGER")
            user.groups.add(general_manager_group)
            AdminProfile.objects.get_or_create(
                user=user,
                defaults={
                    "full_name": user.get_full_name() or user.username,
                    "branch": options["branch"].strip() or "شعبه مرکزی",
                },
            )

        self.stdout.write(self.style.SUCCESS("حساب مدیرکل با موفقیت آماده شد؛ رمز عبور نمایش داده نمی‌شود."))

    def _prompt_for_password(self, user):
        for _attempt in range(3):
            password = getpass("رمز عبور جدید (ورودی پنهان): ")
            confirmation = getpass("تکرار رمز عبور: ")
            if password != confirmation:
                self.stderr.write("دو رمز یکسان نیستند؛ دوباره تلاش کنید.")
                continue
            if not password:
                self.stderr.write("رمز عبور خالی مجاز نیست.")
                continue
            try:
                validate_password(password, user)
            except ValidationError as exc:
                for message in exc.messages:
                    self.stderr.write(message)
                continue
            return password
        raise CommandError("تنظیم رمز عبور انجام نشد؛ فرمان را دوباره اجرا کنید.")
