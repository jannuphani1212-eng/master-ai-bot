export async function buildYoutubeTaskContext({
  ownerId,
  channelId,
  task,
  rhymeMemory,
  getYoutubeAgentContext,
  onError = () => {}
} = {}) {
  if (!ownerId) return "";

  const sections = [];
  if (/rhyme|resume|continue|scene|clip/i.test(String(task || "")) && rhymeMemory?.context) {
    try {
      const saved = await rhymeMemory.context(ownerId, channelId);
      if (saved) sections.push(saved);
    } catch (error) {
      onError("rhyme_memory", error);
    }
  }

  if (typeof getYoutubeAgentContext === "function") {
    try {
      const channel = await getYoutubeAgentContext({ ownerId, channelId });
      if (channel) sections.push(channel);
    } catch (error) {
      onError("channel_context", error);
    }
  }

  return sections.length ? "\n\n" + sections.join("\n\n") : "";
}
