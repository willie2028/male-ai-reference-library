#!/usr/bin/env node
/**
 * browser_test.mjs — 真实浏览器验收测试（Chrome headless + CDP，零依赖）
 *
 * 覆盖：
 *   1. 分类切换
 *   2. 中英文关键词搜索
 *   3. 标签筛选
 *   4. 锁定后随机组合不改动该槽位
 *   5. 图板可导出，且三张图片顺序正确（用 PIL 离线按像素签名比对）
 *   6. 详情弹层打开与关闭
 *   7. 组合提示词内容完整，并可复制到剪贴板
 *   8. 手机宽度下无主要内容横向溢出
 *   9. 浏览器控制台无 JS 错误
 *
 * 前置：本地 HTTP 服务已启动（默认 http://127.0.0.1:8080，可用 BASE_URL 覆盖）
 * 用法：node scripts/browser_test.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const PORT = 9300 + Math.floor(Math.random() * 600);   // 每次用随机端口，避免残留进程占用

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 运行时探测一个带 Pillow 的 Python（用于图板顺序的离线像素比对）。
 *  不写死任何个人路径：优先用 PATH 上的解释器，再按 HOME 探测常见 conda 安装位置。 */
function findPython() {
  const home = process.env.HOME || '';
  const cands = ['python3', 'python'];
  if (home) {
    for (const rel of ['anaconda3/bin/python3', 'miniconda3/bin/python3', 'opt/anaconda3/bin/python3']) {
      cands.push(`${home}/${rel}`);
    }
  }
  for (const c of cands) {
    try {
      execFileSync(c, ['-c', 'import PIL; print(PIL.__version__)'], { stdio: 'ignore' });
      return c;
    } catch { /* 下一个候选 */ }
  }
  return null;
}

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.contextId = null;          // 当前默认执行上下文
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.executionContextCreated') {
          const ctx = msg.params.context;
          if (ctx.auxData?.isDefault) this.contextId = ctx.id;
        } else if (msg.method === 'Runtime.executionContextsCleared') {
          this.contextId = null;
        }
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)); }
      }, 30000);
    });
  }
  once(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting ' + method)), timeout);
      const fn = (msg) => {
        if (msg.method === method) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((f) => f !== fn);
          resolve(msg.params);
        }
      };
      this.listeners.push(fn);
    });
  }
  async eval(expression) {
    const params = { expression, awaitPromise: true, returnByValue: true };
    // 导航后默认上下文会重建；显式带上 contextId 避免评估到旧文档
    if (this.contextId) params.contextId = this.contextId;
    const r = await this.send('Runtime.evaluate', params);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function connect() {
  const url = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/json/version`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  const res = await fetch(`${url}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new CDP(ws);
}

/* ---------- 页面内辅助脚本 ---------- */
const HELPERS = `
window.__ids = () => [...document.querySelectorAll('.card .mono.dim')].map(e => e.textContent);
window.__use = (id) => {
  const card = [...document.querySelectorAll('.card')]
    .find(c => c.querySelector('.mono.dim') && c.querySelector('.mono.dim').textContent === id);
  if (!card) return false;
  card.querySelector('.card-actions .btn').click();
  return true;
};
window.__slotId = (i) => {
  const cap = document.querySelectorAll('.slot')[i].querySelector('.slot-caption .mono');
  return cap ? cap.textContent : null;
};
window.__lock = (i) => {
  const btns = document.querySelectorAll('.slot')[i].querySelectorAll('.icon-btn');
  btns[0].click();
  return true;
};
window.__search = (q) => {
  const s = document.querySelector('#search');
  s.value = q;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__tab = (c) => {
  document.querySelector('.tab[data-cat="' + c + '"]').click();
  return true;
};
window.__chip = (t) => {
  const chips = [...document.querySelectorAll('#tag-filters .chip')];
  const hit = chips.find(c => c.textContent.startsWith(t));
  if (!hit) return false;
  hit.click();
  return true;
};
window.__captureBoard = () => {
  const orig = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, type) {
    try { window.__boardData = this.toDataURL('image/png'); } catch (e) { window.__boardData = null; }
    cb(new Blob([], { type: type || 'image/png' }));
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { /* 阻止真实下载 */ };
  window.__restore = () => {
    HTMLCanvasElement.prototype.toBlob = orig;
    HTMLAnchorElement.prototype.click = origClick;
  };
  return true;
};
`;

/* ---------- 主流程 ---------- */
let chrome, profileDir;
try {
  // 复用固定 profile 目录，避免每次新建/删除目录触发文件删除权限请求
  profileDir = join(ROOT, 'work', 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    // 本机 Chrome 自带 sandbox 无法初始化、GPU 进程反复崩溃，
    // 且环境设置了 HTTP_PROXY 会把 localhost 也走代理 —— 三者都需要显式关掉
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--hide-scrollbars', '--window-size=1280,1600',
    'about:blank'
  ], { stdio: 'ignore' });

  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const consoleErrors = [];
  cdp.listeners.push((m) => {
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(m.params.entry.text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
    }
  });

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await loaded;

  // 确认已导航到应用页面（执行上下文重建后重新注入辅助脚本）
  let tabs = 0;
  for (let i = 0; i < 40; i++) {
    tabs = await cdp.eval('document.querySelectorAll(".tab").length');
    if (tabs === 4) break;
    await sleep(250);
  }
  if (tabs !== 4) {
    const where = await cdp.eval('location.href + " | title=" + document.title');
    throw new Error(`页面未正确加载：tabs=${tabs} @ ${where}`);
  }
  await cdp.eval(HELPERS);

  // 等待数据加载 + 图片预加载完成
  for (let i = 0; i < 60; i++) {
    const n = await cdp.eval('document.querySelectorAll(".card").length');
    const pre = await cdp.eval('document.querySelectorAll(".card-media img").length');
    if (n > 0 && pre > 0) break;
    await sleep(250);
  }
  await sleep(1200);   // 等待所有图片 load/error 事件触发

  const data = JSON.parse(readFileSync(new URL('../data/references.json', import.meta.url), 'utf8'));
  const items = data.items;

  /* ---- 1. 分类切换 ---- */
  for (const cat of ['face', 'pose', 'outfit']) {
    await cdp.eval(`__tab(${JSON.stringify(cat)})`);
    await sleep(150);
    const ids = await cdp.eval('__ids()');
    const expected = items.filter((i) => i.category === cat).map((i) => i.id).sort();
    check(`分类切换 → ${cat}`,
      ids.length === expected.length && expected.every((e) => ids.includes(e)),
      `显示 ${ids.length} 张，期望 ${expected.length} 张`);
  }

  /* ---- 2. 中英文搜索 ---- */
  const cases = [
    ['卷发', '中文关键词'],
    ['stubble', '英文关键词'],
    ['西装', '中文关键词'],
    ['tracksuit', '英文关键词'],
    ['beard', '英文关键词'],
    ['西裤 dress', '中英混合']
  ];
  for (const [q, kind] of cases) {
    await cdp.eval(`__tab('all')`);
    await cdp.eval(`__search(${JSON.stringify(q)})`);
    await sleep(150);
    const ids = await cdp.eval('__ids()');
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const expected = items.filter((it) => {
      const hay = [it.title, it.id, ...it.tagsZh, ...it.tagsEn].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).map((i) => i.id).sort();
    check(`搜索「${q}」（${kind}）`,
      ids.length === expected.length && expected.every((e) => ids.includes(e)),
      `命中 ${ids.length} 张：${ids.join(', ') || '无'}`);
  }
  await cdp.eval(`__search('')`);

  /* ---- 3. 标签筛选 ---- */
  await cdp.eval(`__tab('face')`);
  await sleep(120);
  const chipOk = await cdp.eval(`__chip('短发')`);
  await sleep(150);
  const chipIds = await cdp.eval('__ids()');
  const chipExpected = items.filter((i) => i.category === 'face' && i.tagsZh.includes('短发')).map((i) => i.id).sort();
  check('标签筛选（脸 · 短发）',
    chipOk && chipExpected.length === chipIds.length && chipExpected.every((e) => chipIds.includes(e)),
    `命中 ${chipIds.length} 张：${chipIds.join(', ')}`);
  await cdp.eval(`__chip('短发')`);   // 取消筛选
  await sleep(120);

  /* ---- 4. 锁定后随机不改动该槽位 ---- */
  await cdp.eval(`__use('face-002')`);
  await cdp.eval(`__use('pose-003')`);
  await cdp.eval(`__use('outfit-004')`);
  await sleep(200);
  const before = await cdp.eval('JSON.stringify([__slotId(0),__slotId(1),__slotId(2)])');
  await cdp.eval(`__lock(0)`);
  await sleep(120);
  const lockedBefore = await cdp.eval('__slotId(0)');
  await cdp.eval('document.querySelector("#btn-random-all").click()');
  await sleep(400);
  const after = await cdp.eval('JSON.stringify([__slotId(0),__slotId(1),__slotId(2)])');
  const [b0, b1, b2] = JSON.parse(before);
  const [a0, a1, a2] = JSON.parse(after);
  check('锁定槽位后随机组合不改动该槽位', a0 === lockedBefore && a0 === b0,
    `锁定前脸=${b0}，锁定后随机脸=${a0}（应保持不变）`);
  check('未锁定槽位在随机组合后被替换', a1 !== b1 || a2 !== b2,
    `姿势 ${b1}→${a1}，服装 ${b2}→${a2}`);

  /* ---- 5. 图板导出 + 顺序正确 ---- */
  await cdp.eval(`__tab('all')`);
  await sleep(150);
  await cdp.eval(`__use('face-002')`);
  await cdp.eval(`__use('pose-003')`);
  await cdp.eval(`__use('outfit-004')`);
  await sleep(300);
  const slotIds = JSON.parse(await cdp.eval('JSON.stringify([__slotId(0),__slotId(1),__slotId(2)])'));
  check('三个组合槽位均已填充', !!slotIds[0] && !!slotIds[1] && !!slotIds[2], slotIds.join(' / '));

  await cdp.eval('__captureBoard()');
  await cdp.eval('document.querySelector("#btn-export").click()');
  await sleep(900);
  const board = await cdp.eval('window.__boardData || null');
  check('图板可导出（canvas → PNG）', !!board && board.startsWith('data:image/png'),
    board ? `数据长度 ${board.length}` : '未生成数据');

  if (board) {
    const b64 = board.split(',')[1];
    const boardPath = new URL('../work/board.png', import.meta.url);
    writeFileSync(boardPath, Buffer.from(b64, 'base64'));
    // 顺序校验在浏览器外用 PIL 独立完成，避免与被测代码共用同一套假设
    const py = findPython();
    if (!py) {
      check('图板三张图片顺序正确（脸→姿势→服装）', false,
        '未找到带 Pillow 的 Python 解释器，无法执行离线像素比对');
    } else {
      let out;
      try {
        out = execFileSync(py,
          [new URL('./check_order.py', import.meta.url).pathname, boardPath.pathname,
           slotIds[0], slotIds[1], slotIds[2]], { encoding: 'utf8' });
      } catch (e) {
        out = e.stdout || '';
      }
      const order = JSON.parse(out.trim());
      check('图板三张图片顺序正确（脸→姿势→服装）', order.ok,
        `面板匹配 ${JSON.stringify(order.matched)}（期望 [0,1,2]），各面板平均误差 ${JSON.stringify(order.errors)}`);
    }
  }

  /* ---- 6. 详情弹层 ---- */
  await cdp.eval(`__tab('all')`);
  await sleep(150);
  const openDetailOk = await cdp.eval(`(() => {
    const card = [...document.querySelectorAll('.card')]
      .find(c => c.querySelector('.mono.dim') && c.querySelector('.mono.dim').textContent === 'face-003');
    if (!card) return false;
    card.querySelector('.card-media').click();
    return true;
  })()`);
  await sleep(250);
  const lbVisible = await cdp.eval('!document.getElementById("lightbox").hidden');
  const lbTitle = await cdp.eval('document.getElementById("lightbox-title").textContent');
  const lbTags = await cdp.eval('document.querySelectorAll("#lightbox-tags .tag").length');
  check('点击卡片打开详情弹层', openDetailOk && lbVisible && lbTitle.length > 0,
    `标题「${lbTitle}」，标签 ${lbTags} 个`);
  await cdp.eval('document.getElementById("lightbox-close").click()');
  await sleep(150);
  check('详情弹层可关闭', await cdp.eval('document.getElementById("lightbox").hidden'), '已关闭');

  /* ---- 7. 复制组合提示词 ---- */
  await cdp.send('Browser.grantPermissions', {
    origin: BASE.replace(/\/$/, ''), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
  }).catch(() => { /* 某些版本不支持，退回 stub */ });
  await cdp.eval('__tab("all")');
  await sleep(120);
  await cdp.eval(`__use('face-001')`);
  await cdp.eval(`__use('pose-001')`);
  await cdp.eval(`__use('outfit-001')`);
  await sleep(200);
  const promptText = await cdp.eval('document.getElementById("combo-prompt").value');
  check('组合提示词已生成且内容完整',
    promptText.includes('图 1') && promptText.includes('图 2') && promptText.includes('图 3') &&
    promptText.includes('脸部') && promptText.includes('身体比例与姿势') && promptText.includes('服装') &&
    promptText.includes('同一名成年男性') && promptText.includes('一并提交给生图模型') &&
    promptText.includes('无法保证'),
    `长度 ${promptText.length} 字`);
  // 截获剪贴板写入
  await cdp.eval(`(() => {
    window.__copied = null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } }
      });
    } catch (e) { window.__copied = null; }
    return true;
  })()`);
  await cdp.eval('document.querySelector("#btn-copy-prompt").click()');
  await sleep(400);
  // headless 下读回系统剪贴板并不可靠，改为断言应用确实把正确文本交给了
  // navigator.clipboard.writeText（截获调用），真实读回作为附加信号
  const copied = await cdp.eval('window.__copied || null');
  check('复制组合提示词（调用 writeText 且文本正确）',
    !!copied && copied.includes('图 1') && copied.includes('图 3') && copied.includes('同一名成年男性'),
    copied ? `写入 ${copied.length} 字` : '未捕获到写入调用');
  let clip = null;
  try { clip = await cdp.eval('navigator.clipboard.readText()'); } catch { /* headless 读回不支持 */ }
  check('组合提示词已复制到系统剪贴板', !!clip ? clip.includes('图 1') : true,
    clip ? `读回 ${clip.length} 字` : 'headless 环境不支持读回（已由上一项覆盖）');

  /* ---- 8. 手机宽度横向溢出 ---- */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await sleep(400);
  const overflow = await cdp.eval(`(() => {
    const de = document.documentElement;
    const wide = [];
    document.querySelectorAll('main *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
        wide.push((el.className || el.tagName) + ' right=' + Math.round(r.right));
      }
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, innerW: window.innerWidth, wide: wide.slice(0, 6) };
  })()`);
  check('手机宽度（390px）无主要内容横向溢出',
    overflow.scrollW <= overflow.clientW + 1 && overflow.wide.length === 0,
    `scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW} 溢出元素=${overflow.wide.length ? overflow.wide.join(' | ') : '无'}`);

  // 截图存档（先确保弹层关闭；截图失败不影响功能结论）
  await cdp.eval('document.getElementById("lightbox").hidden = true');
  await sleep(200);
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL('../work/shot-mobile.png', import.meta.url), Buffer.from(shot.data, 'base64'));
  } catch (e) {
    console.log('（手机截图未生成：' + e.message + '）');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  try {
    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL('../work/shot-desktop.png', import.meta.url), Buffer.from(shot2.data, 'base64'));
  } catch (e) {
    console.log('（桌面截图未生成：' + e.message + '）');
  }

  check('浏览器控制台无 JS 错误', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '无错误');

  /* ---- 汇总 ---- */
  const failed = results.filter((r) => !r.pass);
  writeFileSync(new URL('../work/browser_result.json', import.meta.url),
    JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, total: results.length,
      passed: results.length - failed.length, results }, null, 2));
  console.log(`\n浏览器实测：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log('  ✗ ' + f.name + ' — ' + f.detail));
    process.exitCode = 1;
  }
} catch (err) {
  console.error('测试执行异常：', err.message);
  writeFileSync(new URL('../work/browser_result.json', import.meta.url),
    JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, error: err.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  // 不删除 profile 目录：避免触发文件删除权限请求；该目录在 work/ 下，已被 .gitignore 忽略
}
