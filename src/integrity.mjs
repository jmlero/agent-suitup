import crypto from "node:crypto";

export function normalizeText(value) {
  return value.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

export function integrity(value) {
  return `sha256-${crypto.createHash("sha256").update(value).digest("base64")}`;
}

export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortValue(value[key])]),
  );
}
