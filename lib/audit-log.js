import crypto from "node:crypto";

export function createAuditMiddleware({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const hashSecret = String(env.AUDIT_LOG_HASH_SECRET || serviceKey).trim();

  return function auditOwnerRequest(req, res, next) {
    const actorId = req.ownerUser?.id;
    if (!actorId || !supabaseUrl || !serviceKey || !hashSecret) return next();

    const startedAt = now();
    const route = String(req.baseUrl || "") + String(req.path || "/");
    const safeRoute = route.replace(/[\r\n\t]/g, "").slice(0, 240);
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const ipHash = crypto.createHmac("sha256", hashSecret).update(ip).digest("hex");
    const userAgent = String(req.get?.("user-agent") || req.headers?.["user-agent"] || "").slice(0, 300);

    res.once("finish", () => {
      const payload = {
        actor_user_id: actorId,
        event_type: (String(req.method || "GET").toLowerCase() + " " + safeRoute).slice(0, 120),
        http_method: String(req.method || "GET").slice(0, 12),
        route: safeRoute,
        status_code: Number(res.statusCode) || 0,
        duration_ms: Math.max(0, now() - startedAt),
        ip_hash: ipHash,
        user_agent: userAgent
      };
      void fetchImpl(supabaseUrl + "/rest/v1/audit_events", {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(payload)
      }).then(response => {
        if (!response.ok) throw new Error("Audit log insert failed (" + response.status + ").");
      }).catch(error => {
        console.error("Owner audit event could not be saved:", error.message);
      });
    });

    next();
  };
}
