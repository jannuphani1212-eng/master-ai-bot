const rawBaseUrl = String(process.env.MASTER_AI_BOT_URL || "").trim();
const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
const secret = String(process.env.SCHEDULER_SHARED_SECRET || "").trim();

if (!baseUrl || !secret) {
  console.error("MASTER_AI_BOT_URL and SCHEDULER_SHARED_SECRET are required.");
  process.exit(1);
}

const headers = { Authorization: "Bearer " + secret, "Content-Type": "application/json" };
const deadline = Date.now() + 10 * 60 * 60 * 1000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(path, method = "GET") {
  const response = await fetch(baseUrl + path, {
    method, headers, ...(method === "POST" ? { body: JSON.stringify({ trigger: "render-cron" }) } : {}),
    signal: AbortSignal.timeout(4 * 60 * 1000)
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { response: body.slice(0, 1000) }; }
  if (!response.ok || data.success !== true) throw new Error("HTTP " + response.status + ": " + JSON.stringify(data));
  return data;
}

try {
  const accepted = await call("/api/internal/daily-run", "POST");
  console.log("Daily queue accepted:", JSON.stringify(accepted));
  let lastSummary = null;
  while (Date.now() < deadline) {
    const status = await call("/api/internal/daily-status");
    lastSummary = status;
    console.log("Daily queue status:", JSON.stringify({
      dayKey: status.dayKey, counts: status.counts, workerRunning: status.workerRunning
    }));
    if (status.finished) {
      console.log("All five daily jobs reached a terminal state:", JSON.stringify(status));
      if ((status.counts?.failed || 0) > 0) process.exitCode = 1;
      break;
    }
    // Re-trigger idempotently so a web-service restart cannot strand queued jobs.
    if (!status.workerRunning && (status.counts?.pending || 0) + (status.counts?.running || 0) > 0) {
      await call("/api/internal/daily-run", "POST");
    }
    await wait(20000);
  }
  if (!lastSummary?.finished) {
    console.error("Daily queue did not finish within the cron run window.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Daily autonomous schedule failed:", error.message);
  process.exitCode = 1;
}
