import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["bridge.entry.server.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  write: false,
  // The standalone launcher is distributed as an asset; Git installs run no build scripts.
  minify: false,
});
await writeFile(
  "bridge-source.server.json",
  JSON.stringify(result.outputFiles[0].text) + "\n",
);

const migration = await build({
  entryPoints: ["migration-runner.entry.server.ts"],
  bundle: true,
  platform: "node",
  target: "node22.13",
  format: "cjs",
  write: false,
  minify: false,
});
await writeFile(
  "migration-runner-source.server.json",
  JSON.stringify(migration.outputFiles[0].text) + "\n",
);
