const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createRequire } = require("node:module");
const { transformSync } = require("esbuild");

// Execute the actual TypeScript module with explicit test doubles at its boundaries.
function loadModule(relativePath, mocks = {}, cache = new Map()) {
  const file = resolve(__dirname, "../..", relativePath);
  if (cache.has(file)) return cache.get(file).exports;
  const realRequire = createRequire(file);
  const { code } = transformSync(readFileSync(file, "utf8"), {
    loader: file.endsWith("tsx") ? "tsx" : "ts",
    format: "cjs",
    target: "node20",
    sourcefile: file,
  });
  const module = { exports: {} };
  cache.set(file, module);
  const requireDependency = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) {
      return loadModule(`src/${name.slice(2)}.ts`, mocks, cache);
    }
    return realRequire(name);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    requireDependency, module, module.exports, file, dirname(file)
  );
  return module.exports;
}

module.exports = { loadModule };
