/* 男性 AI 作图参考库 — 前端逻辑
 * 无构建步骤、无外部依赖、无 CDN。所有数据来自 data/references.json。
 * 浏览器内不存储任何 API 密钥。
 */
(function () {
  'use strict';

  var CATEGORIES = [
    { key: 'face',   zh: '脸',   slot: '脸部参考', num: '①', role: '用于脸部和发型',   use: '用作脸部参考' },
    { key: 'pose',   zh: '姿势', slot: '姿势参考', num: '②', role: '用于身体比例与姿势', use: '用作姿势参考' },
    { key: 'outfit', zh: '服装', slot: '服装参考', num: '③', role: '用于服装',         use: '用作服装参考' }
  ];
  var SLOT_ORDER = ['face', 'pose', 'outfit'];
  var CAT = {};
  CATEGORIES.forEach(function (c) { CAT[c.key] = c; });

  var FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, "Segoe UI", sans-serif';

  var state = {
    items: [],
    cat: 'all',
    query: '',
    tags: [],              // 已选标签（中文）
    slots: { face: null, pose: null, outfit: null },
    locks: { face: false, pose: false, outfit: false },
    imgOk: {},             // id -> boolean，图片是否可实际加载
    imgPromise: {},        // id -> Promise<boolean>
    detail: null,
    preloaded: false
  };

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }

  function mk(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' is-' + kind : '');
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'error' ? 6000 : 3200);
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  /** 确认图片真实可加载；结果缓存。 */
  function imageUsable(item) {
    if (state.imgPromise[item.id]) return state.imgPromise[item.id];
    var p = loadImage(item.image).then(function (im) {
      state.imgOk[item.id] = !!im;
      return !!im;
    });
    state.imgPromise[item.id] = p;
    return p;
  }

  function byId(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  /* ---------- 过滤 ---------- */
  function scopeItems() {
    if (state.cat === 'all') return state.items.slice();
    return state.items.filter(function (it) { return it.category === state.cat; });
  }

  function matchQuery(item, tokens) {
    if (!tokens.length) return true;
    var hay = [item.title, item.id]
      .concat(item.tagsZh || [])
      .concat(item.tagsEn || [])
      .join(' ')
      .toLowerCase();
    return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
  }

  function matchTags(item) {
    if (!state.tags.length) return true;
    var t = item.tagsZh || [];
    return state.tags.some(function (tag) { return t.indexOf(tag) !== -1; });
  }

  function visibleItems() {
    var tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    return scopeItems().filter(function (it) {
      return matchQuery(it, tokens) && matchTags(it);
    });
  }

  /* ---------- 授权显示 ---------- */
  // 授权状态必须如实呈现：approved 表示「已确认可再分发」，
  // pending-review 表示「待确认」，两者都不能被显示成更强的承诺。
  var LICENSE_LABEL = {
    approved: '已确认可再分发（依据服务条款 §9.2(d)）',
    'pending-review': '待确认（pending-review）'
  };
  function licenseLabel(item) {
    return LICENSE_LABEL[item.license] || ('未知状态：' + item.license);
  }

  /* ---------- 渲染：统计 ---------- */
  function renderStats() {
    var total = state.items.length;
    var per = {};
    CATEGORIES.forEach(function (c) {
      per[c.key] = state.items.filter(function (it) { return it.category === c.key; }).length;
    });
    var ready = state.items.filter(function (it) { return it.status === 'ready'; }).length;
    var shown = visibleItems().length;

    var parts = ['共 ' + total + ' 张'];
    CATEGORIES.forEach(function (c) { parts.push(c.zh + ' ' + per[c.key]); });
    parts.push('已就绪 ' + ready);
    parts.push('当前显示 ' + shown);
    $('stats').textContent = parts.join(' · ');

    var pending = state.items.filter(function (it) { return it.license !== 'approved'; }).length;
    var approved = total - pending;
    $('topbar-meta').textContent = total + ' 张素材 · 全部为 AI 生成 · 授权：' +
      (total === 0 ? '无素材' :
        (pending === 0 ? approved + ' 张已确认可再分发' :
          approved + ' 张已确认，' + pending + ' 张待确认'));
  }

  /* ---------- 渲染：标签筛选 ---------- */
  function renderTagFilters() {
    var box = $('tag-filters');
    box.innerHTML = '';
    var items = scopeItems();
    var counts = {};
    items.forEach(function (it) {
      (it.tagsZh || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a.localeCompare(b, 'zh-Hans-CN');
    });

    // 丢弃当前分类下不存在的标签
    state.tags = state.tags.filter(function (t) { return counts[t]; });

    if (!tags.length) return;
    box.appendChild(mk('span', 'chip-note dim', '标签：'));

    tags.forEach(function (t) {
      var on = state.tags.indexOf(t) !== -1;
      var b = mk('button', 'chip' + (on ? ' is-on' : ''));
      b.type = 'button';
      b.appendChild(document.createTextNode(t));
      b.appendChild(mk('span', 'count', String(counts[t])));
      b.addEventListener('click', function () {
        var i = state.tags.indexOf(t);
        if (i === -1) state.tags.push(t); else state.tags.splice(i, 1);
        render();
      });
      box.appendChild(b);
    });
  }

  /* ---------- 渲染：网格 ---------- */
  function renderGrid() {
    var grid = $('grid');
    var empty = $('empty-state');
    grid.innerHTML = '';

    if (!state.items.length) {
      empty.hidden = false;
      empty.innerHTML = '';
      var strong = mk('strong', null, '素材库为空');
      empty.appendChild(strong);
      empty.appendChild(mk('span', null, 'data/references.json 中没有可用素材。'));
      return;
    }

    var list = visibleItems();
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = '';
      empty.appendChild(mk('strong', null, '没有匹配的素材'));
      empty.appendChild(mk('span', null, '试试更换关键词，或清除当前筛选条件。'));
      var clear = mk('button', 'btn', '清除筛选');
      clear.type = 'button';
      clear.addEventListener('click', clearFilters);
      empty.appendChild(clear);
      return;
    }
    empty.hidden = true;

    list.forEach(function (item) {
      var card = mk('div', 'card');

      var media = mk('button', 'card-media');
      media.type = 'button';
      media.title = '查看详情：' + item.title;
      var im = mk('img');
      im.src = item.image;
      im.alt = item.title;
      im.loading = 'lazy';
      im.addEventListener('error', function () {
        media.innerHTML = '';
        media.appendChild(mk('span', null, '图片缺失'));
      });
      media.appendChild(im);
      media.addEventListener('click', function () { openDetail(item); });
      card.appendChild(media);

      var body = mk('div', 'card-body');
      body.appendChild(mk('div', 'card-title', item.title));
      body.appendChild(mk('div', 'mono dim', item.id));

      var tags = mk('div', 'tags');
      (item.tagsZh || []).slice(0, 4).forEach(function (t) { tags.appendChild(mk('span', 'tag', t)); });
      if ((item.tagsZh || []).length > 4) {
        tags.appendChild(mk('span', 'tag', '+' + ((item.tagsZh || []).length - 4)));
      }
      body.appendChild(tags);

      var actions = mk('div', 'card-actions');
      var use = mk('button', 'btn btn-primary', CAT[item.category].use);
      use.type = 'button';
      use.addEventListener('click', function () { assignSlot(item.category, item); });
      actions.appendChild(use);
      body.appendChild(actions);

      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  /* ---------- 渲染：槽位 ---------- */
  function renderSlots() {
    var box = $('slots');
    box.innerHTML = '';

    SLOT_ORDER.forEach(function (key) {
      var cat = CAT[key];
      var item = state.slots[key];
      var slot = mk('div', 'slot' + (state.locks[key] ? ' is-locked' : ''));

      var head = mk('div', 'slot-head');
      var name = mk('div', 'slot-name');
      name.appendChild(mk('span', 'num', cat.num));
      name.appendChild(document.createTextNode(cat.slot));
      head.appendChild(name);

      var tools = mk('div', 'slot-tools');
      var lock = mk('button', 'icon-btn' + (state.locks[key] ? ' is-on' : ''), state.locks[key] ? '已锁' : '锁定');
      lock.type = 'button';
      lock.title = state.locks[key] ? '已锁定：随机组合不会改动此槽位' : '锁定后随机组合不会改动此槽位';
      lock.addEventListener('click', function () {
        state.locks[key] = !state.locks[key];
        renderSlots();
      });
      tools.appendChild(lock);

      var reroll = mk('button', 'icon-btn', '换一个');
      reroll.type = 'button';
      reroll.title = '只替换这一张';
      reroll.addEventListener('click', function () { rerollSlot(key); });
      tools.appendChild(reroll);

      var clear = mk('button', 'icon-btn', '清空');
      clear.type = 'button';
      clear.title = '清空此槽位';
      clear.addEventListener('click', function () {
        state.slots[key] = null;
        render();
      });
      tools.appendChild(clear);

      head.appendChild(tools);
      slot.appendChild(head);

      var media = mk('div', 'slot-media');
      if (item) {
        var im = mk('img');
        im.src = item.image;
        im.alt = item.title;
        im.addEventListener('error', function () {
          media.innerHTML = '';
          media.appendChild(mk('span', null, '图片缺失'));
        });
        media.appendChild(im);
      } else {
        media.appendChild(mk('span', null, '尚未选择 · ' + cat.role));
      }
      slot.appendChild(media);

      var cap = mk('div', 'slot-caption');
      if (item) {
        cap.appendChild(mk('span', 'mono', item.id));
        cap.appendChild(mk('span', null, item.title));
      }
      slot.appendChild(cap);

      box.appendChild(slot);
    });
  }

  /* ---------- 组合提示词 ---------- */
  function buildPrompt() {
    var f = state.slots.face, p = state.slots.pose, o = state.slots.outfit;
    if (!f && !p && !o) return '';
    var lines = [];
    lines.push('【男性角色三联参考 · 组合提示词】');
    lines.push('');
    if (f) lines.push('图 1（' + CAT.face.num + ' 脸部参考 · ' + f.id + '｜' + f.title + '）：用于确定角色的脸部与发型。');
    if (p) lines.push('图 2（' + CAT.pose.num + ' 姿势参考 · ' + p.id + '｜' + p.title + '）：用于确定身体比例与姿势。');
    if (o) lines.push('图 3（' + CAT.outfit.num + ' 服装参考 · ' + o.id + '｜' + o.title + '）：用于确定服装。');
    lines.push('');
    lines.push('请生成一张写实照片，画面中为同一名成年男性：');
    lines.push('- 以图 1 的脸部特征与发型为准；');
    lines.push('- 采用图 2 的身体比例与姿势；');
    lines.push('- 穿着图 3 的完整服装。');
    lines.push('');
    lines.push('请把导出的三联参考图与本提示词一并提交给生图模型，不要仅凭文字描述生成。');
    lines.push('说明：不同生图模型对参考图的理解能力不同，无法保证人物身份完全一致；如需更强的一致性，可多次生成并挑选最接近的一张。');
    return lines.join('\n');
  }

  function renderPrompt() {
    var ta = $('combo-prompt');
    var text = buildPrompt();
    ta.value = text;
    ta.placeholder = '在下方素材库中各选一张「脸 / 姿势 / 服装」，此处会自动生成组合提示词。';
    $('btn-copy-prompt').disabled = !text;
    $('btn-export').disabled = SLOT_ORDER.some(function (k) { return !state.slots[k]; });
  }

  /* ---------- 槽位操作 ---------- */
  function assignSlot(key, item) {
    state.slots[key] = item;
    render();
    toast('已设为' + CAT[key].slot + '：' + item.id);
  }

  function randomPick(key) {
    var candidates = state.items.filter(function (it) {
      return it.category === key && it.status === 'ready' && state.imgOk[it.id] === true;
    });
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function rerollSlot(key) {
    var pick = randomPick(key);
    if (!pick) {
      toast('暂无可用素材（需状态为 ready 且图片实际存在）', 'warn');
      return;
    }
    state.slots[key] = pick;
    render();
  }

  function randomAll() {
    if (!state.preloaded) {
      toast('图片尚未加载完成，请稍候再试', 'warn');
      return;
    }
    SLOT_ORDER.forEach(function (key) {
      if (state.locks[key]) return;          // 已锁定 → 不改动
      var pick = randomPick(key);
      if (pick) state.slots[key] = pick;
    });
    render();
    toast('已随机组合（锁定的槽位保持不变）');
  }

  function clearFilters() {
    state.query = '';
    state.tags = [];
    $('search').value = '';
    render();
  }

  /* ---------- 详情 ---------- */
  function openDetail(item) {
    state.detail = item;
    $('lightbox-img').src = item.image;
    $('lightbox-img').alt = item.title;
    $('lightbox-title').textContent = item.title;
    $('lightbox-id').textContent = item.id + ' · ' + CAT[item.category].zh + ' · ' +
      item.width + '×' + item.height;
    $('lightbox-prompt').textContent = item.prompt || '（无记录）';
    $('lightbox-negative').textContent = item.negativePrompt || '（无记录）';

    var tags = $('lightbox-tags');
    tags.innerHTML = '';
    (item.tagsZh || []).forEach(function (t) { tags.appendChild(mk('span', 'tag', t)); });
    (item.tagsEn || []).forEach(function (t) { tags.appendChild(mk('span', 'tag tag-en', t)); });

    var lic = licenseLabel(item);
    var src = item.source || {};
    $('lightbox-license').textContent = '来源：' + (src.provider || '未知') +
      (src.model ? ' / ' + src.model : '（模型未确认）') +
      (src.generatedAt ? ' / ' + src.generatedAt : '') +
      ' · 授权：' + lic;

    var use = $('lightbox-use');
    use.textContent = CAT[item.category].use;
    use.onclick = function () { assignSlot(item.category, item); closeDetail(); };

    $('lightbox-download').onclick = function () { downloadOne(item); };

    $('lightbox').hidden = false;
  }

  function closeDetail() {
    $('lightbox').hidden = true;
    state.detail = null;
  }

  function downloadOne(item) {
    var a = document.createElement('a');
    a.href = item.image;
    a.download = item.id + '.webp';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('已下载 ' + item.id + '.webp');
  }

  /* ---------- 复制提示词 ---------- */
  function copyPrompt() {
    var text = buildPrompt();
    if (!text) { toast('请先选择素材', 'warn'); return; }

    function fallback() {
      var ta = $('combo-prompt');
      ta.removeAttribute('readonly');
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.setAttribute('readonly', 'readonly');
      if (ok) { toast('已复制组合提示词'); return; }
      toast('复制失败，请手动复制上方文本框内容', 'error');
      ta.removeAttribute('readonly');
      ta.focus();
      ta.select();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('已复制组合提示词');
      }).catch(function () { fallback(); });
    } else {
      fallback();
    }
  }

  /* ---------- 导出三联参考图 ---------- */
  function exportBoard() {
    var missing = SLOT_ORDER.filter(function (k) { return !state.slots[k]; });
    if (missing.length) {
      toast('请先补齐三类参考：' + missing.map(function (k) { return CAT[k].zh; }).join('、'), 'warn');
      return;
    }

    Promise.all(SLOT_ORDER.map(function (k) { return loadImage(state.slots[k].image); }))
      .then(function (imgs) {
        var failed = imgs.some(function (im) { return !im; });
        if (failed) { toast('有图片加载失败，未导出图板', 'error'); return; }
        drawBoard(imgs);
      })
      .catch(function () { toast('图片加载失败，未导出图板', 'error'); });
  }

  function drawBoard(imgs) {
    var PW = 1440, PANEL_W = 440, GAP = 30, MARGIN = 30;
    var HEAD = 118, PANEL_H = 880, IMG_TOP = 132, IMG_H = 740, IMG_W = PANEL_W - 28;
    var FOOT_Y = 1015, CH = 1080;

    var cv = document.createElement('canvas');
    cv.width = PW; cv.height = CH;
    var g = cv.getContext('2d');

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, PW, CH);

    // 标题
    g.fillStyle = '#16191d';
    g.font = '700 30px ' + FONT;
    g.textBaseline = 'alphabetic';
    g.fillText('男性角色三联参考图', MARGIN, 52);
    g.fillStyle = '#5b6470';
    g.font = '15px ' + FONT;
    g.fillText('Male Character Triptych Reference · ① 脸部 ② 姿势 ③ 服装', MARGIN, 84);

    SLOT_ORDER.forEach(function (key, i) {
      var cat = CAT[key];
      var item = state.slots[key];
      var x = MARGIN + i * (PANEL_W + GAP);

      // 面板底
      g.fillStyle = '#ffffff';
      g.fillRect(x, HEAD, PANEL_W, PANEL_H);
      g.strokeStyle = '#d7dbe1';
      g.lineWidth = 2;
      g.strokeRect(x + 1, HEAD + 1, PANEL_W - 2, PANEL_H - 2);

      // 图片（等比 contain，不拉伸）
      var im = imgs[i];
      var boxX = x + 14, boxY = IMG_TOP, boxW = IMG_W, boxH = IMG_H;
      g.fillStyle = '#f1f3f6';
      g.fillRect(boxX, boxY, boxW, boxH);
      var scale = Math.min(boxW / im.width, boxH / im.height);
      var dw = im.width * scale, dh = im.height * scale;
      g.drawImage(im, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);

      // 标签
      g.fillStyle = '#16191d';
      g.font = '700 22px ' + FONT;
      g.fillText(cat.num + ' ' + cat.slot, x + 14, 900);
      g.fillStyle = '#5b6470';
      g.font = '15px ' + FONT;
      g.fillText(item.id + ' · ' + item.title, x + 14, 932);
      g.font = '13px ' + FONT;
      g.fillText(cat.role, x + 14, 958);
    });

    // 页脚
    g.strokeStyle = '#e2e5ea';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(MARGIN, FOOT_Y);
    g.lineTo(PW - MARGIN, FOOT_Y);
    g.stroke();

    g.fillStyle = '#16191d';
    g.font = '14px ' + FONT;
    g.fillText('请将本图板与组合提示词一并提交给生图模型，不要仅凭文字描述生成。', MARGIN, FOOT_Y + 30);
    g.fillStyle = '#5b6470';
    g.font = '13px ' + FONT;
    g.fillText('全部素材为 AI 生成 · 授权状态待确认 · male-ai-reference-library', MARGIN, FOOT_Y + 52);

    cv.toBlob(function (blob) {
      if (!blob) { toast('导出失败', 'error'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'male-ref-triptych.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('已导出三联参考图 PNG');
    }, 'image/png');
  }

  /* ---------- 总渲染 ---------- */
  function render() {
    renderStats();
    renderTagFilters();
    renderGrid();
    renderSlots();
    renderPrompt();
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      state.cat = b.dataset.cat;
      Array.prototype.forEach.call(this.querySelectorAll('.tab'), function (t) {
        t.classList.toggle('is-active', t === b);
      });
      render();
    });

    $('search').addEventListener('input', function () {
      state.query = this.value;
      render();
    });

    $('btn-clear-filters').addEventListener('click', clearFilters);
    $('btn-random-all').addEventListener('click', randomAll);
    $('btn-copy-prompt').addEventListener('click', copyPrompt);
    $('btn-export').addEventListener('click', exportBoard);

    $('lightbox-close').addEventListener('click', closeDetail);
    $('lightbox').addEventListener('click', function (e) {
      if (e.target === this) closeDetail();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('lightbox').hidden) closeDetail();
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    bind();
    var first = document.querySelector('.tab[data-cat="all"]');
    if (first) first.classList.add('is-active');

    fetch('data/references.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.items = (data && data.items) || [];
        render();
        // 预加载图片：随机功能只允许使用实际存在（可加载）的素材
        var checks = state.items.map(function (it) {
          return imageUsable(it).then(function (ok) {
            if (!ok) { state.imgOk[it.id] = false; }
            return ok;
          });
        });
        Promise.all(checks).then(function () {
          state.preloaded = true;
          renderSlots();
        });
      })
      .catch(function (err) {
        state.items = [];
        render();
        var empty = $('empty-state');
        empty.hidden = false;
        empty.innerHTML = '';
        empty.appendChild(mk('strong', null, '素材数据加载失败'));
        empty.appendChild(mk('span', null, '无法读取 data/references.json（' + err.message +
          '）。请通过本地 HTTP 服务打开本页，例如 python3 -m http.server 8080。'));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
