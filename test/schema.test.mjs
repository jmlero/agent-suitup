import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { catalogKeys, listComponents, validateCatalogComponent } from "../src/catalog.mjs";
import { emptyManifest, normalizeManifest, supportedAdapters, validateManifest } from "../src/state.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogSchema = readJson("schemas/catalog.schema.json");
const manifestSchema = readJson("schemas/manifest.schema.json");
const catalog = readJson("catalog/catalog.json");

test("the published catalog satisfies its JSON schema", () => {
  assert.deepEqual(schemaErrors(catalogSchema, catalog), []);
});

test("schema and runtime validation reject the same invalid catalog components", () => {
  const byKind = (kind) => listComponents().filter((component) => component.kind === kind);
  const cases = [
    ["unknown component field", listComponents(), (component) => ({ ...component, notes: "extra" })],
    ["kind and ID disagree", listComponents(), (component) => ({ ...component, kind: component.kind === "block" ? "skill" : "block" })],
    ["short version", listComponents(), (component) => ({ ...component, version: "1.0" })],
    ["blank name", listComponents(), (component) => ({ ...component, name: "  " })],
    ["blank license", listComponents(), (component) => ({ ...component, license: " " })],
    ["unknown selection field", listComponents(), (component) => ({ ...component, selection: { ...component.selection, audience: "all" } })],
    ["unsupported recommended scope", byKind("block"), (component) => ({ ...component, recommendedScope: "user" })],
    ["conflict with an invalid ID", listComponents(), (component) => ({ ...component, conflictsWith: ["tool/codegraph"] })],
    ["content without a license", [...byKind("block"), ...byKind("skill"), ...byKind("command")],
      ({ license, ...component }) => component],
    ["unknown content field", [...byKind("block"), ...byKind("skill")],
      (component) => ({ ...component, content: { ...component.content, mutable: true } })],
    ["unknown context field", byKind("skill"), (component) => ({ ...component, context: { ...component.context, budget: 1 } })],
    ["declared cost for bundled content", byKind("block"),
      (component) => ({ ...component, context: { ...component.context, estimatedTokens: 10 } })],
    ["remote content without a cost", listComponents().filter(({ content }) => content?.kind === "remote"),
      (component) => ({ ...component, context: { loading: component.context.loading } })],
    ["remote content on a branch", listComponents().filter(({ content }) => content?.kind === "remote"),
      (component) => ({ ...component, content: { ...component.content, url: component.content.url.replace(/[0-9a-f]{40}/, "master") } })],
    ["block outside project scope", byKind("block"), (component) => ({ ...component, scopes: ["project", "user"] })],
    ["portable component with adapters", byKind("skill"), (component) => ({ ...component, adapters: ["claude"] })],
    ["plugin for another agent", byKind("plugin"), (component) => ({ ...component, adapters: ["grok"] })],
    ["plugin with prompt content", byKind("plugin"), (component) => ({ ...component, context: { loading: "on-demand" } })],
    ["plugin without verification date", byKind("plugin"), ({ lastVerified, ...component }) => component],
    ["plugin with invalid verification date", byKind("plugin"), (component) => ({ ...component, lastVerified: "yesterday" })],
    ["unknown marketplace field", byKind("plugin"), (component) => ({
      ...component,
      adapter: { claude: { ...component.adapter.claude, marketplace: { ...component.adapter.claude.marketplace, url: "x" } } },
    })],
    ["unknown suggestion rule", listComponents().filter(({ suggest }) => suggest),
      (component) => ({ ...component, suggest: { ...component.suggest, when: { ...component.suggest.when, none: ["hasCI"] } } })],
    ["duplicate prerequisite", listComponents().filter(({ requires }) => requires),
      (component) => ({ ...component, requires: { commands: [component.requires.commands[0], component.requires.commands[0]] } })],
  ];

  for (const [name, components, mutate] of cases) {
    assert.ok(components.length, `${name}: no catalog component exercises this rule`);
    for (const component of components) {
      const invalid = mutate(structuredClone(component));
      assert.notDeepEqual(schemaErrors(catalogSchema, { catalogVersion: 2, components: [invalid] }), [],
        `${name}: the schema accepts ${component.id}`);
      assert.throws(() => validateCatalogComponent(invalid), `${name}: runtime validation accepts ${component.id}`);
    }
  }
});

test("runtime field sets match the schema's declared properties", () => {
  const definitions = catalogSchema.$defs;
  const [bundled, remote] = definitions.content.oneOf;
  const expected = {
    document: catalogSchema.properties,
    component: definitions.component.properties,
    selection: definitions.component.properties.selection.properties,
    context: definitions.context.properties,
    bundledContent: bundled.properties,
    remoteContent: remote.properties,
    suggest: definitions.suggest.properties,
    suggestWhen: definitions.suggest.properties.when.properties,
    requires: definitions.requires.properties,
    adapter: definitions.adapter.properties,
    claudeAdapter: definitions.adapter.properties.claude.properties,
    marketplace: definitions.adapter.properties.claude.properties.marketplace.properties,
  };
  assert.deepEqual(Object.keys(catalogKeys).sort(), Object.keys(expected).sort());
  for (const [name, properties] of Object.entries(expected)) {
    assert.deepEqual([...catalogKeys[name]].sort(), Object.keys(properties).sort(), name);
  }
});

test("the manifest schema accepts exactly the manifests the CLI reads", () => {
  const manifest = normalizeManifest({
    ...emptyManifest(supportedAdapters),
    components: [{ id: "block/tdd", scope: "project" }, { id: "skill/review-pr", scope: "user" }],
  });
  assert.deepEqual(schemaErrors(manifestSchema, manifest), []);
  assert.deepEqual(validateManifest(structuredClone(manifest)), manifest);
  assert.deepEqual(manifestSchema.properties.adapters.items.enum, supportedAdapters);

  for (const [name, invalid] of [
    ["pre-rename version", { manifestVersion: 1, targets: ["codex"], components: [] }],
    ["future version", { ...manifest, manifestVersion: 3 }],
    ["unknown adapter", { ...manifest, adapters: ["codex"] }],
    ["unknown scope", { ...manifest, components: [{ id: "block/tdd", scope: "global" }] }],
    ["missing adapters", { manifestVersion: 2, components: [] }],
  ]) {
    assert.notDeepEqual(schemaErrors(manifestSchema, invalid), [], `${name}: the schema accepts it`);
    assert.throws(() => validateManifest(structuredClone(invalid)), `${name}: the CLI accepts it`);
  }
});

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(repository, relative), "utf8"));
}

// Evaluates the JSON Schema keywords these schemas use. An unsupported keyword
// fails loudly so that schema changes cannot silently skip validation.
function schemaErrors(schema, value, root = schema, at = "$") {
  if (schema === true) return [];
  if (schema === false) return [`${at}: not allowed`];
  const errors = [];
  const fail = (message) => errors.push(`${at}: ${message}`);
  const nested = (subschema, child = value, location = at) => schemaErrors(subschema, child, root, location);
  for (const [keyword, rule] of Object.entries(schema)) {
    switch (keyword) {
      case "$schema": case "$id": case "title": case "$defs": case "format": case "then": case "else":
        break;
      case "$ref":
        errors.push(...nested(rule.split("/").slice(1).reduce((node, key) => node[key], root)));
        break;
      case "type":
        if (!matchesType(rule, value)) fail(`expected ${rule}`);
        break;
      case "const":
        if (JSON.stringify(value) !== JSON.stringify(rule)) fail(`expected ${JSON.stringify(rule)}`);
        break;
      case "enum":
        if (!rule.some((option) => JSON.stringify(option) === JSON.stringify(value))) fail("not in enum");
        break;
      case "pattern":
        if (typeof value === "string" && !new RegExp(rule, "u").test(value)) fail(`does not match ${rule}`);
        break;
      case "minLength":
        if (typeof value === "string" && Array.from(value).length < rule) fail("too short");
        break;
      case "minimum":
        if (typeof value === "number" && value < rule) fail("too small");
        break;
      case "minItems":
        if (Array.isArray(value) && value.length < rule) fail("too few items");
        break;
      case "uniqueItems":
        if (rule && Array.isArray(value) && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
          fail("duplicate items");
        }
        break;
      case "items":
        if (Array.isArray(value)) value.forEach((item, index) => errors.push(...nested(rule, item, `${at}[${index}]`)));
        break;
      case "contains":
        if (Array.isArray(value) && !value.some((item) => !nested(rule, item).length)) fail("no matching item");
        break;
      case "required":
        if (isObject(value)) for (const key of rule) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
        break;
      case "properties":
        if (isObject(value)) {
          for (const [key, subschema] of Object.entries(rule)) {
            if (Object.hasOwn(value, key)) errors.push(...nested(subschema, value[key], `${at}.${key}`));
          }
        }
        break;
      case "additionalProperties":
        if (isObject(value)) {
          for (const key of Object.keys(value).filter((key) => !Object.hasOwn(schema.properties ?? {}, key))) {
            errors.push(...nested(rule, value[key], `${at}.${key}`));
          }
        }
        break;
      case "allOf":
        for (const subschema of rule) errors.push(...nested(subschema));
        break;
      case "anyOf":
        if (!rule.some((subschema) => !nested(subschema).length)) fail("matches no anyOf branch");
        break;
      case "oneOf":
        if (rule.filter((subschema) => !nested(subschema).length).length !== 1) fail("does not match exactly one oneOf branch");
        break;
      case "if":
        errors.push(...nested(nested(rule).length ? schema.else ?? true : schema.then ?? true));
        break;
      default:
        throw new Error(`Unsupported schema keyword in test evaluator: ${keyword}`);
    }
  }
  return errors;
}

function matchesType(type, value) {
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
