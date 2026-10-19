// 共享特关规则模块：匹配精度与添加规则的合并语义。
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchWatchRules, mergeWatchRuleInput, getWatchAuthorLabel, removeWatchRuleKeyword } = require('./watch-rules.js');

const matches = (source, rule, title = 't') =>
  matchWatchRules({ source, title, summary: '' }, [{ id: 'r', ...rule }]).length > 0;

test('source type: short english terms need a word-bounded prefix, others match substrings', () => {
  assert.equal(matches('X：Waymo (@Waymo)', { source: 'X' }), true);
  assert.equal(matches('x：Waymo (@Waymo)', { source: 'X' }), true);
  assert.equal(matches('Xiaomi：Blog', { source: 'X' }), false);
  assert.equal(matches('Tripo（官方 X）', { source: 'X' }), false);
  assert.equal(matches('IT之家·人工智能', { source: 'IT之家' }), true);
  assert.equal(matches('IT之家·人工智能', { source: '人工智能' }), true);
  assert.equal(matches('Hugging Face 社区博客（混合发现）', { source: 'Hugging Face' }), true);
  assert.equal(matches('公众号：腾讯混元', { source: '公众号' }), true);
});

test('author matches name, handle or alias but not an affiliation or channel note', () => {
  assert.equal(matches('X：Vaibhav Srivastav（OpenAI）(@reach_vb)', { author: 'OpenAI' }), false);
  assert.equal(matches('X：Vaibhav Srivastav（OpenAI）(@reach_vb)', { author: 'Vaibhav' }), true);
  assert.equal(matches('X：可灵 Kling AI (@Kling_ai)', { author: '@kling_ai' }), true);
  assert.equal(matches('X：可灵 Kling AI (@Kling_ai)', { author: '可灵' }), true);
  assert.equal(matches('公众号：昆仑万维（天工）', { author: '天工' }), true);
  assert.equal(matches('Waymo：Blog（网页）', { author: '网页' }), false);
  assert.equal(matches('NVIDIA：Newsroom（RSS）', { author: 'RSS' }), false);
  assert.equal(matches('IT之家·人工智能', { author: 'IT之家' }), true);
});

test('short english keywords match whole words; longer and chinese keywords match substrings', () => {
  assert.equal(matches('S', { keywords: ['AI'] }, 'He said it rains'), false);
  assert.equal(matches('S', { keywords: ['AI'] }, 'OpenAI ships'), false);
  assert.equal(matches('S', { keywords: ['AI'] }, '用AI做视频'), true);
  assert.equal(matches('S', { keywords: ['AI'] }, 'AIs everywhere'), true);
  assert.equal(matches('S', { keywords: ['GPT'] }, 'ChatGPT 上线'), true);
  assert.equal(matches('S', { keywords: ['LLM'] }, 'New LLMs released'), true);
  assert.equal(matches('S', { keywords: ['gpt'] }, 'GPT-5.6 Sol'), true);
  assert.equal(matches('S', { keywords: ['模型'] }, '大模型发布'), true);
  assert.equal(matches('S', { keywords: ['Claude Code'] }, 'Claude Code 6个实用Hook玩法'), true);
});

test('disabled and empty rules never match', () => {
  assert.equal(matches('X：A', { source: 'X', enabled: false }), false);
  assert.equal(matches('X：A', {}), false);
});

test('adding a rule never narrows an existing rule', () => {
  const broad = [{ id: 'a', source: '', author: 'OpenAI', keywords: [], enabled: true }];
  const covered = mergeWatchRuleInput(broad, { author: 'openai', keywords: ['GPT'] });
  assert.equal(covered.outcome, 'covered');
  assert.deepEqual(covered.rules[0].keywords, []);

  const narrow = [{ id: 'a', source: '', author: 'OpenAI', keywords: ['GPT'], enabled: true }];
  const broadened = mergeWatchRuleInput(narrow, { author: 'OpenAI' });
  assert.equal(broadened.outcome, 'broadened');
  assert.deepEqual(broadened.rules[0].keywords, []);

  const merged = mergeWatchRuleInput(narrow, { author: 'OpenAI', keywords: ['Sora, gpt'] });
  assert.equal(merged.outcome, 'merged');
  assert.deepEqual(merged.rules[0].keywords, ['GPT', 'Sora']);
  assert.equal(mergeWatchRuleInput(narrow, { author: 'OpenAI', keywords: ['gpt'] }).outcome, 'duplicate');
});

test('adding next to a disabled rule re-enables it instead of creating an overlapping rule', () => {
  const disabled = [{ id: 'a', source: '', author: 'OpenAI', keywords: ['GPT'], enabled: false }];
  const result = mergeWatchRuleInput(disabled, { author: 'openai', keywords: ['Sora'] }, { id: 'b' });
  assert.equal(result.outcome, 'reenabled');
  assert.deepEqual(result.rules.map(rule => [rule.id, rule.enabled, rule.keywords]), [['a', true, ['GPT', 'Sora']]]);
  const broadened = mergeWatchRuleInput(disabled, { author: 'OpenAI' });
  assert.deepEqual(broadened.rules.map(rule => [rule.enabled, rule.keywords]), [[true, []]]);
});

test('an enabled duplicate wins over a disabled one', () => {
  const rules = [
    { id: 'off', source: '', author: 'OpenAI', keywords: ['GPT'], enabled: false },
    { id: 'on', source: '', author: 'OpenAI', keywords: ['Sora'], enabled: true }
  ];
  const result = mergeWatchRuleInput(rules, { author: 'OpenAI', keywords: ['o3'] });
  assert.equal(result.ruleId, 'on');
  assert.equal(result.rules.find(rule => rule.id === 'off').enabled, false);
});

test('removing the last keyword of a keyword-only rule removes the rule', () => {
  const rules = [{ id: 'a', source: '', author: '', keywords: ['GPT'], enabled: true }];
  assert.deepEqual(removeWatchRuleKeyword(rules, 'a', 0), []);
});

test('notification label uses the author name without notes or handle', () => {
  assert.equal(getWatchAuthorLabel('X：Arthur Mensch（Mistral CEO） (@arthurmensch)'), 'Arthur Mensch');
  assert.equal(getWatchAuthorLabel('IT之家·人工智能'), 'IT之家·人工智能');
});
