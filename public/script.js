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
      throw new Error("Server returned an error.");
    }

    const data = await response.json();

    connectionStatus.textContent = "● Connected";
    systemStatus.textContent = JSON.stringify(
      {
        success: data.success,
        message: data.message,
        agentsAvailable: data.agents.length
      },
      null,
      2
    );

    displayAgents(data.agents);
  } catch (error) {
    connectionStatus.textContent = "● Offline";
    systemStatus.textContent =
      "Could not connect to the backend.\n" +
      "Make sure the server is running and try again.";
    agentList.innerHTML =
      "<p>The agent list will appear when the backend is available.</p>";
  }
}

function displayAgents(agents) {
  agentList.innerHTML = "";

  agents.forEach((agent) => {
    const card = document.createElement("article");
    card.className = "agent-card";

    const title = document.createElement("h3");
    title.textContent = agent.name;

    const description = document.createElement("p");
    description.textContent = agent.role;

    card.appendChild(title);
    card.appendChild(description);
    agentList.appendChild(card);
  });
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const task = taskInput.value.trim();
  const selectedAgent = agentSelect.value;

  if (!task) {
    taskResult.textContent = "Please enter a task first.";
    return;
  }

  taskResult.textContent =
    "Your task has been recorded in the dashboard form.\n\n" +
    "Selected agent: " + selectedAgent + "\n" +
    "Task: " + task + "\n\n" +
    "AI task processing will be connected in the next development step.";

  submitButton.disabled = true;
  submitButton.textContent = "Task Prepared";

  setTimeout(() => {
    submitButton.disabled = false;
    submitButton.textContent = "Prepare My Task";
  }, 1500);
});

refreshButton.addEventListener("click", loadSystemStatus);

loadSystemStatus();
