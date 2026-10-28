import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `rooms`, `floor` and `built_year` are type-specific attributes: the schema
 * decides which of them a property type asks for. The property wizards used to
 * render a second, hard-coded input for each of them ("تعداد خواب", "شماره
 * طبقه", "سال ساخت") and to post those legacy fields next to the attribute
 * payload. The two copies drifted, so the property list, the detail page and
 * the attribute panel could show different values for the same property.
 *
 * These assertions keep the single source of truth: the wizard must collect
 * the physical features through <DynamicAttributeFields> only and must not send
 * the legacy mirror fields.
 */
const components = path.resolve(process.cwd(), "src/features/properties/components");

function source(file: string): string {
  return readFileSync(path.join(components, file), "utf-8");
}

const LEGACY_INPUT_LABELS = ["تعداد خواب", "شماره طبقه", "سال ساخت"];

describe.each(["AddPropertyWizard.tsx", "EditPropertyWizard.tsx"])("%s feature inputs", (file) => {
  const content = source(file);

  it("does not ask for the physical features twice", () => {
    for (const label of LEGACY_INPUT_LABELS) {
      expect(content, `«${label}» must come from the property type schema`).not.toContain(
        `label="${label}"`,
      );
    }
  });

  it("renders the type-specific attribute fields", () => {
    expect(content).toContain("<DynamicAttributeFields");
  });

  it("does not post the legacy mirror fields", () => {
    for (const field of ["beds", "constructionYear"]) {
      expect(content, `${field} must only be read, never written`).not.toContain(`${field}:`);
    }
    expect(content).not.toMatch(/\bfloor:\s/);
  });
});
