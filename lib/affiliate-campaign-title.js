export function extractAffiliateCampaignTitle(report, dayKey) {
  const text = String(report || "");
  const titleMatch = text.match(/^(?:\*\*)?(?:Campaign title|Working title|Title)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
  const title = String(titleMatch?.[1] || headingMatch?.[1] || ("Daily affiliate research brief " + dayKey))
    .trim()
    .slice(0, 180);
  return title || ("Daily affiliate research brief " + dayKey).slice(0, 180);
}
