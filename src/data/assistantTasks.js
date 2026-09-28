export function isWorkspaceAction(text) {
  return /^(?:please\s+)?(?:open|go to|show)\s+(?:the\s+)?experiment browser\b/i.test(text)
    || /^(?:please\s+)?(?:insert|add|remove|delete|move|resize|export|draft|write|rewrite)\b.{0,200}\b(?:manuscript|canvas|text box|paragraph|caption)\b/i.test(text)
    || /^(?:请|帮我)?(?:写|起草|润色|插入|修改).{0,80}(?:稿件|段落|图注)/.test(text)
    || /^(?:请|帮我)?(?:打开|进入|显示)(?:实验浏览器|experiment browser)/i.test(text);
}

export function workbookTaskSources(message) {
  const links = message.workbookBatch
    ? (message.workbookBatch.items || []).map((item) => item.workbookReviewLink)
    : [message.workbookReviewLink];
  return links.filter(Boolean);
}

export function workbookTaskReady(message, state) {
  const links = workbookTaskSources(message);
  if (!links.length || message.workbookBatch?.items?.some((item) => item.status !== "uploaded")) return false;
  return links.every((link) => (state?.workbookReviewRegions || []).some((region) =>
    region.sourceDocumentId === link.sourceDocumentId && region.disposition === "active"
    && region.reviewStatus === "accepted" && region.acceptedRevisionId && region.acceptedRevisionId === region.currentRevisionId));
}
