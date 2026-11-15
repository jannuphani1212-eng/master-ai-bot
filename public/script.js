const connectionStatus = document.getElementById("connectionStatus");
const agentList = document.getElementById("agentList");
const systemStatus = document.getElementById("systemStatus");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const agentSelect = document.getElementById("agentSelect");
const taskResult = document.getElementById("taskResult");
const submitButton = document.getElementById("submitButton");
const refreshButton = document.getElementById("refreshButton");
const diagnosticsDialog = document.getElementById("diagnosticsDialog");
const ownerLoginDialog = document.getElementById("ownerLoginDialog");
const ownerSignInButton = document.getElementById("ownerSignInButton");
const toastElement = document.getElementById("toast");
const wakeMessage = document.getElementById("wakeMessage");
const taskFeed = document.getElementById("taskFeed");
const approvalPanel = document.getElementById("approvalPanel");
const youtubePanel = document.getElementById("youtubePanel");
function showToast(message){toastElement.textContent=message;toastElement.classList.add("show");setTimeout(()=>toastElement.classList.remove("show"),2600);}
function setPrivatePanelsVisible(visible){approvalPanel.hidden=!visible;youtubePanel.hidden=!visible;ownerSignInButton.textContent=visible?"Owner workspace":"Owner sign in";}
function addFeedStep(message,done=false){const row=document.createElement("div");row.className="feed-step"+(done?" done":"");const dot=document.createElement("span");dot.className="feed-dot";const label=document.createElement("span");label.textContent=message;row.append(dot,label);taskFeed.appendChild(row);}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text || "";
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

async function loadSystemStatus() {
  connectionStatus.textContent = "● Waking up";
  connectionStatus.className = "status status-checking";
  systemStatus.textContent = "Waking up Master AI Brain…";

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

    connectionStatus.textContent = "● System Online";
    connectionStatus.className = "status";
    wakeMessage.textContent = "Master AI Brain is online. Your specialist team is ready.";
    systemStatus.textContent = [
      data.message || "Backend is running.",
      `Agents available: ${Array.isArray(data.agents) ? data.agents.length : 0}`,
      "Provider order: " + (data.providerOrder || ["Gemini", "Groq", "OpenRouter"]).join(" → "),
      ...providerLines,
      "Approval policy: " + (data.approvalPolicy || "Review outputs before external actions."),
      "Approval database configuration: " + (data.supabaseApprovalStorage?.configured ? "Configured; table access is checked after owner sign-in." : "Missing Supabase environment settings.")
    ].join("\n");

    displayAgents(Array.isArray(data.agents) ? data.agents : []);
  } catch (error) {
    connectionStatus.textContent = "● Waking up";
    connectionStatus.className = "status status-offline";
    wakeMessage.textContent = "The backend is taking longer than usual to wake up. Please wait and retry.";
    systemStatus.textContent = "Backend is not reachable. Check the deployment and try again.";
    agentList.innerHTML = '<article class="agent-card skeleton"><div class="skeleton-line short"></div><div class="skeleton-line"></div><div class="skeleton-pill"></div></article>'.repeat(5);
  }
}

function displayAgents(agents) {
  agentList.replaceChildren();
  const team=[["master","Master AI Brain","Plans, delegates and combines reports.","✦","ORCHESTRATOR"],["youtube","YouTube","Video ideas, channel strategy and growth.","▶","VIDEO"],["app-development","App Development","App architecture and implementation plans.","▣","PRODUCT & CODE"],["affiliate","Affiliate Marketing","Product research and conversion strategy.","↗","REVENUE"],["blogging","Blogging","Articles and editorial planning.","✎","CONTENT"],["seo","SEO","Keywords and search strategy.","⌕","DISCOVERY"]];
  const byId=new Map(agents.map(agent=>[agent.id,agent]));
  team.forEach(([id,name,role,icon,tag])=>{const source=byId.get(id)||{};const card=document.createElement("article");card.className="agent-card"+(id==="master"?" master-agent":"");addText(card,"span",icon,"agent-icon");const body=document.createElement("div");addText(body,"h3",source.name||name);addText(body,"p",source.role||role);addText(body,"span",tag,"agent-role");card.appendChild(body);addText(card,"span","● Configured","agent-state");agentList.appendChild(card);});
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
  submitButton.textContent = "Working…";
  taskResult.textContent = "";
  taskFeed.hidden = false;
  taskFeed.replaceChildren();
  addFeedStep("Master Brain received your goal");
  addFeedStep(agentId==="master"?"Planning and routing to specialists…":"Routing to "+agentSelect.options[agentSelect.selectedIndex].text);
  addFeedStep("Generating proposal with the AI provider…");

  try {
    if (!approvalAccessToken) {
      ownerLoginDialog.showModal();
      throw new Error("Please sign in with your owner account before running a task.");
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

    addFeedStep("Specialist response received. Preparing your report.",true);
    displayTaskResult(data, agentId);
  } catch (error) {
    taskResult.textContent =
      "Task not completed.\n\n" +
      error.message +
      "\n\nOpen Owner sign in to authorize a task, then try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prepare My Task";
  }
});

refreshButton.addEventListener("click", loadSystemStatus);
connectionStatus.addEventListener("click",()=>diagnosticsDialog.showModal());
document.getElementById("closeDiagnosticsDialog").addEventListener("click",()=>diagnosticsDialog.close());
ownerSignInButton.addEventListener("click",()=>{if(approvalAccessToken){approvalPanel.scrollIntoView({behavior:"smooth"});return;}ownerLoginDialog.showModal();});
document.getElementById("closeLoginDialog").addEventListener("click",()=>ownerLoginDialog.close());
document.querySelectorAll(".prompt-chip").forEach(button=>button.addEventListener("click",()=>{taskInput.value=button.dataset.prompt||"";taskInput.focus();}));
loadSystemStatus();


// OWNER APPROVAL CENTER
// Keep only the Supabase refresh token between page loads. A fresh access token
// is requested from Supabase when the dashboard opens; passwords are never stored.
let approvalAccessToken = "";
let approvalRefreshToken = "";
let approvalConfig = null;
const APPROVAL_SESSION_KEY = "masterAiBot.ownerRefreshToken";

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
  const loginFeedback = document.getElementById("loginFeedback");
  if (loginFeedback) {
    loginFeedback.textContent = message;
    loginFeedback.className = isError ? "warning-text" : "muted";
  }
}

async function getApprovalConfig() {
  if (approvalConfig) return approvalConfig;
  const response = await fetch("/api/approvals/config", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Approval configuration is unavailable.");
  approvalConfig = data;
  return approvalConfig;
}

function saveApprovalRefreshToken(token) {
  approvalRefreshToken = token || "";
  try {
    if (approvalRefreshToken) {
      localStorage.setItem(APPROVAL_SESSION_KEY, approvalRefreshToken);
    } else {
      localStorage.removeItem(APPROVAL_SESSION_KEY);
    }
  } catch {
    setApprovalMessage("Browser storage is unavailable. You may need to sign in again after refreshing.", true);
  }
}

function clearApprovalSession() {
  approvalAccessToken = "";
  saveApprovalRefreshToken("");
}

async function refreshApprovalSession() {
  if (!approvalRefreshToken) return false;
  const config = await getApprovalConfig();
  const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.anonKey
    },
    body: JSON.stringify({ refresh_token: approvalRefreshToken })
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.access_token || !session.refresh_token) {
    clearApprovalSession();
    return false;
  }
  approvalAccessToken = session.access_token;
  saveApprovalRefreshToken(session.refresh_token);
  return true;
}

async function restoreApprovalSession() {
  try {
    const storedToken = localStorage.getItem(APPROVAL_SESSION_KEY);
    if (!storedToken) return;
    approvalRefreshToken = storedToken;
    setApprovalMessage("Restoring your secure owner session...");
    const restored = await refreshApprovalSession();
    if (!restored) {
      approvalLoginForm.hidden = false;
      approvalWorkspace.hidden = true;
      setApprovalMessage("Your saved sign-in has expired. Please sign in again.", true);
      return;
    }
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    ownerLoginDialog.close();
    setPrivatePanelsVisible(true);
    setApprovalMessage("Owner session restored. Loading your approval queue...");
    await loadApprovalQueue();
    await loadYoutubeStatus();
  } catch (error) {
    setApprovalMessage("Could not restore your owner session: " + error.message, true);
  }
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
      clearApprovalSession();
      approvalWorkspace.hidden = true;
      approvalLoginForm.hidden = false;
      setPrivatePanelsVisible(false);
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
    addText(card, "p", "Agent: " + (item.payload?.agentName || item.payload?.agent || "Not specified") + " · Action: " + (item.action_type || "other") + " · Status: " + (item.status || "unknown"));
    addText(card, "p", "Estimated cost / impact: " + (item.payload?.estimatedCost ?? item.payload?.estimatedImpact ?? "Not provided"));
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
      approve.textContent = "Approve";
      approve.addEventListener("click", () => decideApproval(item.id, "approved"));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "secondary";
      reject.textContent = "Reject";
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
    showToast(status==="approved"?"Approved for record only — no action executed.":"Proposal rejected.");
    await loadApprovalQueue();
    await loadYoutubeStatus();
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
    saveApprovalRefreshToken(session.refresh_token);
    approvalPassword.value = "";
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    ownerLoginDialog.close();
    setPrivatePanelsVisible(true);
    setApprovalMessage("Signed in. Loading your private approval queue...");
    showToast("Owner session verified.");
    await loadApprovalQueue();
    await loadYoutubeStatus();
  } catch (error) {
    clearApprovalSession();
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
  clearApprovalSession();
  approvalWorkspace.hidden = true;
  approvalLoginForm.hidden = false;
  setPrivatePanelsVisible(false);
  approvalList.textContent = "Sign in to view the owner queue.";
  resetYoutubePanel("Sign in as the owner to check the YouTube connection.");
  setApprovalMessage("Signed out. Your session token has been cleared from this page.");
});

approvalRefreshButton.addEventListener("click", loadApprovalQueue);


// GLOBAL RHYMES 4U YOUTUBE CONNECTION
const youtubeConnectButton = document.getElementById("youtubeConnectButton");
const youtubeRefreshButton = document.getElementById("youtubeRefreshButton");
const youtubeStatus = document.getElementById("youtubeStatus");
const youtubeChannel = document.getElementById("youtubeChannel");
const youtubeVideos = document.getElementById("youtubeVideos");
const youtubeVideosHeading = document.getElementById("youtubeVideosHeading");
const youtubeAnalytics = document.getElementById("youtubeAnalytics");
const youtubeAnalyticsHeading = document.getElementById("youtubeAnalyticsHeading");

function resetYoutubePanel(message) {
  youtubeStatus.textContent = message;
  youtubeChannel.replaceChildren();
  youtubeChannel.hidden = true;
  youtubeVideos.replaceChildren();
  youtubeVideosHeading.hidden = true;
  youtubeAnalytics.replaceChildren();
  youtubeAnalyticsHeading.hidden = true;
}

async function youtubeApi(path) {
  if (!approvalAccessToken) throw new Error("Sign in with the owner account first.");
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Authorization: "Bearer " + approvalAccessToken }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "YouTube request failed.");
  return data;
}

function addYoutubeMetric(parent, label, value) {
  const card = document.createElement("article");
  card.className = "youtube-metric";
  addText(card, "span", label, "muted");
  addText(card, "strong", value);
  parent.appendChild(card);
}

async function loadYoutubeStatus() {
  if (!approvalAccessToken) {
    resetYoutubePanel("Sign in as the owner to check the YouTube connection.");
    return;
  }
  youtubeStatus.textContent = "Checking the Global Rhymes 4U connection...";
  try {
    const data = await youtubeApi("/api/youtube/status");
    if (!data.connected) {
      resetYoutubePanel("YouTube is not connected yet. Use Connect YouTube channel to authorize your dedicated Global Rhymes 4U Google account.");
      return;
    }
    youtubeStatus.textContent = "Connected securely: " + (data.channel?.title || "YouTube channel") + ". Loading channel information...";
    await loadYoutubeData();
  } catch (error) {
    youtubeStatus.textContent = error.message;
  }
}

async function loadYoutubeData() {
  youtubeStatus.textContent = "Loading channel, recent videos and analytics...";
  try {
    const [channelResult, videoResult, analyticsResult] = await Promise.allSettled([
      youtubeApi("/api/youtube/channel"),
      youtubeApi("/api/youtube/videos"),
      youtubeApi("/api/youtube/analytics")
    ]);
    if (channelResult.status !== "fulfilled") throw channelResult.reason;
    const channel = channelResult.value.channel;
    const videoData = videoResult.status === "fulfilled" ? videoResult.value : { videos: [] };
    const analyticsData = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
    youtubeChannel.replaceChildren();
    youtubeChannel.hidden = false;
    if (channel.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = channel.thumbnailUrl;
      image.alt = "YouTube channel thumbnail";
      image.loading = "lazy";
      youtubeChannel.appendChild(image);
    }
    const details = document.createElement("div");
    addText(details, "h3", channel.title);
    addText(details, "p", channel.description || "No channel description is available.", "muted");
    const metrics = document.createElement("div");
    metrics.className = "youtube-metrics";
    addYoutubeMetric(metrics, "Subscribers", channel.subscribers === null ? "Hidden" : Number(channel.subscribers).toLocaleString());
    addYoutubeMetric(metrics, "Channel views", Number(channel.views).toLocaleString());
    addYoutubeMetric(metrics, "Videos", Number(channel.videoCount).toLocaleString());
    details.appendChild(metrics);
    youtubeChannel.appendChild(details);

    youtubeVideos.replaceChildren();
    youtubeVideosHeading.hidden = false;
    if (videoResult.status !== "fulfilled") {
      addText(youtubeVideos, "p", "Recent video data could not be loaded: " + videoResult.reason.message);
    } else if (!videoData.videos?.length) {
      addText(youtubeVideos, "p", "No recent public or accessible videos were returned.");
    } else {
      videoData.videos.forEach(video => {
        const card = document.createElement("article");
        card.className = "youtube-video-card";
        if (video.thumbnailUrl) {
          const image = document.createElement("img");
          image.src = video.thumbnailUrl;
          image.alt = video.title + " thumbnail";
          image.loading = "lazy";
          card.appendChild(image);
        }
        addText(card, "h4", video.title);
        addText(card, "p", new Date(video.publishedAt).toLocaleDateString(), "muted");
        addText(card, "p", Number(video.views).toLocaleString() + " views · " + Number(video.likes).toLocaleString() + " likes");
        const link = document.createElement("a");
        link.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(video.id);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open video";
        card.appendChild(link);
        youtubeVideos.appendChild(card);
      });
    }

    youtubeAnalytics.replaceChildren();
    youtubeAnalyticsHeading.hidden = false;
    if (analyticsData) {
      const headers = (analyticsData.headers || []).map(item => item.name);
      const rows = analyticsData.rows || [];
      const sumMetric = name => {
        const index = headers.indexOf(name);
        return index < 0 ? 0 : rows.reduce((total, row) => total + Number(row[index] || 0), 0);
      };
      addYoutubeMetric(youtubeAnalytics, "Views · 28 days", sumMetric("views").toLocaleString());
      addYoutubeMetric(youtubeAnalytics, "Watch time", Math.round(sumMetric("estimatedMinutesWatched")).toLocaleString() + " minutes");
      addYoutubeMetric(youtubeAnalytics, "Subscribers gained", sumMetric("subscribersGained").toLocaleString());
    } else {
      addText(youtubeAnalytics, "p", "YouTube Analytics is unavailable: " + analyticsResult.reason.message);
    }
    youtubeStatus.textContent = "Global Rhymes 4U is connected. Channel data is live" +
      (analyticsData ? "; analytics cover " + analyticsData.startDate + " to " + analyticsData.endDate + "." : ". Some analytics are unavailable.");
  } catch (error) {
    youtubeStatus.textContent = "Channel connection is active, but some data could not be loaded: " + error.message;
  }
}

youtubeConnectButton.addEventListener("click", async () => {
  youtubeConnectButton.disabled = true;
  youtubeStatus.textContent = "Preparing secure Google authorization...";
  try {
    const data = await youtubeApi("/api/youtube/connect-url");
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    youtubeStatus.textContent = error.message;
    youtubeConnectButton.disabled = false;
  }
});

youtubeRefreshButton.addEventListener("click", loadYoutubeStatus);

const youtubeResult = new URLSearchParams(window.location.search).get("youtube");
if (youtubeResult === "connected") {
  youtubeStatus.textContent = "Google authorization succeeded. Sign in as the owner to load your channel.";
} else if (youtubeResult === "channel-mismatch") {
  youtubeStatus.textContent = "The selected Google account did not return a channel named Global Rhymes 4U. Sign in with the dedicated channel account and try again.";
} else if (youtubeResult === "error") {
  youtubeStatus.textContent = "Google could not complete the connection. Check the Google Cloud OAuth setup and try again.";
}

// Private controls stay hidden until Supabase verifies the owner session.
setPrivatePanelsVisible(false);
approvalMessage.textContent="Sign in to open owner-only approvals and connected accounts.";
restoreApprovalSession();

