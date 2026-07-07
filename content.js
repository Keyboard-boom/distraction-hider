(() => {
  if (window.__distractionHiderLoaded) {
    return;
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
          <strong>选择要隐藏的项目</strong>
          <span id="dh-selected-count">点击页面元素，可连续多选</span>
        </div>
        <div class="dh-banner-actions">
          <button type="button" data-dh-action="cancel">取消</button>
          <button type="button" data-dh-action="confirm" disabled>确认隐藏</button>
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
      count.textContent = selectedRules.length ? `已选 ${selectedRules.length} 项` : "点击页面元素，可连续多选";
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
      showToast("已取消选择");
    } else {
      selectedRules.push(nextRule);
      showToast(pickMode === "similar" ? "已选择相似项目" : "已选择项目");
    }
    paintSelected();
  };

  const confirmSelection = async () => {
    if (!selectedRules.length) return;

    const selectors = new Set(selectedRules.map((rule) => rule.selector));
    const rules = siteState.rules.filter((rule) => !selectors.has(rule.selector));
    for (const rule of selectedRules) {
      const { element: _element, ...storedRule } = rule;
      rules.push(storedRule);
    }

    const count = selectedRules.length;
    stopPicking();
    await saveCurrentSiteState({ ...siteState, rules });
    showToast(`已隐藏 ${count} 项`);
  };

  const cancelSelection = () => {
    stopPicking();
    showToast("已取消");
  };

  const onBannerClick = (event) => {
    const button = event.target.closest("[data-dh-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.dhAction === "confirm") {
      confirmSelection().catch((error) => showToast(`隐藏失败：${error.message}`));
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
      showToast(`选择失败：${error.message}`);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      cancelSelection();
      return;
    }
    if (event.key === "Enter" && selectedRules.length) {
      event.preventDefault();
      confirmSelection().catch((error) => showToast(`隐藏失败：${error.message}`));
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
    showToast("已撤销上一条隐藏规则");
  };

  const clearSite = async () => {
    await saveCurrentSiteState({ enabled: true, rules: [] });
    showToast("已恢复当前站点");
  };

  const removeRule = async (id) => {
    const rules = siteState.rules.filter((rule) => rule.id !== id);
    await saveCurrentSiteState({ ...siteState, rules });
  };

  const toggleSite = async () => {
    await saveCurrentSiteState({ ...siteState, enabled: !siteState.enabled });
    showToast(siteState.enabled ? "隐藏规则已开启" : "隐藏规则已暂停");
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === "GET_STATE") {
        siteState = await getCurrentSiteState();
        applyRules();
        return { ok: true, hostname: hostname(), ...siteState };
      }
      if (message.type === "START_PICKING") {
        startPicking(message.mode === "similar" ? "similar" : "exact");
        return { ok: true, hostname: hostname(), ...siteState };
      }
      if (message.type === "UNDO_LAST") {
        await undoLast();
        return { ok: true, ...siteState };
      }
      if (message.type === "CLEAR_SITE") {
        await clearSite();
        return { ok: true, ...siteState };
      }
      if (message.type === "REMOVE_RULE") {
        await removeRule(message.id);
        return { ok: true, ...siteState };
      }
      if (message.type === "TOGGLE_SITE") {
        await toggleSite();
        return { ok: true, ...siteState };
      }
      return { ok: false, error: "Unknown message" };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[STORE_KEY]) return;
    getCurrentSiteState().then((nextState) => {
      siteState = nextState;
      applyRules();
    });
  });

  const boot = async () => {
    siteState = await getCurrentSiteState();
    applyRules();
  };

  boot();
})();
