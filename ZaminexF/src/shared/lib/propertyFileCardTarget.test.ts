import { describe, expect, it } from "vitest";
import { propertyFileCardTarget } from "./propertyFileCardTarget";

describe("propertyFile card targets", () => {
  it.each([12, "34"])("opens private details only for an assigned propertyFile: %s", (id) => {
    expect(propertyFileCardTarget({ id, isMine: true })).toEqual({ kind: "property-file-detail", id });
  });

  it.each([12, "34"])("opens the read-only modal for someone else's propertyFile: %s", (id) => {
    const target = propertyFileCardTarget({ id, isMine: false });
    expect(target).toEqual({ kind: "modal", id });
    expect(target.kind).not.toBe("property-file-detail");
  });

  it("does not mutate the propertyFile", () => {
    const propertyFile = Object.freeze({ id: 12, isMine: false });
    expect(propertyFileCardTarget(propertyFile)).toEqual({ kind: "modal", id: 12 });
  });
});
