chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.action !== "open-recipe" || sender.frameId !== 0 || sender.tab?.id == null) return;
  let url;
  try { url = new URL(sender.url); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password) return;
  const tabId = sender.tab.id;
  const short = (value, limit) => typeof value === "string" ? value.slice(0, limit) : "";
  const page = {
    url: url.href,
    title: short(message.title, 200),
    text: short(message.text, 32000),
    structured: short(message.structured, 12000),
    image: short(message.image, 2048),
    language: short(message.language, 24),
    direction: ["rtl", "ltr"].includes(message.direction) ? message.direction : "",
    headings: Array.isArray(message.headings) ? message.headings.slice(0, 8).map(x => short(x, 80)) : [],
  };
  chrome.storage.session.set({ [`recipe:${tabId}`]: page })
    .then(() => chrome.tabs.update(tabId, { url: chrome.runtime.getURL("reader.html") }))
    .then(() => reply({ ok: true }), () => reply({ ok: false }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`recipe:${tabId}`));
