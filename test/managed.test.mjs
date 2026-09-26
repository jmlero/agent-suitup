import assert from "node:assert/strict";
import test from "node:test";
import {
  managedPayload,
  removeManagedBlock,
  upsertManagedBlock,
} from "../src/managed.mjs";

const component = { id: "block/example", version: "1.0.0" };
const content = "## Example\n\nKeep this rule.\n";

test("managed blocks use compact boundaries without prompt metadata", () => {
  const document = upsertManagedBlock("# Existing\n", component, content);
  assert.match(document, /<!--as:block\/example-->/);
  assert.match(document, /<!--\/as:block\/example-->/);
  assert.doesNotMatch(document, /source|integrity|1\.0\.0/);
  assert.equal(managedPayload(document, component.id), content);
  assert.equal(removeManagedBlock(document, component.id), "# Existing\n");
});
