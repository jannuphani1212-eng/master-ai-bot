const REQUIRED_SPECIALISTS = ["affiliate", "youtube", "blogging", "app-development", "seo"];

export function parseSynthesisReuseRequest(task) {
  const match = String(task || "").match(/^\\s*SYNTHESIS_ONLY_REPORT_IDS\\s*:\\s*(.*)$/im);
  if (!match) return null;
  return match[1].split(/[\\s,;]+/).map(value => value.trim()).filter(Boolean);
}

export function validateSavedSpecialistReports(rows, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length !== 5 || new Set(requestedIds).size !== 5) {
    throw new Error("Synthesis-only mode requires exactly five distinct saved report IDs.");
  }
  if (!Array.isArray(rows) || rows.length !== 5) {
    throw new Error("Could not retrieve all five saved specialist reports for this owner. No specialists were executed.");
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const ordered = requestedIds.map(id => byId.get(id));
  if (ordered.some(row => !row)) throw new Error("One or more report IDs were not found for this owner. No specialists were executed.");
  const agents = ordered.map(row => row.agent_id);
  if (new Set(agents).size !== 5 || REQUIRED_SPECIALISTS.some(agent => !agents.includes(agent))) {
    throw new Error("Saved report IDs must contain exactly one report from each of the five specialists.");
  }
  if (ordered.some(row => row.status !== "completed" || !String(row.report || "").trim())) {
    throw new Error("All five saved specialist reports must be completed and contain report text.");
  }
  return ordered;
}
