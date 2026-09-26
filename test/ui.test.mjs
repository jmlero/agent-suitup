import assert from "node:assert/strict";
import test from "node:test";
import { paint } from "../src/ui.mjs";

test("only a non-empty NO_COLOR disables color", (context) => {
  const oldForce = process.env.FORCE_COLOR;
  const oldNoColor = process.env.NO_COLOR;
  context.after(() => {
    if (oldForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = oldForce;
    if (oldNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = oldNoColor;
  });
  process.env.FORCE_COLOR = "1";

  delete process.env.NO_COLOR;
  assert.equal(paint("32", "ok"), "\x1b[32mok\x1b[0m");
  process.env.NO_COLOR = "";
  assert.equal(paint("32", "ok"), "\x1b[32mok\x1b[0m");
  process.env.NO_COLOR = "1";
  assert.equal(paint("32", "ok"), "ok");
});
