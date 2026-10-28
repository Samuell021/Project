from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie

from apps.accounts.presentation import build_initial_data


@ensure_csrf_cookie
@login_required
def dashboard(request, app_path=""):
    return render(
        request,
        "dashboard.html",
        {"initial_data": build_initial_data(request)},
    )


@login_required
def crm_dashboard_alias(request):
    return redirect("app-route", app_path="crm")


@login_required
def crm_settings_alias(request):
    return redirect("app-route", app_path="crm/settings")
