import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveNotificationTarget } from "./notificationTarget";

describe("notification targets", () => {
  it.each(["property_file_pending_review", "property_file_approved", "property_file_rejected"])(
    "opens the propertyFile for %s even when property and ticket IDs exist",
    (type) => {
      expect(resolveNotificationTarget({ type, metadata: { propertyFileId: 12, propertyId: 34, ticketId: 56 } }))
        .toEqual({ kind: "propertyFile", id: "12" });
    },
  );

  it.each(["property_pending_review", "property_approved", "property_rejected", "property_assigned"])(
    "preserves property targets for %s",
    (type) => {
      expect(resolveNotificationTarget({ type, metadata: { propertyId: 34, propertyFileId: 12, ticketId: 56 } }))
        .toEqual({ kind: "property", id: "34" });
    },
  );

  it.each(["ticket_created", "ticket_reply", "ticket_status_changed", "unknown"])(
    "prefers a ticket for %s",
    (type) => {
      expect(resolveNotificationTarget({ type, metadata: { ticketId: 56, propertyFileId: 12, propertyId: 34 } }))
        .toEqual({ kind: "ticket", id: "56", folder: "received" });
    },
  );

  it("reads the sent folder only from ticketFolder", () => {
    expect(resolveNotificationTarget({ metadata: { ticket_id: "56", ticketFolder: "sent" } }))
      .toEqual({ kind: "ticket", id: "56", folder: "sent" });
    expect(resolveNotificationTarget({ metadata: { ticketId: "56", ticketFolder: "other" } }))
      .toEqual({ kind: "ticket", id: "56", folder: "received" });
  });

  it("prefers a propertyFile over a property for unknown types", () => {
    expect(resolveNotificationTarget({ type: "unknown", metadata: { property_file_id: "12", property_id: "34" } }))
      .toEqual({ kind: "propertyFile", id: "12" });
    expect(resolveNotificationTarget({ metadata: { property_id: "34" } }))
      .toEqual({ kind: "property", id: "34" });
  });

  it.each(["0", "abc", 0, -1, 1.5, "-1", "1.5", "1e2", "", true, null, undefined, Number.MAX_SAFE_INTEGER + 1])(
    "ignores invalid identifiers: %s",
    (id) => {
      expect(resolveNotificationTarget({ metadata: { ticketId: id, propertyFileId: id, propertyId: id } }))
        .toEqual({ kind: "none" });
    },
  );

  it("uses a valid alias when the primary ID is invalid", () => {
    expect(resolveNotificationTarget({ type: "property_file_approved", metadata: { propertyFileId: "abc", property_file_id: 12 } }))
      .toEqual({ kind: "propertyFile", id: "12" });
  });

  it("never substitutes a different subject for a typed notification", () => {
    expect(resolveNotificationTarget({ type: "property_file_approved", metadata: { propertyFileId: "0", propertyId: 34 } }))
      .toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ type: "property_pending_review", metadata: { propertyId: "abc", ticketId: 56 } }))
      .toEqual({ kind: "none" });
  });

  it.each([undefined, null, {}, { metadata: null }, { metadata: "invalid" }])(
    "returns none when metadata is absent or unusable: %s",
    (notification) => {
      expect(resolveNotificationTarget(notification)).toEqual({ kind: "none" });
    },
  );

  it("does not mutate the notification", () => {
    const notification = Object.freeze({ type: "property_file_approved", metadata: Object.freeze({ propertyFileId: 12, propertyId: 34 }) });
    expect(resolveNotificationTarget(notification)).toEqual({ kind: "propertyFile", id: "12" });
  });

  it("wires drawer clicks through the resolver without changing read markers", () => {
    const drawer = readFileSync(path.resolve(process.cwd(), "src/shared/components/NotifDrawer.tsx"), "utf8");
    expect(drawer).toContain("const target = resolveNotificationTarget(n)");
    expect(drawer).toContain("onOpenPropertyFile(target.id)");
    expect(drawer).toContain("onOpenProperty(target.id)");
    expect(drawer).toContain("onOpenTicket(target.id, target.folder)");
    expect(drawer).toContain("void handleMarkRead(n.id)");
    expect(drawer).toContain("!n.isRead");
    expect(drawer).not.toContain("const propertyId = n.metadata");
  });
});
