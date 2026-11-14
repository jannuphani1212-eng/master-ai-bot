const connectionStatus = document.getElementById("connectionStatus");
const agentList = document.getElementById("agentList");
const systemStatus = document.getElementById("systemStatus");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const agentSelect = document.getElementById("agentSelect");
const taskResult = document.getElementById("taskResult");
const submitButton = document.getElementById("submitButton");
const refreshButton = document.getElementById("refreshButton");

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || "";
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

async function loadSystemStatus() {
  connectionStatus.textContent = "Connecting...";
  systemStatus.textContent = "Checking backend...";

  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Backend status request failed.");

    const data = await response.json();
    const providers = data.providers || {};
    const providerLines = Object.entries(providers).map(([name, info]) => {
      const state = !info.configured
        ? "Not configured"
        : info.coolingDown
          ? `Cooling down (${info.cooldownRemainingSeconds || 0}s)`
          : "Configured";
      return `${name}: ${state}`;
    });

    connectionStatus.textContent = "● Backend connected";
    systemStatus.textContent = [
      data.message || "Backend is running.",
      `Agents available: ${Array.isArray(data.agents) ? data.agents.length : 0}`,
      "Provider order: " + (data.providerOrder || ["Gemini", "Groq", "OpenRouter"]).join(" → "),
      ...providerLines,
      "Approval policy: " + (data.approvalPolicy || "Review outputs before external actions.")
    ].join("\n");

    displayAgents(Array.isArray(data.agents) ? data.agents : []);
  } catch (error) {
    connectionStatus.textContent = "● Offline";
    systemStatus.textContent =
      "Backend is not reachable. Check the deployment and try again.";
    agentList.textContent = "Agent information is unavailable.";
  }
}

function displayAgents(agents) {
  agentList.replaceChildren();
  agents.forEach((agent) => {
    const card = document.createElement("article");
    card.className = "agent-card";
    addText(card, "h3", agent.name);
    addText(card, "p", agent.role);
    agentList.appendChild(card);
  });
}

function displayTaskResult(data, selectedAgent) {
  taskResult.replaceChildren();

  if (data.agent === "master" || selectedAgent === "master") {
    const partial = Boolean(data.partialSuccess);
    addText(
      taskResult,
      "h3",
      partial ? "Master report — partial completion" : "Master report"
    );
    addText(taskResult, "p", `AI provider(s): ${data.provider || "Not reported"}`);
    addText(
      taskResult,
      "p",
      `Specialists: ${data.successfulSpecialists ?? 0}/${data.totalSpecialists ?? 0} completed`
    );

    if (Array.isArray(data.specialistResults)) {
      const heading = addText(taskResult, "h4", "Individual specialist reports");
      heading.className = "result-subheading";

      data.specialistResults.forEach((item) => {
        const card = document.createElement("section");
        card.className = "specialist-result";
        addText(
          card,
          "h4",
          `${item.success ? "✓" : "⚠"} ${item.name || item.agentId}`
        );
        addText(
          card,
          "p",
          "Actual provider: " + (item.provider || (item.success ? "Not reported" : "No successful provider"))
        );
        if (item.qualityReview) {
          addText(
            card,
            "p",
            `Structural quality review: ${item.qualityReview.score}/100 — ${item.qualityReview.status}`,
            item.qualityReview.status === "passed" ? "quality-passed" : "warning-text"
          );
          if (Array.isArray(item.qualityReview.warnings) && item.qualityReview.warnings.length) {
            addText(card, "p", "Quality checks: " + item.qualityReview.warnings.join(" "), "warning-text");
          }
        }
        addText(
          card,
          "p",
          item.success
            ? item.result
            : "Failure reason: " + (item.error || "No error details were returned.")
        );
        taskResult.appendChild(card);
      });
    }

    addText(taskResult, "h4", "Combined Master response");
    addText(taskResult, "p", data.result || "No combined response was returned.");

    if (data.requiresHumanApproval) {
      addText(
        taskResult,
        "p",
        data.approvalNotice || "Review this proposal before taking external action.",
        "approval-notice"
      );
    }
    if (partial) {
      addText(taskResult, "p", "Some specialists failed. Review the individual reports and retry the missing work.", "warning-text");
    }
    return;
  }

  addText(taskResult, "h3", "Specialist response");
  addText(taskResult, "p", `AI provider: ${data.provider || "Not reported"}`);
  if (data.qualityReview) {
    addText(
      taskResult,
      "p",
      `Structural quality review: ${data.qualityReview.score}/100 — ${data.qualityReview.status}`,
      data.qualityReview.status === "passed" ? "quality-passed" : "warning-text"
    );
    if (Array.isArray(data.qualityReview.warnings) && data.qualityReview.warnings.length) {
      addText(taskResult, "p", "Quality checks: " + data.qualityReview.warnings.join(" "), "warning-text");
    }
  }
  addText(taskResult, "p", data.result || "No response was returned.");
  if (data.requiresHumanApproval) {
    addText(
      taskResult,
      "p",
      data.approvalNotice || "Review this draft before taking external action.",
      "approval-notice"
    );
  }
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const task = taskInput.value.trim();
  const agentId = agentSelect.value;
  if (!task) {
    taskResult.textContent = "Please enter a task.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Working...";
  taskResult.textContent = "Sending your task to the AI backend...";

  try {
    if (!approvalAccessToken) {
      throw new Error("Please sign in with the owner account in the Owner Approval Center before submitting AI tasks.");
    }

    const response = await fetch("/api/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + approvalAccessToken
      },
      body: JSON.stringify({ task, agentId })
    });

    const data = await response.json();
    const hasPartialReports =
      Array.isArray(data.specialistResults) && data.specialistResults.length > 0;

    if (!response.ok || (!data.success && !hasPartialReports)) {
      throw new Error(data.error || "The task could not be completed.");
    }

    displayTaskResult(data, agentId);
  } catch (error) {
    taskResult.textContent =
      "Task not completed.\n\n" +
      error.message +
      "\n\nCheck backend status and configured AI providers.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prepare My Task";
  }
});

refreshButton.addEventListener("click", loadSystemStatus);
loadSystemStatus();


// OWNER APPROVAL CENTER
// The access token stays in memory only and is cleared when the page is refreshed.
let approvalAccessToken = "";
let approvalConfig = null;

const approvalLoginForm = document.getElementById("approvalLoginForm");
const approvalEmail = document.getElementById("approvalEmail");
const approvalPassword = document.getElementById("approvalPassword");
const approvalLoginButton = document.getElementById("approvalLoginButton");
const approvalMessage = document.getElementById("approvalMessage");
const approvalWorkspace = document.getElementById("approvalWorkspace");
const approvalCreateForm = document.getElementById("approvalCreateForm");
const approvalTitle = document.getElementById("approvalTitle");
const approvalActionType = document.getElementById("approvalActionType");
const approvalPayload = document.getElementById("approvalPayload");
const approvalList = document.getElementById("approvalList");
const approvalLogoutButton = document.getElementById("approvalLogoutButton");
const approvalRefreshButton = document.getElementById("approvalRefreshButton");

function setApprovalMessage(message, isError = false) {
  approvalMessage.textContent = message;
  approvalMessage.className = isError ? "warning-text" : "muted";
}

async function getApprovalConfig() {
  if (approvalConfig) return approvalConfig;
  const response = await fetch("/api/approvals/config", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Approval configuration is unavailable.");
  approvalConfig = data;
  return approvalConfig;
}

async function approvalApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + approvalAccessToken,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Approval request failed.");
  return data;
}

async function loadApprovalQueue() {
  if (!approvalAccessToken) return;
  approvalList.textContent = "Loading approval queue...";
  try {
    const data = await approvalApi("/api/approvals");
    renderApprovalQueue(Array.isArray(data.approvals) ? data.approvals : []);
    setApprovalMessage("Signed in. Your owner-only approval queue is ready.");
  } catch (error) {
    approvalList.textContent = error.message;
    if (/session|sign-in|authorised/i.test(error.message)) {
      approvalAccessToken = "";
      approvalWorkspace.hidden = true;
      approvalLoginForm.hidden = false;
    }
    setApprovalMessage(error.message, true);
  }
}

function renderApprovalQueue(items) {
  approvalList.replaceChildren();
  if (!items.length) {
    addText(approvalList, "p", "No approval proposals yet.");
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "approval-card";
    addText(card, "h4", item.title || "Untitled proposal");
    addText(card, "p", "Category: " + (item.action_type || "other") + " · Status: " + (item.status || "unknown"));
    addText(card, "p", "Created: " + (item.created_at ? new Date(item.created_at).toLocaleString() : "Not available"));
    const details = document.createElement("pre");
    details.textContent = JSON.stringify(item.payload || {}, null, 2);
    card.appendChild(details);
    if (item.decision_note) addText(card, "p", "Decision note: " + item.decision_note);

    if (item.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "approval-actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "Approve proposal";
      approve.addEventListener("click", () => decideApproval(item.id, "approved"));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "secondary";
      reject.textContent = "Reject proposal";
      reject.addEventListener("click", () => decideApproval(item.id, "rejected"));
      actions.append(approve, reject);
      card.appendChild(actions);
    }
    approvalList.appendChild(card);
  });
}

async function decideApproval(id, status) {
  const label = status === "approved" ? "approve" : "reject";
  if (!window.confirm("Are you sure you want to " + label + " this proposal? This records your decision only; it does not execute the action.")) return;
  try {
    await approvalApi("/api/approvals/" + encodeURIComponent(id) + "/decision", {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setApprovalMessage("Decision recorded. No external action was executed.");
    await loadApprovalQueue();
  } catch (error) {
    setApprovalMessage(error.message, true);
  }
}

approvalLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  approvalLoginButton.disabled = true;
  approvalLoginButton.textContent = "Signing in...";
  setApprovalMessage("Verifying your Supabase owner account...");
  try {
    const config = await getApprovalConfig();
    const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.anonKey
      },
      body: JSON.stringify({
        email: approvalEmail.value.trim(),
        password: approvalPassword.value
      })
    });
    const session = await response.json();
    if (!response.ok || !session.access_token) {
      throw new Error(session.msg || session.message || session.error_description || "Sign-in failed. Check the owner email and password.");
    }
    approvalAccessToken = session.access_token;
    approvalPassword.value = "";
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    setApprovalMessage("Signed in. Loading your private approval queue...");
    await loadApprovalQueue();
  } catch (error) {
    approvalAccessToken = "";
    setApprovalMessage(error.message, true);
  } finally {
    approvalLoginButton.disabled = false;
    approvalLoginButton.textContent = "Sign in securely";
  }
});

approvalCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let payload;
  try {
    payload = JSON.parse(approvalPayload.value || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Details must be a JSON object.");
    }
  } catch (error) {
    setApprovalMessage("Invalid JSON details: " + error.message, true);
    return;
  }

  const button = document.getElementById("approvalCreateButton");
  button.disabled = true;
  try {
    await approvalApi("/api/approvals", {
      method: "POST",
      body: JSON.stringify({
        title: approvalTitle.value.trim(),
        actionType: approvalActionType.value,
        payload
      })
    });
    approvalTitle.value = "";
    approvalPayload.value = "{}";
    setApprovalMessage("Proposal saved. It is waiting for your review.");
    await loadApprovalQueue();
  } catch (error) {
    setApprovalMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

approvalLogoutButton.addEventListener("click", () => {
  approvalAccessToken = "";
  approvalWorkspace.hidden = true;
  approvalLoginForm.hidden = false;
  approvalList.textContent = "Sign in to view the owner queue.";
  setApprovalMessage("Signed out. Your session token has been cleared from this page.");
});

approvalRefreshButton.addEventListener("click", loadApprovalQueue);
