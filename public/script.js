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
          item.success ? item.result : "This specialist could not complete the task."
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
    const response = await fetch("/api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
