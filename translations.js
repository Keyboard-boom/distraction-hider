const TRANSLATIONS = {
  zh: {
    appName:        '隐藏干扰器',
    loading:        '读取当前页面...',
    pickExact:      '选择隐藏',
    pickSimilar:    '隐藏相似',
    sectionTitle:   '本站规则',
    emptyState:     '还没有隐藏任何项目',
    pageUnavailable:'当前页面不可用',
    noResponse:     '页面没有响应',
    scriptNotUpdated:'页面脚本仍未更新，请刷新当前网页后重试',
    cannotStart:    '无法开始选择',
    pageNotSupported:'这个页面不支持隐藏规则',
    hiddenLabel:    '隐藏项目',
    similarLabel:   '相似项目',
    deleteRule:     '删除这条规则',
    bannerTitle:    '选择要隐藏的项目',
    bannerHint:     '点击页面元素，可连续多选',
    selectedCount:  '已选 {0} 项',
    cancel:         '取消',
    confirm:        '确认隐藏',
    deselected:     '已取消选择',
    similarSelected:'已选择相似项目',
    itemSelected:   '已选择项目',
    hiddenCount:    '已隐藏 {0} 项',
    cancelled:      '已取消',
    hideFailed:     '隐藏失败：{0}',
    undoToast:      '已撤销上一条隐藏规则',
    siteRestored:   '已恢复当前站点',
    rulesEnabled:   '隐藏规则已开启',
    rulesPaused:    '隐藏规则已暂停',
    undoTitle:      '撤销上一条规则',
    clearTitle:     '恢复当前站点',
    langLabel:      'English',
    langTitle:      '切换到英文',
    toggleTitle:    '启用或暂停本站规则',
    actionsLabel:   '隐藏操作',
    toolsLabel:     '管理规则',
    rulesLabel:     '当前站点规则',
  },
  en: {
    appName:        'Distraction Hider',
    loading:        'Reading current page...',
    pickExact:      'Hide Element',
    pickSimilar:    'Hide Similar',
    sectionTitle:   'Site Rules',
    emptyState:     'No items hidden yet',
    pageUnavailable:'Current page unavailable',
    noResponse:     'Page did not respond',
    scriptNotUpdated:'Script not loaded, please refresh and try again',
    cannotStart:    'Cannot start selection',
    pageNotSupported:'This page does not support hide rules',
    hiddenLabel:    'Hidden',
    similarLabel:   'Similar',
    deleteRule:     'Delete this rule',
    bannerTitle:    'Select elements to hide',
    bannerHint:     'Click elements, select multiple',
    selectedCount:  '{0} selected',
    cancel:         'Cancel',
    confirm:        'Hide',
    deselected:     'Deselected',
    similarSelected:'Similar items selected',
    itemSelected:   'Item selected',
    hiddenCount:    'Hidden {0} items',
    cancelled:      'Cancelled',
    hideFailed:     'Hide failed: {0}',
    undoToast:      'Undone last hide rule',
    siteRestored:   'Site restored',
    rulesEnabled:   'Hide rules enabled',
    rulesPaused:    'Hide rules paused',
    undoTitle:      'Undo last rule',
    clearTitle:     'Reset current site',
    langLabel:      '中文',
    langTitle:      'Switch to Chinese',
    toggleTitle:    'Enable or pause site rules',
    actionsLabel:   'Hide actions',
    toolsLabel:     'Manage rules',
    rulesLabel:     'Site rules',
  }
};

const DEFAULT_LANG = 'zh';

// In-memory language cache (kept in sync with storage)
let __lang = DEFAULT_LANG;

function t(key, ...args) {
  let str = TRANSLATIONS[__lang]?.[key];
  if (!str) str = TRANSLATIONS[DEFAULT_LANG]?.[key] || key;
  if (args.length) {
    str = str.replace(/\{(\d+)\}/g, (_, i) => {
      const idx = parseInt(i, 10);
      return idx < args.length ? String(args[idx]) : '';
    });
  }
  return str;
}

async function loadLang() {
  const result = await chrome.storage.sync.get('language');
  __lang = result.language || DEFAULT_LANG;
  return __lang;
}

async function saveLang(lang) {
  __lang = lang;
  await chrome.storage.sync.set({ language: lang });
}

function getLang() {
  return __lang;
}

function getOtherLang() {
  return __lang === 'zh' ? 'en' : 'zh';
}
