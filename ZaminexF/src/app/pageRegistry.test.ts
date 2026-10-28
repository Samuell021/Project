import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAVIGATION_GROUPS } from "../shared/lib/navigation";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const primaryPages = new Set<string>();
const aliases: Array<[string, string]> = [];
let hasPageSwitch = false;

function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "pageRegistry" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) primaryPages.add(property.name.text);
    }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left) && ts.isElementAccessExpression(node.right)) {
    const left = node.left;
    const right = node.right;
    if (left.expression.getText(tree) === "pageRegistry" && right.expression.getText(tree) === "pageRegistry" && ts.isStringLiteral(left.argumentExpression) && ts.isStringLiteral(right.argumentExpression)) aliases.push([left.argumentExpression.text, right.argumentExpression.text]);
  }
  if (ts.isSwitchStatement(node) && node.expression.getText(tree) === "page") hasPageSwitch = true;
  ts.forEachChild(node, visit);
}

visit(tree);

describe("page registry", () => {
  it("registers every navigation destination", () => {
    const registered = new Set([...primaryPages, ...aliases.map(([page]) => page)]);
    const missing = NAVIGATION_GROUPS.flatMap((group) => group.items).filter((item) => !registered.has(item.page)).map((item) => item.page);
    expect(missing).toEqual([]);
  });

  it("resolves compatibility destinations to an existing renderer", () => {
    expect(aliases.length).toBeGreaterThan(0);
    for (const [page, target] of aliases) {
      expect(primaryPages.has(target), `${page} → ${target}`).toBe(true);
      expect(primaryPages.has(page)).toBe(false);
    }
  });

  it("does not dispatch pages through a switch or an unfinished placeholder", () => {
    expect(hasPageSwitch).toBe(false);
    expect(source).not.toContain('title="به‌زودی"');
  });
});
