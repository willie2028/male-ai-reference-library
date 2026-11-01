#!/usr/bin/env node
/**
 * validate.mjs — 静态校验（无需依赖）
 *
 * 检查项：
 *   1. data/references.json 可解析
 *   2. id 唯一、格式正确、分类前缀一致
 *   3. 分类取值合法
 *   4. 必填字段存在且类型正确
 *   5. status=ready 的素材，其本地图片存在且非空
 *   6. 图片路径为相对路径，未逃出项目目录
 *   7. 标签取自 docs/SPEC.md 定义的固定词表
 *   8. 未把 pending-review 授权显示为已开放许可
 *   9. 仓库内不含密钥或本机绝对路径
 *
 * 用法：node scripts/validate.mjs
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'references.json');
const SPEC = join(ROOT, 'docs', 'SPEC.md');

const CATEGORIES = ['face', 'pose', 'outfit'];
const STATUSES = ['planned', 'generated', 'ready', 'rejected'];
const LICENSES = ['pending-review', 'approved'];
const REQUIRED = ['id', 'category', 'title', 'tagsZh', 'tagsEn', 'image', 'prompt', 'negativePrompt', 'source', 'license', 'status'];
const SOURCE_FIELDS = ['type', 'provider', 'model', 'generatedAt', 'referenceImages', 'termsUrl'];

const errors = [];
const warnings = [];
const notes = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

/* ---------- 1. JSON 可解析 ---------- */
let raw;
let doc;
try {
  raw = readFileSync(DATA, 'utf8');
  doc = JSON.parse(raw);
} catch (e) {
  console.error(`✗ data/references.json 无法解析：${e.message}`);
  process.exit(1);
}
const items = Array.isArray(doc) ? doc : doc.items;
if (!Array.isArray(items)) {
  console.error('✗ data/references.json 缺少 items 数组');
  process.exit(1);
}
notes.push(`JSON 可解析，items 长度 ${items.length}`);

/* ---------- 2/3/4. 结构校验 ---------- */
const seen = new Map();
for (const [i, it] of items.entries()) {
  const at = `items[${i}]`;
  if (!it || typeof it !== 'object') { fail(`${at} 不是对象`); continue; }

  for (const f of REQUIRED) {
    if (!(f in it)) fail(`${at} 缺少必填字段 "${f}"`);
  }
  if (typeof it.id !== 'string' || !it.id) { fail(`${at}.id 无效`); continue; }

  if (seen.has(it.id)) fail(`id 重复：${it.id}（${seen.get(it.id)} 与 ${at}）`);
  else seen.set(it.id, at);

  // id 格式 <category>-<NNN>
  const m = /^([a-z]+)-(\d{3})$/.exec(it.id);
  if (!m) fail(`${at}.id "${it.id}" 不符合 <category>-<NNN> 格式`);
  else {
    if (!CATEGORIES.includes(m[1])) fail(`${at}.id "${it.id}" 的分类前缀无效`);
    else if (m[1] !== it.category) fail(`${at}.id "${it.id}" 前缀与 category "${it.category}" 不一致`);
  }

  if (!CATEGORIES.includes(it.category)) fail(`${at}.category "${it.category}" 非法（应为 ${CATEGORIES.join('/')}）`);
  if (!STATUSES.includes(it.status)) fail(`${at}.status "${it.status}" 非法`);
  if (!LICENSES.includes(it.license)) fail(`${at}.license "${it.license}" 非法`);
  if (typeof it.title !== 'string' || !it.title.trim()) fail(`${at}.title 为空`);

  if (!Array.isArray(it.tagsZh) || !it.tagsZh.length) fail(`${at}.tagsZh 为空数组`);
  if (!Array.isArray(it.tagsEn) || !it.tagsEn.length) fail(`${at}.tagsEn 为空数组`);
  if (Array.isArray(it.tagsZh) && new Set(it.tagsZh).size !== it.tagsZh.length) {
    fail(`${at}.tagsZh 存在重复标签`);
  }

  if (typeof it.image !== 'string' || !it.image) fail(`${at}.image 为空`);
  if (typeof it.source !== 'object' || it.source === null) fail(`${at}.source 缺失`);
  else {
    for (const f of SOURCE_FIELDS) {
      if (!(f in it.source)) fail(`${at}.source 缺少字段 "${f}"`);
    }
    // 禁止把未知模型 / 授权写成已确认
    if (typeof it.source.model === 'string' && it.source.model.trim()) {
      if (/^(unknown|pending|n\/a|tbd|null|unknown-pending-review)$/i.test(it.source.model.trim())) {
        fail(`${at}.source.model 应留空而非填写占位值`);
      }
    }
    if (it.source.type === 'generated' && typeof it.source.provider === 'string'
        && /^(unknown|pending|n\/a|tbd|null)$/i.test(it.source.provider.trim())) {
      fail(`${at}.source.provider 应留空或写实际工具名`);
    }
  }

  // 授权：pending-review 的素材不得同时声称已获开放许可
  if (it.license === 'pending-review') {
    for (const k of ['openLicense', 'licenseApproved', 'publicDomain', 'cc0']) {
      if (it[k] === true) fail(`${at} 授权为 pending-review，却声称 ${k}=true`);
    }
  }
}

/* ---------- 5/6. 图片存在性、相对路径 ---------- */
for (const it of items) {
  if (!it || typeof it.image !== 'string' || !it.image) continue;
  const p = it.image;

  if (/^https?:/i.test(p) || p.startsWith('//')) {
    fail(`${it.id} 使用了远程图片地址：${p}（本项目要求相对路径）`);
    continue;
  }
  if (isAbsolute(p)) {
    fail(`${it.id} 使用了绝对路径：${p}`);
    continue;
  }
  if (p.includes('..')) fail(`${it.id} 路径越界：${p}`);

  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith('..')) fail(`${it.id} 图片路径逃出项目目录：${p}`);

  if (it.status === 'ready') {
    if (!existsSync(abs)) { fail(`${it.id} 状态为 ready，但图片不存在：${p}`); continue; }
    const st = statSync(abs);
    if (!st.isFile()) { fail(`${it.id} 图片路径不是文件：${p}`); continue; }
    if (st.size === 0) fail(`${it.id} 图片文件为空：${p}`);
  }
}

/* ---------- 7. 固定词表校验 ---------- */
let vocab = { face: new Set(), pose: new Set(), outfit: new Set() };
try {
  const spec = readFileSync(SPEC, 'utf8');
  const sec = (spec.split('## 3. 标签词表')[1] || '').split(/\n## /)[0];
  const lines = sec.split('\n');
  const headerOf = { face: '**脸 face**', pose: '**姿势 pose**', outfit: '**服装 outfit**' };
  for (const key of CATEGORIES) {
    const at = lines.findIndex((l) => l.trim() === headerOf[key]);
    if (at === -1) continue;
    // 词表位于标题行的下一行，直到空行为止
    for (let i = at + 1; i < lines.length; i++) {
      if (!lines[i].trim()) break;
      for (const t of lines[i].matchAll(/`([^`]+)`/g)) vocab[key].add(t[1]);
    }
  }
} catch (e) {
  warn(`无法从 docs/SPEC.md 解析标签词表：${e.message}`);
}

for (const it of items) {
  if (!it || !Array.isArray(it.tagsZh) || !vocab[it.category] || vocab[it.category].size === 0) continue;
  for (const t of it.tagsZh) {
    if (!vocab[it.category].has(t)) {
      fail(`${it.id} 标签「${t}」不在 docs/SPEC.md 的 ${it.category} 固定词表中`);
    }
  }
}
notes.push(`固定词表：脸 ${vocab.face.size} / 姿势 ${vocab.pose.size} / 服装 ${vocab.outfit.size}`);

/* ---------- 8. UI 未把授权显示为更强的承诺 ---------- */
const uiFiles = ['index.html', 'assets/app.js', 'assets/style.css'];
const uiText = uiFiles.map((f) => {
  const p = join(ROOT, f);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}).join('\n');

// 界面必须为数据中出现的每种授权状态给出对应的如实文案
const LICENSE_UI_LABEL = {
  approved: '已确认可再分发',
  'pending-review': '待确认'
};
const presentStates = [...new Set(items.map((i) => i.license))];
for (const st of presentStates) {
  const label = LICENSE_UI_LABEL[st];
  if (!label) { fail(`未知的授权状态 "${st}"`); continue; }
  if (!uiText.includes(label)) {
    fail(`界面代码中缺少授权状态 "${st}" 对应文案「${label}」，授权状态可能被显示为更强或更弱的承诺`);
  }
}
// 界面不得出现比实际更强的授权表述
for (const bad of ['CC0', '公有领域', 'Open License', 'open license', '无条件', '不受任何限制', '版权已放弃']) {
  if (uiText.includes(bad)) fail(`界面代码中出现「${bad}」，可能把授权显示为比实际更强的承诺`);
}

// approved 状态的素材必须有授权依据与条款链接
for (const it of items) {
  if (it.license !== 'approved') continue;
  if (!it.licenseBasis || String(it.licenseBasis).trim().length < 10) {
    fail(`${it.id} 授权为 approved，但缺少 licenseBasis 依据说明`);
  }
  if (!it.source || !it.source.termsUrl) {
    fail(`${it.id} 授权为 approved，但缺少 source.termsUrl 条款链接`);
  }
}

// 授权文案必须区分图片与代码
const assetLicensePath = join(ROOT, 'ASSET_LICENSE.md');
if (!existsSync(assetLicensePath)) {
  fail('缺少 ASSET_LICENSE.md（图片授权需与代码授权分开说明）');
} else {
  const al = readFileSync(assetLicensePath, 'utf8');
  if (!/pending-review|待确认/.test(al)) fail('ASSET_LICENSE.md 未说明 pending-review 状态如何处理');
  if (!/MIT/.test(al)) fail('ASSET_LICENSE.md 未说明代码 MIT 不适用于图片');
  if (presentStates.includes('approved') && !/9\.2/.test(al)) {
    fail('ASSET_LICENSE.md 未引用服务条款中的 Output 归属条款');
  }
}

/* ---------- 9. 密钥与本机路径 ---------- */
const SECRET_RE = /(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}|secret\s*[:=]\s*['"][^'"]{8,}|BEGIN [A-Z ]*PRIVATE KEY)/i;
const HOME_NEEDLE = '/' + 'Users/';
const HOME_NEEDLE_WIN = 'C:' + '\\Users';
const SELF = fileURLToPath(import.meta.url);
const scanDirs = ['assets', 'data', 'docs', 'scripts', 'images'];
for (const d of scanDirs) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) continue;
  for (const f of walk(abs)) {
    if (f === SELF) continue;   // 本文件自身包含检测用的字面量
    const text = readFileSync(f, 'utf8');
    if (SECRET_RE.test(text)) fail(`疑似密钥：${relative(ROOT, f)}`);
    if (text.includes(HOME_NEEDLE) || text.includes(HOME_NEEDLE_WIN)) {
      fail(`包含本机绝对路径：${relative(ROOT, f)}`);
    }
  }
}
for (const f of ['index.html', 'README.md', 'LICENSE', 'CONTRIBUTING.md']) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8');
  if (SECRET_RE.test(text)) fail(`疑似密钥：${f}`);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/* ---------- 输出 ---------- */
console.log('── 校验结果 ──────────────────────────────');
notes.forEach((n) => console.log('  · ' + n));
console.log(`  · 素材 ${items.length} 张，唯一 id ${seen.size} 个`);
if (warnings.length) {
  console.log('\n警告：');
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (errors.length) {
  console.log('\n错误：');
  errors.forEach((e) => console.log('  ✗ ' + e));
  console.log(`\n✗ 校验未通过：${errors.length} 个错误`);
  process.exit(1);
}
console.log('\n✓ 校验全部通过');
