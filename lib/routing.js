export function requestsAllSpecialists(task) {
  return /\ball\s*(?:five|5)\b|\ball\s+(?:the\s+)?(?:specialists?|agents?|bots?)\b|\bevery\s+(?:specialists?|agents?|bots?)\b/i.test(
    String(task || "")
  );
}

export function fallbackAgentSelection(task, specialistAgents) {
  if (requestsAllSpecialists(task)) {
    return specialistAgents.map((agent) => agent.id);
  }

  const text = String(task || "").toLowerCase();
  const selected = [];

  function add(id) {
    if (!selected.includes(id) && selected.length < 3) {
      selected.push(id);
    }
  }

  if (/affiliate|commission|amazon|meesho|flipkart|product marketing/.test(text)) add("affiliate");
  if (/youtube|video|channel|reels|shorts|rhymes/.test(text)) add("youtube");
  if (/blog|article|website content|writing/.test(text)) add("blogging");
  if (/app|android|software|code|website development|programming/.test(text)) add("app-development");
  if (/seo|keyword|google ranking|search engine/.test(text)) add("seo");

  if (selected.length === 0 && specialistAgents[0]) {
    add(specialistAgents[0].id);
  }

  return selected;
}
