import { instructions, schema } from "./protocol.js";

const privateStorage = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

function isRecipeTab(sender) {
  return sender?.frameId === 0 && sender.tab?.id != null && sender.url?.startsWith("https://");
}

let stylesheet;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!isRecipeTab(sender)) return;
  if (message?.action === "skim-settings") {
    chrome.tabs.create({ url: "chrome://skim/" });
    return;
  }
  if (message?.action !== "skim-styles") return;
  stylesheet ??= fetch(chrome.runtime.getURL("reader.css")).then(response => response.text());
  stylesheet.then(reply, () => reply(null));
  return true;
});

// The response schema emits containers in order. Read only complete JSON values
// so partial tokens and braces inside strings never reach the renderer.
function valueAt(text, start) {
  if (text[start] !== "{" && text[start] !== "[") return;
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === "\\") { i++; continue; }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "{" || char === "[") depth++;
    if ((char === "}" || char === "]") && --depth === 0) {
      return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
    }
  }
}

async function skim(port, message, signal) {
  await privateStorage;
  const { skimKey } = await chrome.storage.local.get("skimKey");
  if (!skimKey) {
    port.postMessage({ type: "key" });
    return;
  }
  const html = typeof message.html === "string" ? message.html.slice(0, 24000) : "";
  const metadata = typeof message.structured === "string" ? message.structured.slice(0, 12000) : "";
  if (!html) throw new Error("Missing recipe content");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${skimKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    body: JSON.stringify({
      model: "gpt-6.2-sol", service_tier: "ultrafast", reasoning: { effort: "low" },
      store: false, stream: true, max_output_tokens: 3500, instructions,
      input: metadata ? `Recipe metadata:\n${metadata}\n\nLoaded article HTML:\n${html}` : html,
      text: { format: { type: "json_schema", name: "recipe_cards", strict: true, schema } },
    }),
  });
  if (response.status === 401) {
    port.postMessage({ type: "key" });
    return;
  }
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  let buffer = "", content = "", sectionCursor = null, index = 0, completed = false;
  const fields = new Set(["lead", "outline", "servings"]);
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:") || line.trim() === "data: [DONE]") continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.completed") completed = true;
      if (event.type !== "response.output_text.delta") continue;
      content += event.delta;
      for (const field of fields) {
        const property = new RegExp(`"${field}"\\s*:\\s*`).exec(content);
        const parsed = property && valueAt(content, property.index + property[0].length);
        if (parsed) {
          port.postMessage({ type: field, value: parsed.value });
          fields.delete(field);
        }
      }
      if (sectionCursor == null) {
        const property = /"sections"\s*:\s*\[/.exec(content);
        if (property) sectionCursor = property.index + property[0].length;
      }
      if (sectionCursor != null) {
        while (/[\s,]/.test(content[sectionCursor] ?? "")) sectionCursor++;
        for (let parsed; (parsed = valueAt(content, sectionCursor));) {
          port.postMessage({ type: "section", index: index++, value: parsed.value });
          sectionCursor = parsed.end;
          while (/[\s,]/.test(content[sectionCursor] ?? "")) sectionCursor++;
        }
      }
    }
  }
  if (!completed || !index || fields.size) throw new Error("Incomplete response");
  port.postMessage({ type: "done", count: index });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "skim" || !isRecipeTab(port.sender)) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  function start(message) {
    if (message?.action !== "skim") return;
    port.onMessage.removeListener(start);
    skim(port, message, controller.signal).catch(error => {
      if (!controller.signal.aborted) port.postMessage({ type: "error", message: error.message });
    });
  }
  port.onMessage.addListener(start);
});
