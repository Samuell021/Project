from functools import wraps

from django.shortcuts import redirect

from apps.accounts.models import UserRole


def consultant_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect("accounts:login")

        if getattr(request.user, "role", None) not in (
            UserRole.AGENT,
            UserRole.RANGE_MANAGER,
        ):
            return redirect("accounts:login")

        return view_func(request, *args, **kwargs)

    return _wrapped_view
