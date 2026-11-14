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
      body: JSON.stringify({ task, agentId, youtubeChannelId: activeYoutubeChannelId || undefined })
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
    approvalPassword.value = "";
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    setApprovalMessage("Signed in. Loading your private approval queue...");
    await loadApprovalQueue();
    await loadAffiliateCampaigns();
    await loadYoutubeStatus();
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
  resetYoutubePanel("Sign in as the owner to check the YouTube connection.");
  resetAffiliatePanel("Sign in as the owner to view affiliate campaigns.");
  setApprovalMessage("Signed out. Your session token has been cleared from this page.");
});

approvalRefreshButton.addEventListener("click", loadApprovalQueue);


// AFFILIATE VIDEO STUDIO
const affiliateForm = document.getElementById("affiliateForm");
const affiliateProductName = document.getElementById("affiliateProductName");
const affiliateCategory = document.getElementById("affiliateCategory");
const affiliateMerchant = document.getElementById("affiliateMerchant");
const affiliateProductUrl = document.getElementById("affiliateProductUrl");
const affiliateTrackingUrl = document.getElementById("affiliateTrackingUrl");
const affiliateCommissionRate = document.getElementById("affiliateCommissionRate");
const affiliateProductFacts = document.getElementById("affiliateProductFacts");
const affiliateGenerateButton = document.getElementById("affiliateGenerateButton");
const affiliateStatus = document.getElementById("affiliateStatus");
const affiliateResult = document.getElementById("affiliateResult");
const affiliateCampaignList = document.getElementById("affiliateCampaignList");

function resetAffiliatePanel(message) {
  affiliateStatus.textContent = message;
  affiliateResult.textContent = "Your generated campaign package will appear here.";
  affiliateCampaignList.textContent = "Sign in to load saved campaigns.";
}

async function affiliateApi(path, options = {}) {
  if (!approvalAccessToken) throw new Error("Sign in with the owner account first.");
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + approvalAccessToken,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Affiliate request failed.");
  return data;
}

function addAffiliateCampaignCard(campaign) {
  const card = document.createElement("article");
  card.className = "approval-card";
  addText(card, "h4", campaign.product_name + " · " + campaign.category);
  addText(card, "p", "Status: " + campaign.status + " · Research: " + campaign.research_status, "muted");
  addText(card, "p", "Commission: " +
    (campaign.commission_rate === null ? "Not provided" : campaign.commission_rate + "%") +
    " · " + campaign.commission_status, "muted");

  const preview = document.createElement("pre");
  preview.textContent = JSON.stringify(campaign.content_json || {}, null, 2);
  card.appendChild(preview);

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const showClicks = document.createElement("button");
  showClicks.type = "button";
  showClicks.className = "secondary";
  showClicks.textContent = "Refresh click count";
  showClicks.addEventListener("click", async () => {
    showClicks.disabled = true;
    try {
      const result = await affiliateApi("/api/affiliate/campaigns/" + encodeURIComponent(campaign.id) + "/clicks");
      addText(card, "p", "Recorded clicks: " + Number(result.totalClicks || 0).toLocaleString(), "muted");
    } catch (error) {
      addText(card, "p", error.message, "warning-text");
    } finally {
      showClicks.disabled = false;
    }
  });
  actions.appendChild(showClicks);

  if (campaign.status === "draft") {
    if (campaign.affiliate_url) {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "Approve link tracking";
      approve.addEventListener("click", async () => {
        if (!window.confirm("Approve this saved campaign for affiliate click tracking? This will not publish content or spend money.")) return;
        approve.disabled = true;
        try {
          await affiliateApi("/api/affiliate/campaigns/" + encodeURIComponent(campaign.id) + "/approve", { method: "POST", body: "{}" });
          await loadAffiliateCampaigns();
          affiliateStatus.textContent = "Campaign approved for link tracking only. No content was published.";
        } catch (error) {
          affiliateStatus.textContent = error.message;
          approve.disabled = false;
        }
      });
      actions.appendChild(approve);
    } else {
      addText(card, "p", "Add an approved affiliate link before enabling click tracking.", "warning-text");
    }
  } else if (campaign.affiliate_url && ["approved", "published"].includes(campaign.status)) {
    for (const source of ["youtube_shorts", "instagram_reels"]) {
      const link = document.createElement("a");
      link.href = "/r/" + encodeURIComponent(campaign.id) + "?src=" + source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source === "youtube_shorts" ? "Tracked YouTube Shorts link" : "Tracked Instagram Reels link";
      actions.appendChild(link);
    }
  }
  card.appendChild(actions);
  affiliateCampaignList.appendChild(card);
}

async function loadAffiliateCampaigns() {
  if (!approvalAccessToken) {
    resetAffiliatePanel("Sign in as the owner to create and view affiliate campaigns.");
    return;
  }
  affiliateStatus.textContent = "Loading your saved affiliate campaigns...";
  try {
    const data = await affiliateApi("/api/affiliate/campaigns");
    affiliateCampaignList.replaceChildren();
    const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    if (!campaigns.length) {
      affiliateCampaignList.textContent = "No campaigns saved yet. Add a product above to generate your first bilingual video package.";
    } else {
      campaigns.forEach(addAffiliateCampaignCard);
    }
    affiliateStatus.textContent = campaigns.length + " saved affiliate campaign(s). Drafts remain unpublished until you review them.";
  } catch (error) {
    affiliateStatus.textContent = error.message;
  }
}

affiliateForm.addEventListener("submit", async event => {
  event.preventDefault();
  affiliateGenerateButton.disabled = true;
  affiliateGenerateButton.textContent = "Generating drafts...";
  affiliateStatus.textContent = "Creating English and Telugu Shorts/Reels packages...";
  affiliateResult.textContent = "Please wait while the AI prepares your draft.";
  try {
    const payload = {
      productName: affiliateProductName.value.trim(),
      category: affiliateCategory.value,
      merchant: affiliateMerchant.value.trim(),
      productUrl: affiliateProductUrl.value.trim(),
      affiliateUrl: affiliateTrackingUrl.value.trim(),
      commissionRate: affiliateCommissionRate.value.trim(),
      productFacts: affiliateProductFacts.value.trim()
    };
    const data = await affiliateApi("/api/affiliate/campaigns", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    affiliateResult.textContent = JSON.stringify(data.campaign?.content_json || {}, null, 2);
    affiliateStatus.textContent = "Campaign saved as a draft. Product claims, prices and commission still need official verification.";
    await loadAffiliateCampaigns();
  } catch (error) {
    affiliateStatus.textContent = error.message;
    affiliateResult.textContent = "The campaign was not saved.";
  } finally {
    affiliateGenerateButton.disabled = false;
    affiliateGenerateButton.textContent = "Generate Telugu + English video drafts";
  }
});


// GLOBAL RHYMES 4U YOUTUBE CONNECTION
const youtubeConnectButton = document.getElementById("youtubeConnectButton");
const youtubeRefreshButton = document.getElementById("youtubeRefreshButton");
const youtubeChannelSelect = document.getElementById("youtubeChannelSelect");
let activeYoutubeChannelId = "";
const youtubeStatus = document.getElementById("youtubeStatus");
const youtubeChannel = document.getElementById("youtubeChannel");
const youtubeVideos = document.getElementById("youtubeVideos");
const youtubeVideosHeading = document.getElementById("youtubeVideosHeading");
const youtubeAnalytics = document.getElementById("youtubeAnalytics");
const youtubeAnalyticsHeading = document.getElementById("youtubeAnalyticsHeading");

function resetYoutubePanel(message) {
  youtubeStatus.textContent = message;
  activeYoutubeChannelId = "";
  youtubeChannelSelect.replaceChildren();
  youtubeChannelSelect.hidden = true;
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
    resetYoutubePanel("Sign in as the owner to check connected YouTube channels.");
    return;
  }
  const previousChannelId = activeYoutubeChannelId;
  youtubeStatus.textContent = "Checking connected YouTube channels...";
  try {
    const data = await youtubeApi("/api/youtube/status");
    const channels = Array.isArray(data.channels) ? data.channels : [];
    if (!channels.length) {
      resetYoutubePanel("No YouTube channels are connected yet. Use Connect another YouTube account and authorize the channel owner account.");
      return;
    }
    youtubeChannelSelect.replaceChildren();
    channels.forEach(channel => {
      const option = document.createElement("option");
      option.value = channel.id;
      option.textContent = channel.title || channel.id;
      youtubeChannelSelect.appendChild(option);
    });
    activeYoutubeChannelId = channels.some(channel => channel.id === previousChannelId)
      ? previousChannelId
      : channels[0].id;
    youtubeChannelSelect.value = activeYoutubeChannelId;
    youtubeChannelSelect.hidden = false;
    youtubeStatus.textContent = channels.length + " YouTube channel connection(s) found. Loading the selected channel...";
    await loadYoutubeData();
  } catch (error) {
    youtubeStatus.textContent = error.message;
  }
}

async function loadYoutubeData() {
  youtubeStatus.textContent = "Loading channel, recent videos and analytics...";
  try {
    const channelQuery = activeYoutubeChannelId
      ? "?channelId=" + encodeURIComponent(activeYoutubeChannelId)
      : "";
    const [channelResult, videoResult, analyticsResult] = await Promise.allSettled([
      youtubeApi("/api/youtube/channel" + channelQuery),
      youtubeApi("/api/youtube/videos" + channelQuery),
      youtubeApi("/api/youtube/analytics" + channelQuery)
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
    youtubeStatus.textContent = channel.title + " is connected. Channel data is live" +
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
youtubeChannelSelect.addEventListener("change", () => {
  activeYoutubeChannelId = youtubeChannelSelect.value;
  loadYoutubeData();
});

const youtubeResult = new URLSearchParams(window.location.search).get("youtube");
if (youtubeResult === "connected") {
  youtubeStatus.textContent = "Google authorization succeeded. Sign in as the owner to load your channel.";
} else if (youtubeResult === "no-channel") {
  youtubeStatus.textContent = "Google authorization succeeded, but no YouTube channel was returned. Confirm that this Google account owns or manages a YouTube channel and try again.";
} else if (youtubeResult === "error") {
  youtubeStatus.textContent = "Google could not complete the connection. Check the Google Cloud OAuth setup and try again.";
}
