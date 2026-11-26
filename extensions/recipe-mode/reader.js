const skimReader = (() => {
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  let sheet, active;

  async function styles() {
    if (sheet) return sheet;
    const css = await chrome.runtime.sendMessage({ action: "skim-styles" });
    if (!css) throw new Error("Could not load Skim styles");
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const font = new FontFace("Feldman", `url("${chrome.runtime.getURL("feldman.woff2")}")`, { weight: "100 900", display: "swap" });
    document.fonts.add(font);
    return sheet;
  }

  function close() {
    if (!active) return;
    const { body, host, inert, launcher, port } = active;
    active = null;
    port?.disconnect();
    body.inert = inert;
    host.remove();
    launcher.focus({ preventScroll: true });
  }

  function open(page, launcher) {
    close();
    const body = document.body;
    const host = make("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const surface = make("main", null, "skim-surface");
    const nav = make("nav");
    const back = make("button");
    const account = make("button");
    const status = make("div", null, "card skim-status");
    const loading = make("span");
    const indicator = make("span", null, "skim-indicator");
    const retry = make("button");
    status.setAttribute("role", "status");
    nav.append(back, account);
    status.append(indicator, loading, retry);
    const stack = make("div");
    stack.id = "reader";
    const hero = make("header", null, "card skim-hero");
    const title = make("h1", page.title);
    const answer = make("p");
    const summary = make("div");
    summary.append(title, answer);
    hero.append(summary);
    if (page.image.startsWith("https://")) {
      const image = make("img");
      image.src = page.image;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.onerror = () => image.remove();
      hero.append(image);
    }
    stack.append(hero);
    surface.append(nav, status, stack);
    shadow.append(surface);

    let hebrew, language, servings, waitingForKey;
    const state = { body, host, inert: body.inert, launcher };
    const cards = [];
    const label = (english, hebrewText) => hebrew ? hebrewText : english;
    function setLanguage(lang, direction) {
      hebrew = /^(he|iw)([-_]|$)/i.test(lang) || /[\u0590-\u05ff]/.test(page.title);
      language = hebrew ? "he" : "en";
      try { if (lang) language = Intl.getCanonicalLocales(lang.replaceAll("_", "-"))[0]; } catch { /* Invalid publisher tag. */ }
      surface.lang = language;
      surface.dir = direction === "rtl" || (direction !== "ltr" && hebrew) ? "rtl" : "ltr";
      back.textContent = label("Back to article", "חזרה למקור");
      account.textContent = label("API key", "מפתח API");
      retry.textContent = label("Try again", "ניסיון חוזר");
    }
    function settings() {
      chrome.runtime.sendMessage({ action: "skim-settings" });
    }
    setLanguage(page.language, page.direction);
    if (page.accent != null) surface.style.setProperty("--site-hue", String(page.accent));
    back.onclick = close;
    retry.onclick = () => start(state.ready);
    surface.addEventListener("keydown", event => { if (event.key === "Escape") close(); });

    function cardAt(index) {
      if (cards[index]) return cards[index];
      const card = make("section", null, "card skim-section");
      const heading = make("h2");
      const preview = make("div", null, "skim-preview");
      preview.setAttribute("aria-hidden", "true");
      const details = make("div", null, "skim-details");
      const content = make("div");
      details.append(content);
      card.append(heading, preview, details);
      stack.append(card);
      return cards[index] = { card, heading, preview, content };
    }

    function showPreviews() {
      for (const entry of cards) entry.card.remove();
      cards.length = 0;
      for (const [index, section] of page.sections.entries()) {
        const entry = cardAt(index);
        entry.heading.textContent = section.title;
        const lines = make("div", null, "skim-preview-lines");
        for (const text of section.lines) lines.append(make("p", text));
        if (section.lines.length) {
          entry.preview.append(lines);
          entry.card.classList.add("previewing");
        }
      }
    }

    function showOutline(outline) {
      outline.forEach((title, index) => {
        const entry = cardAt(index);
        entry.heading.textContent = title;
        entry.card.classList.remove("previewing");
        entry.card.dataset.waiting = "";
      });
      while (cards.length > outline.length) cards.pop().card.remove();
    }

    function servingControls(labels) {
      const count = Number(servings?.count);
      if (!Number.isInteger(count) || count < 1 || count > 500 || !labels.length) return null;
      const controls = make("div", null, "controls skim-serving");
      const sizeLabel = make("label", servings.unit || label("Servings", "מנות"));
      const size = make("input");
      Object.assign(size, { type: "number", min: 1, max: 500, step: 1, value: count });
      sizeLabel.append(size);
      const perLabel = make("label", label("Per serving", "למנה"));
      const per = make("input");
      per.type = "checkbox";
      perLabel.prepend(per);
      const format = new Intl.NumberFormat(language, { maximumFractionDigits: 3 });
      function update() {
        const desired = per.checked ? 1 : size.valueAsNumber;
        if (!Number.isInteger(desired) || desired < 1 || desired > 500) return;
        for (const { quantity, row } of labels) {
          const amount = Number(row[2]);
          const maximum = Number(row[4]);
          quantity.textContent = (desired === count && !per.checked) || !(amount > 0)
            ? row[1] ?? ""
            : [format.format(amount * desired / count) +
                (maximum > amount ? "–" + format.format(maximum * desired / count) : ""), row[3]].filter(Boolean).join(" ");
        }
      }
      size.addEventListener("input", update);
      per.addEventListener("change", update);
      controls.append(sizeLabel, perLabel);
      if (servings.size) controls.append(make("p", servings.size));
      return controls;
    }

    function showSection(section, index) {
      const entry = cardAt(index);
      const ingredients = section.kind === "ingredients";
      const list = make(ingredients ? "dl" : section.kind === "steps" ? "ol" : "ul", null, "motion-items");
      const labels = [];
      for (const row of section.rows) {
        if (ingredients) {
          const line = make("div", null, "row");
          const name = make("dt");
          const amount = make("dd");
          const quantity = make("bdi", row[1] ?? "");
          name.append(make("bdi", row[0]));
          amount.append(quantity);
          line.append(name, amount);
          list.append(line);
          labels.push({ quantity, row });
        } else {
          const item = make("li");
          if (row[1]) {
            const name = make("strong");
            name.append(make("bdi", row[1]));
            item.append(name, " ");
          }
          item.append(make("bdi", row[0]));
          list.append(item);
        }
      }
      const controls = ingredients && servingControls(labels);
      if (controls) entry.content.append(controls);
      entry.content.append(list);
      entry.heading.textContent = section.title;
      delete entry.card.dataset.waiting;
      entry.card.classList.add("expanded");
    }

    function finish() {
      status.hidden = true;
    }

    function start(ready) {
      state.port?.disconnect();
      waitingForKey = false;
      servings = null;
      status.hidden = false;
      indicator.hidden = false;
      retry.hidden = true;
      loading.textContent = label("Skimming recipe…", "מעבד את המתכון…");
      if (cards.length) showPreviews();
      const port = chrome.runtime.connect({ name: "skim" });
      state.port = port;
      let terminal = false;
      function showError(message) {
        indicator.hidden = true;
        retry.hidden = false;
        loading.textContent = label("Could not finish the recipe.", "לא ניתן היה להשלים את המתכון.") + (message ? ` (${message})` : "");
      }
      port.onDisconnect.addListener(() => {
        if (active === state && state.port === port && !terminal) ready.then(() => showError(), () => {});
      });
      port.onMessage.addListener(message => ready.then(() => {
        if (active !== state || state.port !== port) return;
        switch (message.type) {
          case "lead":
            setLanguage(message.value.language, message.value.direction);
            title.textContent = message.value.title;
            answer.textContent = message.value.answer;
            break;
          case "outline": showOutline(message.value); break;
          case "servings": servings = message.value; break;
          case "section": showSection(message.value, message.index); break;
          case "done":
            while (cards.length > message.count) cards.pop().card.remove();
            finish();
            terminal = true;
            break;
          case "key":
            indicator.hidden = true;
            retry.hidden = false;
            loading.textContent = label("Set your OpenAI API key to skim this recipe.", "יש להגדיר מפתח OpenAI כדי לעבד את המתכון.");
            waitingForKey = true;
            terminal = true;
            break;
          case "error":
            showError(message.message);
            terminal = true;
            break;
        }
      }, () => {}));
      port.postMessage({ action: "skim", html: page.html, structured: page.structured });
    }
    active = state;
    state.ready = styles().then(css => {
      if (active !== state) return;
      shadow.adoptedStyleSheets = [css];
      host.style.cssText = "all:initial!important;display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important";
      body.inert = true;
      document.documentElement.append(host);
      back.focus({ preventScroll: true });
      showPreviews();
    }, error => {
      if (active === state) close();
      throw error;
    });
    account.onclick = () => {
      settings();
      if (waitingForKey) window.addEventListener("focus", () => {
        if (active === state && waitingForKey) start(state.ready);
      }, { once: true });
    };
    start(state.ready);
    return state.ready;
  }

  return { open, close };
})();
