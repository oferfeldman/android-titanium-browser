(() => {
  const clean = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
  const hasType = (value, type) => array(value?.["@type"])
    .some(name => typeof name === "string" && name.split(/[/#:]/).at(-1) === type);

  function findRecipe(value) {
    if (!value || typeof value !== "object") return null;
    if (hasType(value, "Recipe")) return value;
    for (const child of Object.values(value)) {
      const match = findRecipe(child);
      if (match) return match;
    }
    return null;
  }

  function instructions(value) {
    return array(value).flatMap(step =>
      typeof step === "string" ? [clean(step)] :
      step?.itemListElement ? instructions(step.itemListElement) : [clean(step?.text)],
    ).filter(Boolean);
  }

  const cues = {
    recipe: /\b(?:recipes?|recetas?|recettes?|rezepte?|ricett[ae]|receitas?|recept(?:en)?|retsept|przepis)\b|מתכונ(?:ים|ות)|מתכון|рецепт|وصفة|طرز تهیه|रेसिपी|レシピ|食谱|食譜|菜谱|菜譜|레시피|สูตรอาหาร|công thức|yemek tarifi/iu,
    ingredients: /\b(?:ingredients?|ingredientes|ingr[eé]dients|zutaten|ingredienti|ingrediënten|składniki|malzemeler)\b|מצרכים|מרכיבים|ингредиенты|المكونات|المقادير|مواد لازم|सामग्री|材料|食材|재료|ส่วนผสม|nguyên liệu/iu,
    steps: /\b(?:instructions?|directions|preparation|preparaci[oó]n|pr[eé]paration|zubereitung|preparazione|preparo|bereiding|przygotowanie|hazırlanışı)\b|אופן\s+ה?הכנה|הוראות הכנה|приготовление|طريقة التحضير|طريقة العمل|دستور پخت|बनाने की विधि|作り方|做法|조리법|만드는 법|วิธีทำ|cách làm/iu,
  };

  function scan() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const recipe = findRecipe(JSON.parse(script.textContent));
        if (recipe) return {
          title: clean(recipe.name),
          ingredients: array(recipe.recipeIngredient).map(clean).filter(Boolean),
          steps: instructions(recipe.recipeInstructions),
          yield: array(recipe.recipeYield).map(clean).find(Boolean),
        };
      } catch { /* Skip malformed publisher metadata. */ }
    }

    const microdata = document.querySelector('[itemtype$="/Recipe"], [typeof~="schema:Recipe"]');
    if (microdata) {
      const values = name => [...microdata.querySelectorAll(`[itemprop~="${name}"]`)]
        .map(node => clean(node.getAttribute("content") ?? node.textContent)).filter(Boolean);
      const stepNodes = [...microdata.querySelectorAll('[itemprop~="recipeInstructions"]')];
      const steps = stepNodes.flatMap(node => {
        const items = [...node.querySelectorAll("li")].map(item => clean(item.textContent)).filter(Boolean);
        return items.length ? items : [clean(node.getAttribute("content") ?? node.textContent)];
      }).filter(Boolean);
      return { title: values("name")[0], ingredients: values("recipeIngredient"), steps, yield: values("recipeYield")[0] };
    }

    const headline = clean(document.querySelector("h1")?.textContent);
    const root = document.querySelector("article:has(h1), main:has(h1), [role=main]") ??
      document.querySelector("h1")?.parentElement ?? document.body;
    const headings = [...root.querySelectorAll("h2,h3,h4,h5,h6,strong,b")]
      .filter(node => clean(node.textContent).length <= 70 &&
        (!node.matches("strong,b") || clean(node.parentElement?.textContent) === clean(node.textContent)));
    const ingredients = headings.find(node => cues.ingredients.test(node.textContent));
    const steps = headings.find(node => cues.steps.test(node.textContent));
    const path = (() => { try { return decodeURIComponent(location.pathname); } catch { return location.pathname; } })();
    const recipe = cues.recipe.test(`${headline} ${document.title} ${path.replace(/[\/_-]/g, " ")}`);
    if (!recipe && !(ingredients && steps)) return null;

    function sectionItems(heading) {
      const items = [];
      let current = heading;
      if (current?.matches("strong,b")) current = current.parentElement;
      for (let node = current?.nextElementSibling; node && items.length < 40; node = node.nextElementSibling) {
        if (node.matches("h1,h2,h3,h4,h5,h6") ||
          headings.some(heading => node === heading || node.contains(heading))) break;
        const rows = node.matches("ul,ol") ? [...node.children].map(item => item.innerText ?? item.textContent) :
          (node.innerText ?? node.textContent).split("\n");
        items.push(...rows.map(clean).filter(Boolean));
      }
      return items.slice(0, 40);
    }

    return { title: headline, ingredients: sectionItems(ingredients), steps: sectionItems(steps) };
  }

  const host = document.createElement("div");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:auto 0 0 0!important;z-index:2147483647!important;pointer-events:none!important";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing:border-box; }
    button,a { font:inherit; }
    button { cursor:pointer; }
    .launch,.panel { pointer-events:auto; font:500 16px/1.45 system-ui,sans-serif; }
    .launch { display:block; margin:0 auto max(18px,env(safe-area-inset-bottom)); color:#fff;
      background:#305d3c; border:0; border-radius:100px; min-height:48px; padding:0 22px;
      box-shadow:0 3px 16px #0003; transition:scale .18s cubic-bezier(.2,0,0,1); }
    .launch:active { scale:.96; }
    dialog { color:#17291d; background:#f4f8ef; border:0; border-radius:24px 24px 0 0; inset:auto 0 0;
      width:min(100%,560px); max-width:none; max-height:min(85dvh,740px); margin:0 auto;
      padding:18px 18px max(22px,env(safe-area-inset-bottom)); text-align:start; color-scheme:light; }
    dialog::backdrop { background:#0006; }
    h1 { font-size:1.45em; margin:0; line-height:1.2; overflow-wrap:anywhere; }
    h2 { font-size:1em; margin:0 0 8px; }
    header { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .close { border:0; background:transparent; color:inherit; min-width:44px; min-height:44px; font-size:1.55em; }
    section { background:#fff; border:1px solid #dce7da; border-radius:18px; padding:13px 15px; margin:10px 0; }
    ul,ol { margin:0; padding-inline-start:1.4em; }
    li { padding-block:5px; overflow-wrap:anywhere; }
    li+li { border-block-start:1px solid #dce7da; }
    p { margin:8px 0; }
    a { display:inline-flex; align-items:center; min-height:44px; color:#305d3c; }
    @media (prefers-color-scheme:dark) {
      dialog { color:#eef4eb; background:#17211a; color-scheme:dark; }
      section { background:#232f26; } section,li+li { border-color:#3d5040; }
      .launch { background:#bee4af; color:#14341f; } a { color:#bee4af; }
    }
    @media (prefers-reduced-motion:reduce) { .launch { transition:none; } }
  `;
  const launch = document.createElement("button");
  launch.type = "button";
  launch.className = "launch";
  const panel = document.createElement("dialog");
  panel.className = "panel";
  panel.setAttribute("aria-labelledby", "recipe-title");
  shadow.append(style, launch, panel);

  function show(recipe) {
    const locale = (document.documentElement.lang || document.querySelector('meta[property="og:locale"]')?.content || "").toLowerCase();
    const hebrew = /^(he|iw)([-_]|$)/.test(locale) || /[\u0590-\u05ff]/.test(recipe.title || "");
    launch.textContent = hebrew ? "מצב מתכון" : "Recipe mode";
    launch.onclick = () => {
      panel.replaceChildren();
      panel.dir = document.documentElement.dir || (hebrew || /^(ar|fa|ur)([-_]|$)/.test(locale) ? "rtl" : "auto");
      const header = document.createElement("header");
      const title = document.createElement("h1");
      title.id = "recipe-title";
      title.textContent = recipe.title || document.title || launch.textContent;
      const close = document.createElement("button");
      close.className = "close";
      close.textContent = "×";
      close.setAttribute("aria-label", hebrew ? "סגירה" : "Close");
      close.onclick = () => panel.close();
      header.append(title, close);
      panel.append(header);
      if (recipe.yield) {
        const yieldText = document.createElement("p");
        yieldText.textContent = recipe.yield;
        panel.append(yieldText);
      }
      for (const [label, rows, list] of [
        [hebrew ? "מצרכים" : "Ingredients", recipe.ingredients, "ul"],
        [hebrew ? "הכנה" : "Instructions", recipe.steps, "ol"],
      ]) {
        if (!rows.length) continue;
        const section = document.createElement("section");
        const heading = document.createElement("h2");
        heading.textContent = label;
        const items = document.createElement(list);
        for (const row of rows) {
          const item = document.createElement("li");
          item.dir = "auto";
          item.textContent = row;
          items.append(item);
        }
        section.append(heading, items);
        panel.append(section);
      }
      if (!recipe.ingredients.length || !recipe.steps.length) {
        const message = document.createElement("p");
        message.textContent = hebrew ? "אפשר לפתוח את הדף ב־Skim כדי לחלץ את המתכון." :
          "Open this page in Skim to extract the full recipe.";
        panel.append(message);
      }
      const skim = document.createElement("a");
      const url = encodeURIComponent(location.href);
      skim.href = `intent://recipe?url=${url}#Intent;scheme=skim;package=com.feldman.skim;end`;
      skim.textContent = hebrew ? "פתיחה ב־Skim" : "Open in Skim";
      panel.append(skim);
      panel.showModal();
      close.focus();
    };
    if (!host.isConnected) document.documentElement.append(host);
  }

  function refresh() {
    const recipe = scan();
    if (recipe) show(recipe);
    else host.remove();
  }

  refresh();
  let timer;
  const observer = new MutationObserver(mutations => {
    if (!mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
      .some(node => node !== host && node.nodeType === Node.ELEMENT_NODE))) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
