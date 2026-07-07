const state = {
  tabId: null,
  url: null,
  hostname: "",
  enabled: true,
  rules: []
};

const ui = {
  busy: false,
  ready: false
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  siteLabel: $("#siteLabel"),
  toggleSite: $("#toggleSite"),
  toggleIcon: $("#toggleIcon"),
  langToggle: $("#langToggle"),
  pickExact: $("#pickExact"),
  pickSimilar: $("#pickSimilar"),
  undoLast: $("#undoLast"),
  clearSite: $("#clearSite"),
  ruleCount: $("#ruleCount"),
  ruleList: $("#ruleList"),
  emptyState: $("#emptyState"),
  errorText: $("#errorText")
};

const setError = (message = "") => {
  elements.errorText.textContent = message;
};

const renderControlState = () => {
  const unavailable = ui.busy || !ui.ready;
  elements.pickExact.disabled = unavailable;
  elements.pickSimilar.disabled = unavailable;
  elements.toggleSite.disabled = unavailable;
  elements.undoLast.disabled = unavailable || state.rules.length === 0;
  elements.clearSite.disabled = unavailable || state.rules.length === 0;
  for (const button of elements.ruleList.querySelectorAll("button")) {
    button.disabled = unavailable;
  }
};

const setBusy = (busy) => {
  ui.busy = busy;
  renderControlState();
};
const updateI18n = () => {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  }
  document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
};

const sendToTab = (message) => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || response.ok === false) {
        reject(new Error(response?.error || t("noResponse")));
        return;
      }
      resolve(response);
    });
  });
};

const injectContentScript = async () => {
  await chrome.scripting.insertCSS({
    target: { tabId: state.tabId },
    files: ["content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    files: ["content.js"]
  });
};

const getPageState = async () => {
  try {
    const response = await sendToTab({ type: "GET_STATE" });
    if (response.supportsBatchSelection) {
      return response;
    }
    await injectContentScript();
    return sendToTab({ type: "GET_STATE" });
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) {
      throw error;
    }
    await injectContentScript();
    return sendToTab({ type: "GET_STATE" });
  }
};

const startPickingOnPage = async (mode) => {
  await injectContentScript();
  const scriptNotUpdatedMsg = t("scriptNotUpdated");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    func: (nextMode, scriptNotUpdatedMsg) => {
      const controller = window.__distractionHiderController;
      if (!controller || typeof controller.startPicking !== "function") {
        return { ok: false, error: scriptNotUpdatedMsg };
      }
      controller.startPicking(nextMode === "similar" ? "similar" : "exact");
      return { ok: true, scriptVersion: controller.version, supportsBatchSelection: true };
    },
    args: [mode, scriptNotUpdatedMsg]
  });

  if (!result?.result?.ok) {
    throw new Error(result?.result?.error || t("cannotStart"));
  }
  return result.result;
};

const hostnameFromUrl = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

const render = () => {
  elements.siteLabel.textContent = state.hostname || t("pageUnavailable");
  elements.toggleSite.classList.toggle("is-on", state.enabled);
  elements.toggleSite.setAttribute("aria-checked", String(state.enabled));
  elements.ruleCount.textContent = String(state.rules.length);
  elements.undoLast.disabled = state.rules.length === 0;
  elements.clearSite.disabled = state.rules.length === 0;
  elements.ruleList.replaceChildren();

  elements.emptyState.style.display = state.rules.length ? "none" : "block";

  for (const rule of [...state.rules].reverse()) {
    const item = document.createElement("li");

    const label = document.createElement("div");
    label.className = "rule-label";

    const title = document.createElement("strong");
    title.textContent = rule.label || (rule.mode === "similar" ? t("similarLabel") : t("hiddenLabel"));

    const selector = document.createElement("span");
    selector.textContent = rule.selector;

    const remove = document.createElement("button");
    remove.className = "delete-rule";
    remove.type = "button";
    remove.title = t("deleteRule");
    remove.setAttribute("aria-label", t("deleteRule"));
    remove.textContent = "×";
    remove.disabled = ui.busy || !ui.ready;
    remove.addEventListener("click", () => runCommand({ type: "REMOVE_RULE", id: rule.id }));

    label.append(title, selector);
    item.append(label, remove);
    elements.ruleList.append(item);
  }
  renderControlState();
};

const applyResponse = (response) => {
  state.hostname = response.hostname || state.hostname;
  state.enabled = response.enabled !== false;
  state.rules = Array.isArray(response.rules) ? response.rules : [];
  render();
};

const runCommand = async (message, closeAfter = false) => {
  setError();
  setBusy(true);
  try {
    if (message.type === "START_PICKING") {
      const response = await startPickingOnPage(message.mode);
      if (response.supportsBatchSelection && closeAfter) window.close();
      return;
    }
    const response = await sendToTab(message);
    applyResponse(response);
    if (closeAfter) window.close();
  } catch (error) {
    setError(error.message);
  } finally {
    setBusy(false);
  }
};

const init = async () => {
  await loadLang();
  updateI18n();
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id;
    state.url = tab?.url || "";
    state.hostname = hostnameFromUrl(state.url);

    if (!state.tabId || !/^https?:|^file:/.test(state.url)) {
      throw new Error(t("pageNotSupported"));
    }

    const response = await getPageState();
    ui.ready = true;
    applyResponse(response);
  } catch (error) {
    ui.ready = false;
    elements.siteLabel.textContent = state.hostname || t("pageUnavailable");
    setError(error.message);
    renderControlState();
  } finally {
    setBusy(false);
  }
};

elements.langToggle.addEventListener("click", async () => {
  const newLang = getOtherLang();
  await saveLang(newLang);
  updateI18n();
  render();
  try {
    chrome.tabs.sendMessage(state.tabId, { type: "SET_LANGUAGE", language: newLang });
  } catch {}
});
elements.pickExact.addEventListener("click", () => runCommand({ type: "START_PICKING", mode: "exact" }, true));
elements.pickSimilar.addEventListener("click", () => runCommand({ type: "START_PICKING", mode: "similar" }, true));
elements.undoLast.addEventListener("click", () => runCommand({ type: "UNDO_LAST" }));
elements.clearSite.addEventListener("click", () => runCommand({ type: "CLEAR_SITE" }));
elements.toggleSite.addEventListener("click", () => runCommand({ type: "TOGGLE_SITE" }));

init();
