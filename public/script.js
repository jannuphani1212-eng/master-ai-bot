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
    await loadCommissionData();
    await loadInstagramStatus();
    await loadInstagramPublishRequests();
    await loadSearchConsoleSites();
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
  resetCommissionPanel("Sign in as the owner to import commission reports.");
  resetInstagramPanel("Sign in as the owner to connect an Instagram professional account.");
  resetInstagramPublishPanel("Sign in as the owner to manage Reel publishing requests.");
  resetSearchConsolePanel("Sign in as the owner to connect Google Search Console.");
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


// AFFILIATE COMMISSION REPORTS
const commissionImportForm = document.getElementById("commissionImportForm");
const commissionProgram = document.getElementById("commissionProgram");
const commissionSourceReference = document.getElementById("commissionSourceReference");
const commissionCsv = document.getElementById("commissionCsv");
const commissionImportButton = document.getElementById("commissionImportButton");
const commissionStatus = document.getElementById("commissionStatus");
const commissionSummary = document.getElementById("commissionSummary");
const commissionEntries = document.getElementById("commissionEntries");

function resetCommissionPanel(message) {
  commissionStatus.textContent = message;
  commissionSummary.textContent = "No verified commission totals loaded.";
  commissionEntries.textContent = "Sign in to load imported commission entries.";
}

async function loadCommissionData() {
  if (!approvalAccessToken) {
    resetCommissionPanel("Sign in as the owner to import commission reports.");
    return;
  }
  commissionStatus.textContent = "Loading commission entries...";
  try {
    const data = await affiliateApi("/api/affiliate/commissions");
    commissionSummary.replaceChildren();
    const summaries = Array.isArray(data.summary) ? data.summary : [];
    if (!summaries.length) {
      commissionSummary.textContent = "No owner-verified commission totals yet.";
    } else {
      summaries.forEach(item => {
        const card = document.createElement("article");
        card.className = "approval-card";
        addText(card, "h4", "Verified commission totals · " + item.currency);
        addText(card, "p", "Pending: " + Number(item.pending).toFixed(2) +
          " · Approved: " + Number(item.approved).toFixed(2) +
          " · Paid: " + Number(item.paid).toFixed(2), "muted");
        addText(card, "p", "Verified total: " + Number(item.verifiedTotal).toFixed(2) + " " + item.currency);
        commissionSummary.appendChild(card);
      });
    }

    commissionEntries.replaceChildren();
    const entries = Array.isArray(data.commissions) ? data.commissions : [];
    if (!entries.length) {
      commissionEntries.textContent = "No commission rows imported yet.";
    } else {
      entries.forEach(entry => {
        const card = document.createElement("article");
        card.className = "approval-card";
        addText(card, "h4", entry.program + " · " + entry.external_order_id);
        addText(card, "p", Number(entry.commission_amount).toFixed(2) + " " + entry.currency +
          " · " + entry.status + " · " + entry.report_date, "muted");
        addText(card, "p", "Source: " + entry.source_reference + " · " + entry.verification_status, "muted");
        if (entry.verification_status !== "owner_verified") {
          const verify = document.createElement("button");
          verify.type = "button";
          verify.textContent = "Confirm against official report";
          verify.addEventListener("click", async () => {
            if (!window.confirm("Have you checked this exact order and commission amount against the official affiliate report?")) return;
            verify.disabled = true;
            try {
              await affiliateApi("/api/affiliate/commissions/" + encodeURIComponent(entry.id) + "/verify", {
                method: "POST",
                body: "{}"
              });
              await loadCommissionData();
              commissionStatus.textContent = "Commission entry confirmed by the owner. Only confirmed rows contribute to totals.";
            } catch (error) {
              commissionStatus.textContent = error.message;
              verify.disabled = false;
            }
          });
          card.appendChild(verify);
        }
        commissionEntries.appendChild(card);
      });
    }
    commissionStatus.textContent = entries.length + " commission row(s) loaded; " +
      Number(data.needsReview || 0) + " still need owner review.";
  } catch (error) {
    commissionStatus.textContent = error.message;
  }
}

commissionImportForm.addEventListener("submit", async event => {
  event.preventDefault();
  commissionImportButton.disabled = true;
  commissionImportButton.textContent = "Importing...";
  commissionStatus.textContent = "Validating and importing the official report...";
  try {
    const result = await affiliateApi("/api/affiliate/commissions/import", {
      method: "POST",
      body: JSON.stringify({
        program: commissionProgram.value.trim(),
        sourceReference: commissionSourceReference.value.trim(),
        csvText: commissionCsv.value
      })
    });
    commissionStatus.textContent = result.importedCount + " row(s) imported. Review each row before confirming it.";
    commissionCsv.value = "";
    await loadCommissionData();
  } catch (error) {
    commissionStatus.textContent = error.message;
  } finally {
    commissionImportButton.disabled = false;
    commissionImportButton.textContent = "Import official report";
  }
});


// INSTAGRAM PROFESSIONAL ACCOUNT CONNECTION
const instagramConnectButton = document.getElementById("instagramConnectButton");
const instagramRefreshButton = document.getElementById("instagramRefreshButton");
const instagramStatus = document.getElementById("instagramStatus");
const instagramAccounts = document.getElementById("instagramAccounts");
const instagramPublishAccount = document.getElementById("instagramPublishAccount");
const instagramReelForm = document.getElementById("instagramReelForm");
const instagramReelVideoUrl = document.getElementById("instagramReelVideoUrl");
const instagramReelCaption = document.getElementById("instagramReelCaption");
const instagramShareToFeed = document.getElementById("instagramShareToFeed");
const instagramAffiliateDisclosureConfirmed = document.getElementById("instagramAffiliateDisclosureConfirmed");
const instagramMediaRightsConfirmed = document.getElementById("instagramMediaRightsConfirmed");
const instagramRequestApprovalButton = document.getElementById("instagramRequestApprovalButton");
const instagramPublishStatus = document.getElementById("instagramPublishStatus");
const instagramPublishRefreshButton = document.getElementById("instagramPublishRefreshButton");
const instagramPublishRequests = document.getElementById("instagramPublishRequests");

function resetInstagramPanel(message) {
  instagramStatus.textContent = message;
  instagramAccounts.textContent = "No Instagram account loaded.";
  instagramPublishAccount.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Connect an Instagram professional account first";
  instagramPublishAccount.appendChild(option);
}

async function instagramApi(path, options = {}) {
  if (!approvalAccessToken) throw new Error("Sign in with the owner account first.");
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + approvalAccessToken,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Instagram request failed.");
  return data;
}

async function loadInstagramStatus() {
  if (!approvalAccessToken) {
    resetInstagramPanel("Sign in as the owner to connect an Instagram professional account.");
    return;
  }
  instagramStatus.textContent = "Checking Instagram account connections...";
  try {
    const data = await instagramApi("/api/instagram/status");
    instagramAccounts.replaceChildren();
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    instagramPublishAccount.replaceChildren();
    if (!accounts.length) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Connect an Instagram professional account first";
      instagramPublishAccount.appendChild(emptyOption);
      instagramAccounts.textContent = "No Instagram account connected yet. Connect the separate affiliate Business or Creator account.";
      instagramStatus.textContent = "Instagram is not connected.";
      return;
    }
    accounts.filter(account => !account.reconnectRequired &&
      ["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(String(account.accountType || "").toUpperCase())
    ).forEach(account => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = (account.username ? "@" + account.username : account.id) + " · " + account.accountType;
      instagramPublishAccount.appendChild(option);
    });
    if (!instagramPublishAccount.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No active professional account";
      instagramPublishAccount.appendChild(option);
    }
    accounts.forEach(account => {
      const card = document.createElement("article");
      card.className = "approval-card";
      addText(card, "h4", account.username ? "@" + account.username : "Instagram account");
      addText(card, "p", "Account type: " + (account.accountType || "Unknown"), "muted");
      addText(card, "p", account.reconnectRequired
        ? "Reconnect required to refresh this account's access."
        : "Token expiry: " + new Date(account.expiresAt).toLocaleString(), "muted");
      instagramAccounts.appendChild(card);
    });
    instagramStatus.textContent = accounts.length + " Instagram account connection(s) found. Reels publishing remains disabled until the publishing workflow is separately approved and tested.";
  } catch (error) {
    instagramStatus.textContent = error.message;
  }
}

instagramConnectButton.addEventListener("click", async () => {
  instagramConnectButton.disabled = true;
  instagramStatus.textContent = "Preparing Instagram Business Login...";
  try {
    const data = await instagramApi("/api/instagram/connect-url");
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    instagramStatus.textContent = error.message;
    instagramConnectButton.disabled = false;
  }
});
instagramRefreshButton.addEventListener("click", loadInstagramStatus);

function resetInstagramPublishPanel(message) {
  instagramPublishStatus.textContent = message;
  instagramPublishRequests.textContent = "No publishing requests loaded.";
}

async function loadInstagramPublishRequests() {
  if (!approvalAccessToken) {
    resetInstagramPublishPanel("Sign in as the owner to manage Reel publishing requests.");
    return;
  }
  instagramPublishStatus.textContent = "Loading Reel approval requests...";
  try {
    const data = await instagramApi("/api/instagram/publish-requests");
    instagramPublishRequests.replaceChildren();
    const requests = Array.isArray(data.requests) ? data.requests : [];
    if (!requests.length) {
      instagramPublishRequests.textContent = "No Instagram Reel publishing requests yet.";
    }
    requests.forEach(request => {
      const card = document.createElement("article");
      card.className = "approval-card";
      addText(card, "h4", request.title || "Instagram Reel publishing request");
      addText(card, "p", "Approval: " + request.status, "muted");
      const job = request.publishJob;
      if (request.status !== "approved") {
        addText(card, "p", "This exact video URL and caption must be approved in the Owner Approval Center before preparation.", "muted");
      } else if (!job) {
        const prepare = document.createElement("button");
        prepare.type = "button";
        prepare.textContent = "Prepare approved Reel";
        prepare.addEventListener("click", async () => {
          prepare.disabled = true;
          try {
            await instagramApi("/api/instagram/publish-requests/" + encodeURIComponent(request.id) + "/prepare", { method: "POST", body: "{}" });
            await loadInstagramPublishRequests();
          } catch (error) {
            instagramPublishStatus.textContent = error.message;
            prepare.disabled = false;
          }
        });
        card.appendChild(prepare);
      } else {
        addText(card, "p", "Publishing status: " + job.status, "muted");
        if (job.status === "processing") {
          const check = document.createElement("button");
          check.type = "button";
          check.textContent = "Check Instagram processing";
          check.addEventListener("click", async () => {
            check.disabled = true;
            try {
              await instagramApi("/api/instagram/publish-requests/" + encodeURIComponent(request.id) + "/status");
              await loadInstagramPublishRequests();
            } catch (error) {
              instagramPublishStatus.textContent = error.message;
              check.disabled = false;
            }
          });
          card.appendChild(check);
        } else if (job.status === "ready") {
          const publish = document.createElement("button");
          publish.type = "button";
          publish.textContent = "Publish approved Reel now";
          publish.addEventListener("click", async () => {
            if (!window.confirm("Publish this exact owner-approved video and caption publicly to Instagram now?")) return;
            publish.disabled = true;
            try {
              await instagramApi("/api/instagram/publish-requests/" + encodeURIComponent(request.id) + "/publish", { method: "POST", body: "{}" });
              await loadInstagramPublishRequests();
              instagramPublishStatus.textContent = "Instagram accepted the Reel publishing request.";
            } catch (error) {
              instagramPublishStatus.textContent = error.message;
              publish.disabled = false;
            }
          });
          card.appendChild(publish);
        } else if (job.status === "published") {
          addText(card, "p", "Published media ID: " + job.media_id, "muted");
          if (job.published_at) addText(card, "p", "Published at: " + new Date(job.published_at).toLocaleString(), "muted");
        } else if (job.status === "publish_unknown") {
          addText(card, "p", "The final API result could not be confirmed. Check Instagram manually before taking any further action.", "warning-text");
        } else if (job.error_message) {
          addText(card, "p", job.error_message, "warning-text");
        }
      }
      instagramPublishRequests.appendChild(card);
    });
    instagramPublishStatus.textContent = requests.length + " Instagram Reel request(s) loaded. Publishing requires approval and a separate publish click.";
  } catch (error) {
    instagramPublishStatus.textContent = error.message;
  }
}

instagramReelForm.addEventListener("submit", async event => {
  event.preventDefault();
  instagramRequestApprovalButton.disabled = true;
  instagramRequestApprovalButton.textContent = "Creating approval request...";
  try {
    const result = await instagramApi("/api/instagram/publish-requests", {
      method: "POST",
      body: JSON.stringify({
        igUserId: instagramPublishAccount.value,
        videoUrl: instagramReelVideoUrl.value.trim(),
        caption: instagramReelCaption.value.trim(),
        shareToFeed: instagramShareToFeed.checked,
        affiliateDisclosureConfirmed: instagramAffiliateDisclosureConfirmed.checked,
        mediaRightsConfirmed: instagramMediaRightsConfirmed.checked
      })
    });
    instagramReelForm.reset();
    instagramPublishStatus.textContent = "Approval request created. No video has been published.";
    await loadInstagramPublishRequests();
  } catch (error) {
    instagramPublishStatus.textContent = error.message;
  } finally {
    instagramRequestApprovalButton.disabled = false;
    instagramRequestApprovalButton.textContent = "Request owner approval";
  }
});
instagramPublishRefreshButton.addEventListener("click", loadInstagramPublishRequests);

const instagramResult = new URLSearchParams(window.location.search).get("instagram");
if (instagramResult === "connected") {
  instagramStatus.textContent = "Instagram authorization succeeded. Sign in as the owner to load the connected account.";
} else if (instagramResult === "professional-required") {
  instagramStatus.textContent = "This Instagram account is personal. Switch it to a Business or Creator professional account, then connect again.";
} else if (instagramResult === "error") {
  instagramStatus.textContent = "Instagram could not complete authorization. Check the Meta app settings, redirect URI and permissions.";
}


// GOOGLE SEARCH CONSOLE — READ-ONLY SEO REPORTS
const searchConsoleConnectButton = document.getElementById("searchConsoleConnectButton");
const searchConsoleRefreshButton = document.getElementById("searchConsoleRefreshButton");
const searchConsoleStatus = document.getElementById("searchConsoleStatus");
const searchConsoleSiteSelect = document.getElementById("searchConsoleSite");
const searchConsoleQueryForm = document.getElementById("searchConsoleQueryForm");
const searchConsoleStartDate = document.getElementById("searchConsoleStartDate");
const searchConsoleEndDate = document.getElementById("searchConsoleEndDate");
const searchConsoleDimension = document.getElementById("searchConsoleDimension");
const searchConsoleRowLimit = document.getElementById("searchConsoleRowLimit");
const searchConsoleQueryButton = document.getElementById("searchConsoleQueryButton");
const searchConsoleReport = document.getElementById("searchConsoleReport");

function resetSearchConsolePanel(message) {
  searchConsoleStatus.textContent = message;
  searchConsoleSiteSelect.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Connect Google Search Console first";
  searchConsoleSiteSelect.appendChild(option);
  searchConsoleReport.textContent = "Connect Search Console and choose a property to view its search performance.";
}

async function searchConsoleApi(path, options = {}) {
  if (!approvalAccessToken) throw new Error("Sign in with the owner account first.");
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + approvalAccessToken,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Search Console request failed.");
  return data;
}

async function loadSearchConsoleSites() {
  if (!approvalAccessToken) {
    resetSearchConsolePanel("Sign in as the owner to connect Google Search Console.");
    return;
  }
  searchConsoleStatus.textContent = "Loading Search Console accounts and properties...";
  try {
    const data = await searchConsoleApi("/api/seo/search-console/sites");
    searchConsoleSiteSelect.replaceChildren();
    let optionCount = 0;
    (data.accounts || []).forEach(account => {
      (account.sites || []).forEach(site => {
        if (!site.siteUrl || site.permissionLevel === "siteUnverifiedUser") return;
        const option = document.createElement("option");
        option.value = String(optionCount++);
        option.dataset.siteUrl = site.siteUrl;
        option.dataset.googleEmail = account.googleEmail;
        option.textContent = site.siteUrl + " · " + account.googleEmail;
        searchConsoleSiteSelect.appendChild(option);
      });
    });
    if (!optionCount) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No accessible Search Console properties found";
      searchConsoleSiteSelect.appendChild(option);
      const needsReconnect = (data.accounts || []).some(account => account.reconnectRequired);
      searchConsoleStatus.textContent = needsReconnect
        ? "A Google connection needs reconnecting. Reconnect the account and refresh."
        : "Google account connected, but no readable Search Console properties were returned.";
      return;
    }
    searchConsoleStatus.textContent = optionCount + " accessible Search Console property/properties found. Reports are read-only and use finalized data.";
  } catch (error) {
    searchConsoleStatus.textContent = error.message;
  }
}

searchConsoleConnectButton.addEventListener("click", async () => {
  searchConsoleConnectButton.disabled = true;
  searchConsoleStatus.textContent = "Preparing Google Search Console authorization...";
  try {
    const data = await searchConsoleApi("/api/seo/search-console/connect-url");
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    searchConsoleStatus.textContent = error.message;
    searchConsoleConnectButton.disabled = false;
  }
});
searchConsoleRefreshButton.addEventListener("click", loadSearchConsoleSites);

searchConsoleQueryForm.addEventListener("submit", async event => {
  event.preventDefault();
  const selected = searchConsoleSiteSelect.selectedOptions[0];
  if (!selected?.dataset.siteUrl || !selected.dataset.googleEmail) {
    searchConsoleStatus.textContent = "Choose an accessible Search Console property first.";
    return;
  }
  searchConsoleQueryButton.disabled = true;
  searchConsoleQueryButton.textContent = "Loading report...";
  searchConsoleReport.textContent = "Querying finalized Search Console data...";
  try {
    const data = await searchConsoleApi("/api/seo/search-console/query", {
      method: "POST",
      body: JSON.stringify({
        siteUrl: selected.dataset.siteUrl,
        googleEmail: selected.dataset.googleEmail,
        startDate: searchConsoleStartDate.value,
        endDate: searchConsoleEndDate.value,
        dimension: searchConsoleDimension.value,
        rowLimit: Number(searchConsoleRowLimit.value)
      })
    });
    searchConsoleReport.replaceChildren();
    addText(searchConsoleReport, "p", data.siteUrl + " · " + data.startDate + " to " + data.endDate, "muted");
    addText(searchConsoleReport, "p", "Google Search Console rows are limited to the top results and may not include every query or page.", "muted");
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
      addText(searchConsoleReport, "p", "No Search Console rows were returned for this date range and dimension.", "muted");
    } else {
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headerRow = document.createElement("tr");
      [data.dimension, "Clicks", "Impressions", "CTR", "Average position"].forEach(label => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      });
      head.appendChild(headerRow);
      table.appendChild(head);
      const body = document.createElement("tbody");
      rows.forEach(row => {
        const tr = document.createElement("tr");
        const values = [
          Array.isArray(row.keys) ? row.keys.join(" · ") : "",
          Number(row.clicks || 0).toLocaleString(),
          Number(row.impressions || 0).toLocaleString(),
          (Number(row.ctr || 0) * 100).toFixed(2) + "%",
          Number(row.position || 0).toFixed(2)
        ];
        values.forEach(value => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      searchConsoleReport.appendChild(table);
    }
    searchConsoleStatus.textContent = rows.length + " Search Console row(s) returned. These are actual Google Search Console values, not forecasts.";
  } catch (error) {
    searchConsoleStatus.textContent = error.message;
    searchConsoleReport.textContent = "The report could not be loaded.";
  } finally {
    searchConsoleQueryButton.disabled = false;
    searchConsoleQueryButton.textContent = "Run SEO performance report";
  }
});

const searchConsoleResult = new URLSearchParams(window.location.search).get("searchConsole");
if (searchConsoleResult === "connected") {
  searchConsoleStatus.textContent = "Google authorization succeeded. Sign in as the owner to load your Search Console properties.";
} else if (searchConsoleResult === "reauthorize") {
  searchConsoleStatus.textContent = "Google did not return a refresh token. Reconnect and approve offline access.";
} else if (searchConsoleResult === "error") {
  searchConsoleStatus.textContent = "Search Console authorization failed. Check the Google API project, OAuth redirect URI and Search Console API access.";
}

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
