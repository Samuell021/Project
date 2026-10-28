from importlib import import_module

from django.conf import settings


def _session_store():
    engine = getattr(settings, "SESSION_ENGINE", "django.contrib.sessions.backends.db")
    return import_module(engine).SessionStore


def flush_user_sessions(user, *, keep_session_key=None) -> int:
    if user is None or not getattr(user, "pk", None):
        return 0

    uid = str(user.pk)
    deleted = 0
    store = _session_store()

    iterator = getattr(store, "iter_sessions", None)
    if iterator is None:
        # DB/cached-DB stores have no iter_sessions. Delete via the store so
        # cached copies cannot keep a deactivated/demoted account signed in.
        from django.contrib.sessions.models import Session
        from django.utils import timezone

        for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator():
            if str(session.get_decoded().get("_auth_user_id") or "") != uid:
                continue
            if keep_session_key and session.session_key == keep_session_key:
                continue
            store(session_key=session.session_key).delete()
            deleted += 1
        return deleted

    for session in iterator():
        try:
            data = session.get_decoded() if hasattr(session, "get_decoded") else dict(session)
        except Exception:
            continue
        if str(data.get("_auth_user_id") or "") != uid:
            continue
        if keep_session_key and getattr(session, "session_key", None) == keep_session_key:
            continue
        try:
            session.delete()
            deleted += 1
        except Exception:
            continue
    return deleted


flush_user_sessions = flush_user_sessions
