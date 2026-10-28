export type NotificationTarget =
  | { kind: "ticket"; id: string; folder: "sent" | "received" }
  | { kind: "propertyFile" | "property"; id: string }
  | { kind: "none" };

function validId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return undefined;
  const id = String(value).trim();
  return /^[1-9]\d*$/.test(id) ? id : undefined;
}

export function resolveNotificationTarget(notification: unknown): NotificationTarget {
  if (!notification || typeof notification !== "object") return { kind: "none" };
  const source = notification as Record<string, unknown>;
  const metadata = source.metadata && typeof source.metadata === "object"
    ? source.metadata as Record<string, unknown>
    : {};
  const type = typeof source.type === "string" ? source.type : "";
  const propertyFileId = validId(metadata.propertyFileId) ?? validId(metadata.property_file_id);
  const propertyId = validId(metadata.propertyId) ?? validId(metadata.property_id);
  const ticketId = validId(metadata.ticketId) ?? validId(metadata.ticket_id);

  if (type.startsWith("property_file_")) {
    return propertyFileId ? { kind: "propertyFile", id: propertyFileId } : { kind: "none" };
  }
  if (type.startsWith("property_")) {
    return propertyId ? { kind: "property", id: propertyId } : { kind: "none" };
  }
  if (ticketId) {
    return {
      kind: "ticket",
      id: ticketId,
      folder: metadata.ticketFolder === "sent" ? "sent" : "received",
    };
  }
  if (propertyFileId) return { kind: "propertyFile", id: propertyFileId };
  if (propertyId) return { kind: "property", id: propertyId };
  return { kind: "none" };
}
