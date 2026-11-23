export function extractAffiliateCampaignTitle(report, dayKey = "today") {
  const text = String(report || "");
  const labeledTitle = text.match(/^\s*(?:\*\*)?(?:Campaign title|Working title|Title)(?:\*\*)?\s*[:：-]\s*(.+?)\s*$/im);
  const headingTitle = text.match(/^\s{0,3}#{1,3}\s+(.+?)\s*$/m);
  const title = labeledTitle?.[1] || headingTitle?.[1] || ("Daily affiliate research brief " + dayKey);
  return String(title).trim().replace(/^\*\*(.*?)\*\*$/, "$1").slice(0, 180);
}
