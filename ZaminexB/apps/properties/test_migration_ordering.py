import ast
from pathlib import Path

from django.test import SimpleTestCase

MIGRATIONS_ROOT = Path(__file__).resolve().parent / "migrations"


def _migration_graph():
    dependency_edges = {}
    run_before_edges = {}
    for path in sorted(MIGRATIONS_ROOT.glob("0*.py")):
        node = path.stem
        dependency_edges[node] = set()
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for item in tree.body:
            if not isinstance(item, ast.ClassDef):
                continue
            for statement in item.body:
                if not isinstance(statement, ast.Assign):
                    continue
                target = getattr(statement.targets[0], "id", "")
                if target not in ("dependencies", "run_before"):
                    continue
                for element in getattr(statement.value, "elts", []):
                    if not (isinstance(element, ast.Tuple) and len(element.elts) == 2):
                        continue
                    app = getattr(element.elts[0], "value", None)
                    name = getattr(element.elts[1], "value", None)
                    if not (app == "properties" and name):
                        continue
                    edges = dependency_edges if target == "dependencies" else run_before_edges
                    edges.setdefault(node, set()).add(name)
    return dependency_edges, run_before_edges


class MigrationOrderingTests(SimpleTestCase):
    def test_price_check_is_never_ordered_before_its_own_applied_dependency(self):
        dependency_edges, run_before_edges = _migration_graph()
        self.assertNotIn(
            "0026_alter_property_price",
            run_before_edges.get("0028_check_integer_toman_prices", set()),
            "بررسی مبلغ باید پس از مهاجرت نام ستون قیمت اجرا شود؛ ترتیب معکوس پایگاه‌هایی را که ۰۰۲۶ را پیش‌تر اجرا کرده‌اند ناسازگار می‌کند.",
        )
        self.assertIn("0026_alter_property_price", dependency_edges.get("0028_check_integer_toman_prices", set()))

    def test_no_migration_is_ordered_before_a_previously_applied_migration(self):
        dependency_edges, run_before_edges = _migration_graph()
        self.assertEqual(
            {node: sorted(targets) for node, targets in run_before_edges.items() if targets},
            {},
            "ترتیب run_before روی مهاجرت منتشرشده، پایگاه‌هایی را که نسخه پیشین آن مهاجرت را اجرا کرده‌اند ناسازگار می‌کند.",
        )
