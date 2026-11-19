import test from "node:test";
import assert from "node:assert/strict";
import { mergeMissingReportSections } from "../lib/report-repair.js";

test("replaces a thin existing section without duplicating its heading", () => {
  const original = "## Executive summary\nUseful summary.\n\n## 5. Concrete deliverables\n";
  const repaired = mergeMissingReportSections(
    original,
    "## Concrete deliverables\n- Product shortlist template.\n- Comparison scorecard.\n- Disclosure and tracking plan.",
    { replaceSections: ["Concrete deliverables"] }
  );
  assert.equal((repaired.match(/## 5\. Concrete deliverables/g) || []).length, 1);
  assert.match(repaired, /Product shortlist template/);
  assert.match(repaired, /Comparison scorecard/);
  assert.match(repaired, /Disclosure and tracking plan/);
  assert.match(repaired, /Useful summary/);
});

test("appends a missing section while preserving existing content", () => {
  const original = "## Executive summary\nKeep this.";
  const repaired = mergeMissingReportSections(original, "## Research and evidence\nNeeds live verification.");
  assert.match(repaired, /Keep this/);
  assert.match(repaired, /## Research and evidence/);
});

test("does not change the report when generated repair text is empty", () => {
  assert.equal(mergeMissingReportSections("Original report", ""), "Original report");
});
