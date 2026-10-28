import importlib

from django.db import connection
from django.test import TestCase

from apps.properties.models import Property

migration = importlib.import_module(
    "apps.properties.migrations.0017_add_list_filter_indexes"
)

DECLARED = {
    "idx_property_created_at": ["-created_at"],
    "idx_property_status_created": ["status", "-created_at"],
    "idx_property_type": ["property_type"],
    "idx_property_area": ["area"],
}


class IndexDeclarationTests(TestCase):
    def test_model_declares_every_index(self):
        declared = {index.name: index.fields for index in Property._meta.indexes}
        self.assertEqual(declared, DECLARED)

    def test_surviving_indexes_are_still_declared_by_their_original_migration(self):
        in_migration = {
            operation.index.name: operation.index.fields
            for operation in migration.Migration.operations
        }
        for name, fields in DECLARED.items():
            self.assertEqual(in_migration[name], fields)

    def test_migration_runs_outside_a_transaction(self):
        self.assertFalse(migration.Migration.atomic)

    def test_the_default_ordering_is_indexed(self):
        first = Property._meta.ordering[0]
        self.assertEqual(first, "-created_at")
        leading = [
            index.name
            for index in Property._meta.indexes
            if index.fields and index.fields[0] == "-created_at"
        ]
        self.assertIn("idx_property_created_at", leading)

    def test_the_indexes_really_exist_in_the_database(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexname FROM pg_indexes"
                " WHERE tablename = 'properties_property'"
            )
            present = {row[0] for row in cursor.fetchall()}
        for name in DECLARED:
            self.assertIn(name, present)


class IndexDefinitionTests(TestCase):
    def _indexdef(self, name):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexdef FROM pg_indexes WHERE indexname = %s", [name]
            )
            row = cursor.fetchone()
        self.assertIsNotNone(row, f"{name} is missing from the database")
        return row[0]

    def test_ordering_index_covers_created_at_descending(self):
        self.assertIn("(created_at DESC)", self._indexdef("idx_property_created_at"))

    def test_status_index_covers_status_then_created_at(self):
        definition = self._indexdef("idx_property_status_created")
        self.assertIn("(status, created_at DESC)", definition)

    def test_supply_price_indexes_back_the_effective_price_lookup(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT indexdef FROM pg_indexes WHERE tablename = 'listings_listing'")
            definitions = " ".join(row[0] for row in cursor.fetchall())
        self.assertIn("(sale_price)", definitions)

    def test_the_single_column_indexes_cover_their_filter(self):
        for name, column in (
            ("idx_property_type", "property_type"),
            ("idx_property_area", "area"),
        ):
            self.assertIn(f"({column})", self._indexdef(name))

    def test_every_declared_index_really_exists(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexname FROM pg_indexes"
                " WHERE tablename = 'properties_property'"
            )
            present = {row[0] for row in cursor.fetchall()}
        for name in DECLARED:
            self.assertIn(name, present)
