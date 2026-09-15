const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('standalone cleanup removes generated environment copies, preserves source, and rejects escaping root', async () => {
  const {finalizeStandalone} = await import('./finalize-standalone.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'standalone-security-'));
  try {
    const out=path.join(root,'.next/standalone');
    for(const f of ['server.js','.document-worker/parser.cjs','node_modules/pdf-parse/package.json','node_modules/pdfjs-dist/package.json','.env','.env.production']) {
      fs.mkdirSync(path.dirname(path.join(out,f)),{recursive:true});fs.writeFileSync(path.join(out,f),'synthetic');
    }
    fs.writeFileSync(path.join(root,'.env'),'source-preserved');
    assert.equal(finalizeStandalone(root).removedEnvironmentCopies,2);
    assert.equal(fs.readFileSync(path.join(root,'.env'),'utf8'),'source-preserved');
    assert.equal(fs.existsSync(path.join(out,'.env')),false);
    fs.renameSync(out,path.join(root,'moved'));
    fs.symlinkSync(path.join(root,'moved'),out,'dir');
    assert.throws(()=>finalizeStandalone(root),/Expected local/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
