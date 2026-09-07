import { stripVTControlCharacters } from "node:util";
import { aggregateContextCost } from "./catalog.mjs";
import { componentGuide, componentKinds } from "./component-guide.mjs";
import { paint } from "./ui.mjs";

const tabs = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "block", label: "Blocks" },
  { id: "command", label: "Commands" },
  { id: "plugin", label: "Integrations" },
];

export class Picker {
  constructor(components, { installedIds = new Set(), installedScopes = new Map() } = {}) {
    this.components = components;
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
      else if (key.name === "backspace") this.query = Array.from(this.query).slice(0, -1).join("");
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) this.query += text;
      this.cursor = this.detailOffset = 0;
      return;
    }
    if (key.name === "tab" || key.name === "left" || key.name === "right" || /^[1-5]$/.test(text ?? "")) {
      const direction = key.name === "left" || key.shift ? -1 : 1;
      const index = /^[1-5]$/.test(text ?? "") ? Number(text) - 1
        : (Math.max(0, tabs.findIndex(({ id }) => id === this.tab)) + direction + tabs.length) % tabs.length;
      this.tab = tabs[index].id;
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
    else if (text === "s") { this.tab = this.tab === "selected" ? "all" : "selected"; this.cursor = 0; }
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
  if (columns < 40 || rows < 16) return [fit("Resize the terminal, or Esc to cancel.", width)];
  const focused = picker.focused;
  const cost = aggregateContextCost(picker.selection);
  const prefix = [
    `${paint("1;36", "◈ AGENT")} ${paint("2", "/")} ${paint("1;35", "SUITUP")} ${paint("2", fit("  Build your toolkit", width - 20))}`,
    paint("2", fit("Skills for tasks · Blocks for rules · Nothing preselected", width)),
  ];
  const tabLabels = tabs.map(({ id, label }, index) => {
    const count = picker.components.filter((component) => id === "all" || component.kind === id).length;
    return { text: `${index + 1} ${label} ${count}`, active: picker.tab === id };
  });
  if (!picker.inspected) {
    let line = "";
    for (const tab of tabLabels) {
      if (length(line) + tab.text.length + 3 > width) { prefix.push(line); line = ""; }
      line += `${line ? "  " : ""}${paint(tab.active ? "1;30;46" : "2", tab.active ? `[${tab.text}]` : ` ${tab.text} `)}`;
    }
    if (line) prefix.push(line);
    prefix.push(paint(picker.searching ? "1;36" : "2", fit(picker.searching || picker.query
      ? `/ ${picker.searching ? "Search" : "Filter"}: ${picker.query}${picker.searching ? "▏" : ""}`
      : picker.tab === "selected" ? "Your selection · Space removes an item · s returns to catalog"
        : "Browse every category · / search · ✓ installed items stay in place", width)));
  }
  const footer = [
    paint("1;35", fit(`${picker.selected.size} selected · ${cost.words}w always · ~${cost.estimatedTokens}t`, width)),
    ...footerHints(picker, width),
  ];
  if (width >= 76 && rows >= 26) {
    footer.splice(1, 0, paint("2", fit([
      ...["skill", "block", "command", "plugin"].map((kind) => {
        const count = picker.selection.filter((component) => component.kind === kind).length;
        return `${count} ${componentKinds[kind].name.toLowerCase()}${count === 1 ? "" : "s"}`;
      }),
      `${picker.installedIds.size} installed`,
    ].join(" · "), width)));
  }
  const height = Math.max(5, rows - 1 - prefix.length - footer.length);
  const guide = focused ? componentGuide(focused, {
    scope: picker.installedScopes.get(focused.id) ?? scope, adapters, recommendation: suggest(focused),
  }) : null;
  let body;
  if (picker.inspected) {
    body = panel("COMPONENT GUIDE", detailLines(picker, guide, width - 4, height - 2), width, height, "36");
  } else if (width >= 76) {
    const leftWidth = Math.min(48, Math.floor(width * 0.43));
    const rightWidth = width - leftWidth - 1;
    const left = panel(picker.tab === "selected" ? "YOUR SELECTION" : "EXPLORE", catalogLines(picker, leftWidth - 4, height - 2, suggest), leftWidth, height, "35");
    const right = panel("DETAILS · i expand · PgUp/PgDn", detailLines(picker, guide, rightWidth - 4, height - 2), rightWidth, height, "36");
    body = left.map((line, index) => `${line} ${right[index]}`);
  } else if (rows < 20) {
    const content = focused ? [
      paint("1;36", fit(`${picker.installedIds.has(focused.id) ? "✓" : picker.selected.has(focused.id) ? "[✓]" : "[ ]"} ${focused.name}`, width - 4)),
      paint("2", fit(focused.id, width - 4)),
      ...wrap(focused.outcome ?? focused.description, width - 4),
    ] : ["No matches. Esc clears the search."];
    body = panel("BROWSE · i opens full guide", content, width, height, "36");
  } else {
    const listHeight = height >= 12 ? 4 : 2;
    const content = [
      ...catalogLines(picker, width - 4, listHeight, suggest),
      paint("2", "─".repeat(width - 4)),
      ...detailLines(picker, guide, width - 4, height - 3 - listHeight, true),
    ];
    body = panel("EXPLORE · i opens full guide", content, width, height, "36");
  }
  return [...prefix, ...body, ...footer].map((line) => fit(line, width));
}

function catalogLines(picker, width, height, suggest) {
  const visible = picker.visible;
  if (!visible.length) return [paint("2", "No matches."), ...wrap(picker.tab === "selected"
    ? "Nothing selected yet. Press s to browse."
    : "Try another category or Esc to clear the search.", width)].slice(0, height);
  const pageSize = Math.max(1, Math.floor((height >= 5 ? height - 1 : height) / 3));
  const start = Math.max(0, Math.min(picker.cursor - Math.floor(pageSize / 2), visible.length - pageSize));
  const lines = [];
  for (const component of visible.slice(start, start + pageSize)) {
    const active = component === picker.focused;
    const installed = picker.installedIds.has(component.id);
    const selected = picker.selected.has(component.id);
    const kind = componentKinds[component.kind];
    const marker = installed ? " ✓ " : selected ? "[✓]" : "[ ]";
    const title = fit(`${active ? "›" : " "}${marker} ${component.name}`, width).padEnd(width);
    lines.push(paint(active ? "1;30;46" : installed ? "2" : selected ? "32" : "1", title));
    lines.push(paint("2", fit(` ${component.description}`, width)));
    if (lines.length < height) lines.push(paint(kind.color, fit(` ${kind.name} · ${installed ? "installed" : selected ? "selected" : kind.loading}${suggest(component).pick ? " · ★ suggested" : ""}`, width)));
  }
  if (height >= 5) {
    while (lines.length < height - 1) lines.push("");
    const end = Math.min(start + pageSize, visible.length);
    lines.push(paint("2", fit(`${start + 1}–${end} of ${visible.length}${end < visible.length ? " · ↓ more" : ""}`, width)));
  }
  return lines.slice(0, height);
}

function detailLines(picker, guide, width, height, compact = false) {
  if (height < 1) return [];
  if (!guide) return wrap("Pick a category or clear the search to explore the catalog. Nothing installs until the final review.", width).slice(0, height);
  const focused = picker.focused;
  const status = picker.installedIds.has(focused.id) ? "✓ Installed · kept as-is" : picker.selected.has(focused.id) ? "✓ Selected" : "Space to add to your selection";
  const lines = compact ? [] : [
    ...wrap(focused.name, width).map((line) => paint("1;36", line)),
    paint("2", fit(focused.id, width)),
    paint(picker.selected.has(focused.id) ? "32" : "2", fit(status, width)),
    "",
  ];
  for (const [title, text] of guide.sections) {
    lines.push(paint("1;35", title.toUpperCase()), ...wrap(text, width), "");
  }
  lines.pop();
  const space = Math.max(1, height - 1);
  picker.detailMaximum = Math.max(0, lines.length - space);
  picker.detailOffset = Math.min(picker.detailOffset, picker.detailMaximum);
  const result = lines.slice(picker.detailOffset, picker.detailOffset + space);
  while (result.length < space) result.push("");
  if (height > 1) result.push(paint("2", fit(picker.detailMaximum
    ? `${picker.detailOffset ? "↑ " : ""}${picker.detailOffset < picker.detailMaximum ? "↓ " : ""}More details · ${picker.inspected ? "↑↓ scroll" : "i expand / PgDn"}`
    : "Space selects · nothing installs yet", width)));
  return result;
}

function footerHints(picker, width) {
  const hints = picker.inspected
    ? ["↑↓ / PgUp/PgDn scroll · Space select", "Enter / Esc back · Ctrl+C quit"]
    : picker.searching ? ["Type to filter · Enter keeps filter", "Esc clears search · Ctrl+C quit"]
      : width >= 76
        ? ["↑↓ browse · Tab / 1–5 categories · Space select · i details · / search", "Enter next · s selection · a all matches · n none · Esc quit"]
        : ["↑↓ browse · Tab type · Space select", "i details · / search · Enter next", "Esc quit · s selection · a all · n none"];
  return hints.flatMap((hint) => wrap(hint, width)).map((line) => paint("2", line));
}

function panel(title, content, width, height, color) {
  const label = fit(` ${title} `, width - 4);
  const top = paint(color, `╭─${label}${"─".repeat(Math.max(0, width - 3 - length(label)))}╮`);
  const lines = [top];
  for (let index = 0; index < height - 2; index += 1) {
    const text = fit(content[index] ?? "", width - 4);
    lines.push(`${paint(color, "│")} ${text}${" ".repeat(Math.max(0, width - 4 - length(text)))} ${paint(color, "│")}`);
  }
  lines.push(paint(color, `╰${"─".repeat(width - 2)}╯`));
  return lines;
}

function length(value) { return Array.from(stripVTControlCharacters(value)).length; }

function fit(value, width) {
  width = Math.max(0, width);
  if (length(value) <= width) return value;
  // Truncated text drops styling so a clipped escape sequence cannot leak.
  return width ? `${Array.from(stripVTControlCharacters(value)).slice(0, width - 1).join("")}…` : "";
}

function wrap(value, width) {
  const lines = [""];
  for (let word of value.split(/\s+/)) {
    let last = lines.length - 1;
    if (lines[last] && length(`${lines[last]} ${word}`) > width) { lines.push(""); last += 1; }
    while (length(word) > width) {
      lines[last] = Array.from(word).slice(0, width).join("");
      word = Array.from(word).slice(width).join("");
      lines.push(""); last += 1;
    }
    lines[last] += `${lines[last] ? " " : ""}${word}`;
  }
  return lines;
}
