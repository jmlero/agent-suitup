import { stripVTControlCharacters } from "node:util";
import { agentNames, agents } from "./agents.mjs";
import { aggregateContextCost } from "./catalog.mjs";
import { componentGuide, componentKinds } from "./component-guide.mjs";
import { paint } from "./ui.mjs";

const kindOrder = ["block", "skill", "command", "plugin"];
const steps = ["Agents", "Choose", "Review"];

export class Picker {
  constructor(components, { installedIds = new Set(), installedScopes = new Map() } = {}) {
    const rank = (component) => kindOrder.indexOf(component.kind);
    this.components = components.map((component, index) => ({ component, index }))
      .sort((left, right) => rank(left.component) - rank(right.component) || left.index - right.index)
      .map(({ component }) => component);
    this.tabs = [{ id: "all", label: "All" }, ...kindOrder
      .filter((kind) => this.components.some((component) => component.kind === kind))
      .map((kind) => ({ id: kind, label: componentKinds[kind].plural }))];
    this.installedIds = installedIds;
    this.installedScopes = installedScopes;
    this.selected = new Set();
    this.cursor = 0;
    this.tab = "all";
    this.query = "";
    this.searching = false;
    this.inspected = null;
    this.detailOffset = 0;
    this.detailMaximum = 0;
    this.returnTab = "all";
    this.pasting = false;
    this.tooSmall = false;
  }

  get visible() {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.components.filter((component) =>
      (this.tab === "all" || (this.tab === "selected" ? this.selected.has(component.id) : component.kind === this.tab))
      && words.every((word) => `${component.id} ${component.name} ${component.description} ${Object.values(component.selection ?? {}).join(" ")}`.toLowerCase().includes(word)));
  }

  get focused() { return this.inspected ?? this.visible[this.cursor]; }
  get selection() { return this.components.filter(({ id }) => this.selected.has(id)); }

  toggle(component) {
    if (!component || this.installedIds.has(component.id)) return;
    this.selected.has(component.id) ? this.selected.delete(component.id) : this.selected.add(component.id);
    this.cursor = Math.min(this.cursor, Math.max(0, this.visible.length - 1));
  }

  handle(text, key = {}) {
    if (key.ctrl && (key.name === "c" || key.name === "d")) return "cancel";
    if (key.name === "paste-start" || key.name === "paste-end") {
      this.pasting = key.name === "paste-start";
      if (this.pasting) {
        this.inspected = null;
        this.searching = true;
      }
      return;
    }
    // Pasted text only filters the catalog; it never triggers shortcuts or submits.
    if (this.pasting) {
      const value = (text ?? "").replace(/[\x00-\x1f\x7f]+/g, " ");
      if (value && !(value === " " && (!this.query || this.query.endsWith(" ")))) this.query += value;
      this.cursor = this.detailOffset = 0;
      return;
    }
    // Nothing is visible to act on until the terminal is large enough.
    if (this.tooSmall) return key.name === "escape" ? "cancel" : undefined;
    if (this.inspected) {
      if (key.name === "escape" || key.name === "return" || text === "i") {
        this.inspected = null;
        this.detailOffset = 0;
      } else if (key.name === "space" || text === " ") this.toggle(this.inspected);
      else this.scrollDetails(key);
      return;
    }
    if (key.name === "escape") {
      if (this.searching || this.query || this.tab === "selected") {
        this.searching = false;
        this.query = "";
        if (this.tab === "selected") this.tab = "all";
        this.cursor = this.detailOffset = 0;
        return;
      }
      return "cancel";
    }
    if (this.searching) {
      if (key.name === "return" || key.name === "down") this.searching = false;
      else if (key.name === "backspace") this.query = graphemes(this.query).slice(0, -1).join("");
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) this.query += text;
      this.cursor = this.detailOffset = 0;
      return;
    }
    const number = /^[1-9]$/.test(text ?? "") ? Number(text) : 0;
    if (key.name === "tab" || key.name === "left" || key.name === "right" || (number && number <= this.tabs.length)) {
      const direction = key.name === "left" || key.shift ? -1 : 1;
      // The selection view moves relative to the category it was opened from.
      const current = this.tab === "selected" ? this.returnTab : this.tab;
      const index = number ? number - 1
        : (Math.max(0, this.tabs.findIndex(({ id }) => id === current)) + direction + this.tabs.length) % this.tabs.length;
      this.tab = this.tabs[index].id;
      this.cursor = this.detailOffset = 0;
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") { this.scrollDetails(key); return; }
    if (key.name === "up") this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === "down") this.cursor = Math.min(Math.max(0, this.visible.length - 1), this.cursor + 1);
    else if (key.name === "home") this.cursor = 0;
    else if (key.name === "end") this.cursor = Math.max(0, this.visible.length - 1);
    else if (key.name === "space" || text === " ") this.toggle(this.focused);
    else if (text === "/") this.searching = true;
    else if (text === "i") this.inspected = this.focused ?? null;
    else if (text === "s") {
      if (this.tab !== "selected") this.returnTab = this.tab;
      this.tab = this.tab === "selected" ? "all" : "selected";
      this.cursor = 0;
    }
    else if (text === "a") {
      const available = this.visible.filter(({ id }) => !this.installedIds.has(id));
      const allSelected = available.every(({ id }) => this.selected.has(id));
      for (const { id } of available) allSelected ? this.selected.delete(id) : this.selected.add(id);
      this.cursor = Math.min(this.cursor, Math.max(0, this.visible.length - 1));
    } else if (text === "n") { this.selected.clear(); this.cursor = 0; }
    else if (key.name === "return") return "submit";
    this.detailOffset = 0;
  }

  scrollDetails(key) {
    if (key.name === "home") this.detailOffset = 0;
    else if (key.name === "end") this.detailOffset = this.detailMaximum;
    else {
      const delta = { up: -1, down: 1, pageup: -5, pagedown: 5 }[key.name] ?? 0;
      this.detailOffset = Math.max(0, Math.min(this.detailMaximum, this.detailOffset + delta));
    }
  }
}

export function pickerFrame(picker, {
  columns = 80, rows = 24, suggest = () => ({ pick: false }), scope = "project", adapters = [],
} = {}) {
  const width = Math.max(1, Math.min(132, columns - 2));
  picker.tooSmall = columns < 40 || rows < 16;
  if (picker.tooSmall) return [fit("Resize the terminal, or Esc to cancel.", width)];
  const focused = picker.focused;
  const header = [titleLine(width, 2, adapters)];
  if (picker.inspected) {
    header.push(paint("2", fit("Full details · Enter or Esc returns to the list", width)));
  } else header.push(...tabLines(picker, width));
  header.push(rule(width));
  const footer = [rule(width), ...footerLines(picker, width)];
  const height = Math.max(4, rows - 1 - header.length - footer.length);
  const guide = focused ? componentGuide(focused, {
    scope: picker.installedScopes.get(focused.id) ?? scope, adapters, recommendation: suggest(focused),
  }) : null;
  let body;
  if (picker.inspected) {
    body = detailLines(picker, guide, width, height);
  } else if (width >= 76) {
    const leftWidth = Math.min(44, Math.max(32, Math.floor(width * 0.38)));
    const left = listLines(picker, leftWidth, height, suggest);
    const right = detailLines(picker, guide, width - leftWidth - 3, height);
    body = Array.from({ length: height }, (_, index) =>
      `${pad(fit(left[index] ?? "", leftWidth), leftWidth)}${paint("2", " │ ")}${right[index] ?? ""}`);
  } else {
    // Short terminals keep only the focused row above its details.
    const listHeight = rows < 20 ? 1 : height >= 14 ? 5 : 3;
    body = [
      ...padLines(listLines(picker, width, listHeight, suggest), listHeight),
      rule(width),
      ...detailLines(picker, guide, width, height - listHeight - 1),
    ];
  }
  return [...header, ...body, ...footer].map((line) => fit(line, width));
}

export class AgentPicker {
  // Every agent starts selected, so installed content works with all of them.
  constructor({ enabled = [], detected = new Set(), selected = agents.map(({ id }) => id) } = {}) {
    this.enabled = new Set(enabled);
    this.detected = detected;
    this.selected = new Set([...enabled, ...selected]);
    this.cursor = 0;
    this.warning = "";
    this.pasting = false;
    this.tooSmall = false;
  }

  get selection() { return agents.filter(({ id }) => this.selected.has(id)).map(({ id }) => id); }

  toggle(index) {
    const { id } = agents[index];
    // Setup only adds agents; remove --adapter drops one explicitly.
    if (this.enabled.has(id)) return;
    this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    this.warning = "";
  }

  handle(text, key = {}) {
    if (key.ctrl && (key.name === "c" || key.name === "d")) return "cancel";
    if (key.name === "paste-start" || key.name === "paste-end") { this.pasting = key.name === "paste-start"; return; }
    if (this.pasting) return;
    if (this.tooSmall) return key.name === "escape" ? "cancel" : undefined;
    const number = /^[1-9]$/.test(text ?? "") ? Number(text) : 0;
    if (key.name === "escape") return "cancel";
    if (key.name === "up") this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === "down") this.cursor = Math.min(agents.length - 1, this.cursor + 1);
    else if (key.name === "space" || text === " ") this.toggle(this.cursor);
    else if (number && number <= agents.length) { this.cursor = number - 1; this.toggle(this.cursor); }
    else if (key.name === "return") {
      if (this.selected.size) return "submit";
      this.warning = "Choose at least one agent with Space.";
    }
  }
}

export function agentFrame(model, { columns = 80, rows = 24 } = {}) {
  const width = Math.max(1, Math.min(132, columns - 2));
  model.tooSmall = columns < 40 || rows < 16;
  if (model.tooSmall) return [fit("Resize the terminal, or Esc to cancel.", width)];
  const nameWidth = Math.max(...agents.map(({ name }) => name.length)) + 2;
  const tag = (agent) => model.enabled.has(agent.id) ? "set up" : model.detected.has(agent.id) ? "detected" : "";
  const tagWidth = Math.max(0, ...agents.map((agent) => tag(agent).length));
  const available = width - 4 - nameWidth - (tagWidth ? tagWidth + 2 : 0);
  const inline = agents.every(({ setup }) => length(setup) <= available);
  const footer = [rule(width), ...hintLines([["↑↓", "move"], ["space", "toggle"], ["enter", "continue"], ["esc", "quit"]], width)];
  const intro = wrap("Every agent reads AGENTS.md. Skills and skill commands are installed where each agent looks for them.", width)
    .map((line) => paint("2", line));
  const list = (details) => agents.flatMap((agent, index) => {
    const mark = model.enabled.has(agent.id) ? paint("32", "✓") : model.selected.has(agent.id) ? paint("1;32", "●") : paint("2", "○");
    const lead = `${index === model.cursor ? paint("1;36", "❯") : " "} ${mark} `;
    const name = index === model.cursor ? paint("1", pad(agent.name, nameWidth)) : pad(agent.name, nameWidth);
    const label = tag(agent) ? paint("2", tag(agent)) : "";
    if (inline) return [`${lead}${name}${paint("2", pad(agent.setup, available))}${label ? `  ${label}` : ""}`];
    return [`${lead}${name}${label}`, ...(details ? [`    ${paint("2", fit(agent.setup, width - 4))}`] : [])];
  });
  // Short terminals drop the explanation first, then each agent's details.
  const budget = rows - 1 - footer.length;
  const layouts = [[...intro, "", ...list(true)], list(true), list(false)];
  const body = layouts.find((layout) => layout.length + 4 <= budget) ?? layouts.at(-1);
  const lines = [
    titleLine(width, 1, []),
    rule(width),
    paint("1", "Which coding agents do you use?"),
    ...body,
    "",
    model.warning ? paint("33", fit(model.warning, width)) : "",
  ];
  const space = Math.max(0, budget - lines.length);
  return [...lines, ...Array(space).fill(""), ...footer].map((line) => fit(line, width));
}

function titleLine(width, step, adapters) {
  const trail = steps.map((label, index) => index + 1 < step ? paint("2", `✓ ${label}`)
    : index + 1 === step ? paint("1;36", label) : paint("2", label)).join(paint("2", " › "));
  const brand = paint("1", "agent-suitup");
  const names = agentNames(adapters);
  const left = names.length && length(brand) + length(trail) + names.join(", ").length + 5 <= width
    ? `${brand}${paint("2", ` · ${names.join(", ")}`)}` : brand;
  if (length(left) + length(trail) + 2 > width) return left;
  return `${left}${" ".repeat(width - length(left) - length(trail))}${trail}`;
}

function tabLines(picker, width) {
  const tabs = picker.tabs.map(({ id, label }) => {
    const count = picker.components.filter((component) => id === "all" || component.kind === id).length;
    return { text: ` ${label} ${count} `, active: picker.tab === id };
  });
  if (picker.tab === "selected") tabs.push({ text: ` Selected ${picker.selected.size} `, active: true });
  const segments = tabs.map(({ text, active }) => active ? paint("1;7", text) : paint("2", text));
  if (picker.searching || picker.query) {
    segments.push(paint(picker.searching ? "1;36" : "33", `/ ${picker.query}${picker.searching ? "▏" : ""}`));
  }
  const lines = [];
  let line = "";
  for (const segment of segments) {
    if (line && length(line) + 1 + length(segment) > width) { lines.push(line); line = ""; }
    line += `${line ? " " : ""}${segment}`;
  }
  if (line) lines.push(line);
  return lines;
}

function listLines(picker, width, height, suggest) {
  const visible = picker.visible;
  if (!visible.length) {
    return [paint("2", "No matches."), ...wrap(picker.tab === "selected"
      ? "Nothing selected yet. Press s to go back."
      : "Try another category, or Esc to clear the search.", width).map((line) => paint("2", line))].slice(0, height);
  }
  const rows = [];
  for (const [index, component] of visible.entries()) {
    if (height > 2 && component.kind !== visible[index - 1]?.kind) rows.push({ heading: component.kind });
    rows.push({ component });
  }
  const focus = Math.max(0, rows.findIndex((row) => row.component === picker.focused));
  const overflow = rows.length > height;
  const space = overflow && height > 2 ? height - 1 : height;
  let start = Math.max(0, Math.min(focus - Math.floor(space / 2), rows.length - space));
  // Show the heading of the first visible group whenever the focus still fits.
  if (start > 0 && rows[start - 1].heading && focus - start + 1 < space) start -= 1;
  const lines = rows.slice(start, start + space).map((row) => row.heading
    ? headingLine(row.heading, width) : itemLine(picker, row.component, width, suggest));
  if (space < height) {
    lines.push(paint("2", fit(`${picker.cursor + 1} of ${visible.length}${start + space < rows.length ? " ↓" : ""}`, width)));
  }
  return lines;
}

function headingLine(kind, width) {
  const { plural, summary, color } = componentKinds[kind];
  const title = paint(`1;${color}`, plural);
  return length(`${plural}  ${summary}`) <= width ? `${title}  ${paint("2", summary)}` : fit(title, width);
}

function itemLine(picker, component, width, suggest) {
  const active = component === picker.focused;
  const installed = picker.installedIds.has(component.id);
  const selected = picker.selected.has(component.id);
  const mark = installed ? paint("32", "✓") : selected ? paint("1;32", "●") : paint("2", "○");
  // Suggestions show as a word when the name still fits, otherwise as a star.
  const suggested = !installed && suggest(component).pick;
  const tag = !suggested ? "" : length(component.name) + 14 <= width ? "suggested" : "★";
  const tagWidth = tag ? length(tag) + 1 : 0;
  const name = fit(component.name, Math.max(1, width - 4 - tagWidth));
  const styled = active ? paint("1", name) : installed ? paint("2", name) : name;
  const gap = " ".repeat(Math.max(0, width - 4 - length(name) - tagWidth));
  return `${active ? paint("1;36", "❯") : " "} ${mark} ${styled}${tag ? `${gap} ${paint("33", tag)}` : ""}`;
}

function detailLines(picker, guide, width, height) {
  if (height < 1) return [];
  if (!guide) return padLines(wrap("Nothing to show. Nothing installs until the final review.", width).map((line) => paint("2", line)), height);
  const focused = picker.focused;
  const lines = [
    ...wrap(guide.name, width).map((line) => paint("1", line)),
    ...wrap(guide.meta, width).map((line) => paint("2", line)),
  ];
  if (picker.installedIds.has(focused.id)) lines.push(paint("32", "✓ Installed · kept as it is"));
  else if (picker.selected.has(focused.id)) lines.push(paint("32", "● Selected"));
  lines.push("", ...wrap(guide.summary, width), "", ...factLines(guide.facts, width));
  lines.push("", paint("1", "Files"), ...fileLines(guide.files, width));
  lines.push("", paint("1", guide.content.title), ...contentLines(guide.content.text, width));
  const space = height > 1 ? height - 1 : height;
  picker.detailMaximum = Math.max(0, lines.length - space);
  picker.detailOffset = Math.min(picker.detailOffset, picker.detailMaximum);
  const result = padLines(lines.slice(picker.detailOffset, picker.detailOffset + space), space);
  if (space < height) {
    const position = picker.detailOffset < picker.detailMaximum ? "↓ more below" : "↑ end of details";
    const keys = picker.inspected ? "↑↓ PgUp PgDn scroll" : "PgDn scrolls, i expands";
    result.push(picker.detailMaximum ? paint("2", fit(`${position} · ${keys}`, width)) : "");
  }
  return result;
}

function factLines(facts, width) {
  const labelWidth = Math.max(...facts.map(([label]) => label.length)) + 2;
  if (width - labelWidth < 24) {
    return facts.flatMap(([label, text]) => [paint("2", label), ...wrap(text, width)]);
  }
  return facts.flatMap(([label, text]) => wrap(text, width - labelWidth)
    .map((line, index) => `${index ? " ".repeat(labelWidth) : paint("2", pad(label, labelWidth))}${line}`));
}

function fileLines(files, width) {
  const pathWidth = Math.max(...files.map(([file]) => length(file))) + 2;
  if (width - 2 - pathWidth < 22) {
    return files.flatMap(([file, note]) => [`  ${fit(file, width - 2)}`, ...wrap(note, width - 4).map((line) => `    ${paint("2", line)}`)]);
  }
  return files.flatMap(([file, note]) => wrap(note, width - 2 - pathWidth)
    .map((line, index) => `  ${index ? " ".repeat(pathWidth) : pad(file, pathWidth)}${paint("2", line)}`));
}

// Shows installed text verbatim, wrapping long lines without collapsing indentation.
function contentLines(text, width) {
  const gutter = paint("2", "│ ");
  return text.replace(/\n+$/, "").split("\n").flatMap((line) => breakLine(line, width - 2)).map((line) => `${gutter}${line}`);
}

function breakLine(line, width) {
  if (width < 1 || length(line) <= width) return [line];
  const indent = /^\s*/.exec(line)[0];
  const hang = length(indent) <= width / 2 ? indent : "";
  return wrap(line.trim(), width - length(hang)).map((part) => `${hang}${part}`);
}

function footerLines(picker, width) {
  const cost = aggregateContextCost(picker.selection);
  const tokens = width >= 60 ? ` (~${cost.estimatedTokens} tokens)` : "";
  const summary = `${paint("1", `${picker.selected.size} selected`)}${cost.words
    ? paint("2", ` · +${cost.words} words always on${tokens}`) : ""}`;
  const hints = picker.inspected
    ? [["↑↓", "scroll"], ["space", "select"], ["enter", "back"]]
    : picker.searching
      ? [["type", "to filter"], ["enter", "keep filter"], ["esc", "clear"]]
      : width >= 60
        ? [["↑↓", "move"], ["space", "select"], ["tab", "category"], ["/", "search"], ["i", "expand"], ["s", "selected"], ["enter", "continue"], ["esc", "quit"]]
        : [["space", "select"], ["tab", "category"], ["i", "expand"], ["/", "search"], ["enter", "next"], ["esc", "quit"]];
  const lines = hintLines(hints, width);
  if (length(summary) + 3 + length(lines[0]) <= width && lines.length === 1) {
    return [`${summary}${" ".repeat(width - length(summary) - length(lines[0]))}${lines[0]}`];
  }
  return [fit(summary, width), ...lines];
}

function hintLines(hints, width) {
  const lines = [];
  let line = "";
  for (const [key, label] of hints) {
    const hint = `${paint("1", key)} ${paint("2", label)}`;
    if (line && length(line) + 2 + length(hint) > width) { lines.push(line); line = ""; }
    line += `${line ? "  " : ""}${hint}`;
  }
  if (line) lines.push(line);
  return lines;
}

function rule(width) {
  return paint("2", "─".repeat(width));
}

function padLines(lines, height) {
  const result = lines.slice(0, height);
  while (result.length < height) result.push("");
  return result;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(value) {
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

// Terminal columns occupied by text, ignoring styling.
export function displayWidth(value) {
  return graphemes(stripVTControlCharacters(value)).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}

function graphemeWidth(grapheme) {
  if (/^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u.test(grapheme)) return 0;
  if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}/u.test(grapheme)) return 2;
  const code = grapheme.codePointAt(0);
  return wideRanges.some(([start, end]) => code >= start && code <= end) ? 2 : 1;
}

// East Asian Wide and Fullwidth blocks; emoji are matched by property above.
const wideRanges = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

function length(value) { return displayWidth(value); }

function pad(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - length(value)))}`;
}

// Takes whole graphemes that fit in the given number of columns.
function take(value, width) {
  let used = 0;
  let result = "";
  for (const grapheme of graphemes(value)) {
    used += graphemeWidth(grapheme);
    if (used > width) break;
    result += grapheme;
  }
  return result;
}

function fit(value, width) {
  width = Math.max(0, width);
  if (length(value) <= width) return value;
  // Truncated text drops styling so a clipped escape sequence cannot leak.
  return width ? `${take(stripVTControlCharacters(value), width - 1)}…` : "";
}

function wrap(value, width) {
  const lines = [""];
  for (let word of value.split(/\s+/)) {
    let last = lines.length - 1;
    if (lines[last] && length(`${lines[last]} ${word}`) > width) { lines.push(""); last += 1; }
    while (length(word) > width) {
      const head = take(word, width) || graphemes(word)[0];
      lines[last] = head;
      word = word.slice(head.length);
      lines.push(""); last += 1;
    }
    lines[last] += `${lines[last] ? " " : ""}${word}`;
  }
  return lines;
}
