import { instructions, schema } from "./protocol.js";

const byId = id => document.getElementById(id);
const reader = byId("reader");
const status = byId("status");
const form = byId("credentials");
const keyInput = byId("key");
let page;
let hebrew = false;
let running = false;
const strings = (en, he) => hebrew ? he : en;

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setLanguage(language, direction) {
  hebrew = /^(he|iw)([-_]|$)/i.test(language) || /[\u0590-\u05ff]/.test(page.title);
  document.documentElement.lang = language || (hebrew ? "he" : "en");
  document.documentElement.dir = direction === "rtl" || (direction !== "ltr" && hebrew) ? "rtl" : "ltr";
  byId("original").textContent = strings("Open original", "פתיחת המקור");
  byId("account").textContent = strings("API key", "מפתח API");
  form.querySelector("label").textContent = strings("OpenAI API key", "מפתח API של OpenAI");
  byId("key-hint").textContent = strings(
    "Titanium saves this key in its own browser storage. It sends the recipe text to OpenAI when you make cards.",
    "המפתח נשמר בדפדפן Titanium. בעת העיבוד, טקסט המתכון נשלח ל־OpenAI.",
  );
  form.querySelector("button").textContent = strings("Save and skim", "שמירה והכנת כרטיסים");
}

function hero(title, answer) {
  const header = make("header", null, "card hero");
  if (page.image && page.image.startsWith("https://")) {
    const img = make("img");
    img.src = page.image;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove(), { once: true });
    header.append(img);
  }
  header.append(make("h1", title));
  if (answer) header.append(make("p", answer));
  return header;
}

function render(result, complete) {
  setLanguage(result.lead.language, result.lead.direction);
  const header = hero(result.lead.title, result.lead.answer);
  if (!complete) {
    reader.replaceChildren(header);
    return;
  }
  const count = Number(result.yield_count);
  const labels = [];
  const output = [header];
  for (const section of result.sections) {
    if (!section.rows.length) continue;
    const card = make("section", null, "card");
    card.append(make("h2", section.title));
    const ingredients = section.kind === "ingredients";
    const list = make(ingredients ? "dl" : section.kind === "steps" ? "ol" : "ul", null, "motion-items");
    for (const row of section.rows) {
      if (ingredients) {
        const entry = make("div", null, "row");
        const quantity = make("bdi", row[1] ?? "");
        const amount = make("dd");
        const name = make("dt");
        name.append(make("bdi", row[0]));
        amount.append(quantity);
        entry.append(name, amount);
        list.append(entry);
        labels.push({ quantity, row });
      } else {
        const item = make("li");
        if (row[1]) {
          const label = make("strong");
          label.append(make("bdi", row[1]));
          item.append(label, " ");
        }
        item.append(make("bdi", row[0]));
        list.append(item);
      }
    }
    card.append(list);
    output.push(card);
  }
  if (count >= 1 && count <= 500 && labels.length) {
    const card = make("section", null, "card controls");
    const sizeLabel = make("label", result.yield_unit || strings("Servings", "מנות"));
    const size = make("input");
    Object.assign(size, { type: "number", min: 1, max: 500, step: 1, value: count });
    sizeLabel.append(size);
    const perLabel = make("label", strings("Per serving", "למנה"));
    const per = make("input");
    per.type = "checkbox";
    perLabel.prepend(per);
    const format = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 3 });
    function update() {
      const desired = per.checked ? 1 : size.valueAsNumber;
      if (!Number.isInteger(desired) || desired < 1 || desired > 500) return;
      for (const { quantity, row } of labels) {
        const amount = Number(row[2]);
        const maximum = Number(row[4]);
        quantity.textContent = desired === count && !per.checked || !(amount > 0)
          ? row[1] ?? ""
          : [format.format(amount * desired / count) +
              (maximum > amount ? "–" + format.format(maximum * desired / count) : ""), row[3]].filter(Boolean).join(" ");
      }
    }
    size.addEventListener("input", update);
    per.addEventListener("change", update);
    card.append(sizeLabel, perLabel);
    if (result.serving_size) card.append(make("p", result.serving_size));
    output.splice(1, 0, card);
  }
  reader.classList.add("reveal");
  reader.replaceChildren(...output);
}

async function skim(key) {
  if (running) return;
  running = true;
  form.hidden = true;
  reader.classList.remove("reveal");
  reader.replaceChildren(hero(page.title));
  if (page.headings.length) {
    const outline = make("section", null, "card");
    for (const text of page.headings) outline.append(make("h2", text));
    reader.append(outline);
  }
  status.textContent = strings("Skimming recipe…", "מעבד את המתכון…");
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: "gpt-6.2-sol", service_tier: "ultrafast", reasoning: { effort: "low" },
        store: false, stream: true, max_output_tokens: 3500, instructions,
        input: [page.title, page.text, page.structured].filter(Boolean).join("\n"),
        text: { format: { type: "json_schema", name: "page_cards", strict: true, schema } },
      }),
    });
    if (response.status === 401) form.hidden = false;
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const stream = response.body.pipeThrough(new TextDecoderStream());
    let buffer = "", content = "", hasLead = false, completed = false;
    for await (const chunk of stream) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:") || line.trim() === "data: [DONE]") continue;
        const event = JSON.parse(line.slice(5));
        if (event.type === "response.output_text.delta") {
          content += event.delta || "";
          if (!hasLead) {
            const lead = /"lead"\s*:\s*(\{(?:[^"{}]|"(?:[^"\\]|\\.)*")*\})/.exec(content);
            if (lead) {
              render({ lead: JSON.parse(lead[1]) }, false);
              hasLead = true;
            }
          }
        }
        if (event.type === "response.completed") completed = true;
      }
    }
    if (!completed) throw new Error("Incomplete response");
    render(JSON.parse(content), true);
    status.textContent = "";
  } catch (error) {
    status.textContent = strings("Could not finish the recipe.", "לא ניתן היה להשלים את המתכון.");
    status.textContent += ` (${error.message})`;
    const retry = make("button", strings("Try again", "ניסיון חוזר"));
    retry.onclick = () => skim(key);
    reader.append(retry);
  } finally {
    running = false;
  }
}

const tab = await chrome.tabs.getCurrent();
if (tab?.id != null) {
  const name = `recipe:${tab.id}`;
  page = (await chrome.storage.session.get(name))[name];
}
if (!page) {
  status.textContent = "Return to a recipe page and open Recipe mode again.";
  byId("account").hidden = true;
} else {
  if (page.accent != null) document.documentElement.style.setProperty("--site-hue", String(page.accent));
  setLanguage(page.language, page.direction);
  byId("original").href = page.url;
  reader.append(hero(page.title));
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  byId("account").onclick = () => { form.hidden = !form.hidden; if (!form.hidden) keyInput.focus(); };
  form.onsubmit = async event => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key || running) return;
    await chrome.storage.local.set({ skimKey: key });
    keyInput.value = "";
    await skim(key);
  };
  const { skimKey } = await chrome.storage.local.get("skimKey");
  if (skimKey) await skim(skimKey);
  else form.hidden = false;
}
