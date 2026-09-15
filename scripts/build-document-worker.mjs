import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/documents/worker.ts"],
  outfile: ".document-worker/parser.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20.19",
  external: ["pdf-parse"],
  logLevel: "warning",
});
