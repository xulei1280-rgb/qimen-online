'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('./liuyao-engine.js');
const verdict = require('./liuyao-verdict.js');
const useGod = require('./liuyao-usegod.js');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const pages = ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html'];
const notice = 'AI 生成内容，可能有误，请勿据此作重要决定。';

function functions(html, names) {
  return names.map(name => {
    const match = html.match(new RegExp('(?:async )?function ' + name + '\\([^\\n]*?\\{[\\s\\S]*?\\n\\}'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
}

function node() {
  return { value: '', innerHTML: '', textContent: '', disabled: false, focus() {}, setSelectionRange() {}, classList: { toggle() {} } };
}

async function checkQimen() {
  const html = read('index.html');
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  element('aiMode').value = 'brief';
  const plate = { juInfo: {}, ganzhi: {}, kongWang: [], gongs: Array.from({ length: 10 }, () => ({})) };
  const oldRecord = { id: 1, questionType: 'health', tag: '健康疾病', name: '旧记录', data: plate, solarTime: { year: 2026, month: 11, day: 5 } };
  let sent;
  const context = {
    document: { getElementById: element }, plateData: plate, aiHistory: [], aiTopic: null,
    qimenAiRequestSeq: 0, aiCollapsed: {}, plateInputFingerprint: 'same',
    AUTO_HISTORY_STORAGE: 'auto', SAVED_HISTORY_STORAGE: 'saved',
    getRecords: () => [oldRecord], getLongitude: () => 120,
    currentPlateInputFingerprint: () => 'same', ensureCurrentPlate: () => true,
    getPalaceMarks: () => [], palaceStemText: () => '', getRiskWarnings: () => [],
    getJieQiNote: () => '', buildQimenBaziContext: () => '', cloneQimenBazi: () => null,
    esc: String, pad: value => String(value).padStart(2, '0'), renderAssistInfo: () => '', renderAIHistory: () => '',
    DeepSeekClient: { async requestFinal(options) { sent = options.messages; return { answer: '' }; } }
  };
  for (const name of ['refreshAssistInfo', 'clearQimenAiPending', 'showQimenAiPending', 'updateAiButtonLabel',
    'autoGrowQimenAiTextarea', 'setControlsFromTime', 'saveSolarSettings', 'refreshSolarPreview', 'renderQimenBaziLink', 'renderPlate',
    'renderSidePanel', 'renderStatus', 'setPlateActionsDisabled', 'setSideTab']) context[name] = () => {};
  vm.createContext(context);
  vm.runInContext(functions(html, ['getQuestionType', 'getQuestionTypeLabel', 'getPersonName',
    'getAiModeLabel', 'getUseGodHints', 'useQuestionTemplate', 'loadHistory', 'renderRecordList', 'analyzeWithAI']), context);
  context.useQuestionTemplate('wealth');
  assert.equal(element('question').value, '财务事务：这件事我需要注意什么、可以怎样理清思路？');
  await context.analyzeWithAI();
  assert.ok(sent[0].content.includes('不提供投资、收益或买卖建议'));
  assert.ok(sent[0].content.includes('不判断病情、疗效，涉及健康建议就医'));
  assert.ok(sent.at(-1).content.includes('不提供投资、收益或买卖建议'));
  assert.doesNotMatch(sent.at(-1).content, /投资建议|得失/);
  context.loadHistory(1, 'saved');
  assert.equal(element('questionType').value, 'general');
  assert.equal(context.getQuestionTypeLabel(context.getQuestionType()), '综合');
  context.renderRecordList('saved');
  assert.ok(element('historyList').innerHTML.includes('[综合]'));
  assert.doesNotMatch(element('historyList').innerHTML, /健康疾病/);
  assert.doesNotMatch(html, /健康疾病|value="health"|useQuestionTemplate\('health'\)/);
  console.log('PASS P0-1/P0-2 actual template, emitted prompts and legacy health restore');
}

async function checkLiuyao() {
  const html = read('liuyao.html');
  const plate = engine.buildPlate({ lines: [7, 7, 8, 7, 7, 6], monthGZ: '甲寅', dayGZ: '甲子' });
  const selected = { position: 2, relative: plate.lines[1].original.relative, confirmed: true };
  const nodes = new Map([['aiQuestion', node()], ['btnAI', node()]]);
  const sent = [];
  const context = {
    LiuyaoEngine: engine, LiuyaoVerdict: verdict, LiuyaoUseGod: useGod, currentPlate: plate,
    activeUseGod: () => selected, currentVerdict: null, aiRequestSeq: 0,
    document: { getElementById: id => nodes.get(id) },
    TOPIC_LABELS: {},
    esc: String, nl: String, setStatus() {}, persistCurrent: () => true, renderPlate() {},
    useGodSnapshotKey: item => String(item.position) + '|' + String(item.relative),
    DeepSeekClient: { async requestFinal(options) {
      sent.push(options.messages);
      return { answer: '{"evidenceIds":["B03","L02"],"ignored":"一定成功，能赢，能治好，能赚钱"}' };
    } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(functions(html, ['verdictCategory', 'computeVerdict', 'isHighRiskQuestion', 'renderVerdict',
    'renderVerdictDetails', 'renderAiHistory', 'buildAiKernelContext', 'aiPlateContext', 'symbolicAiAnswer',
    'validateLiuyaoAiAnswer', 'analyzeWithAI']), context);
  for (const question of ['这场官司能赢吗', '我女儿的病情会好吗', '能不能怀上', '这次投资能赚钱吗']) {
    assert.equal(verdict.isHighRisk(question), true, question);
    context.currentRecord = { id: question, question, questionType: 'other', useGod: selected, aiHistory: [] };
    context.currentUseGodAssessment = engine.buildUseGodAssessment({ plate, useGod: selected });
    assert.ok(context.computeVerdict(selected, context.currentUseGodAssessment).highRisk);
    assert.ok(context.renderVerdict().includes(verdict.highRiskNotice));
    assert.doesNotMatch(context.renderVerdictDetails(), /可能较大|多半能成|D[1-9]|总分/);
    const kernel = context.buildAiKernelContext();
    assert.equal(kernel.ruleVerdict, null);
    assert.doesNotMatch(context.aiPlateContext(kernel), /ruleVerdict|scores|arbitration|规则初断|可能较大|多半能成/);
    assert.equal(context.validateLiuyaoAiAnswer('能赢，一定成功', kernel).valid, false);
    assert.equal(context.validateLiuyaoAiAnswer('{"evidenceIds":["V01"]}', kernel).valid, false);
    const refused = context.validateLiuyaoAiAnswer('{"topicRefusal":true}', kernel);
    assert.equal(refused.topicRefusal, true);
    assert.ok(refused.answer.includes('一个卦只能问同一件事'));
    for (const follow of [question, '继续看看有哪些象意']) {
      nodes.get('aiQuestion').value = follow;
      await context.analyzeWithAI();
      const messages = sent.at(-1);
      assert.ok(messages[0].content.includes('不判断成败'));
      assert.equal(messages.filter(item => item.role === 'assistant').length, 0);
      assert.doesNotMatch(JSON.stringify(messages), /ruleVerdict|可能较大|多半能成/);
      const answer = context.currentRecord.aiHistory.at(-1).answer;
      assert.ok(answer.includes(verdict.highRiskNotice));
      assert.doesNotMatch(answer, /一定成功|能赢|能治好|能赚钱|可能较大|多半能成/);
    }
    context.currentRecord.aiHistory.push({ question, answer: '旧答一定成功，能赢，能治好', useGodSnapshot: selected });
    const history = context.renderAiHistory();
    assert.ok(history.includes(notice));
    assert.doesNotMatch(history, /旧答一定成功|能治好/);
    console.log('PASS P0-3 ' + question + ' conclusion / AI / follow-up / old history');
  }
  context.currentRecord = { question: '今晚喝啤酒吗', useGod: selected, aiHistory: [] };
  assert.equal(context.buildAiKernelContext(null, '这场官司能赢吗').highRisk, true);
  for (const question of ['治学', '比赛能赢吗', '病药']) {
    assert.equal(verdict.isHighRisk(question), false, question);
    context.currentRecord = { question, questionType: 'other', useGod: selected, aiHistory: [] };
    assert.equal(context.isHighRiskQuestion(), false, question);
    assert.equal(context.buildAiKernelContext().highRisk, undefined, question);
  }
  for (const category of ['lawsuit', 'medicine', 'illnessSelf', 'pregnancy']) assert.equal(verdict.isHighRisk('请继续', category), true);
  console.log('PASS P0-3 neutral questions and high-risk follow-up on ordinary chart');
}

async function checkConsent() {
  const storage = new Map();
  const dialogs = [];
  let sends = 0;
  let accept = true;
  function loadPage() {
    const footers = [];
    const context = {
      document: { readyState: 'complete', createElement: () => ({}), head: { appendChild() {} }, body: { appendChild(item) { footers.push(item); } } },
      localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      confirm: message => { dialogs.push(message); return accept; },
      async fetch(url) { if (url.endsWith('/api/credential')) return { ok: true, async json() { return { credential: 'a'.repeat(64) }; } }; sends++; return { ok: true, async json() { return { choices: [{ message: { content: 'test' } }] }; } }; }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(read('site-notice.js'), context);
    vm.runInContext(read('deepseek-client.js'), context);
    assert.ok(footers[0].innerHTML.includes('使用与数据说明'));
    assert.equal((footers[0].innerHTML.match(/<li>/g) || []).length, 3);
    assert.doesNotMatch(footers[0].innerHTML, /不收集个人信息/);
    assert.match(footers[0].innerHTML, /经本站服务转发给 DeepSeek/);
    for (const text of ['反馈内容', '联系方式', '订单记录']) assert.ok(footers[0].innerHTML.includes(text));
    return context;
  }
  for (const page of pages) {
    assert.ok(read(page).includes('site-notice.js?v=20261105.2'));
    await loadPage().DeepSeekClient.requestFinal({});
  }
  assert.equal(dialogs.length, 1);
  assert.equal(sends, 5);
  await loadPage().DeepSeekClient.requestFinal({ includeDiary: true });
  await loadPage().DeepSeekClient.requestFinal({ includeDiary: true });
  assert.equal(dialogs.length, 2);
  assert.ok(dialogs[1].includes('将同时发送所勾选的日记内容'));
  storage.clear(); dialogs.length = 0;
  await loadPage().DeepSeekClient.requestFinal({ includeDiary: true });
  assert.equal(dialogs.length, 1);
  assert.ok(dialogs[0].includes('盘面和问题将发送至 DeepSeek'));
  assert.ok(dialogs[0].includes('将同时发送所勾选的日记内容'));
  storage.clear(); accept = false;
  const before = sends;
  await assert.rejects(loadPage().DeepSeekClient.requestFinal({ includeDiary: true }), /已取消发送/);
  assert.equal(sends, before);
  assert.equal(storage.size, 0);
  console.log('PASS P0-7 shared cross-page consent, diary scope, combined dialog and denial without network');
}

async function main() {
  for (const page of pages) {
    const html = read(page);
    const descriptions = [...html.matchAll(/<meta name="description" content="([^"]+)">/g)];
    assert.equal(descriptions.length, 1, page);
    assert.ok([...descriptions[0][1]].length <= 80, page);
    assert.match(html, /<title>.+ · 传统(?:文化学习|历法记录)工具<\/title>/);
    assert.ok((page === 'ziwei.html' ? read('ziwei-page.js') : html).includes(notice), page);
  }
  const visibleFiles = fs.readdirSync('.').filter(file => /\.(html|js)$/.test(file) && !file.startsWith('check-'));
  for (const file of visibleFiles) assert.doesNotMatch(read(file), /财运投资|得失风险|健康疾病|预测线索|不收集个人信息/, file);
  assert.ok(read('daily.html').includes('盘面线索与实际日记同轴呈现'));
  assert.equal((read('daily.html').match(/includeDiary:selected.length>0/g) || []).length, 2);
  assert.doesNotMatch(read('daily.html'), /PRIVACY_ACK_STORAGE/);
  assert.deepEqual(Object.values(verdict.labels), ['支持条件较多', '支持与制约并存', '制约较重，存在生扶条件', '制约条件较多', '条件交错', '条件交错，待核对时序']);
  await checkQimen();
  await checkLiuyao();
  await checkConsent();
  console.log('PASS P0-5/P0-6/P2-2 titles, descriptions, labels and production wording scan');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
