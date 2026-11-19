function headingLabel(line) {
  return String(line || "").replace(/^\\s{0,3}#{1,6}\\s*/, "").replace(/^\\s*\\d+[.)]\\s*/, "").trim().toLowerCase();
}

export function mergeMissingReportSections(originalReport, generatedSections, options = {}) {
  const original = String(originalReport || "").trim();
  const additions = String(generatedSections || "").trim();
  if (!additions) return original;
  if (!original) return additions;
  const replace = new Set((options.replaceSections || []).map(value => String(value).trim().toLowerCase()));
  const incoming = additions.split(/\\r?\\n/);
  const incomingHeadings = [];
  for (let i = 0; i < incoming.length; i += 1) if (/^\\s{0,3}#{1,6}\\s+/.test(incoming[i])) incomingHeadings.push(i);
  if (!incomingHeadings.length) return original + "\\n\\n" + additions;
  const lines = original.split(/\\r?\\n/);
  const existingHeadings = [];
  for (let i = 0; i < lines.length; i += 1) if (/^\\s{0,3}#{1,6}\\s+/.test(lines[i])) existingHeadings.push({ index: i, label: headingLabel(lines[i]) });
  const appended = [];
  for (let p = 0; p < incomingHeadings.length; p += 1) {
    const start = incomingHeadings[p];
    const end = incomingHeadings[p + 1] ?? incoming.length;
    const heading = incoming[start];
    const label = headingLabel(heading);
    const body = incoming.slice(start + 1, end);
    const found = existingHeadings.find(item => item.label === label);
    if (found && replace.has(label)) {
      const next = existingHeadings.find(item => item.index > found.index);
      const stop = next ? next.index : lines.length;
      lines.splice(found.index + 1, stop - found.index - 1, ...body);
      const delta = body.length - (stop - found.index - 1);
      for (const item of existingHeadings) if (item.index > found.index) item.index += delta;
    } else if (!found) {
      appended.push(heading, ...body);
    }
  }
  const merged = lines.join("\\n").trim();
  return appended.length ? merged + "\\n\\n" + appended.join("\\n").trim() : merged;
}