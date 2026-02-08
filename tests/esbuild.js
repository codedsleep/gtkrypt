import { build } from "esbuild";
import { readdirSync } from "fs";

// Find all test files
const unitTests = readdirSync("tests/unit")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `tests/unit/${f}`);

const entryPoints = [...unitTests];

if (entryPoints.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

await build({
  entryPoints,
  outdir: "dist/tests/",
  outbase: "tests/",
  bundle: true,
  target: "firefox115",
  format: "esm",
  external: ["gi://*"],
  sourcemap: true,
});
