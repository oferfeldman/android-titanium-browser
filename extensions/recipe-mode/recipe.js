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
    const headers = [...document.querySelectorAll("header, [role=banner], #header, .header")].slice(0, 8);
    const top = [0.15, 0.5, 0.85].flatMap(x => [32, 72, 128, 180].flatMap(y =>
      document.elementsFromPoint(innerWidth * x, Math.min(y, innerHeight / 3)).slice(0, 8),
    ));
    const elements = [...new Set([...headers, ...top, root.querySelector("a[href]")].filter(Boolean))];
    const styles = elements.map(node => getComputedStyle(node));
    const colors = [...theme, ...styles.flatMap(style => [
      style.backgroundColor, ...(style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? []),
    ]), ...styles.map(style => style.color)];
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
    const articleImage = root.querySelector("figure img, img[width]");
    const image = [recipeImage, meta, articleImage?.currentSrc || articleImage?.getAttribute("src")].map(value => {
      try {
        const url = new URL(value, location.href);
        return value && url.protocol === "https:" ? url.href : "";
      } catch { return ""; }
    }).find(Boolean) || "";

    const sourceImage = [...root.querySelectorAll("img")].find(node => node.currentSrc === image || node.src === image);
    return { root, recipe, image, accent: siteAccent(root), title: clean(recipe?.name) || clean(headline?.textContent) || document.title,
      headings, headline, sourceImage };
  }

  function siteTheme(root, headline) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const pixel = canvas.getContext("2d", { willReadFrequently: true });
    function color(value) {
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = value;
      pixel.fillRect(0, 0, 1, 1);
      return pixel.getImageData(0, 0, 1, 1).data;
    }
    function luminance(rgb) {
      const [r, g, b] = [...rgb].slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    }
    const text = getComputedStyle(headline ?? root);
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    const darkDefault = scheme.includes("dark") && (!scheme.includes("light") || matchMedia("(prefers-color-scheme: dark)").matches);
    let paper = darkDefault ? "#121212" : "#fff";
    for (let node = root; node; node = node.parentElement) {
      const surface = getComputedStyle(node).backgroundColor;
      if (color(surface)[3] >= 245) { paper = surface; break; }
    }
    const bgLight = luminance(color(paper));
    const fg = color(text.color);
    const fgLight = luminance(fg);
    const contrast = (Math.max(bgLight, fgLight) + .05) / (Math.min(bgLight, fgLight) + .05);
    return { paper, dark: bgLight < .19, ink: fg[3] >= 245 && contrast >= 5 ? text.color : "",
      font: text.fontFamily };
  }

  function capture({ root, recipe, headings, ...page }) {
    const headingNodes = new Set(headings);
    const seenTitles = new Set();
    const sections = [];
    const fragments = [];
    const metadata = recipe && JSON.stringify(Object.fromEntries(
      ["name", "description", "recipeIngredient", "recipeInstructions", "recipeYield", "prepTime",
        "cookTime", "totalTime", "nutrition"].map(name => [name, recipe[name]]),
    ));
    const limit = metadata && metadata.length <= 12000 ? 9000 : 23000;
    let length = 0;
    let section;
    for (const node of root.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,p,li,dt,dd,td")) {
      if (node.closest("nav,footer,aside,form,dialog,[hidden],[aria-hidden=true]")) continue;
      const heading = headingNodes.has(node) ||
        (node.matches("p,li") && headingNodes.has(node.querySelector("strong,b")));
      if (!heading && (node.matches("strong,b") || node.querySelector("li,p"))) continue;
      if (node.matches("strong,b") && node.parentElement.matches("p,li")) continue;
      const text = clean(node.textContent);
      if (!text) continue;
      if (heading) {
        section = null;
        if (!seenTitles.has(text) && sections.length < 5) {
          section = { title: text, heading: node, lines: [] };
          seenTitles.add(text);
          sections.push(section);
        }
      } else if (!heading && section && section.lines.length < 2) {
        section.lines.push({ node, text: text.slice(0, 160) });
      }
      const safeNode = document.createElement(heading && !node.matches("h1,h2,h3,h4,h5,h6") ? "h3" : node.localName);
      safeNode.textContent = text.slice(0, 1800);
      const html = safeNode.outerHTML;
      if (length + html.length > limit) continue;
      fragments.push(html);
      length += html.length;
    }
    if (!fragments.length) {
      const paragraph = document.createElement("p");
      paragraph.textContent = clean(root.innerText).slice(0, limit / 2);
      fragments.push(paragraph.outerHTML);
    }
    return { ...page, html: fragments.join("\n"), sections, theme: siteTheme(root, page.headline),
      structured: metadata && metadata.length <= 12000 ? metadata : "",
      language: document.documentElement.lang || "", direction: document.documentElement.dir };
  }

  const host = document.createElement("div");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:auto 0 0 0!important;z-index:2147483647!important;pointer-events:none!important";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = new CSSStyleSheet();
  style.replaceSync(`
    button { display:block; pointer-events:auto; margin:0 auto max(18px,env(safe-area-inset-bottom));
      font:600 16px/1.45 system-ui,sans-serif; color:#fff; background:hsl(var(--site-hue, 137) 38% 27%); border:0;
      border-radius:100px; min-height:48px; padding:0 22px; box-shadow:0 3px 16px #0003;
      transition:scale .18s cubic-bezier(.2,0,0,1); }
    button:active { scale:.96; }
    button[data-loading]::after { content:""; display:inline-block; margin-inline-start:9px;
      width:12px; height:12px; border:2px solid currentColor; border-inline-end-color:transparent;
      border-radius:50%; animation:turn .7s linear infinite; }
    @keyframes turn { to { transform:rotate(1turn); } }
    @media (prefers-color-scheme:dark) { button { background:hsl(var(--site-hue, 137) 43% 79%); color:#17211a; } }
    @media (prefers-reduced-motion:reduce) { button,button[data-loading]::after { transition:none; animation:none; } }
  `);
  shadow.adoptedStyleSheets = [style];
  const launch = document.createElement("button");
  launch.type = "button";
  shadow.append(launch);
  let current;
  let lastUrl;
  function refresh() {
    if (lastUrl && lastUrl !== location.href) skimReader.close();
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
    const originalUrl = location.href;
    launch.disabled = true;
    launch.dataset.loading = "";
    launch.setAttribute("aria-busy", "true");
    try {
      await new Promise(requestAnimationFrame);
      if (current && location.href === originalUrl) await skimReader.open(capture(current), launch);
    } catch {
      launch.title = "Could not open Skim. Try again.";
    } finally {
      launch.disabled = false;
      delete launch.dataset.loading;
      launch.removeAttribute("aria-busy");
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
