import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function finalizeStandalone(root = process.cwd()) {
  const project = realpathSync(root);
  const output = resolve(project, '.next/standalone');
  if (!existsSync(output) || lstatSync(output).isSymbolicLink() || !realpathSync(output).startsWith(project + sep)) throw new Error('Expected local standalone build output');
  let removed = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const path = join(directory,entry.name);
      if (entry.name === '.env' || entry.name.startsWith('.env.')) {
        if (entry.isDirectory()) throw new Error('Unexpected environment directory in build output');
        unlinkSync(path); removed++; // Generated copy only; never the project environment file.
      } else if (entry.isDirectory()) walk(path);
    }
  }
  walk(output);
  // Standalone does not automatically include browser assets.
  for (const [source, destination] of [['public','public'],['.next/static','.next/static']]) {
    if (existsSync(resolve(project,source))) cpSync(resolve(project,source),resolve(output,destination),{recursive:true});
  }
  for (const required of ['server.js','.document-worker/parser.cjs','node_modules/pdf-parse/package.json','node_modules/pdfjs-dist/package.json']) {
    if (!existsSync(resolve(output,required))) throw new Error('Standalone runtime dependency is missing');
  }
  return {removedEnvironmentCopies:removed, runtimeAssets:'verified'};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(finalizeStandalone()));
