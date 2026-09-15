const { deflateSync } = require("node:zlib");

// Valid generated PDF objects/xref exercise the installed decoder with synthetic
// participant data. No downloaded report or personal data is used.
function pdfFixture({ pages = 1, text = "Prepared for Test Person\n1. Achiever\n2. Strategic\n3. Learner\n4. Relator\n5. Analytical", compressed = false } = {}) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const content = Buffer.from(`BT /F1 12 Tf 50 750 Td ${text.split("\n").map((line, i) => `${i ? "0 -18 Td " : ""}(${line.replace(/[\\()]/g, "\\$&")}) Tj`).join("\n")} ET`);
  const bytes = compressed ? deflateSync(content) : content;
  objects.push(Buffer.concat([Buffer.from(`<< /Length ${bytes.length}${compressed ? " /Filter /FlateDecode" : ""} >>\nstream\n`), bytes, Buffer.from("\nendstream")]));
  for (let i = 0; i < pages; i++) objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>");
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const bytes = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
    chunks.push(bytes);
    length += bytes.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

module.exports = { pdfFixture };
