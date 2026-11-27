import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyReport } from "./daily-report.js";

test("daily report summarizes completed and failed specialists", () => {
  const report = buildDailyReport("2026-11-27", [
    { agent_id: "affiliate", status: "completed", result: { success: true } },
    { agent_id: "youtube", status: "completed", result: { success: true } },
    { agent_id: "blogging", status: "failed", last_error: "Article extraction failed." },
    { agent_id: "app-development", status: "completed", result: { success: true } },
    { agent_id: "seo", status: "completed", result: { success: true } }
  ]);
  assert.equal(report.title, "Daily Master AI report · 2026-11-27");
  assert.equal(report.metadata.counts.completed, 4);
  assert.equal(report.metadata.counts.failed, 1);
  assert.match(report.body, /Blogging: failed/);
  assert.match(report.body, /owner-approval-only/);
});

test("daily report distinguishes quality attention from successful delivery", () => {
  const report = buildDailyReport("2026-11-28", [
    { agent_id: "blogging", status: "completed", result: { success: false, qualityReview: { score: 75 } } }
  ]);
  assert.equal(report.metadata.counts.needs_attention, 1);
  assert.equal(report.metadata.agents.find(agent => agent.agentId === "blogging").qualityScore, 75);
  assert.equal(report.metadata.counts.not_run, 4);
});
