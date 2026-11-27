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
const blogPanel = document.getElementById("blogPanel");
const instagramPanel = document.getElementById("instagramPanel");
const incomeCentre = document.getElementById("incomeCentre");
const incomeCentreNav = document.getElementById("incomeCentreNav");
function showToast(message){toastElement.textContent=message;toastElement.classList.add("show");setTimeout(()=>toastElement.classList.remove("show"),2600);}
function updateTaskAuthStatus(){const label=document.getElementById("taskAuthStatus");if(!label)return;const signedIn=Boolean(approvalAccessToken);label.textContent=signedIn?"Owner signed in · Tasks enabled":"Owner sign-in required to run tasks";label.classList.toggle("auth-ready",signedIn);}
function setPrivatePanelsVisible(visible){approvalPanel.hidden=!visible;youtubePanel.hidden=!visible;blogPanel.hidden=!visible;instagramPanel.hidden=!visible;incomeCentre.hidden=!visible;incomeCentreNav.hidden=!visible;incomeCentre.setAttribute("aria-hidden",String(!visible));incomeCentreNav.setAttribute("aria-hidden",String(!visible));ownerSignInButton.textContent=visible?"Owner workspace":"Owner sign in";updateTaskAuthStatus();if(visible){void refreshAgnesVideoGate();void loadBlogCmsConnections();void loadInstagramConnection();}}
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
    latestStatusData = data;
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
      "Provider order: " + (data.providerOrder || ["Groq", "OpenRouter", "Gemini"]).join(" → "),
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

const agentProfiles = {
  master: {name:"Master AI Brain",role:"Coordinates all five specialists, compares results and identifies gaps.",icon:"✦",tag:"ORCHESTRATOR",capabilities:["Breaks a goal into specialist tasks","Routes work and combines specialist reports","Compares results, flags missing evidence and failures","Creates safe repair proposals for owner review"],assets:["Five specialist agents are registered in the backend.","Provider order: Groq → OpenRouter → Gemini."],recommendations:["Use the Master Brain for goals requiring multiple disciplines.","Review each specialist report and its evidence warnings before acting."]},
  youtube: {name:"YouTube",role:"Plans channel strategy, video ideas, scripts, packaging and audience growth.",icon:"▶",tag:"VIDEO",capabilities:["Create original video ideas, scripts and storyboards","Plan titles, descriptions, thumbnails and publishing calendars","Review connected channel statistics and recent uploads","Flag copyright, Made for Kids and monetization checks for verification"],assets:["Planned channel: Global Rhymes 4U (@GlobalRhymes4u). Live connection status is checked from Google OAuth."],recommendations:["Connect the dedicated Global Rhymes 4U Google account to display real subscribers, views, uploads and analytics.","Start with a short, focused video task if a long report times out."]},
  affiliate: {name:"Affiliate Marketing",role:"Plans ethical product research, campaigns, content and conversion tracking.",icon:"↗",tag:"REVENUE",capabilities:["Compare affiliate programs and product opportunities","Draft product reviews, Shorts and promotional content","Plan disclosures and campaign tracking","Separate verified commission terms from assumptions"],assets:["No affiliate program or campaign connection is currently verified by the app."],recommendations:["Connect or record each affiliate program only after its account is actually authorized.","Verify current commission rates, cookie windows and program rules from official sources."]},
  blogging: {name:"Blogging",role:"Builds editorial plans, sourced articles and private drafts for connected sites.",icon:"✎",tag:"CONTENT",capabilities:["Research reader intent and article topics","Create outlines, drafts, FAQs and editorial calendars","Prepare internal-link and update recommendations","Track private drafts and publishing work in the task history"],assets:["Connected Blogger / WordPress sites and private drafts load from your owner portfolio.","Remote publishing remains owner-approval-only."],recommendations:["Check the live portfolio below for the connected site and saved drafts.","A saved internal article or private draft is not a published post; verify remote status before claiming publication."]},
  "app-development": {name:"App Development",role:"Plans, builds and troubleshoots application projects.",icon:"▣",tag:"PRODUCT & CODE",capabilities:["Turn ideas into app requirements and user flows","Generate implementation plans and code drafts","Review bugs, tests, architecture and release readiness","Explain Android-first steps in beginner-friendly language"],assets:["No app repository, build pipeline or Play Store connection is currently verified by the app."],recommendations:["Register each app project or repository before showing it as a connected asset.","Keep builds and releases owner-approved."]},
  seo: {name:"SEO",role:"Improves discoverability through research, audits and content optimisation.",icon:"⌕",tag:"DISCOVERY",capabilities:["Build keyword clusters and search-intent maps","Prepare technical and on-page SEO audits","Create content briefs and internal-link plans","Use connected Blogger / WordPress content for on-page recommendations","Interpret Search Console data when connected"],assets:["Connected blog sites and saved drafts are loaded from your owner portfolio.","Search Console metrics remain unavailable until a property is connected."],recommendations:["SEO research and on-page improvements can proceed using connected blog content without Search Console.","Never claim keyword rankings, clicks, impressions or positions unless measured data is connected."]}
};
const specialistDashboardProfiles = {
  master: {title:"Command overview",summary:"Coordinate the five specialist workstreams and review their evidence before approving any external action.",actions:[
    ["Coordinate all five specialists","Prepare a coordinated plan for all five specialists. For each workstream list today's best next task, dependencies, evidence needed, risks and measurable completion criteria. Do not claim tasks were executed."],
    ["Review team health","Review the latest available specialist reports and identify blockers, weak outputs, provider failures and safe recovery proposals. Do not rerun failed work."]
  ]},
  youtube: {title:"YouTube channel dashboard",summary:"Global Rhymes 4U · content planning, channel review and production readiness. Publishing stays owner-approved.",actions:[
    ["Plan the next original video","Create one original child-safe nursery rhyme video concept for Global Rhymes 4U with lyrics, scene-by-scene storyboard, consistent characters, thumbnail concept, title, description and rights/safety checklist. Clearly label anything not yet generated."],
    ["Review channel growth","Prepare a channel performance review using only connected, available metrics. Separate verified metrics from unavailable data and recommendations."]
  ]},
  affiliate: {title:"Affiliate campaign dashboard",summary:"Research opportunities, prepare compliant campaigns and track only verified clicks and commissions.",actions:[
    ["Research a zero-cost campaign","Research one suitable India-focused affiliate campaign. Verify official program terms and product facts, disclose affiliate relationships, and do not invent prices, commissions or links."],
    ["Review campaign performance","Summarise available campaign, click and commission records. Separate measured results from estimates and identify missing tracking."]
  ]},
  blogging: {title:"Sports King 18 editorial dashboard",summary:"Multi-sport coverage, player biographies, sourced articles and private-draft readiness for Sports King 18.",actions:[
    ["Create today's sports article brief","Prepare a researched Sports King 18 article brief covering a timely sports story and a featured player biography. Include source URLs, fact checks, SEO title and outline. Do not invent current news or quotes."],
    ["Build a player biography","Create a detailed, sourced player biography with career timeline, achievements, statistics only where verified, and a source list. Flag any facts needing verification."],
    ["Review editorial quality","Audit the latest saved Blogging Specialist report for completeness, originality, source quality, factual support and SEO. Do not retry generation or publish."]
  ]},
  "app-development": {title:"App & game development dashboard",summary:"Plan Android-first apps and 2D/3D games, track implementation, tests and release readiness.",actions:[
    ["Design an app MVP","Turn an app idea into a beginner-friendly MVP specification with screens, user flows, free-first technology choices, risks and test cases. Do not assume paid services."],
    ["Plan a 2D/3D game","Create a practical 2D/3D game concept, core loop, levels, assets list, engine comparison and Android performance test plan."]
  ]},
  seo: {title:"SEO & search visibility dashboard",summary:"Keyword research, content optimisation, technical checks and evidence-based search performance.",actions:[
    ["Build a keyword plan","Create an intent-based keyword cluster and content plan for the connected site. Label search volume and ranking data unavailable unless verified."],
    ["Run an SEO audit","Prepare a technical and on-page SEO audit checklist for the connected website. Separate observed issues from checks that still require live access."]
  ]}
};
const AGENT_HISTORY_KEY = "masterAiBot.agentWorkHistory.v1";
function readAgentHistory() {
  try { const value=JSON.parse(localStorage.getItem(AGENT_HISTORY_KEY)||"{}"); return value&&typeof value==="object"?value:{}; }
  catch { return {}; }
}
function saveAgentHistory(agentId,item) {
  const history=readAgentHistory();
  history[agentId]=[item,...(Array.isArray(history[agentId])?history[agentId]:[])].slice(0,30);
  try { localStorage.setItem(AGENT_HISTORY_KEY,JSON.stringify(history)); } catch {}
}
function recordTaskHistory(data,selectedAgent,task) {
  const timestamp=new Date().toISOString();
  if(selectedAgent==="master" && !data.reusedReports && Array.isArray(data.specialistResults)) {
    data.specialistResults.forEach(item=>saveAgentHistory(item.agentId,{timestamp,task,status:item.success?"Completed":"Needs attention",provider:item.provider||"Not reported",quality:item.qualityReview?.score??null,report:item.result||item.error||""}));
  }
  saveAgentHistory(selectedAgent,{timestamp,task,status:data.success===false?"Needs attention":"Completed",provider:data.provider||"Not reported",quality:data.qualityReview?.score??null,report:data.result||""});
}
let currentWorkspaceAgent = null;
let latestStatusData = null;
function displayAgents(agents) {
  agentList.replaceChildren();
  const byId=new Map(agents.map(agent=>[agent.id,agent]));
  Object.entries(agentProfiles).forEach(([id,profile])=>{
    const source=byId.get(id)||{};
    const card=document.createElement("article");
    card.className="agent-card"+(id==="master"?" master-agent":"");
    card.tabIndex=0; card.setAttribute("role","button");
    card.setAttribute("aria-label","Open "+profile.name+" workspace");
    card.dataset.agentId=id;
    addText(card,"span",profile.icon,"agent-icon");
    const body=document.createElement("div");
    addText(body,"h3",source.name||profile.name);
    addText(body,"p",source.role||profile.role);
    addText(body,"span",profile.tag,"agent-role");
    card.appendChild(body);
    const health=latestStatusData?.specialistHealth?.agents?.find(item=>item.agentId===id);
    const state=health?.status||"registered";
    addText(card,"span","● "+(state==="healthy"?"Ready":state==="degraded"?"Needs attention":"Registered"),"agent-state");
    addText(card,"span","Open workspace →","agent-open-label");
    const open=()=>openAgentWorkspace(id);
    card.addEventListener("click",open);
    card.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}});
    agentList.appendChild(card);
  });
}
function showWorkspaceMetric(parent,label,value,detail="") {
  const card=document.createElement("article");card.className="workspace-metric";
  addText(card,"span",label,"muted");addText(card,"strong",String(value));
  if(detail)addText(card,"small",detail,"muted");parent.appendChild(card);
}
function prepareWorkspaceTask(agentId,prompt) {
  agentSelect.value=agentId;
  taskInput.value=prompt;
  document.getElementById("agentWorkspace").hidden=true;
  document.querySelector(".agents-panel").hidden=false;
  taskForm.scrollIntoView({behavior:"smooth",block:"start"});
  taskInput.focus();
}
function openAgentWorkspace(agentId) {
  const profile=agentProfiles[agentId];if(!profile)return;
  currentWorkspaceAgent=agentId;
  const panel=document.getElementById("agentWorkspace");
  document.querySelector(".agents-panel").hidden=true;
  panel.hidden=false;
  document.getElementById("workspaceEyebrow").textContent=profile.tag+" WORKSPACE";
  document.getElementById("workspaceTitle").textContent=profile.name;
  document.getElementById("workspaceDescription").textContent=profile.role;
  const dashboard=specialistDashboardProfiles[agentId]||specialistDashboardProfiles.master;
  document.getElementById("workspaceDashboardTitle").textContent=dashboard.title;
  document.getElementById("workspaceDashboardSummary").textContent=dashboard.summary;
  const quickActions=document.getElementById("workspaceQuickActions");
  quickActions.replaceChildren();
  dashboard.actions.forEach(([label,prompt])=>{
    const button=document.createElement("button");
    button.type="button";button.className="workspace-quick-action";
    const title=document.createElement("strong");title.textContent=label;
    const hint=document.createElement("span");hint.textContent="Prepare task →";
    button.append(title,hint);
    button.addEventListener("click",()=>prepareWorkspaceTask(agentId,prompt));
    quickActions.appendChild(button);
  });
  document.getElementById("workspaceHealth").textContent=(latestStatusData?.specialistHealth?.agents?.find(item=>item.agentId===agentId)?.status||"registered").replace("-"," ");
  const capabilities=document.getElementById("workspaceCapabilities");capabilities.replaceChildren();
  profile.capabilities.forEach(value=>addText(capabilities,"li",value));
  const assets=document.getElementById("workspaceAssets");assets.replaceChildren();
  profile.assets.forEach(value=>addText(assets,"p",value,"muted"));
  const rec=document.getElementById("workspaceRecommendations");rec.replaceChildren();
  profile.recommendations.forEach(value=>addText(rec,"p","• "+value,"muted"));
  const health=latestStatusData?.specialistHealth?.agents?.find(item=>item.agentId===agentId);
  if(health?.status==="degraded") {
    addText(rec,"p","Health diagnosis: "+(health.rootCause||health.lastError||"A previous task needs attention."),"warning-text");
    addText(rec,"p","Suggested recovery: "+(health.recoveryAction||"Retry with a smaller task and review the provider diagnostics."),"warning-text");
  }
  const history=readAgentHistory()[agentId]||[];
  const historyNode=document.getElementById("workspaceHistory");historyNode.replaceChildren();
  if(!history.length)addText(historyNode,"p","No task history recorded for this agent in this browser yet.","muted");
  history.forEach(item=>{
    const row=document.createElement("article");row.className="workspace-history-item";
    addText(row,"strong",item.task||"Untitled task");
    addText(row,"p",(item.status||"Unknown")+" · "+(item.provider||"Provider not reported")+(item.quality!==null&&item.quality!==undefined?" · Structural score "+item.quality+"/100":""),"muted");
    addText(row,"small",new Date(item.timestamp).toLocaleString(),"muted");
    if(item.report){const details=document.createElement("details");const summary=document.createElement("summary");summary.textContent="View report";details.appendChild(summary);addText(details,"p",item.report);row.appendChild(details);}
    historyNode.appendChild(row);
  });
  const metrics=document.getElementById("workspaceMetrics");metrics.replaceChildren();
  showWorkspaceMetric(metrics,"Tasks saved",history.length,"Browser-local history");
  showWorkspaceMetric(metrics,"Capabilities",profile.capabilities.length,"Defined agent functions");
  showWorkspaceMetric(metrics,"Readiness",health?.status||"Registered",health?.rootCause||"Local readiness only; external provider tests are separate.");
  const sourceLabel=document.getElementById("workspaceHistorySource");
  if(sourceLabel) sourceLabel.textContent=approvalAccessToken?"Loading your saved history…":"Browser-local history";
  if(approvalAccessToken) { void loadPersistentAgentHistory(agentId); void loadAgentPortfolio(agentId); }
  if(agentId==="youtube") loadWorkspaceYoutube();
  if(agentId==="master" && approvalAccessToken) void loadRepairProposals();
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}
async function loadAgentPortfolio(agentId) {
  if (!(await ensureApprovalSession())) return;
  try {
    const response = await ownerAuthenticatedFetch("/api/agent-portfolio", {
      headers: { Authorization: "Bearer " + approvalAccessToken },
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Live portfolio data is unavailable.");
    if (currentWorkspaceAgent !== agentId) return;
    const item = data.portfolio?.[agentId];
    if (!item) return;
    const assets = document.getElementById("workspaceAssets");
    const metrics = document.getElementById("workspaceMetrics");
    const addPortfolioMetric = (label, value, detail) => showWorkspaceMetric(metrics, label, value === null || value === undefined ? "Unavailable" : Number(value).toLocaleString(), detail);
    if (agentId === "master") {
      addText(assets, "p", "Registered specialist agents: " + item.registeredSpecialists, "quality-passed");
      addText(assets, "p", "Recorded health events: " + (item.healthEvents ?? "Unavailable"), "muted");
      addPortfolioMetric("Health events", item.healthEvents, "Supabase health history");
    } else if (agentId === "youtube") {
      addText(assets, "p", "Connected channel records: " + item.connectedChannels, item.connectedChannels ? "quality-passed" : "warning-text");
      (item.channels || []).forEach(channel => addText(assets, "p", channel.title + " · " + channel.id, "muted"));
      addPortfolioMetric("Connected channels", item.connectedChannels, "Owner-scoped YouTube records");
    } else if (agentId === "affiliate") {
      addText(assets, "p", "Affiliate campaigns: " + (item.campaigns ?? "Unavailable"), "muted");
      addText(assets, "p", "Tracked clicks: " + (item.trackedClicks ?? "Unavailable"), "muted");
      addText(assets, "p", "Commission records: " + (item.commissionRecords ?? "Unavailable"), "muted");
      addText(assets, "p", "Instagram accounts: " + (item.instagramAccounts ?? "Unavailable"), "muted");
      (item.campaignsPreview || []).forEach(campaign => addText(assets, "p", campaign.product + " · " + campaign.status + " · " + campaign.researchStatus, "muted"));
      addPortfolioMetric("Campaigns", item.campaigns, "Saved campaign records");
      addPortfolioMetric("Tracked clicks", item.trackedClicks, "First-party campaign tracking");
      addPortfolioMetric("Commission records", item.commissionRecords, "Imported records; revenue not inferred");
    } else if (agentId === "blogging") {
      addText(assets, "p", "Connected CMS sites: " + (item.connectedSites ?? "Unavailable"), "muted");
      addText(assets, "p", "Saved blog drafts: " + (item.drafts ?? "Unavailable"), "muted");
      addText(assets, "p", "CMS draft/publication records: " + (item.cmsPublicationRecords ?? "Unavailable"), "muted");
      (item.sitesPreview || []).forEach(site => addText(assets, "p", site.name + " · " + site.provider + (site.url ? " · " + site.url : ""), "muted"));
      (item.draftsPreview || []).forEach(draft => addText(assets, "p", "Draft: " + draft.topic + " · " + draft.status, "muted"));
      addPortfolioMetric("Connected sites", item.connectedSites, "Blogger / WordPress records");
      addPortfolioMetric("Saved drafts", item.drafts, "Blog draft records");
    } else if (agentId === "seo") {
      addText(assets, "p", "Connected content sites: " + (item.connectedContentSites ?? "Unavailable"), "muted");
      (item.contentSitesPreview || []).forEach(site => addText(assets, "p", site.name + " · " + site.provider + (site.url ? " · " + site.url : ""), "muted"));
      addText(assets, "p", "Saved content drafts: " + (item.savedContentDrafts ?? "Unavailable"), "muted");
      (item.savedContentPreview || []).forEach(draft => addText(assets, "p", "Content: " + draft.topic + (draft.targetKeyword ? " · Keyword: " + draft.targetKeyword : "") + " · " + draft.status, "muted"));
      addText(assets, "p", "Search Console accounts: " + (item.searchConsoleAccounts ?? "Unavailable"), "muted");
      (item.accountsPreview || []).forEach(account => addText(assets, "p", account.googleEmail, "muted"));
      addPortfolioMetric("Content sites", item.connectedContentSites, "Connected Blogger / WordPress records");
      addPortfolioMetric("Saved content drafts", item.savedContentDrafts, "Available for SEO optimisation");
      addPortfolioMetric("Search Console accounts", item.searchConsoleAccounts, "Read-only performance data connections");
    } else if (agentId === "app-development") {
      addText(assets, "p", item.note, "warning-text");
    }
    const sourceLabel = document.getElementById("workspaceHistorySource");
    if (sourceLabel && currentWorkspaceAgent === agentId) sourceLabel.textContent = "Saved to your owner account · Live portfolio refreshed";
  } catch (error) {
    if (currentWorkspaceAgent === agentId) addText(document.getElementById("workspaceAssets"), "p", "Live portfolio data unavailable: " + error.message, "warning-text");
  }
}
async function loadPersistentAgentHistory(agentId) {
  if (!(await ensureApprovalSession())) return;
  try {
    const response = await ownerAuthenticatedFetch("/api/agent-history?agentId=" + encodeURIComponent(agentId), {
      headers: { Authorization: "Bearer " + approvalAccessToken },
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "History could not be loaded.");
    if (currentWorkspaceAgent !== agentId) return;
    const history = Array.isArray(data.history) ? data.history : [];
    const historyNode = document.getElementById("workspaceHistory");
    historyNode.replaceChildren();
    if (!history.length) addText(historyNode, "p", "No saved tasks for this agent yet. Run a task to start its permanent work history.", "muted");
    history.forEach(item => {
      const row = document.createElement("article"); row.className = "workspace-history-item";
      addText(row, "strong", item.task || "Untitled task");
      addText(row, "p", (item.status || "Unknown") + " · " + (item.provider || "Provider not reported") + (item.quality !== null && item.quality !== undefined ? " · Structural score " + item.quality + "/100" : ""), "muted");
      addText(row, "small", new Date(item.timestamp).toLocaleString(), "muted");
      if (item.report) { const details=document.createElement("details"); const summary=document.createElement("summary"); summary.textContent="View report"; details.appendChild(summary); addText(details,"p",item.report); row.appendChild(details); }
      historyNode.appendChild(row);
    });
    const sourceLabel=document.getElementById("workspaceHistorySource");
    if(sourceLabel) sourceLabel.textContent="Saved to your owner account";
    const count=document.querySelector("#workspaceMetrics .workspace-metric:first-child .workspace-metric-value");
    if(count) count.textContent=String(data.count ?? history.length);
  } catch (error) {
    const sourceLabel=document.getElementById("workspaceHistorySource");
    if(sourceLabel) sourceLabel.textContent="Saved history unavailable";
    if(currentWorkspaceAgent===agentId) addText(document.getElementById("workspaceHistory"),"p","Could not load account history: "+error.message,"warning-text");
  }
}
async function loadWorkspaceYoutube() {
  const assets=document.getElementById("workspaceAssets");
  if(!approvalAccessToken){addText(assets,"p","Sign in as owner to verify the Global Rhymes 4U channel connection and view live channel data.","muted");return;}
  try {
    const status=await youtubeApi("/api/youtube/status");
    if(!status.connected){addText(assets,"p","Live YouTube channels connected: 0. Global Rhymes 4U is planned but not yet authorized.","warning-text");return;}
    const response=await youtubeApi("/api/youtube/channel");
    const channel=response.channel;
    addText(assets,"p","Live connected channel: "+channel.title,"quality-passed");
    const metrics=document.createElement("div");metrics.className="workspace-metrics";
    showWorkspaceMetric(metrics,"Subscribers",channel.subscribers===null?"Hidden":Number(channel.subscribers).toLocaleString(),"YouTube Data API");
    showWorkspaceMetric(metrics,"Channel views",Number(channel.views).toLocaleString(),"YouTube Data API");
    showWorkspaceMetric(metrics,"Videos",Number(channel.videoCount).toLocaleString(),"YouTube Data API");
    assets.appendChild(metrics);
    const recent=await youtubeApi("/api/youtube/videos");
    addText(assets,"p","Recent uploads returned: "+(recent.videos||[]).length,"muted");
  } catch(error){addText(assets,"p","YouTube live data unavailable: "+error.message,"warning-text");}
}
document.getElementById("workspaceBackButton").addEventListener("click",()=>{document.getElementById("agentWorkspace").hidden=true;document.querySelector(".agents-panel").hidden=false;document.querySelector(".agents-panel").scrollIntoView({behavior:"smooth",block:"start"});});
document.getElementById("workspaceRunButton").addEventListener("click",()=>{agentSelect.value=currentWorkspaceAgent;document.getElementById("agentWorkspace").hidden=true;document.querySelector(".agents-panel").hidden=false;taskForm.scrollIntoView({behavior:"smooth",block:"start"});taskInput.focus();});
document.getElementById("workspaceRefreshButton").addEventListener("click",()=>{if(currentWorkspaceAgent)openAgentWorkspace(currentWorkspaceAgent);});

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
    if (!(await ensureApprovalSession())) {
      ownerLoginDialog.showModal();
      throw new Error("Your owner session could not be restored. Please sign in with your owner account, then retry.");
    }

    const response = await ownerAuthenticatedFetch("/api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, agentId, channelId: selectedYoutubeChannelId || undefined })
    });

    const data = await response.json();
    const hasPartialReports =
      Array.isArray(data.specialistResults) && data.specialistResults.length > 0;

    if (!response.ok || (!data.success && !hasPartialReports)) {
      throw new Error(data.error || "The task could not be completed.");
    }

    if (data.reusedReports && Array.isArray(data.specialistResults) && data.specialistResults.length) {
      data.specialistResults.forEach(item => {
        addFeedStep("Reused saved report: " + (item.name || item.agentId) + " · " + (item.savedReportId || "ID not returned"), Boolean(item.savedReportId));
      });
      addFeedStep("Synthesis-only run: no specialist was executed.", true);
      addFeedStep("Master Brain is synthesizing the five saved reports.", true);
    } else if (Array.isArray(data.specialistResults) && data.specialistResults.length) {
      data.specialistResults.forEach(item => {
        addFeedStep((item.success ? "Completed: " : "Needs attention: ") + (item.name || item.agentId) + (item.provider ? " · " + item.provider : ""), Boolean(item.success));
      });
      addFeedStep("Master Brain is assembling the combined report.", true);
    } else {
      addFeedStep("Response received from " + (data.agent || agentId) + (data.provider ? " · " + data.provider : ""), true);
    }
    recordTaskHistory(data, agentId, task);
    if (currentWorkspaceAgent) openAgentWorkspace(currentWorkspaceAgent);
    displayTaskResult(data, agentId);
  } catch (error) {
    saveAgentHistory(agentId, {
      timestamp: new Date().toISOString(),
      task,
      status: "Failed",
      provider: "Not confirmed",
      quality: null,
      report: error.message
    });
    if (currentWorkspaceAgent === agentId) openAgentWorkspace(agentId);
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
connectionStatus.addEventListener("click",()=>{if(!approvalAccessToken){ownerLoginDialog.showModal();return;}diagnosticsDialog.showModal();});
document.getElementById("closeDiagnosticsDialog").addEventListener("click",()=>diagnosticsDialog.close());
ownerSignInButton.addEventListener("click",()=>{if(approvalAccessToken){approvalPanel.scrollIntoView({behavior:"smooth"});return;}ownerLoginDialog.showModal();});
incomeCentreNav.addEventListener("click",()=>{if(!approvalAccessToken){ownerLoginDialog.showModal();return;}incomeCentre.scrollIntoView({behavior:"smooth"});});
document.getElementById("closeLoginDialog").addEventListener("click",()=>ownerLoginDialog.close());
document.querySelectorAll(".prompt-chip").forEach(button=>button.addEventListener("click",()=>{taskInput.value=button.dataset.prompt||"";taskInput.focus();}));
loadSystemStatus();


// OWNER APPROVAL CENTER
// Keep only the Supabase refresh token between page loads. A fresh access token
// is requested from Supabase when the dashboard opens; passwords are never stored.
let approvalAccessToken = "";
updateTaskAuthStatus();
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
  updateTaskAuthStatus();
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
  updateTaskAuthStatus();
  return true;
}

async function restoreApprovalSession() {
  try {
    const storedToken = localStorage.getItem(APPROVAL_SESSION_KEY);
    if (!storedToken) return false;
    approvalRefreshToken = storedToken;
    setApprovalMessage("Restoring your secure owner session...");
    const restored = await refreshApprovalSession();
    if (!restored) {
      approvalLoginForm.hidden = false;
      approvalWorkspace.hidden = true;
      setPrivatePanelsVisible(false);
      setApprovalMessage("Your saved sign-in has expired. Please sign in again.", true);
      return false;
    }
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    ownerLoginDialog.close();
    setPrivatePanelsVisible(true);
    void refreshIncomeCentre();
    setApprovalMessage("Owner session restored. Loading your approval queue...");
    await loadApprovalQueue();
    await loadYoutubeStatus();
    if (currentWorkspaceAgent === "youtube") openAgentWorkspace("youtube");
    return Boolean(approvalAccessToken);
  } catch (error) {
    setPrivatePanelsVisible(false);
    setApprovalMessage("Could not restore your owner session: " + error.message, true);
    return false;
  }
}

async function ensureApprovalSession() {
  if (approvalAccessToken) return true;
  try {
    if (!approvalRefreshToken) {
      approvalRefreshToken = localStorage.getItem(APPROVAL_SESSION_KEY) || "";
    }
  } catch {
    return false;
  }
  if (!approvalRefreshToken) return false;
  return await refreshApprovalSession();
}

async function ownerAuthenticatedFetch(path, options = {}) {
  const send = () => fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: "Bearer " + approvalAccessToken
    }
  });
  let response = await send();
  if (response.status === 401 && approvalRefreshToken) {
    const restored = await refreshApprovalSession();
    if (restored) response = await send();
  }
  return response;
}

async function approvalApi(path, options = {}) {
  if (!(await ensureApprovalSession())) throw new Error("Your owner session is not available. Please sign in again.");
  const response = await ownerAuthenticatedFetch(path, options);
  const body = await response.text();
  let data = {};
  if (body) {
    try { data = JSON.parse(body); }
    catch { throw new Error("The server returned an invalid response (HTTP " + response.status + "). Please retry after the service is stable."); }
  } else if (!response.ok) {
    throw new Error("The server returned an empty response (HTTP " + response.status + "). It may be restarting or unavailable.");
  } else {
    throw new Error("The server returned an empty response. Please retry.");
  }
  if (!response.ok) throw new Error(data.error || "Approval request failed (HTTP " + response.status + ").");
  return data;
}

async function loadDailyOperations() {
  const status = document.getElementById("dailyQueueStatus");
  const list = document.getElementById("dailyNotificationList");
  if (!status || !list || !approvalAccessToken) return;
  status.textContent = "Loading queue and agent notifications…";
  try {
    const [queueData, notificationData] = await Promise.all([
      approvalApi("/api/queue"),
      approvalApi("/api/notifications")
    ]);
    const jobs = Array.isArray(queueData.jobs) ? queueData.jobs : [];
    const counts = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    status.textContent = "Saved queue · " + jobs.length + " recent jobs · Pending " + (counts.pending || 0) +
      " · Running " + (counts.running || 0) + " · Completed " + (counts.completed || 0) + " · Failed " + (counts.failed || 0);
    const items = Array.isArray(notificationData.notifications) ? notificationData.notifications : [];
    list.replaceChildren();
    if (!items.length) {
      list.textContent = "No agent notifications yet. The first scheduled run will add completion and retry updates here.";
      return;
    }
    for (const item of items.slice(0, 30)) {
      const article = document.createElement("article");
      article.className = "approval-card";
      const heading = document.createElement("h4");
      heading.textContent = item.title || "Agent update";
      const body = document.createElement("p");
      body.textContent = item.body || "";
      const meta = document.createElement("small");
      meta.textContent = [item.agent_id || "Master", item.notification_type || "update", item.created_at ? new Date(item.created_at).toLocaleString() : ""].filter(Boolean).join(" · ");
      article.append(heading, body, meta);
      if (!item.read_at) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = "Mark as read";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await approvalApi("/api/notifications/" + encodeURIComponent(item.id) + "/read", { method: "PATCH" });
            await loadDailyOperations();
          } catch (error) {
            button.disabled = false;
            status.textContent = error.message;
          }
        });
        article.append(button);
      }
      list.append(article);
    }
  } catch (error) {
    status.textContent = "Daily operations status unavailable: " + error.message;
    list.textContent = "Sign in and confirm the queue database setup is complete.";
  }
}

async function loadBlogCmsConnections() {
  const status = document.getElementById("blogConnectionStatus");
  const list = document.getElementById("blogConnectionList");
  if (!status || !list || !approvalAccessToken) return;
  status.textContent = "Checking Blogger and WordPress.com connections…";
  list.replaceChildren();
  const results = await Promise.allSettled([
    approvalApi("/api/blog/status?provider=blogger"),
    approvalApi("/api/blog/status?provider=wordpress")
  ]);
  let connected = 0;
  results.forEach((result, index) => {
    const provider = index === 0 ? "Blogger" : "WordPress.com";
    if (result.status !== "fulfilled") {
      addText(list, "p", provider + ": " + result.reason.message, "muted");
      return;
    }
    const sites = Array.isArray(result.value.sites) ? result.value.sites : [];
    connected += sites.length;
    if (!sites.length) {
      addText(list, "p", provider + ": no site connected yet.", "muted");
      return;
    }
    sites.forEach(site => {
      const row = document.createElement("article");
      row.className = "approval-card";
      addText(row, "strong", site.site_name || provider);
      addText(row, "p", site.site_url || "Site URL not provided", "muted");
      addText(row, "small", provider + (site.selected ? " · Selected" : ""), "muted");
      list.appendChild(row);
    });
  });
  status.textContent = connected
    ? connected + " blog site connection(s) saved in your owner account. Remote content remains draft-only."
    : "No blog sites connected yet. Connect Blogger or WordPress.com below.";
}


async function verifyBloggerConnection() {
  const button = document.getElementById("verifyBloggerConnectionButton");
  const status = document.getElementById("blogConnectionVerificationStatus");
  if (!status) return;
  if (button) button.disabled = true;
  status.textContent = "Verifying Blogger access with a read-only request…";
  try {
    const data = await approvalApi("/api/blog/verify-connection", { method: "POST" });
    status.textContent = "Verified: " + (data.remoteBlogTitle || data.siteName || "Blogger site") +
      " · " + (data.siteUrl || "Connected Blogger account") + ". No content was published or changed.";
    status.className = "muted";
  } catch (error) {
    status.textContent = "Blogger access could not be verified: " + error.message;
    status.className = "warning-text";
  } finally {
    if (button) button.disabled = false;
  }
}

async function connectBlogCms(provider) {
  const status = document.getElementById("blogConnectionStatus");
  try {
    const data = await approvalApi("/api/blog/connect-url?provider=" + encodeURIComponent(provider));
    if (!data.authorizationUrl) throw new Error("The CMS provider did not return an authorization link.");
    status.textContent = "Opening " + (provider === "blogger" ? "Blogger" : "WordPress.com") + " secure authorization…";
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    status.textContent = "Could not start " + provider + " connection: " + error.message;
  }
}

async function loadInstagramConnection() {
  const status = document.getElementById("instagramConnectionStatus");
  const list = document.getElementById("instagramConnectionList");
  if (!status || !list || !approvalAccessToken) return;
  status.textContent = "Checking Instagram professional-account connection…";
  list.replaceChildren();
  try {
    const data = await approvalApi("/api/instagram/status");
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if (!accounts.length) {
      status.textContent = "No Instagram professional account connected yet.";
      return;
    }
    accounts.forEach(account => {
      const row = document.createElement("article");
      row.className = "approval-card";
      addText(row, "strong", account.username ? "@" + account.username : "Instagram account");
      addText(row, "p", account.accountType + " · " + (account.connected ? "Token active" : "Reconnect required"), account.connected ? "muted" : "warning-text");
      addText(row, "small", "Token expiry: " + (account.expiresAt ? new Date(account.expiresAt).toLocaleString() : "not reported"), "muted");
      if (account.error) addText(row, "p", account.error, "warning-text");
      list.appendChild(row);
    });
    status.textContent = accounts.length + " Instagram account(s) found. Only professional accounts are supported; publishing is still locked.";
  } catch (error) {
    status.textContent = "Instagram connection status unavailable: " + error.message;
  }
}

async function connectInstagramAccount() {
  const status = document.getElementById("instagramConnectionStatus");
  try {
    const data = await approvalApi("/api/instagram/connect-url");
    if (!data.authorizationUrl) throw new Error("Meta did not return an authorization link.");
    status.textContent = "Opening Instagram's secure authorization page…";
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    status.textContent = "Could not start Instagram connection: " + error.message;
  }
}

async function loadApprovalQueue() {
  if (!approvalAccessToken) return;
  approvalList.textContent = "Loading approval queue...";
  try {
    const data = await approvalApi("/api/approvals");
    renderApprovalQueue(Array.isArray(data.approvals) ? data.approvals : []);
    await loadDailyOperations();
    await loadBlogCmsConnections();
    await loadInstagramConnection();
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
    updateTaskAuthStatus();
    approvalPassword.value = "";
    approvalLoginForm.hidden = true;
    approvalWorkspace.hidden = false;
    ownerLoginDialog.close();
    setPrivatePanelsVisible(true);
    void refreshIncomeCentre();
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
document.getElementById("connectBloggerButton")?.addEventListener("click", () => connectBlogCms("blogger"));
document.getElementById("connectWordPressButton")?.addEventListener("click", () => connectBlogCms("wordpress"));
document.getElementById("refreshBlogConnectionsButton")?.addEventListener("click", loadBlogCmsConnections);
document.getElementById("verifyBloggerConnectionButton")?.addEventListener("click", verifyBloggerConnection);
document.getElementById("connectInstagramButton")?.addEventListener("click", connectInstagramAccount);
document.getElementById("refreshInstagramButton")?.addEventListener("click", loadInstagramConnection);


// GLOBAL RHYMES 4U YOUTUBE CONNECTION
const youtubeConnectButton = document.getElementById("youtubeConnectButton");
const youtubeRefreshButton = document.getElementById("youtubeRefreshButton");
const youtubeStatus = document.getElementById("youtubeStatus");
const youtubeChannel = document.getElementById("youtubeChannel");
const youtubeVideos = document.getElementById("youtubeVideos");
const youtubeVideosHeading = document.getElementById("youtubeVideosHeading");
const youtubeAnalytics = document.getElementById("youtubeAnalytics");
const youtubeAnalyticsHeading = document.getElementById("youtubeAnalyticsHeading");
const youtubeChannelNameInput = document.getElementById("youtubeChannelNameInput");
const youtubeChannelSelect = document.getElementById("youtubeChannelSelect");
let selectedYoutubeChannelId = "";

function resetYoutubePanel(message) {
  youtubeStatus.textContent = message;
  youtubeChannel.replaceChildren();
  youtubeChannel.hidden = true;
  youtubeVideos.replaceChildren();
  youtubeVideosHeading.hidden = true;
  youtubeAnalytics.replaceChildren();
  youtubeAnalyticsHeading.hidden = true;
}

async function youtubeApi(path, options = {}) {
  if (!(await ensureApprovalSession())) throw new Error("Your owner session is unavailable. Please sign in again.");
  if (path.startsWith("/api/youtube/") &&
      !path.startsWith("/api/youtube/status") &&
      !path.startsWith("/api/youtube/connect-url") &&
      selectedYoutubeChannelId) {
    path += (path.includes("?") ? "&" : "?") + "channel_id=" + encodeURIComponent(selectedYoutubeChannelId);
  }
  const response = await ownerAuthenticatedFetch(path, {
    cache: "no-store",
    ...options,
    headers: { ...(options.headers || {}), Authorization: "Bearer " + approvalAccessToken }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "YouTube request failed.");
  return data;
}
async function loadYoutubeProductionJobs() {
  const statusNode = document.getElementById("youtubeProductionStatus");
  const listNode = document.getElementById("youtubeProductionJobs");
  if (!statusNode || !listNode) return [];
  try {
    const data = await youtubeApi("/api/youtube/production-jobs");
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    listNode.replaceChildren();
    if (!jobs.length) addText(listNode, "p", "No video production jobs yet.");
    jobs.forEach(job => {
      const card = document.createElement("article");
      card.className = "rhyme-memory-item";
      addText(card, "h4", job.rhyme_title || "Untitled rhyme");
      addText(card, "p", "Status: " + String(job.status || "unknown").replaceAll("_", " ") +
        " · Scenes: " + (job.completed_scenes?.length || 0) + "/" + (job.total_scenes || "—"), "muted");
      if (job.script) {
        const lyrics = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "View complete original lyrics";
        lyrics.appendChild(summary);
        addText(lyrics, "p", job.script);
        card.appendChild(lyrics);
      }
      const ytMeta = job.production_spec?.youtubeMetadata || job.metadata?.youtubeMetadata;
      if (ytMeta) {
        addText(card, "h4", "YouTube upload details");
        addText(card, "p", "Title: " + (ytMeta.title || job.rhyme_title));
        addText(card, "p", "Description: " + (ytMeta.description || ""));
        addText(card, "p", "Tags: " + (Array.isArray(ytMeta.tags) ? ytMeta.tags.join(", ") : ""));
        const checks = ytMeta.policyPreflight || job.production_spec?.policyPreflight || {};
        addText(card, "p", "Originality review: " + (checks.originality || "Owner review required."));
        addText(card, "p", "Made-for-kids: " + (checks.madeForKids || "Confirm before publishing."));
        addText(card, "p", "Child safety: " + (checks.childSafety || "Owner review required."));
        addText(card, "p", "Monetization: " + (checks.monetization || "No guarantee."));
      }
      if (job.last_error) addText(card, "p", job.last_error, "warning-text");
      if (job.videoUrl) {
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = job.videoUrl;
        video.style.width = "100%";
        video.style.maxWidth = "720px";
        video.style.borderRadius = "14px";
        card.appendChild(video);
        addText(card, "p", "Private review video · link expires after 15 minutes. " + (job.narrationUrl ? "A separate spoken-lyrics track is available." : "This render contains original instrumental audio and on-screen captions; spoken narration is unavailable in this free-tier render."), "muted");
      }
      if (job.narrationUrl) {
        const narration = document.createElement("audio");
        narration.controls = true;
        narration.preload = "none";
        narration.src = job.narrationUrl;
        narration.style.width = "100%";
        card.appendChild(narration);
        addText(card, "p", "Separate spoken-lyrics track for review.", "muted");
      }
      if (job.thumbnailUrl) {
        const image = document.createElement("img");
        image.src = job.thumbnailUrl;
        image.alt = "Generated rhyme thumbnail";
        image.loading = "lazy";
        image.style.width = "180px";
        image.style.borderRadius = "12px";
        card.appendChild(image);
      }
      listNode.appendChild(card);
    });
    statusNode.textContent = jobs.length + " saved production job(s). Videos stay private until you approve the next step.";
    return jobs;
  } catch (error) {
    statusNode.textContent = error.message;
    return [];
  }
}

async function startYoutubeProduction() {
  const button = document.getElementById("youtubeProductionStartButton");
  const titleInput = document.getElementById("youtubeProductionTitle");
  const statusNode = document.getElementById("youtubeProductionStatus");
  const title = titleInput.value.trim();
  if (!title) { statusNode.textContent = "Enter a rhyme title first."; return; }
  button.disabled = true;
  statusNode.textContent = "Writing original lyrics and storyboard. The server keeps working if you leave this page.";
  try {
    const data = await youtubeApi("/api/youtube/production-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rhyme_title: title })
    });
    statusNode.textContent = data.message || "Production job queued.";
    let attempts = 0;
    const poll = async () => {
      const jobs = await loadYoutubeProductionJobs();
      const current = jobs.find(item => item.id === data.job?.id);
      if (current && ["queued", "planning", "rendering", "uploading"].includes(current.status) && attempts < 30) {
        attempts += 1;
        setTimeout(poll, 6000);
      }
    };
    await loadYoutubeProductionJobs();
    setTimeout(poll, 6000);
  } catch (error) {
    statusNode.textContent = "Could not start production: " + error.message;
  } finally {
    button.disabled = false;
  }
}

document.getElementById("youtubeProductionStartButton")?.addEventListener("click", startYoutubeProduction);


function addYoutubeMetric(parent, label, value) {
  const card = document.createElement("article");
  card.className = "youtube-metric";
  addText(card, "span", label, "muted");
  addText(card, "strong", value);
  parent.appendChild(card);
}

async function loadYoutubeStatus() {
  void loadYoutubeProductionJobs();
  if (!approvalAccessToken) {
    resetYoutubePanel("Sign in as the owner to check the YouTube connection.");
    return;
  }
  youtubeStatus.textContent = "Checking the Global Rhymes 4U connection...";
  try {
    const data = await youtubeApi("/api/youtube/status");
    if (!data.connected) {
      selectedYoutubeChannelId = "";
      youtubeChannelSelect.replaceChildren(new Option("No channels connected", ""));
      youtubeChannelSelect.disabled = true;
      resetYoutubePanel("No YouTube channels are connected yet. Enter the exact channel name above, then connect its Google account.");
      return;
    }
    const channels = Array.isArray(data.channels) ? data.channels : (data.channel ? [data.channel] : []);
    const previousSelection = selectedYoutubeChannelId;
    youtubeChannelSelect.replaceChildren();
    channels.forEach(item => youtubeChannelSelect.add(new Option(item.title + " · " + item.id, item.id)));
    selectedYoutubeChannelId = channels.some(item => item.id === previousSelection)
      ? previousSelection
      : (channels.find(item => String(item.title || "").trim().toLowerCase() === "global rhymes 4u")?.id || channels[0]?.id || "");
    youtubeChannelSelect.value = selectedYoutubeChannelId;
    youtubeChannelSelect.disabled = channels.length === 0;
    youtubeConnectButton.disabled = false;
    youtubeConnectButton.textContent = channels.length >= 3 ? "Reconnect or update a channel" : "Connect channel";
    youtubeStatus.textContent = "Connected channels: " + channels.length + "/3. Loading " + (channels.find(item => item.id === selectedYoutubeChannelId)?.title || "selected channel") + "...";
    await loadYoutubeData();
    await refreshYoutubeRhymeMemory();
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
    youtubeStatus.textContent = channel.title + " is connected. Channel data is live" +
      (analyticsData ? "; analytics cover " + analyticsData.startDate + " to " + analyticsData.endDate + "." : ". Some analytics are unavailable.");
  } catch (error) {
    youtubeStatus.textContent = "Channel connection is active, but some data could not be loaded: " + error.message;
  }
}

youtubeConnectButton.addEventListener("click", async () => {
  const channelTitle = youtubeChannelNameInput.value.trim();
  if (!channelTitle || channelTitle.length > 120) {
    youtubeStatus.textContent = "Enter the exact channel name (up to 120 characters) first.";
    return;
  }
  youtubeConnectButton.disabled = true;
  youtubeStatus.textContent = "Preparing secure Google authorization for " + channelTitle + "...";
  try {
    const data = await youtubeApi("/api/youtube/connect-url?channel_title=" + encodeURIComponent(channelTitle));
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    youtubeStatus.textContent = error.message;
    youtubeConnectButton.disabled = false;
  }
});

youtubeChannelSelect.addEventListener("change", () => {
  selectedYoutubeChannelId = youtubeChannelSelect.value;
  if (selectedYoutubeChannelId) {
    void loadYoutubeData();
    if (currentWorkspaceAgent === "youtube") openAgentWorkspace("youtube");
  }
});
youtubeRefreshButton.addEventListener("click", loadYoutubeStatus);

const youtubeRhymeMemoryStatus = document.getElementById("youtubeRhymeMemoryStatus");
const youtubeRhymeMemoryList = document.getElementById("youtubeRhymeMemoryList");
const youtubeRhymeMemoryRefresh = document.getElementById("youtubeRhymeMemoryRefresh");

async function refreshYoutubeRhymeMemory() {
  if (!youtubeRhymeMemoryStatus || !youtubeRhymeMemoryList) return;
  if (!(await ensureApprovalSession())) {
    youtubeRhymeMemoryStatus.textContent = "Sign in as owner to load your saved rhyme progress.";
    youtubeRhymeMemoryList.replaceChildren();
    return;
  }
  youtubeRhymeMemoryStatus.textContent = "Loading saved rhyme production progress from Supabase...";
  try {
    const suffix = selectedYoutubeChannelId ? "?channel_id=" + encodeURIComponent(selectedYoutubeChannelId) : "";
    const response = await ownerAuthenticatedFetch("/api/youtube/rhyme-projects" + suffix, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Saved rhyme progress is unavailable.");
    youtubeRhymeMemoryList.replaceChildren();
    const projects = Array.isArray(data.projects) ? data.projects : [];
    if (!projects.length) {
      youtubeRhymeMemoryStatus.textContent = "No rhyme production records saved yet. When the YouTube Specialist creates a full rhyme production plan, it will save its continuity record here.";
      return;
    }
    projects.forEach(project => {
      const card = document.createElement("article");
      card.className = "rhyme-memory-card";
      addText(card, "h4", project.rhyme_title || "Untitled rhyme");
      const completed = Array.isArray(project.completed_scenes) ? project.completed_scenes : [];
      const remaining = Array.isArray(project.remaining_scenes) ? project.remaining_scenes : [];
      const total = Number(project.total_scenes || 0);
      const percent = total > 0 ? Math.min(100, Math.round(completed.length / total * 100)) : 0;
      addText(card, "p", completed.length + " completed · " + remaining.length + " remaining · " + total + " total scenes", "muted");
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = percent;
      progress.className = "rhyme-memory-progress";
      card.appendChild(progress);
      addText(card, "p", "Next scene: " + (project.next_scene ?? "Not set") + " · Status: " + (project.production_status || "planning"), "muted");
      addText(card, "p", "Cooldown: " + (project.cooldown_status || "unknown") + (project.retry_at ? " · Retry after " + new Date(project.retry_at).toLocaleString() : ""), "muted");
      addText(card, "p", "Retry attempts: " + Number(project.retry_attempts || 0) + " · Failed clips: " + (Array.isArray(project.failed_clips) ? project.failed_clips.length : 0), "muted");
      if (project.script) addText(card, "p", "Saved script: " + project.script.slice(0, 360) + (project.script.length > 360 ? "…" : ""));
      if (project.last_generated_clip && typeof project.last_generated_clip.url === "string" && /^https:\/\//i.test(project.last_generated_clip.url)) {
        const link = document.createElement("a");
        link.href = project.last_generated_clip.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open last generated clip";
        card.appendChild(link);
      }
      addText(card, "p", "Character continuity: " + JSON.stringify(project.character_continuity || {}), "muted");
      addText(card, "p", "Background continuity: " + JSON.stringify(project.background_continuity || {}), "muted");
      youtubeRhymeMemoryList.appendChild(card);
    });
    youtubeRhymeMemoryStatus.textContent = projects.length + " saved rhyme project(s) loaded from persistent server-side storage.";
  } catch (error) {
    youtubeRhymeMemoryStatus.textContent = "Could not load rhyme memory: " + error.message;
  }
}

youtubeRhymeMemoryRefresh?.addEventListener("click", refreshYoutubeRhymeMemory);


const youtubeResult = new URLSearchParams(window.location.search).get("youtube");
if (youtubeResult === "connected") {
  youtubeStatus.textContent = "Google authorization succeeded. Sign in as the owner to load your channel.";
} else if (youtubeResult === "channel-mismatch") {
  youtubeStatus.textContent = "The selected Google account did not return a channel with that exact name. Check the channel name and Google account, then try again.";
} else if (youtubeResult === "error") {
  youtubeStatus.textContent = "Google could not complete the connection. Check the Google Cloud OAuth setup and try again.";
} else if (youtubeResult === "limit") {
  youtubeStatus.textContent = "This owner account already has 3 connected channels. Reconnect an existing channel or remove one before adding another.";
}

// Private controls stay hidden until Supabase verifies the owner session.
setPrivatePanelsVisible(false);
approvalMessage.textContent="Sign in to open owner-only approvals and connected accounts.";
restoreApprovalSession();

document.querySelectorAll(".income-plan-button").forEach(button => {
  button.addEventListener("click", () => {
    const agentId = button.dataset.agent;
    const prompt = button.dataset.prompt || "";
    if (!agentId || !prompt) return;
    agentSelect.value = agentId;
    taskInput.value = prompt;
    taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
    taskInput.focus({ preventScroll: true });
    showToast("Income plan prepared. Review it, then run when ready.");
  });
});
async function refreshIncomeCentre() {
  const status = document.getElementById("incomeLiveStatus");
  if (!status || !(await ensureApprovalSession())) return;
  status.textContent = "Loading owner-scoped income and connected-asset records…";
  try {
    const response = await ownerAuthenticatedFetch("/api/agent-portfolio", {
      headers: { Authorization: "Bearer " + approvalAccessToken },
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Income records are unavailable.");
    const p = data.portfolio || {};
    const youtube = p.youtube?.connectedChannels ?? "unavailable";
    const affiliate = p.affiliate?.campaigns ?? "unavailable";
    const commissions = p.affiliate?.commissionRecords ?? "unavailable";
    const blogDrafts = p.blogging?.drafts ?? "unavailable";
    const seoAccounts = p.seo?.searchConsoleAccounts ?? "unavailable";
    const formatTotals = totals => {
      if (totals === null || totals === undefined) return "unavailable (incomplete records)";
      return totals.length ? totals.map(item => item.currency + " " + Number(item.amount).toFixed(2)).join(", ") : "none recorded";
    };
    const verifiedTotal = formatTotals(p.affiliate?.verifiedCommissionTotals);
    const paidText = formatTotals(p.affiliate?.verifiedPaidCommissions);
    const pendingText = formatTotals(p.affiliate?.verifiedPendingCommissions);
    const unverified = p.affiliate?.unverifiedCommissionRecords ?? "unavailable (incomplete records)";
    const coverage = p.affiliate?.commissionTotalsComplete === true ? "complete" : "incomplete";
    status.textContent = "Live owner records — YouTube channels: " + youtube + "; affiliate campaigns: " + affiliate + "; commission records: " + commissions + "; blog drafts: " + blogDrafts + "; Search Console accounts: " + seoAccounts + ". Owner-verified affiliate commissions (paid + pending): " + verifiedTotal + " (" + coverage + " record set). Verified paid affiliate income: " + paidText + ". Verified pending commissions (not income yet): " + pendingText + ". Unverified commission rows excluded: " + unverified + ". YouTube estimated revenue is separate from confirmed payouts; blog/app income is not connected as a verified payout source yet.";
  } catch (error) {
    status.textContent = "Income data could not be loaded: " + error.message + ". Opportunity planning remains available; earnings are not assumed.";
  }
}

async function loadRepairProposals() {
  const panel = document.getElementById("workspaceRepairProposals");
  const list = document.getElementById("workspaceRepairProposalList");
  if (!panel || !list || !(await ensureApprovalSession())) return;
  panel.hidden = false;
  list.textContent = "Checking recorded failures and safe repair proposals…";
  try {
    const response = await ownerAuthenticatedFetch("/api/repair-proposals", {
      headers: { Authorization: "Bearer " + approvalAccessToken },
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Repair proposals are unavailable.");
    list.replaceChildren();
    if (!Array.isArray(data.proposals) || !data.proposals.length) {
      addText(list, "p", "No active repair proposals. The health monitor creates proposals when a failure is recorded.", "muted");
      return;
    }
    data.proposals.forEach(proposal => {
      const card = document.createElement("article");
      card.className = "repair-proposal-card";
      addText(card, "strong", proposal.title || "Agent repair proposal");
      addText(card, "p", (proposal.agentId || "Agent") + " · " + (proposal.priority || "normal") + " priority · " + (proposal.failureType || "failure") + " / " + (proposal.failureCategory || "unknown"), "muted");
      addText(card, "p", proposal.diagnosis || "Further diagnosis is required.", "warning-text");
      if (proposal.observedError) addText(card, "p", "Observed: " + proposal.observedError, "muted");
      const actions = document.createElement("ol");
      (proposal.proposedActions || []).forEach(action => addText(actions, "li", action));
      card.appendChild(actions);
      addText(card, "p", "Owner approval required · Automatic execution disabled", "approval-notice");
      list.appendChild(card);
    });
  } catch (error) {
    list.textContent = "Repair proposals could not be loaded: " + error.message;
  }
}


// AGNES VIDEO GENERATION — owner-triggered, free-tier gated, never auto-publishes.
const agnesVideoPrompt = document.getElementById("agnesVideoPrompt");
const agnesVideoSeconds = document.getElementById("agnesVideoSeconds");
const agnesVideoRatio = document.getElementById("agnesVideoRatio");
const agnesVideoGenerateButton = document.getElementById("agnesVideoGenerateButton");
const agnesVideoSafetyStatus = document.getElementById("agnesVideoSafetyStatus");
const agnesVideoJobStatus = document.getElementById("agnesVideoJobStatus");
const agnesVideoResult = document.getElementById("agnesVideoResult");
let agnesVideoEnabled = false;

async function refreshAgnesVideoGate() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    const config = status.integrations?.agnesVideo || {};
    agnesVideoEnabled = config.enabled === true && config.apiKeyConfigured === true;
    agnesVideoGenerateButton.disabled = !agnesVideoEnabled || !approvalAccessToken;
    if (!config.apiKeyConfigured) {
      agnesVideoSafetyStatus.textContent = "Agnes API key is not configured on the server. Video generation is unavailable.";
    } else if (!config.enabled) {
      agnesVideoSafetyStatus.textContent = "LOCKED — API key detected, but free-trial eligibility has not been confirmed and enabled. No video request can be sent.";
    } else if (!approvalAccessToken) {
      agnesVideoSafetyStatus.textContent = "Free mode is enabled by the owner. Sign in to create a video.";
    } else {
      agnesVideoSafetyStatus.textContent = "Free mode is enabled. Confirm your prompt before generating. Publishing remains disabled.";
    }
  } catch {
    agnesVideoEnabled = false;
    agnesVideoGenerateButton.disabled = true;
    agnesVideoSafetyStatus.textContent = "Could not verify Agnes status. Generation remains locked.";
  }
}

async function checkAgnesVideoJob(videoId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const data = await youtubeApi("/api/agnes-video/status?video_id=" + encodeURIComponent(videoId));
    agnesVideoJobStatus.textContent = "Video status: " + data.status + (data.progress !== null ? " · " + data.progress + "%" : "");
    if (data.status === "completed" && data.videoUrl) {
      agnesVideoResult.replaceChildren();
      const link = document.createElement("a");
      link.href = data.videoUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open generated video";
      agnesVideoResult.appendChild(link);
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "Agnes video generation failed.");
  }
  agnesVideoJobStatus.textContent = "The job is still processing. Refresh this panel later and check the Agnes job status.";
}

agnesVideoGenerateButton.addEventListener("click", async () => {
  const prompt = agnesVideoPrompt.value.trim();
  if (!agnesVideoEnabled) {
    agnesVideoSafetyStatus.textContent = "Generation is locked until free eligibility is verified.";
    return;
  }
  if (prompt.length < 20 || prompt.length > 3000) {
    agnesVideoJobStatus.textContent = "Please enter a prompt between 20 and 3,000 characters.";
    return;
  }
  if (!(await ensureApprovalSession())) {
    agnesVideoJobStatus.textContent = "Please sign in as owner before generating.";
    return;
  }
  agnesVideoGenerateButton.disabled = true;
  agnesVideoJobStatus.textContent = "Submitting your video request…";
  agnesVideoResult.replaceChildren();
  try {
    const response = await ownerAuthenticatedFetch("/api/agnes-video", {
      method: "POST",
      headers: { Authorization: "Bearer " + approvalAccessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, seconds: Number(agnesVideoSeconds.value), aspect_ratio: agnesVideoRatio.value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Agnes video request failed.");
    agnesVideoJobStatus.textContent = "Video job accepted. Waiting for completion…";
    await checkAgnesVideoJob(data.videoId);
  } catch (error) {
    agnesVideoJobStatus.textContent = error.message;
  } finally {
    agnesVideoGenerateButton.disabled = !agnesVideoEnabled || !approvalAccessToken;
  }
});
void refreshAgnesVideoGate();
