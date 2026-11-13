const ALLOWED_ACTION_TYPES = new Set([
  "publish",
  "send",
  "purchase",
  "spend",
  "delete",
  "account_change",
  "deploy",
  "other"
]);

function jsonResponse(res, status, body) {
  return res.status(status).json(body);
}

function getSupabaseConfig(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  const ownerId = String(env.SUPABASE_OWNER_USER_ID || "").trim();

  if (!url || !anonKey || !ownerId) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch {
    return null;
  }

  return { url, anonKey, ownerId };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createSupabaseApprovalHandlers({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  async function authenticate(req, res) {
    const config = getSupabaseConfig(env);
    if (!config) {
      jsonResponse(res, 503, {
        success: false,
        error: "Supabase approval storage is not configured on the server."
      });
      return null;
    }

    const authorization = req.get
      ? req.get("authorization")
      : req.headers?.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    if (!match) {
      jsonResponse(res, 401, {
        success: false,
        error: "A valid Supabase sign-in session is required."
      });
      return null;
    }

    try {
      const response = await fetchImpl(config.url + "/auth/v1/user", {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: "Bearer " + match[1]
        }
      });
      const user = await readJson(response);

      if (!response.ok || !user?.id) {
        jsonResponse(res, 401, {
          success: false,
          error: "The Supabase sign-in session is invalid or expired."
        });
        return null;
      }

      if (user.id !== config.ownerId) {
        jsonResponse(res, 403, {
          success: false,
          error: "This account is not authorised to manage approvals."
        });
        return null;
      }

      return { config, user };
    } catch {
      jsonResponse(res, 502, {
        success: false,
        error: "Could not verify the Supabase sign-in session."
      });
      return null;
    }
  }

  async function supabaseRequest(config, accessToken, path, options = {}) {
    const response = await fetchImpl(config.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: config.anonKey,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      }
    });
    const data = await readJson(response);
    return { response, data };
  }

  async function list(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;

    try {
      const query = "approval_requests?select=id,title,action_type,payload,status,created_at,decided_at,decision_note&order=created_at.desc&limit=100";
      const { response, data } = await supabaseRequest(
        auth.config,
        req.headers.authorization.replace(/^Bearer\s+/i, ""),
        query
      );
      if (!response.ok) {
        return jsonResponse(res, 502, {
          success: false,
          error: "Could not load approval requests from Supabase."
        });
      }
      return jsonResponse(res, 200, { success: true, approvals: Array.isArray(data) ? data : [] });
    } catch {
      return jsonResponse(res, 502, {
        success: false,
        error: "Could not connect to Supabase approval storage."
      });
    }
  }

  async function create(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const body = req.body || {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const actionType = body.actionType;
    const payload = body.payload === undefined ? {} : body.payload;

    if (!title || title.length > 200) {
      return jsonResponse(res, 400, {
        success: false,
        error: "Title must contain between 1 and 200 characters."
      });
    }
    if (!ALLOWED_ACTION_TYPES.has(actionType)) {
      return jsonResponse(res, 400, {
        success: false,
        error: "Choose a supported approval action type."
      });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse(res, 400, {
        success: false,
        error: "Approval payload must be a JSON object."
      });
    }

    try {
      const accessToken = req.headers.authorization.replace(/^Bearer\s+/i, "");
      const { response, data } = await supabaseRequest(
        auth.config,
        accessToken,
        "approval_requests",
        {
          method: "POST",
          body: JSON.stringify({
            owner_id: auth.user.id,
            title,
            action_type: actionType,
            payload
          })
        }
      );
      if (!response.ok) {
        return jsonResponse(res, 502, {
          success: false,
          error: "Supabase could not save this approval proposal."
        });
      }
      return jsonResponse(res, 201, {
        success: true,
        approval: Array.isArray(data) ? data[0] || null : null,
        message: "Proposal saved for owner review. No external action was executed."
      });
    } catch {
      return jsonResponse(res, 502, {
        success: false,
        error: "Could not connect to Supabase approval storage."
      });
    }
  }

  async function decide(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const id = String(req.params?.id || "");
    const status = req.body?.status;
    const decisionNote = typeof req.body?.decisionNote === "string"
      ? req.body.decisionNote.trim()
      : "";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return jsonResponse(res, 400, { success: false, error: "A valid approval ID is required." });
    }
    if (status !== "approved" && status !== "rejected") {
      return jsonResponse(res, 400, {
        success: false,
        error: "Decision must be approved or rejected."
      });
    }
    if (decisionNote.length > 1000) {
      return jsonResponse(res, 400, {
        success: false,
        error: "Decision note must be 1,000 characters or fewer."
      });
    }

    try {
      const accessToken = req.headers.authorization.replace(/^Bearer\s+/i, "");
      const query = "approval_requests?id=eq." + encodeURIComponent(id) + "&status=eq.pending";
      const { response, data } = await supabaseRequest(
        auth.config,
        accessToken,
        query,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            ...(decisionNote ? { decision_note: decisionNote } : {})
          })
        }
      );
      if (!response.ok) {
        return jsonResponse(res, 502, {
          success: false,
          error: "Supabase could not record this approval decision."
        });
      }
      if (!Array.isArray(data) || data.length === 0) {
        return jsonResponse(res, 409, {
          success: false,
          error: "Approval was not changed. It may not exist or may already be decided."
        });
      }
      return jsonResponse(res, 200, {
        success: true,
        approval: data[0],
        message: "Decision recorded. This does not execute the proposed external action."
      });
    } catch {
      return jsonResponse(res, 502, {
        success: false,
        error: "Could not connect to Supabase approval storage."
      });
    }
  }

  return { list, create, decide };
}
