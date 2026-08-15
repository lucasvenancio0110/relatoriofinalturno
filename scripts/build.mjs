import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "src/js"), { recursive: true });
await Promise.all([
  cp(resolve(root, "index.html"), resolve(output, "index.html")),
  cp(resolve(root, ".nojekyll"), resolve(output, ".nojekyll")),
  cp(resolve(root, "styles"), resolve(output, "styles"), { recursive: true }),
]);

const result = await build({
  entryPoints: [resolve(root, "src/js/app.js")],
  outfile: resolve(output, "src/js/app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["safari16.4", "chrome111", "firefox115"],
  minify: true,
  treeShaking: true,
  metafile: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

const bytes = Object.values(result.metafile.outputs).reduce(
  (total, item) => total + Number(item.bytes || 0),
  0,
);
console.log(`Build concluído: dist/ (${(bytes / 1024).toFixed(1)} kB de JavaScript).`);
