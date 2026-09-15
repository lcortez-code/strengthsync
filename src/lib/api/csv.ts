export function csvCell(value: string): string {
  // Spreadsheet applications interpret these prefixes even inside quoted CSV cells.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value)
    ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
