(() => {
  const SCRIPT_VERSION = "0.1.4";
  const TRANSLATIONS = {
    zh: {
      bannerTitle:    "选择要隐藏的项目",
      bannerHint:     "点击页面元素，可连续多选",
      selectedCount:  "已选 {0} 项",
      cancel:         "取消",
      confirm:        "确认隐藏",
      deselected:     "已取消选择",
      similarSelected:"已选择相似项目",
      itemSelected:   "已选择项目",
      hiddenCount:    "已隐藏 {0} 项",
      cancelled:      "已取消",
      hideFailed:     "隐藏失败：{0}",
      undoToast:      "已撤销上一条隐藏规则",
      siteRestored:   "已恢复当前站点",
      rulesEnabled:   "隐藏规则已开启",
      rulesPaused:    "隐藏规则已暂停",
    },
    en: {
      bannerTitle:    "Select elements to hide",
      bannerHint:     "Click elements, select multiple",
      selectedCount:  "{0} selected",
      cancel:         "Cancel",
      confirm:        "Hide",
      deselected:     "Deselected",
      similarSelected:"Similar items selected",
      itemSelected:   "Item selected",
      hiddenCount:    "Hidden {0} items",
      cancelled:      "Cancelled",
      hideFailed:     "Hide failed: {0}",
      undoToast:      "Undone last hide rule",
      siteRestored:   "Site restored",
      rulesEnabled:   "Hide rules enabled",
      rulesPaused:    "Hide rules paused",
    }
  };
  let __lang = "zh";
  function ct(key, ...args) {
    let str = TRANSLATIONS[__lang]?.[key] || TRANSLATIONS["zh"]?.[key] || key;
    if (args.length) {
      str = str.replace(/\{(\d+)\}/g, (_, i) => {
        const idx = parseInt(i, 10);
        return idx < args.length ? String(args[idx]) : "";
      });
    }
    return str;
  }
  async function loadContentLang() {
    try {
      const result = await chrome.storage.sync.get("language");
      __lang = result.language || "zh";
    } catch {
      __lang = "zh";
    }
  }
  const existingController = window.__distractionHiderController;

  if (existingController?.version === SCRIPT_VERSION) {
    return;
  }

  if (existingController?.dispose) {
    try {
      existingController.dispose();
    } catch {
      // A previous extension context can be invalid after reloading the extension.
    }
  }

  window.__distractionHiderLoaded = true;

  const STORE_KEY = "distractionHiderSites";
  const STYLE_ID = "dh-hide-rules";
  const BOX_ID = "dh-highlight-box";
  const BANNER_ID = "dh-select-banner";
  const SELECTED_LAYER_ID = "dh-selected-layer";
  const TOAST_ID = "dh-toast";
  const MAX_RULES_PER_SITE = 250;

  let siteState = { enabled: true, rules: [] };
  let picking = false;
  let pickMode = "exact";
  let currentTarget = null;
  let selectedRules = [];
  let toastTimer = 0;

  const hostname = () => location.hostname || "local-file";

  const nowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const isExtensionUi = (node) => {
    return Boolean(node && node.closest && node.closest(`#${BOX_ID}, #${BANNER_ID}, #${SELECTED_LAYER_ID}, #${TOAST_ID}`));
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const attrEscape = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const getSites = async () => {
    const result = await chrome.storage.sync.get(STORE_KEY);
    return result[STORE_KEY] || {};
  };

  const setSites = async (sites) => {
    await chrome.storage.sync.set({ [STORE_KEY]: sites });
  };

  const getCurrentSiteState = async () => {
    const sites = await getSites();
    const current = sites[hostname()] || {};
    return {
      enabled: current.enabled !== false,
      rules: Array.isArray(current.rules) ? current.rules : []
    };
  };

  const saveCurrentSiteState = async (nextState) => {
    const sites = await getSites();
    sites[hostname()] = {
      enabled: nextState.enabled !== false,
      rules: (nextState.rules || []).slice(-MAX_RULES_PER_SITE)
    };
    await setSites(sites);
    siteState = sites[hostname()];
    applyRules();
  };

  const isValidSelector = (selector) => {
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  };

  const applyRules = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.append(style);
    }

    if (!siteState.enabled || !siteState.rules.length) {
      style.textContent = "";
      return;
    }

    style.textContent = siteState.rules
      .filter((rule) => rule && rule.selector && isValidSelector(rule.selector))
      .map((rule) => `${rule.selector}{display:none!important;visibility:hidden!important;}`)
      .join("\n");
  };

  const ensureOverlay = () => {
    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = document.createElement("div");
      box.id = BOX_ID;
      document.documentElement.append(box);
    }

    let selectedLayer = document.getElementById(SELECTED_LAYER_ID);
    if (!selectedLayer) {
      selectedLayer = document.createElement("div");
      selectedLayer.id = SELECTED_LAYER_ID;
      document.documentElement.append(selectedLayer);
    }

    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = BANNER_ID;
      banner.innerHTML = `
        <div class="dh-banner-text">
          <strong>${ct("bannerTitle")}</strong>
          <span id="dh-selected-count">${ct("bannerHint")}</span>
        </div>
        <div class="dh-banner-actions">
          <button type="button" data-dh-action="cancel">${ct("cancel")}</button>
          <button type="button" data-dh-action="confirm" disabled>${ct("confirm")}</button>
        </div>
      `;
      banner.addEventListener("click", onBannerClick);
      document.documentElement.append(banner);
    }

    updateBanner();
    return { box, selectedLayer, banner };
  };

  const showToast = (message) => {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.documentElement.append(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.style.display = "none";
    }, 1600);
  };

  const hideOverlay = () => {
    const box = document.getElementById(BOX_ID);
    const banner = document.getElementById(BANNER_ID);
    const selectedLayer = document.getElementById(SELECTED_LAYER_ID);
    if (box) box.style.display = "none";
    if (banner) banner.remove();
    if (selectedLayer) selectedLayer.remove();
  };

  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      width: Math.min(window.innerWidth, rect.width),
      height: Math.min(window.innerHeight, rect.height)
    };
  };

  const paintHighlight = (element) => {
    const { box } = ensureOverlay();
    const rect = rectFor(element);
    box.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  };

  const updateBanner = () => {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) return;
    const count = banner.querySelector("#dh-selected-count");
    const confirm = banner.querySelector('[data-dh-action="confirm"]');
    if (count) {
      count.textContent = selectedRules.length ? ct("selectedCount", selectedRules.length) : ct("bannerHint");
    }
    if (confirm) {
      confirm.disabled = selectedRules.length === 0;
    }
  };

  const paintSelected = () => {
    const { selectedLayer } = ensureOverlay();
    selectedLayer.replaceChildren();

    for (const [index, rule] of selectedRules.entries()) {
      if (!rule.element || !document.documentElement.contains(rule.element)) continue;
      const rect = rectFor(rule.element);
      if (rect.width <= 0 || rect.height <= 0) continue;

      const marker = document.createElement("div");
      marker.className = "dh-selected-box";
      marker.style.left = `${rect.left}px`;
      marker.style.top = `${rect.top}px`;
      marker.style.width = `${rect.width}px`;
      marker.style.height = `${rect.height}px`;
      marker.dataset.index = String(index + 1);
      selectedLayer.append(marker);
    }

    updateBanner();
  };

  const meaningfulClasses = (element) => {
    return Array.from(element.classList || [])
      .filter((name) => name && name.length <= 48)
      .filter((name) => !/^(active|selected|hover|focus|show|hide|open|closed)$/i.test(name))
      .filter((name) => !/^\d/.test(name))
      .slice(0, 4);
  };

  const countMatches = (selector) => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };

  const uniqueSelector = (selector) => countMatches(selector) === 1;

  const attrSelectors = (element) => {
    const tag = element.localName;
    const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name", "role", "title"];
    return attrs
      .map((attr) => {
        const value = element.getAttribute(attr);
        if (!value || value.length > 80) return null;
        return `${tag}[${attr}="${attrEscape(value)}"]`;
      })
      .filter(Boolean);
  };

  const nthOfType = (element) => {
    let index = 1;
    let sibling = element;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.localName === element.localName) index += 1;
    }
    return `${element.localName}:nth-of-type(${index})`;
  };

  const segmentFor = (element, includeNth) => {
    if (!element || !element.localName) return "";
    if (element.id && uniqueSelector(`#${cssEscape(element.id)}`)) {
      return `#${cssEscape(element.id)}`;
    }

    const classPart = meaningfulClasses(element)
      .slice(0, 3)
      .map((name) => `.${cssEscape(name)}`)
      .join("");
    const base = `${element.localName}${classPart}`;
    if (!includeNth && classPart) {
      return base;
    }
    return includeNth ? `${base || element.localName}:nth-of-type(${nthOfTypeIndex(element)})` : element.localName;
  };

  const nthOfTypeIndex = (element) => {
    let index = 1;
    let sibling = element;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.localName === element.localName) index += 1;
    }
    return index;
  };

  const buildExactSelector = (element) => {
    if (element.id && uniqueSelector(`#${cssEscape(element.id)}`)) {
      return `#${cssEscape(element.id)}`;
    }

    for (const selector of attrSelectors(element)) {
      if (uniqueSelector(selector)) return selector;
    }

    const path = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      path.unshift(segmentFor(node, false));
      const candidate = path.join(" > ");
      if (uniqueSelector(candidate)) return candidate;

      const nthPath = [...path];
      nthPath[0] = segmentFor(node, true);
      const nthCandidate = nthPath.join(" > ");
      if (uniqueSelector(nthCandidate)) return nthCandidate;

      node = node.parentElement;
      if (path.length >= 7) break;
    }

    const fullPath = [];
    node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      fullPath.unshift(nthOfType(node));
      node = node.parentElement;
      if (fullPath.length >= 8) break;
    }
    return fullPath.join(" > ");
  };

  const similarCandidatesFor = (element) => {
    const selectors = [];
    const tag = element.localName;
    const classes = meaningfulClasses(element);
    const dataAttrs = ["data-testid", "data-test", "data-cy"];

    if (classes.length) {
      selectors.push(`${tag}.${cssEscape(classes[0])}`);
      selectors.push(`${tag}.${classes.slice(0, 2).map(cssEscape).join(".")}`);
      selectors.push(`.${cssEscape(classes[0])}`);
    }

    for (const attr of dataAttrs) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 80) {
        selectors.push(`${tag}[${attr}="${attrEscape(value)}"]`);
      }
    }

    return Array.from(new Set(selectors)).filter(Boolean);
  };

  const buildSimilarSelector = (element) => {
    const pool = [];
    let node = element;
    let depth = 0;

    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && depth < 4) {
      for (const selector of similarCandidatesFor(node)) {
        const count = countMatches(selector);
        if (count > 1 && count <= 120) {
          pool.push({ selector, count, depth });
        }
      }
      node = node.parentElement;
      depth += 1;
    }

    pool.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return Math.abs(a.count - 6) - Math.abs(b.count - 6);
    });

    return pool[0]?.selector || buildExactSelector(element);
  };

  const readableLabel = (element) => {
    const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 64);
    const id = element.id ? `#${element.id}` : "";
    const cls = meaningfulClasses(element)[0] ? `.${meaningfulClasses(element)[0]}` : "";
    return `${element.localName}${id}${cls}`;
  };

  const draftRuleForElement = (element) => {
    const selector = pickMode === "similar" ? buildSimilarSelector(element) : buildExactSelector(element);
    return {
      id: nowId(),
      selector,
      label: readableLabel(element),
      mode: pickMode,
      createdAt: Date.now(),
      page: location.href,
      element
    };
  };

  const toggleSelectedElement = (element) => {
    const nextRule = draftRuleForElement(element);
    const existingIndex = selectedRules.findIndex((rule) => rule.selector === nextRule.selector);
    if (existingIndex >= 0) {
      selectedRules.splice(existingIndex, 1);
      showToast(ct("deselected"));
    } else {
      selectedRules.push(nextRule);
      showToast(pickMode === "similar" ? ct("similarSelected") : ct("itemSelected"));
    }
    paintSelected();
  };


        const playDissolveAnimation = async (elements) => {
    if (!elements.length) return;
    const parseColor = (s) => {
      if (!s) return null;
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return [+m[1],+m[2],+m[3]];
      return null;
    };
    const getColors = (el) => {
      const cs = [];
      try {
        const st = getComputedStyle(el);
        for (const p of ["color","backgroundColor","borderTopColor","borderLeftColor","borderBottomColor","borderRightColor"]) {
          const v = st[p];
          if (v && v !== "transparent") cs.push(v);
        }
        for (const ch of el.querySelectorAll("*")) {
          try { const v = getComputedStyle(ch).color; if (v && v !== "transparent") cs.push(v); } catch(e) {}
        }
      } catch(e) {}
      const out = [];
      for (const c of cs) { const p = parseColor(c); if (p) out.push(p); }
      return out.length ? out : null;
    };
    const pal = [[255,99,132],[255,205,86],[75,192,192],[54,162,235],[153,102,255],[100,220,180],[255,182,193],[240,128,128],[175,238,238],[100,149,237],[255,218,160],[200,150,255],[152,255,152],[135,206,250],[255,255,255]];
    const sheet = document.createElement("style");
    sheet.textContent = "@keyframes dhF{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.5)}}@keyframes dhP{0%{opacity:1;transform:translate(0,0) scale(1) rotate(0deg)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0.2) rotate(var(--dr))}}";
    document.head.appendChild(sheet);
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(wrap);
    for (const el of elements) {
      if (!el || !document.documentElement.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const flash = document.createElement("div");
      flash.style.cssText = "position:fixed;left:"+r.left+"px;top:"+r.top+"px;width:"+r.width+"px;height:"+r.height+"px;background:rgba(255,255,255,0.6);border-radius:"+(getComputedStyle(el).borderRadius||"0")+";animation:dhF 0.3s ease-out forwards;";
      wrap.appendChild(flash);
      const ec = getColors(el);
      const use = ec&&ec.length ? ec.concat(pal) : pal;
      const area = r.width * r.height;
      const count = Math.min(200, Math.max(30, Math.round(area / 80)));
      for (let i = 0; i < count; i++) {
        const col = use[Math.random()*use.length|0];
        const size = 2 + Math.random() * 5;
        const ang = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 100;
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist - 20;
        const dr = (Math.random() - 0.5) * 720;
        const dur = 400 + Math.random() * 600;
        const p = document.createElement("div");
        p.style.cssText = "position:fixed;left:"+(r.left + Math.random()*r.width)+"px;top:"+(r.top + Math.random()*r.height)+"px;width:"+size+"px;height:"+size+"px;background:rgb("+col[0]+","+col[1]+","+col[2]+");border-radius:"+(Math.random()>0.5?"50%":"2px")+";";
        p.style.setProperty("--dx", dx+"px");
        p.style.setProperty("--dy", dy+"px");
        p.style.setProperty("--dr", dr+"deg");
        p.style.animation = "dhP "+dur+"ms ease-out forwards";
        wrap.appendChild(p);
      }
    }
    await new Promise(r => setTimeout(r, 1200));
    wrap.remove(); sheet.remove();
  };
const confirmSelection = async () => {
    if (!selectedRules.length) return;

    const selectors = new Set(selectedRules.map((rule) => rule.selector));
    const rules = siteState.rules.filter((rule) => !selectors.has(rule.selector));
    for (const rule of selectedRules) {
      const { element: _element, ...storedRule } = rule;
      rules.push(storedRule);
    }

    const animElements = selectedRules.map((r) => r.element).filter(Boolean);
    const count = selectedRules.length;
    stopPicking();
    await playDissolveAnimation(animElements);
    await saveCurrentSiteState({ ...siteState, rules });
    showToast(ct("hiddenCount", count));
  };

  const cancelSelection = () => {
    stopPicking();
    showToast(ct("cancelled"));
  };

  const onBannerClick = (event) => {
    const button = event.target.closest("[data-dh-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.dhAction === "confirm") {
      confirmSelection().catch((error) => showToast(ct("hideFailed", error.message)));
      return;
    }
    if (button.dataset.dhAction === "cancel") {
      cancelSelection();
    }
  };

  const onMove = (event) => {
    if (!picking || isExtensionUi(event.target)) return;
    const element = event.target;
    if (!element || element === document.documentElement || element === document.body) return;
    currentTarget = element;
    paintHighlight(element);
  };

  const onClick = async (event) => {
    if (!picking || !currentTarget || isExtensionUi(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const element = currentTarget;
    try {
      toggleSelectedElement(element);
    } catch (error) {
      showToast(ct("hideFailed", error.message));
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      cancelSelection();
      return;
    }
    if (event.key === "Enter" && selectedRules.length) {
      event.preventDefault();
      confirmSelection().catch((error) => showToast(ct("hideFailed", error.message)));
    }
  };

  const onScroll = () => {
    if (picking && currentTarget) {
      paintHighlight(currentTarget);
    }
    if (picking && selectedRules.length) {
      paintSelected();
    }
  };

  const startPicking = (mode = "exact") => {
    if (picking) {
      stopPicking();
    }
    pickMode = mode;
    picking = true;
    currentTarget = null;
    selectedRules = [];
    ensureOverlay();
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);
  };

  const stopPicking = () => {
    picking = false;
    currentTarget = null;
    selectedRules = [];
    hideOverlay();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll, true);
  };

  const undoLast = async () => {
    const rules = siteState.rules.slice(0, -1);
    await saveCurrentSiteState({ ...siteState, rules });
    showToast(ct("undoToast"));
  };

  const clearSite = async () => {
    await saveCurrentSiteState({ enabled: true, rules: [] });
    showToast(ct("siteRestored"));
  };

  const removeRule = async (id) => {
    const rules = siteState.rules.filter((rule) => rule.id !== id);
    await saveCurrentSiteState({ ...siteState, rules });
  };

  const toggleSite = async () => {
    await saveCurrentSiteState({ ...siteState, enabled: !siteState.enabled });
    showToast(siteState.enabled ? ct("rulesEnabled") : ct("rulesPaused"));
  };

  const stateResponse = () => ({
    ok: true,
    hostname: hostname(),
    scriptVersion: SCRIPT_VERSION,
    supportsBatchSelection: true,
    ...siteState
  });

  const onRuntimeMessage = (message, _sender, sendResponse) => {
    (async () => {
      if (message.type === "GET_STATE") {
        siteState = await getCurrentSiteState();
        applyRules();
        return stateResponse();
      }
      if (message.type === "START_PICKING") {
        startPicking(message.mode === "similar" ? "similar" : "exact");
        return stateResponse();
      }
      if (message.type === "UNDO_LAST") {
        await undoLast();
        return stateResponse();
      }
      if (message.type === "CLEAR_SITE") {
        await clearSite();
        return stateResponse();
      }
      if (message.type === "REMOVE_RULE") {
        await removeRule(message.id);
        return stateResponse();
      }
      if (message.type === "TOGGLE_SITE") {
        await toggleSite();
        return stateResponse();
      }
      if (message.type === "SET_LANGUAGE") {
        __lang = message.language || "zh";
        const banner = document.getElementById(BANNER_ID);
        if (banner) {
          const strong = banner.querySelector(".dh-banner-text strong");
          const span = banner.querySelector("#dh-selected-count");
          const cancel = banner.querySelector('[data-dh-action="cancel"]');
          const confirm = banner.querySelector('[data-dh-action="confirm"]');
          if (strong) strong.textContent = ct("bannerTitle");
          if (span) span.textContent = ct("bannerHint");
          if (cancel) cancel.textContent = ct("cancel");
          if (confirm) confirm.textContent = ct("confirm");
        }
        return { ok: true };
      }
      return { ok: false, error: "Unknown message" };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[STORE_KEY]) return;
    getCurrentSiteState().then((nextState) => {
      siteState = nextState;
      applyRules();
    });
  });

  const boot = async () => {
    await loadContentLang();
    siteState = await getCurrentSiteState();
    applyRules();
  };

  window.__distractionHiderController = {
    version: SCRIPT_VERSION,
    startPicking,
    dispose() {
      stopPicking();
      try {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch {
        // The listener may already belong to an invalidated extension context.
      }
    }
  };

  boot();
})();
