const DAILY_REPORT_AGENTS = [
  ["affiliate", "Affiliate"],
  ["youtube", "YouTube"],
  ["blogging", "Blogging"],
  ["app-development", "App Development"],
  ["seo", "SEO"]
];

export function buildDailyReport(dayKey, jobs = []) {
  const byAgent = new Map(jobs.map(job => [job.agent_id, job]));
  const agents = DAILY_REPORT_AGENTS.map(([id, label]) => {
    const job = byAgent.get(id);
    let status = "not_run";
    if (job?.status === "failed") status = "failed";
    else if (job?.status === "blocked") status = "blocked";
    else if (job?.status === "completed") status = job.result?.success === true ? "completed" : "needs_attention";
    else if (job?.status === "running" || job?.status === "pending") status = job.status;
    else if (job) status = "needs_attention";
    return {
      agentId: id,
      label,
      status,
      qualityScore: typeof job?.result?.qualityReview?.score === "number" &&
        Number.isFinite(job.result.qualityReview.score) &&
        job.result.qualityReview.score >= 0 && job.result.qualityReview.score <= 100
        ? job.result.qualityReview.score
        : null,
      error: status === "failed" || status === "blocked" ? String(job.last_error || (status === "blocked" ? "Waiting for provider quota availability." : "Task failed.")).slice(0, 300) : null
    };
  });
  const counts = agents.reduce((total, agent) => {
    total[agent.status] = (total[agent.status] || 0) + 1;
    return total;
  }, {});
  const lines = agents.map(agent => {
    const suffix = agent.qualityScore === null ? "" : " (quality " + agent.qualityScore + "/100)";
    const error = agent.error ? " — " + agent.error : "";
    return agent.label + ": " + agent.status.replace(/_/g, " ") + suffix + error;
  });
  const day = String(dayKey || "unknown date");
  const body = [
    "Daily autonomous work summary for " + day + ".",
    "Completed: " + (counts.completed || 0) + "/5 · Needs attention: " + (counts.needs_attention || 0) +
      " · Failed: " + (counts.failed || 0) + " · Provider-blocked: " + (counts.blocked || 0) + " · Pending/running: " + ((counts.pending || 0) + (counts.running || 0)) +
      " · Not run: " + (counts.not_run || 0) + ".",
    ...lines,
    "External publishing, spending and account changes remain owner-approval-only."
  ].join("\n");
  return {
    title: "Daily Master AI report · " + day,
    body,
    metadata: { dayKey: day, counts, agents }
  };
}
