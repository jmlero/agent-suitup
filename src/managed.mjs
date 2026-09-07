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
  let body = segment.slice(firstNewline + 1, lastNewline);
  if (range.format === "legacy") {
    const metadataEnd = body.indexOf("\n");
    if (metadataEnd === -1 || !body.startsWith("<!-- agent-suitup:source ")) {
      throw new ManagedContentError(`Missing managed metadata: ${id}`);
    }
    body = body.slice(metadataEnd + 1);
  }
  return normalizeText(body);
}

export function upsertClaudeBridge(document) {
  const bridge = {
    id: "bridge/agents-md",
    version: "1",
  };
  return upsertManagedBlock(document, bridge, "@AGENTS.md\n");
}

export function removeClaudeBridge(document) {
  return removeManagedBlock(document, "bridge/agents-md");
}

export function findManagedRange(document, id) {
  const formats = [
    { format: "compact", startMarker: `<!--as:${id}-->`, endMarker: `<!--/as:${id}-->` },
    {
      format: "legacy",
      startMarker: `<!-- agent-suitup:start ${id} -->`,
      endMarker: `<!-- agent-suitup:end ${id} -->`,
    },
  ].map((candidate) => ({
    ...candidate,
    starts: occurrences(document, candidate.startMarker),
    ends: occurrences(document, candidate.endMarker),
  }));
  const startCount = formats.reduce((sum, candidate) => sum + candidate.starts.length, 0);
  const endCount = formats.reduce((sum, candidate) => sum + candidate.ends.length, 0);
  if (!startCount && !endCount) return null;
  const match = formats.find((candidate) => candidate.starts.length === 1 && candidate.ends.length === 1);
  if (startCount !== 1 || endCount !== 1 || !match || match.ends[0] < match.starts[0]) {
    throw new ManagedContentError(`Ambiguous managed boundaries for ${id}`);
  }
  return {
    start: match.starts[0],
    end: match.ends[0] + match.endMarker.length,
    format: match.format,
  };
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
