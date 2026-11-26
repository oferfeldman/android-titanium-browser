(() => {
  const clean = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
  const type = (value, name) => asArray(value?.["@type"]).some(
    entry => typeof entry === "string" && entry.split(/[/#:]/).at(-1) === name,
  );
  function findRecipe(value) {
    if (!value || typeof value !== "object") return null;
    if (type(value, "Recipe")) return value;
    for (const child of Object.values(value)) {
      const match = findRecipe(child);
      if (match) return match;
    }
    return null;
  }

  const ingredients = /\b(?:ingredients?|ingredientes|ingr[eé]dients|zutaten|ingredienti|ingrediënten|składniki|malzemeler)\b|מצרכים|מרכיבים|ингредиенты|المكونات|المقادير|مواد لازم|सामग्री|材料|食材|재료|ส่วนผสม|nguyên liệu/iu;
  const preparation = /\b(?:instructions?|directions|preparation|preparaci[oó]n|pr[eé]paration|zubereitung|preparazione|preparo|bereiding|przygotowanie|hazırlanışı)\b|אופן\s+ה?הכנה|הוראות הכנה|приготовление|طريقة التحضير|طريقة العمل|دستور پخت|बनाने की विधि|作り方|做法|조리법|만드는 법|วิธีทำ|cách làm/iu;
  function isSearchPage(url) {
    const host = url.hostname.toLowerCase();
    return /(^|\.)(?:duckduckgo\.com|bing\.com|search\.yahoo\.com|search\.brave\.com|ecosia\.org|startpage\.com)$/.test(host) ||
      /(^|\.)google\.[a-z.]+$/.test(host) ||
      /^\/(?:search|search-results)(?:\/|$)/i.test(url.pathname) ||
      document.querySelector('[itemtype$="/SearchResultsPage"]') !== null;
  }

  function siteAccent(root) {
    const theme = [...document.querySelectorAll('meta[name="theme-color"]')]
      .filter(meta => !meta.media || matchMedia(meta.media).matches)
      .map(meta => meta.content);
    const header = document.querySelector("header, [role=banner]");
    const top = document.elementsFromPoint(innerWidth / 2, Math.min(90, innerHeight / 3));
    const elements = [header, ...top.slice(0, 8), root.querySelector("a[href]")].filter(Boolean);
    const colors = [...theme, ...elements.map(node => getComputedStyle(node).backgroundColor),
      ...elements.map(node => getComputedStyle(node).color)];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const pixel = canvas.getContext("2d", { willReadFrequently: true });
    if (!pixel) return null;
    for (const color of colors) {
      if (!color || !CSS.supports("color", color)) continue;
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = color;
      pixel.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = pixel.getImageData(0, 0, 1, 1).data;
      const min = Math.min(r, g, b), max = Math.max(r, g, b), range = max - min;
      if (alpha < 230 || range < 28 || max < 45 || (r === 0 && g === 0 && b === 238)) continue;
      let hue = max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
      hue = (hue * 60 + 360) % 360;
      return Math.round(hue);
    }
    return null;
  }

  function scan() {
    if (isSearchPage(new URL(location.href))) return null;
    const headline = document.querySelector("h1");
    const root = headline?.closest("article,main,[role=main]") ??
      (headline?.parentElement?.textContent.length >= 300 ? headline.parentElement : document.body);
    const headings = [...root.querySelectorAll("h2,h3,h4,h5,h6,strong,b")]
      .filter(node => clean(node.textContent).length <= 70 &&
        (!node.matches("strong,b") || clean(node.parentElement?.textContent) === clean(node.textContent)));
    let recipe;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (script.textContent.length > 1_000_000) continue;
      try {
        recipe = findRecipe(JSON.parse(script.textContent));
        if (recipe?.recipeIngredient && recipe?.recipeInstructions) break;
        recipe = null;
      } catch { /* Skip malformed publisher metadata. */ }
    }
    const micro = root.querySelector('[itemprop~="recipeIngredient"]') &&
      root.querySelector('[itemprop~="recipeInstructions"]');
    if (!recipe && !micro && !(headings.some(node => ingredients.test(node.textContent)) &&
      headings.some(node => preparation.test(node.textContent)))) return null;

    const meta = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content;
    const recipeImage = asArray(recipe?.image).map(value => value?.url ?? value?.contentUrl ?? value).find(Boolean);
    const articleImage = root.querySelector("figure img, img[width]")?.getAttribute("src");
    const image = [recipeImage, meta, articleImage].map(value => {
      try {
        const url = new URL(value, location.href);
        return value && url.protocol === "https:" ? url.href : "";
      } catch { return ""; }
    }).find(Boolean) || "";

    return { root, recipe, image, accent: siteAccent(root), title: clean(recipe?.name) || clean(headline?.textContent) || document.title,
      headings: headings.map(node => clean(node.textContent)).filter(Boolean).slice(0, 8) };
  }

  const host = document.createElement("div");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:auto 0 0 0!important;z-index:2147483647!important;pointer-events:none!important";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button { display:block; pointer-events:auto; margin:0 auto max(18px,env(safe-area-inset-bottom));
      font:600 16px/1.45 system-ui,sans-serif; color:#fff; background:hsl(var(--site-hue, 137) 38% 27%); border:0;
      border-radius:100px; min-height:48px; padding:0 22px; box-shadow:0 3px 16px #0003;
      transition:scale .18s cubic-bezier(.2,0,0,1); }
    button:active { scale:.96; }
    @media (prefers-color-scheme:dark) { button { background:hsl(var(--site-hue, 137) 43% 79%); color:#17211a; } }
    @media (prefers-reduced-motion:reduce) { button { transition:none; } }
  `;
  const launch = document.createElement("button");
  launch.type = "button";
  shadow.append(style, launch);
  let current;
  let lastUrl;
  function refresh() {
    lastUrl = location.href;
    current = scan();
    if (!current) { host.remove(); return; }
    if (current.accent == null) launch.style.removeProperty("--site-hue");
    else launch.style.setProperty("--site-hue", String(current.accent));
    const locale = document.documentElement.lang || document.querySelector('meta[property="og:locale"]')?.content || "";
    const hebrew = /^(he|iw)([-_]|$)/i.test(locale) || /[\u0590-\u05ff]/.test(current.title);
    launch.textContent = hebrew ? "מצב מתכון" : "Recipe mode";
    if (!host.isConnected) document.documentElement.append(host);
  }
  launch.addEventListener("click", async event => {
    if (!event.isTrusted) return;
    if (lastUrl !== location.href) refresh();
    if (!current) return;
    launch.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({
        action: "open-recipe",
        title: current.title,
        text: (current.root.innerText ?? current.root.textContent).trim().slice(0, 32000),
        structured: current.recipe ? JSON.stringify(current.recipe).slice(0, 12000) : "",
        headings: current.headings,
        image: current.image,
        accent: current.accent,
        language: document.documentElement.lang || "",
        direction: document.documentElement.dir,
      });
      if (!result?.ok) throw new Error("Could not open Skim");
    } catch {
      launch.title = "Could not open Skim. Try again.";
    } finally {
      launch.disabled = false;
    }
  });

  refresh();
  let timer;
  new MutationObserver(mutations => {
    if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
      .some(node => node !== host && node.nodeType === Node.ELEMENT_NODE))) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 350);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", refresh);
})();
