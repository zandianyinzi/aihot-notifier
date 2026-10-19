// 特关规则：规则归一化、匹配与输入合并。后台与弹窗共享，避免两份实现漂移。
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WatchRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const ASCII_WORD = /[a-z0-9_]/;
  const SHORT_ASCII_TERM = /^[a-z0-9_]{1,2}$/;
  // 来源括号里的发布渠道标注，不是账号或产品别名。
  const CHANNEL_NOTE = /^(网页|网页版|官网|博客|rss|官方.*|混合发现)$/i;

  function splitWatchKeywords(value) {
    if (Array.isArray(value)) return value.flatMap(v => splitWatchKeywords(v)).filter(Boolean);
    return String(value || '').split(/[,，]/).map(v => v.trim()).filter(Boolean);
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  // 保留停用规则和用户顺序（顺序即优先级）；丢弃没有任何条件的空规则。
  function normalizeWatchRuleList(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.map((rule, index) => ({
      id: String(rule?.id || `wr_${index}`),
      source: String(rule?.source || '').trim(),
      author: String(rule?.author || '').trim(),
      keywords: splitWatchKeywords(rule?.keywords),
      enabled: rule?.enabled !== false,
      createdAt: rule?.createdAt || ''
    })).filter(rule => rule.source || rule.author || rule.keywords.length > 0);
  }

  function getEnabledWatchRules(rules) {
    return normalizeWatchRuleList(rules).filter(rule => rule.enabled);
  }

  // 来源格式示例：「X：Philipp Schmid（Google DeepMind 开发者体验） (@_philschmid)」、
  // 「公众号：昆仑万维（天工）」、「IT之家·人工智能」（无冒号时整串既是来源也是作者）。
  function parseWatchSource(source) {
    const text = String(source || '').trim();
    const separator = text.search(/[:：]/);
    const sourceType = separator < 0 ? text : text.slice(0, separator).trim();
    const authorText = separator < 0 ? text : text.slice(separator + 1).trim();
    const handles = Array.from(authorText.matchAll(/@([A-Za-z0-9_]+)/g), match => match[1]);
    const parentheticals = Array.from(authorText.matchAll(/[（(]([^（）()]*)[）)]/g), match => match[1].trim())
      .filter(value => value && !value.startsWith('@') && !CHANNEL_NOTE.test(value));
    const authorName = authorText.replace(/\s*[（(][^（）()]*[）)]/g, '').trim();
    // 带 @handle 的个人账号里，括号是任职说明（如「（OpenAI）」），不作为作者别名；
    // 其它来源里的括号通常是产品或账号别名（如「（天工）」），仍可匹配。
    const aliases = handles.length > 0 ? [] : parentheticals;
    return { sourceType, authorText, authorName: authorName || authorText, handles, aliases };
  }

  function isAsciiWordChar(char) {
    return Boolean(char) && ASCII_WORD.test(char);
  }

  // 1–2 个字符的英文/数字短词（如 AI、X）按整词匹配（允许复数 s），避免 AI 命中 said；
  // 更长的词和中文按子串匹配，保证 GPT 命中 ChatGPT。
  function includesTerm(haystack, needle) {
    const text = normalizeText(haystack);
    const term = normalizeText(needle);
    if (!term) return true;
    if (!SHORT_ASCII_TERM.test(term)) return text.includes(term);
    for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + 1)) {
      if (isAsciiWordChar(text[index - 1])) continue;
      const end = index + term.length;
      if (isAsciiWordChar(text[end]) && !(text[end] === 's' && !isAsciiWordChar(text[end + 1]))) continue;
      return true;
    }
    return false;
  }

  // 来源类型：英文短词（如 X）只按前缀 + 词边界匹配，不命中「Xiaomi」或「Tripo（官方 X）」；
  // 其它来源按子串匹配，「人工智能」可命中「IT之家·人工智能」。
  function matchesSourceType(sourceType, needle) {
    const text = normalizeText(sourceType);
    const term = normalizeText(needle);
    if (!term) return true;
    if (!SHORT_ASCII_TERM.test(term)) return text.includes(term);
    return text.startsWith(term) && !isAsciiWordChar(text[term.length]);
  }

  function matchesAuthor(parts, needle) {
    const term = normalizeText(needle).replace(/^@/, '');
    if (!term) return true;
    if (parts.handles.some(handle => normalizeText(handle) === term)) return true;
    return [parts.authorName, ...parts.aliases].some(value => includesTerm(value, term));
  }

  function matchWatchRules(item, rules) {
    const enabledRules = getEnabledWatchRules(rules);
    if (enabledRules.length === 0 || !item) return [];
    const parts = parseWatchSource(item.source);
    const keywordText = `${item.title || ''}\n${item.summary || ''}`;
    return enabledRules.filter(rule => {
      if (rule.source && !matchesSourceType(parts.sourceType, rule.source)) return false;
      if (rule.author && !matchesAuthor(parts, rule.author)) return false;
      if (rule.keywords.length > 0 && !rule.keywords.some(keyword => includesTerm(keywordText, keyword))) return false;
      return true;
    });
  }

  function getWatchAuthorLabel(source) {
    const parts = parseWatchSource(source);
    return parts.authorName || String(source || '').trim();
  }

  function unionKeywords(existing, incoming) {
    const merged = [...existing];
    incoming.forEach(keyword => {
      if (!merged.some(value => normalizeText(value) === normalizeText(keyword))) merged.push(keyword);
    });
    return merged;
  }

  // 添加规则时与「同来源 + 同作者」的规则合并，且不得缩小已有规则的匹配范围。
  // 优先合并已启用规则；只有停用的同名规则时重新启用它，避免出现两条重叠规则。
  // outcome: empty | added | merged | broadened | covered | duplicate | reenabled
  function mergeWatchRuleInput(rules, input, options = {}) {
    const normalized = normalizeWatchRuleList(rules);
    const source = String(input?.source || '').trim();
    const author = String(input?.author || '').trim();
    const keywords = splitWatchKeywords(input?.keywords);
    if (!source && !author && keywords.length === 0) return { rules: normalized, outcome: 'empty', ruleId: '' };
    const isSame = rule => normalizeText(rule.source) === normalizeText(source) && normalizeText(rule.author) === normalizeText(author);
    const sameRule = normalized.find(rule => rule.enabled && isSame(rule)) || normalized.find(isSame);
    if (!sameRule) {
      const nowIso = options.now || new Date().toISOString();
      const id = options.id || `wr_${Date.now()}`;
      return {
        rules: [...normalized, { id, source, author, keywords, enabled: true, createdAt: nowIso }],
        outcome: 'added',
        ruleId: id
      };
    }
    // 已有规则不限关键词时保持不限；新输入不限关键词时放宽；否则取并集。
    const nextKeywords = sameRule.keywords.length === 0 || keywords.length === 0
      ? []
      : unionKeywords(sameRule.keywords, keywords);
    const nextRules = normalized.map(rule => rule.id === sameRule.id ? { ...rule, keywords: nextKeywords, enabled: true } : rule);
    if (!sameRule.enabled) return { rules: nextRules, outcome: 'reenabled', ruleId: sameRule.id };
    if (sameRule.keywords.length === 0) {
      return { rules: normalized, outcome: keywords.length === 0 ? 'duplicate' : 'covered', ruleId: sameRule.id };
    }
    if (keywords.length === 0) return { rules: nextRules, outcome: 'broadened', ruleId: sameRule.id };
    if (nextKeywords.length === sameRule.keywords.length) return { rules: normalized, outcome: 'duplicate', ruleId: sameRule.id };
    return { rules: nextRules, outcome: 'merged', ruleId: sameRule.id };
  }

  function removeWatchRuleKeyword(rules, ruleId, keywordIndex) {
    return normalizeWatchRuleList(normalizeWatchRuleList(rules)
      .map(rule => rule.id === ruleId ? { ...rule, keywords: rule.keywords.filter((_, index) => index !== keywordIndex) } : rule));
  }

  return {
    splitWatchKeywords,
    normalizeWatchRuleList,
    getEnabledWatchRules,
    parseWatchSource,
    includesTerm,
    matchesSourceType,
    matchWatchRules,
    getWatchAuthorLabel,
    mergeWatchRuleInput,
    removeWatchRuleKeyword
  };
});
