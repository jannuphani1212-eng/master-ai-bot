const rawBaseUrl = String(process.env.MASTER_AI_BOT_URL || "").trim();
const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
const secret = String(process.env.SCHEDULER_SHARED_SECRET || "").trim();

if (!baseUrl || !secret) {
  console.error("MASTER_AI_BOT_URL and SCHEDULER_SHARED_SECRET are required.");
  process.exit(1);
}

const controller = AbortSignal.timeout(11 * 60 * 60 * 1000);
try {
  const response = await fetch(baseUrl + "/api/internal/daily-run", {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger: "render-cron" }),
    signal: controller
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { response: body.slice(0, 1000) }; }
  if (!response.ok || data.success !== true) {
    console.error("Daily run failed:", response.status, data);
    process.exit(1);
  }
  console.log("Daily run completed:", JSON.stringify(data));
} catch (error) {
  console.error("Could not reach Master AI Bot daily-run endpoint:", error.message);
  process.exit(1);
}
