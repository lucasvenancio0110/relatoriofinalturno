import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");

test("HTML usa módulos e não contém senha em texto aberto", () => {
  assert.match(html, /type="module" src="\.\/src\/js\/app\.js"/);
  assert.doesNotMatch(html, /132423/);
  assert.doesNotMatch(html, /onclick\s*=/i);
});

test("viewport permite zoom e diálogos possuem semântica nativa", () => {
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale\s*=\s*1/i);
  assert.ok((html.match(/<dialog\b/g) || []).length >= 3);
});
