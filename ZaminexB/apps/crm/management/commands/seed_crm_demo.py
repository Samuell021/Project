"""Backward-compatible command name for the comprehensive demo seed.

Use ``python manage.py seed_demo_data`` for new setups. This alias remains so
existing local scripts and tests keep the same command name.
"""

from apps.common.management.commands.seed_demo_data import Command
