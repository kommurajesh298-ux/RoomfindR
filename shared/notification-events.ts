type EventPart = string | number | null | undefined;

const normalizePart = (value: EventPart) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const buildNotificationEventId = (...parts: EventPart[]) =>
  parts
    .map(normalizePart)
    .filter(Boolean)
    .join(":");
