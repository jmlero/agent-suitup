import crypto from "node:crypto";

export function normalizeText(value) {
  return value.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

// Returns UTF-8 text, or null for content that must be kept as exact bytes.
export function decodeText(bytes) {
  if (bytes.includes(0)) return null;
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text : null;
}

export function sameContent(left, right) {
  if (typeof left === "string" && typeof right === "string") return left === right;
  return Buffer.from(left).equals(Buffer.from(right));
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
