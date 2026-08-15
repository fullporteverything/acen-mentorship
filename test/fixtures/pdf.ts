export function minimalPdf(): string {
  let output = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  const offsets = objects.map((object) => {
    const offset = output.length;
    output += object;
    return offset;
  });
  const xref = output.length;
  output += "xref\n0 4\n0000000000 65535 f \n";
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
