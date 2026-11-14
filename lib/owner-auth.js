export function createOwnerAuthMiddleware({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  return async function requireOwner(req, res, next) {
    const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
    const ownerId = String(env.SUPABASE_OWNER_USER_ID || "").trim();

    if (!supabaseUrl || !anonKey || !ownerId) {
      return res.status(503).json({
        success: false,
        error: "Owner authentication is not configured. Contact the site owner."
      });
    }

    const authorization = req.get
      ? req.get("authorization")
      : req.headers?.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Please sign in with the owner account before submitting AI tasks."
      });
    }

    try {
      const response = await fetchImpl(supabaseUrl + "/auth/v1/user", {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: "Bearer " + match[1]
        }
      });
      const user = await response.json().catch(() => null);

      if (!response.ok || !user?.id) {
        return res.status(401).json({
          success: false,
          error: "Your owner sign-in session is invalid or expired. Please sign in again."
        });
      }

      if (user.id !== ownerId) {
        return res.status(403).json({
          success: false,
          error: "This account is not authorised to use the AI task service."
        });
      }

      req.ownerUser = { id: user.id };
      return next();
    } catch {
      return res.status(502).json({
        success: false,
        error: "Could not verify your owner sign-in. Please try again."
      });
    }
  };
}
