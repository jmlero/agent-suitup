import { normalizeText } from "./integrity.mjs";

export class ManagedContentError extends Error {}

export function upsertManagedBlock(document, component, content) {
  const normalized = normalizeText(content);
  const range = findManagedRange(document, component.id);
  const segment = managedSegment(component.id, normalized);

  if (range) return `${document.slice(0, range.start)}${segment}${document.slice(range.end)}`;
  if (!document) return `${segment}\n`;
  const separator = document.endsWith("\n\n") ? "" : document.endsWith("\n") ? "\n" : "\n\n";
  return `${document}${separator}${segment}\n`;
}

export function removeManagedBlock(document, id) {
  const range = findManagedRange(document, id);
  if (!range) return document;
  const before = document.slice(0, range.start);
  const after = document.slice(range.end);
  if (before.trim() && !after.trim()) return `${before.trimEnd()}\n`;
  const result = `${before}${after}`;
  return result.trim() ? result : "";
}

export function managedPayload(document, id) {
  const range = findManagedRange(document, id);
  if (!range) return null;
  const segment = document.slice(range.start, range.end);
  const firstNewline = segment.indexOf("\n");
  const lastNewline = segment.lastIndexOf("\n");
  if (firstNewline === -1 || lastNewline <= firstNewline) {
    throw new ManagedContentError(`Malformed managed block: ${id}`);
  }
  return normalizeText(segment.slice(firstNewline + 1, lastNewline));
}

export function findManagedRange(document, id) {
  const startMarker = `<!--as:${id}-->`;
  const endMarker = `<!--/as:${id}-->`;
  const starts = occurrences(document, startMarker);
  const ends = occurrences(document, endMarker);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new ManagedContentError(`Ambiguous managed boundaries for ${id}`);
  }
  return { start: starts[0], end: ends[0] + endMarker.length };
}

function managedSegment(id, content) {
  return [
    `<!--as:${id}-->`,
    content.trimEnd(),
    `<!--/as:${id}-->`,
  ].join("\n");
}

function occurrences(document, needle) {
  const result = [];
  let from = 0;
  while (true) {
    const index = document.indexOf(needle, from);
    if (index === -1) return result;
    result.push(index);
    from = index + needle.length;
  }
}
