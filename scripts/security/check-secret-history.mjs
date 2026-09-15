import { execFileSync } from "node:child_process";
import { scanText } from "../check-postgres-secrets.mjs";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const commits = git("rev-list", "--all").trim().split("\n").filter(Boolean);
const scanned = new Set();
const findings = [];
for (const commit of commits) {
  for (const record of git("ls-tree", "-r", "-z", commit).split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, blob] = record.slice(0, tab).split(" ");
    const file = record.slice(tab + 1);
    if (type !== "blob" || mode === "120000" || scanned.has(blob)) continue;
    scanned.add(blob);
    const content = git("cat-file", "blob", blob);
    for (const finding of scanText(content, file)) findings.push({ ...finding, commit });
  }
}
// Locations only: content and credential values are never included.
console.log(JSON.stringify({ commits: commits.length, uniqueBlobs: scanned.size, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
