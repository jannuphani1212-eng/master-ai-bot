const connectionStatus = document.getElementById("connectionStatus");
const agentList = document.getElementById("agentList");
const systemStatus = document.getElementById("systemStatus");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const agentSelect = document.getElementById("agentSelect");
const taskResult = document.getElementById("taskResult");
const submitButton = document.getElementById("submitButton");
const refreshButton = document.getElementById("refreshButton");

async function loadSystemStatus() {
  connectionStatus.textContent = "Connecting...";
  systemStatus.textContent = "Checking backend...";

  try {
    const response = await fetch("/api/status");

    if (!response.ok) {
      throw new Error("Backend request failed.");
    }

    const data = await response.json();

    connectionStatus.textContent = "● Connected";
    systemStatus.textContent = JSON.stringify({
      status: data.message,
      aiConfigured: data.aiConfigured,
      agentsAvailable: data.agents.length
    }, null, 2);

    displayAgents(data.agents);
  } catch (error) {
    connectionStatus.textContent = "● Offline";
    systemStatus.textContent =
      "Backend is not reachable yet. Deploy the application and try again.";

    agentList.textContent = "Agent information is unavailable.";
  }
}

function displayAgents(agents) {
  agentList.replaceChildren();

  agents.forEach((agent) => {
    const card = document.createElement("article");
    card.className = "agent-card";

    const title = document.createElement("h3");
    title.textContent = agent.name;

    const description = document.createElement("p");
    description.textContent = agent.role;

    card.append(title, description);
    agentList.appendChild(card);
  });
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ task, agentId })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "The task could not be completed.");
    }

    taskResult.textContent =
      "Agent: " + data.agent + "\n\n" + data.result;
  } catch (error) {
    taskResult.textContent =
      "Task not completed.\n\n" +
      error.message +
      "\n\nCheck that the backend is deployed and the AI API key is configured.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prepare My Task";
  }
});

refreshButton.addEventListener("click", loadSystemStatus);

loadSystemStatus();
