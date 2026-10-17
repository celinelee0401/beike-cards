// 畫布：顯示卡片、拖拉、縮放、連線、卡中卡

import {
  store, begin, end, commit, node, children, descendants, addNode, removeNodes,
  removeLinksOf, topZ, nodeLabel, scheduleSave,
} from './store.js';
import { db, imageURL } from './db.js';
import { $, h, clamp, uid, toast, linkPoints, boundsOf, imageCardSize, IMAGE_PAD } from './util.js';

const viewport = $('#viewport');
const world = $('#world');
const cardsLayer = $('#cards');
const linksSvg = $('#links');
const floatBar = $('#float-toolbar');
const hintEl = $('#hint');
const emptyHint = $('#empty-hint');
const crumbsEl = $('#crumbs');
const zoomLabel = $('#zoom-label');

export const COLORS = ['#ffffff', '#fff4b8', '#ffd9e0', '#d6e8ff', '#d7f2dc', '#e6dcff', '#ffe1c4', '#e4e4e4'];
const MIN_SCALE = 0.15, MAX_SCALE = 4;
const DEFAULT_FONT = 22;

export const view = {
  container: null,       // 目前看的是畫布（null）還是某張卡片的裡面
  x: 0, y: 0, scale: 1,
  sel: null,             // { kind: 'node' | 'link', id }
  linkFrom: null,        // 連線模式中的起點卡片
  editing: null,         // { id, token, isNew }
  showColors: false,
  lastColor: '#fff4b8',
  hooks: {},             // 由 main.js 提供：openCamera, openViewer, openEditor
};

const elMap = new Map();
const handle = h('div', { class: 'resize-handle', title: '拖拉調整大小' });

// ---------- 座標 ----------

const vpRect = () => viewport.getBoundingClientRect();
export function toWorld(cx, cy) {
  const r = vpRect();
  return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale };
}
export function visibleRect() {
  const r = vpRect();
  return { x: -view.x / view.scale, y: -view.y / view.scale, w: r.width / view.scale, h: r.height / view.scale };
}

export function applyTransform() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  world.style.setProperty('--inv', String(1 / view.scale));
  const g = 28 * view.scale;
  viewport.style.backgroundSize = `${g}px ${g}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  positionFloatBar();
}

export function zoomAt(cx, cy, factor) {
  const r = vpRect();
  const px = cx - r.left, py = cy - r.top;
  const ns = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  view.x = px - (px - view.x) * (ns / view.scale);
  view.y = py - (py - view.y) * (ns / view.scale);
  view.scale = ns;
  applyTransform();
  saveCurrentView();
}
export function zoomBy(factor) {
  const r = vpRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

export function fitView() {
  const r = vpRect();
  const b = boundsOf(children(view.container));
  if (!b) {
    view.scale = 1; view.x = 40; view.y = 40;
  } else {
    const s = clamp(Math.min((r.width - 80) / b.w, (r.height - 80) / b.h), MIN_SCALE, 1.2);
    view.scale = s;
    view.x = (r.width - b.w * s) / 2 - b.x * s;
    view.y = (r.height - b.h * s) / 2 - b.y * s;
  }
  applyTransform();
  saveCurrentView();
}

const viewKey = (c) => c ?? 'root';
export function saveCurrentView() {
  if (!store.board) return;
  store.board.views[viewKey(view.container)] = { x: view.x, y: view.y, scale: view.scale };
  scheduleSave();
}
function restoreView() {
  const v = store.board.views[viewKey(view.container)];
  if (v) { Object.assign(view, v); applyTransform(); } else fitView();
}

function ensureVisible(n) {
  const vr = visibleRect();
  if (n.x >= vr.x && n.y >= vr.y && n.x + n.w <= vr.x + vr.w && n.y + n.h <= vr.y + vr.h) return;
  const r = vpRect();
  view.x = r.width / 2 - (n.x + n.w / 2) * view.scale;
  view.y = r.height / 2 - (n.y + n.h / 2) * view.scale;
  applyTransform();
  saveCurrentView();
}

// ---------- 進出卡片（卡中卡） ----------

export function openBoardView() {
  view.container = null;
  view.sel = null;
  view.linkFrom = null;
  view.editing = null;
  for (const el of elMap.values()) el.remove();
  elMap.clear();
  render();
  restoreView();
}

export function goTo(containerId, selectId = null) {
  finishEdit();
  saveCurrentView();
  view.container = containerId ?? null;
  view.sel = selectId ? { kind: 'node', id: selectId } : null;
  view.linkFrom = null;
  view.showColors = false;
  render();
  restoreView();
}
export function goUp() {
  if (!view.container) return;
  const c = node(view.container);
  goTo(c?.parent ?? null, view.container);
}

// ---------- 繪製 ----------

export function render() {
  const b = store.board;
  if (!b) return;
  if (view.container && !b.nodes[view.container]) view.container = null;
  if (view.sel?.kind === 'node' && !b.nodes[view.sel.id]) view.sel = null;
  if (view.sel?.kind === 'link' && !b.links.some((l) => l.id === view.sel.id)) view.sel = null;
  if (view.linkFrom && !b.nodes[view.linkFrom]) view.linkFrom = null;

  const counts = {};
  for (const n of Object.values(b.nodes)) if (n.parent) counts[n.parent] = (counts[n.parent] || 0) + 1;

  const kids = children(view.container);
  const keep = new Set();
  for (const n of kids) {
    keep.add(n.id);
    let el = elMap.get(n.id);
    if (!el) {
      el = h('div', { class: 'card', 'data-id': n.id });
      cardsLayer.append(el);
      elMap.set(n.id, el);
    }
    paintCard(el, n, counts[n.id] || 0);
  }
  for (const [id, el] of elMap) if (!keep.has(id)) { el.remove(); elMap.delete(id); }

  renderLinks();
  renderCrumbs();
  emptyHint.hidden = kids.length > 0;
  emptyHint.textContent = view.container
    ? '這張卡片裡還沒有東西。可以按「拍照」或「＋文字卡」放進來。'
    : '按上方「＋文字卡」或「拍照」開始。在空白處點兩下也能新增文字卡。';
  updateSelectionUI();
}

function paintPos(el, n) {
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.style.width = n.w + 'px';
  el.style.height = n.h + 'px';
}

function paintCard(el, n, kidCount) {
  paintPos(el, n);
  el.style.background = n.color || '#fff';
  el.style.zIndex = n.z || 0;
  el.classList.toggle('is-image', n.type === 'image');
  if (view.editing?.id === n.id) return;
  const sig = [n.type, n.text, n.imageId, n.fontSize, kidCount].join('|');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.replaceChildren();
  if (n.type === 'text') {
    const t = h('div', { class: 'card-text' + (n.text ? '' : ' placeholder') }, n.text || '（空白卡片）');
    t.style.fontSize = (n.fontSize || DEFAULT_FONT) + 'px';
    el.append(t);
  } else {
    const img = h('img', { class: 'card-img', alt: '', draggable: 'false' });
    imageURL(n.imageId).then((u) => { if (u) img.src = u; });
    el.append(img);
  }
  if (kidCount) {
    el.append(h('span', { class: 'badge', title: '打開這張卡片' },
      h('span', { class: 'badge-icon', html: STACK_ICON }), String(kidCount)));
  }
}
const STACK_ICON = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>';

const MARKERS = `<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4a5a55"/></marker>
  <marker id="arrow-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#2f6b5a"/></marker>
</defs>`;

export function renderLinks() {
  const b = store.board;
  const kids = children(view.container);
  const box = boundsOf(kids);
  if (!box) { linksSvg.innerHTML = ''; return; }
  const m = 200;
  const vb = { x: box.x - m, y: box.y - m, w: box.w + m * 2, h: box.h + m * 2 };
  Object.assign(linksSvg.style, { left: vb.x + 'px', top: vb.y + 'px', width: vb.w + 'px', height: vb.h + 'px' });
  linksSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const ids = new Set(kids.map((k) => k.id));
  const parts = [MARKERS];
  for (const l of b.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    const { p1, p2 } = linkPoints(b.nodes[l.from], b.nodes[l.to]);
    const d = `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)}L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    const sel = view.sel?.kind === 'link' && view.sel.id === l.id;
    const mk = sel ? 'url(#arrow-sel)' : 'url(#arrow)';
    const arrow = l.arrow || 'end';
    parts.push(`<path class="link-line${sel ? ' selected' : ''}" d="${d}"${arrow !== 'none' ? ` marker-end="${mk}"` : ''}${arrow === 'both' ? ` marker-start="${mk}"` : ''}/>`);
    parts.push(`<path class="link-hit" data-link="${l.id}" d="${d}"/>`);
  }
  linksSvg.innerHTML = parts.join('');
}

function renderCrumbs() {
  crumbsEl.replaceChildren();
  const path = [];
  let c = view.container;
  while (c) {
    const n = node(c);
    if (!n) break;
    path.unshift(n);
    c = n.parent;
  }
  crumbsEl.hidden = !path.length;
  if (!path.length) return;
  crumbsEl.append(h('button', { class: 'crumb-up', onclick: goUp }, '↑ 回上一層'));
  crumbsEl.append(h('button', { class: 'crumb', onclick: () => goTo(null) }, '畫布'));
  path.forEach((n, i) => {
    crumbsEl.append(h('span', { class: 'crumb-sep' }, '›'));
    crumbsEl.append(i === path.length - 1
      ? h('span', { class: 'crumb current' }, nodeLabel(n))
      : h('button', { class: 'crumb', onclick: () => goTo(n.id) }, nodeLabel(n)));
  });
}

// ---------- 選取與浮動工具列 ----------

let barKey = '';

function updateSelectionUI() {
  const selId = view.sel?.kind === 'node' ? view.sel.id : null;
  for (const [id, el] of elMap) {
    el.classList.toggle('selected', id === selId);
    el.classList.toggle('link-source', id === view.linkFrom);
  }
  const selEl = selId && elMap.get(selId);
  if (selEl && !view.linkFrom && !view.editing) selEl.append(handle); else handle.remove();

  hintEl.hidden = !view.linkFrom;
  if (view.linkFrom) hintEl.textContent = '點另一張卡片來連線 · 點空白處取消';

  const show = view.sel && !view.linkFrom && !view.editing;
  floatBar.hidden = !show;
  if (!show) { barKey = ''; return; }
  const n = selId ? node(selId) : null;
  const key = `${view.sel.kind}:${view.sel.id}:${n?.type}:${view.showColors}:${view.container}`;
  if (key !== barKey) { barKey = key; buildFloatBar(); }
  positionFloatBar();
}

function buildFloatBar() {
  floatBar.replaceChildren();
  const btn = (act, label, cls = '') => h('button', { 'data-act': act, class: cls }, label);
  let items;
  if (view.sel.kind === 'link') {
    items = [btn('arrow', '箭頭方向'), btn('del', '刪除', 'danger')];
  } else {
    const n = node(view.sel.id);
    items = n.type === 'text'
      ? [btn('edit', '編輯'), btn('view', '全螢幕'), btn('bigger', '字放大'), btn('smaller', '字縮小')]
      : [btn('view', '全螢幕'), btn('crop', '裁切旋轉')];
    items.push(btn('color', '顏色', view.showColors ? 'on' : ''), btn('link', '連線'),
      btn('camInto', '拍照放進'), btn('open', '打開'), btn('dup', '複製'));
    if (view.container) items.push(btn('out', '移到上一層'));
    items.push(btn('del', '刪除', 'danger'));
  }
  floatBar.append(h('div', { class: 'fb-row' }, items));
  if (view.showColors && view.sel.kind === 'node') {
    const cur = node(view.sel.id)?.color;
    floatBar.append(h('div', { class: 'fb-colors' }, COLORS.map((c) =>
      h('button', { class: 'swatch' + (c === cur ? ' on' : ''), 'data-color': c, style: { background: c }, 'aria-label': '顏色' }))));
  }
}

export function positionFloatBar() {
  if (floatBar.hidden || !view.sel) return;
  const r = vpRect();
  let sx, sy, sw, sh;
  if (view.sel.kind === 'node') {
    const n = node(view.sel.id);
    if (!n) return;
    sx = n.x * view.scale + view.x; sy = n.y * view.scale + view.y;
    sw = n.w * view.scale; sh = n.h * view.scale;
  } else {
    const l = store.board.links.find((k) => k.id === view.sel.id);
    if (!l) return;
    const { p1, p2 } = linkPoints(node(l.from), node(l.to));
    sx = ((p1.x + p2.x) / 2) * view.scale + view.x; sy = ((p1.y + p2.y) / 2) * view.scale + view.y;
    sw = 0; sh = 0;
  }
  const bw = floatBar.offsetWidth, bh = floatBar.offsetHeight;
  let left = clamp(sx + sw / 2 - bw / 2, 8, Math.max(8, r.width - bw - 8));
  let top = sy - bh - 12;
  if (top < 56) top = sy + sh + 12;
  top = clamp(top, 8, Math.max(8, r.height - bh - 8));
  floatBar.style.left = left + 'px';
  floatBar.style.top = top + 'px';
}

function select(sel) {
  view.sel = sel;
  view.showColors = false;
  updateSelectionUI();
  renderLinks();
}

floatBar.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-color]');
  if (sw && view.sel?.kind === 'node') {
    const c = sw.dataset.color;
    view.lastColor = c;
    commit((b) => { b.nodes[view.sel.id].color = c; });
    barKey = '';
    updateSelectionUI();
    return;
  }
  const b = e.target.closest('[data-act]');
  if (b) runAction(b.dataset.act);
});

function runAction(act) {
  const sel = view.sel;
  if (!sel) return;
  if (sel.kind === 'link') {
    if (act === 'del') deleteSelected();
    if (act === 'arrow') {
      const order = ['end', 'both', 'none'];
      commit((b) => {
        const l = b.links.find((k) => k.id === sel.id);
        l.arrow = order[(order.indexOf(l.arrow || 'end') + 1) % order.length];
      });
      toast({ end: '單向箭頭', both: '雙向箭頭', none: '無箭頭' }[store.board.links.find((k) => k.id === sel.id).arrow]);
    }
    return;
  }
  const id = sel.id;
  const n = node(id);
  if (!n) return;
  switch (act) {
    case 'edit': startEdit(id); break;
    case 'view': view.hooks.openViewer?.(id); break;
    case 'crop': view.hooks.openEditor?.(id); break;
    case 'bigger':
    case 'smaller': {
      const d = act === 'bigger' ? 4 : -4;
      commit((b) => { const k = b.nodes[id]; k.fontSize = clamp((k.fontSize || DEFAULT_FONT) + d, 12, 120); });
      break;
    }
    case 'color': view.showColors = !view.showColors; updateSelectionUI(); break;
    case 'link': view.linkFrom = id; view.sel = null; updateSelectionUI(); break;
    case 'camInto': view.hooks.openCamera?.(id); break;
    case 'open': goTo(id); break;
    case 'dup': duplicate(id); break;
    case 'out': moveOut(id); break;
    case 'del': deleteSelected(); break;
  }
}

export function deleteSelected() {
  const sel = view.sel;
  if (!sel) return;
  if (sel.kind === 'link') {
    commit((b) => { b.links = b.links.filter((l) => l.id !== sel.id); });
  } else {
    let count = 0;
    commit(() => { count = removeNodes([sel.id]); });
    toast(count > 1 ? `已刪除（含裡面 ${count - 1} 張卡片），可按「復原」救回` : '已刪除，可按「復原」救回');
  }
  view.sel = null;
  render();
}

function duplicate(id) {
  const ids = [id, ...descendants(id)];
  const map = {};
  ids.forEach((i) => { map[i] = uid(); });
  commit((b) => {
    const src = b.nodes[id];
    const z = topZ(src.parent) + 1;
    for (const i of ids) {
      const o = b.nodes[i];
      const c = { ...o, id: map[i], parent: i === id ? o.parent : map[o.parent] };
      if (i === id) { c.x += 30; c.y += 30; c.z = z; }
      b.nodes[c.id] = c;
    }
    for (const l of [...b.links]) {
      if (map[l.from] && map[l.to] && l.from !== id && l.to !== id) {
        b.links.push({ ...l, id: uid(), from: map[l.from], to: map[l.to] });
      }
    }
  });
  view.sel = { kind: 'node', id: map[id] };
  render();
}

function moveOut(id) {
  const c = node(view.container);
  if (!c) return;
  const target = c.parent ?? null;
  commit((b) => {
    const n = b.nodes[id];
    const spot = findFreeSpot(target, n.w, n.h, { x: c.x + c.w - 20, y: c.y - 40, w: 900, h: Infinity });
    n.parent = target;
    n.x = spot.x; n.y = spot.y;
    n.z = topZ(target) + 1;
    removeLinksOf(id);
  });
  view.sel = null;
  render();
  toast('已移到上一層');
}

// ---------- 新增卡片 ----------

// 在 region 範圍內，由左上往右下找第一個不會和其他卡片重疊的位置
export function findFreeSpot(container, w, h2, region) {
  const kids = children(container);
  const gap = 20;
  const fits = (x, y) => kids.every((k) =>
    x + w + gap <= k.x || k.x + k.w + gap <= x || y + h2 + gap <= k.y || k.y + k.h + gap <= y);
  const x0 = Math.round(region.x + 40), y0 = Math.round(region.y + 40);
  const xMax = Math.max(x0, region.x + region.w - 40 - w);
  for (let y = y0; y < y0 + 6000; y += 40) {
    for (let x = x0; x <= xMax; x += 40) if (fits(x, y)) return { x, y };
  }
  return { x: x0 + 30 * (kids.length % 10), y: y0 + 30 * (kids.length % 10) };
}

const innerRegion = { x: 0, y: 0, w: 1180, h: Infinity };

// 新卡片放在目前看得到的範圍內，避開左上角的路徑列
function placementRect() {
  const r = visibleRect();
  const top = (view.container ? 56 : 0) / view.scale;
  return { x: r.x, y: r.y + top, w: r.w, h: r.h - top };
}
const regionFor = (target) => (target === view.container ? placementRect() : innerRegion);

export function addTextCard(at = null) {
  finishEdit();
  const tok = begin();
  const w = 220, h2 = 140;
  const spot = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h2 / 2) } : findFreeSpot(view.container, w, h2, placementRect());
  const n = addNode({ type: 'text', parent: view.container, ...spot, w, h: h2, color: view.lastColor, text: '', fontSize: DEFAULT_FONT });
  view.sel = { kind: 'node', id: n.id };
  render();
  startEdit(n.id, tok, true);
}

// 用和卡片相同的樣式量出文字需要的高度
function measureTextHeight(text, w, fontSize) {
  const probe = h('div', { class: 'card-text', style: { position: 'absolute', visibility: 'hidden', width: w + 'px', height: 'auto', fontSize: fontSize + 'px' } }, text);
  cardsLayer.append(probe);
  const ht = probe.offsetHeight;
  probe.remove();
  return ht;
}

// 批次新增文字卡：每一段（空一行分隔）一張
export function addTextCards(paragraphs) {
  const ids = [];
  commit(() => {
    for (const text of paragraphs) {
      const w = 240;
      const h2 = clamp(measureTextHeight(text, w, DEFAULT_FONT) + 4, 90, 420);
      const spot = findFreeSpot(view.container, w, h2, placementRect());
      ids.push(addNode({ type: 'text', parent: view.container, ...spot, w, h: h2, color: view.lastColor, text, fontSize: DEFAULT_FONT }).id);
    }
  });
  render();
  if (ids.length) ensureVisible(node(ids[0]));
  return ids.length;
}

// 加入一張照片。target = null 放到畫布；target = 卡片 id 放進那張卡片
export async function addPhoto(img, target) {
  const imageId = uid();
  await db.putImage({ id: imageId, blob: img.blob, w: img.w, h: img.h });
  const size = imageCardSize(img.w, img.h);
  let nid;
  commit(() => {
    const spot = findFreeSpot(target, size.w, size.h, regionFor(target));
    nid = addNode({ type: 'image', parent: target, imageId, ...spot, ...size, color: '#ffffff' }).id;
  });
  render();
  if (target === view.container) ensureVisible(node(nid));
  return nid;
}

// ---------- 文字編輯 ----------

export function startEdit(id, token = null, isNew = false) {
  lastTap = { id: null, t: 0 };
  const n = node(id);
  const el = elMap.get(id);
  if (!n || n.type !== 'text' || !el) return;
  if (view.editing && view.editing.id !== id) finishEdit();
  if (view.editing) return;
  view.editing = { id, token: token ?? begin(), isNew };
  const ta = h('textarea', { class: 'card-edit', value: n.text || '', placeholder: '輸入文字…' });
  ta.style.fontSize = (n.fontSize || DEFAULT_FONT) + 'px';
  const inner = el.querySelector('.card-text');
  if (inner) inner.replaceWith(ta); else el.prepend(ta);
  ta.addEventListener('input', () => { n.text = ta.value; });
  ta.addEventListener('blur', () => finishEdit());
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ta.blur();
  });
  view.sel = { kind: 'node', id };
  updateSelectionUI();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

export function finishEdit() {
  const ed = view.editing;
  if (!ed) return;
  view.editing = null;
  const n = node(ed.id);
  if (n) {
    n.text = (n.text || '').replace(/\s+$/, '');
    if (!n.text && ed.isNew) { removeNodes([n.id]); view.sel = null; }
  }
  const el = elMap.get(ed.id);
  if (el) el.dataset.sig = '';
  const ta = el?.querySelector('textarea');
  if (ta && document.activeElement === ta) ta.blur();
  end(ed.token);
  render();
}

// ---------- 手勢：拖拉、縮放、點選 ----------

const pointers = new Map();
let gesture = null;
let lastTap = { id: null, t: 0, x: 0, y: 0 };

viewport.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#float-toolbar, .zoom-ctrl, #crumbs, textarea')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const endedEdit = !!view.editing;
  if (endedEdit) finishEdit();
  try { viewport.setPointerCapture(e.pointerId); } catch {}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    if (gesture?.moved && gesture.token) {
      if (gesture.type === 'card') clearDropTarget(gesture);
      end(gesture.token);
    }
    const [a, b] = [...pointers.values()];
    const r = vpRect();
    gesture = {
      type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      m0: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
      x0: view.x, y0: view.y, s0: view.scale,
    };
    floatBar.classList.add('dragging');
    return;
  }
  if (pointers.size > 2) return;

  const base = { sx: e.clientX, sy: e.clientY, moved: false, pointerType: e.pointerType, endedEdit };
  const cardEl = e.target.closest('.card');
  const linkEl = e.target.closest('.link-hit');
  if (e.target === handle && view.sel?.kind === 'node') {
    const n = node(view.sel.id);
    gesture = { ...base, type: 'resize', id: n.id, w0: n.w, h0: n.h, ratio: (n.h - IMAGE_PAD * 2) / Math.max(1, n.w - IMAGE_PAD * 2) };
  } else if (cardEl && node(cardEl.dataset.id)) {
    const n = node(cardEl.dataset.id);
    gesture = { ...base, type: 'card', id: n.id, x0: n.x, y0: n.y, badge: !!e.target.closest('.badge'), dropId: null };
  } else if (linkEl) {
    gesture = { ...base, type: 'link', id: linkEl.dataset.link };
  } else {
    gesture = { ...base, type: 'pan', vx0: view.x, vy0: view.y };
  }
});

viewport.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gesture;
  if (!g || g.type === 'none') return;

  if (g.type === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const r = vpRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const ns = clamp(g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0, MIN_SCALE, MAX_SCALE);
    const wx = (g.m0.x - g.x0) / g.s0, wy = (g.m0.y - g.y0) / g.s0;
    view.scale = ns;
    view.x = mid.x - wx * ns;
    view.y = mid.y - wy * ns;
    applyTransform();
    return;
  }

  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (!g.moved) {
    if (Math.hypot(dx, dy) < (g.pointerType === 'touch' ? 8 : 4)) return;
    g.moved = true;
    onDragStart(g);
  }
  const s = view.scale;
  if (g.type === 'pan') {
    view.x = g.vx0 + dx;
    view.y = g.vy0 + dy;
    applyTransform();
  } else if (g.type === 'card') {
    const n = node(g.id);
    if (!n) return;
    n.x = Math.round(g.x0 + dx / s);
    n.y = Math.round(g.y0 + dy / s);
    paintPos(elMap.get(n.id), n);
    renderLinks();
    updateDropTarget(g, e);
  } else if (g.type === 'resize') {
    const n = node(g.id);
    if (!n) return;
    n.w = Math.round(Math.max(90, g.w0 + dx / s));
    n.h = n.type === 'image'
      ? Math.round((n.w - IMAGE_PAD * 2) * g.ratio + IMAGE_PAD * 2)
      : Math.round(Math.max(60, g.h0 + dy / s));
    paintPos(elMap.get(n.id), n);
    renderLinks();
  }
});

function onDragStart(g) {
  floatBar.classList.add('dragging');
  if (g.type === 'card') {
    g.token = begin();
    const n = node(g.id);
    n.z = topZ(n.parent) + 1;
    const el = elMap.get(n.id);
    el.style.zIndex = n.z;
    el.classList.add('dragging');
  } else if (g.type === 'resize') {
    g.token = begin();
  }
}

function updateDropTarget(g, e) {
  const p = toWorld(e.clientX, e.clientY);
  let target = null;
  for (const k of children(view.container)) {
    if (k.id === g.id) continue;
    const m = Math.min(24, k.w * 0.2, k.h * 0.2);
    if (p.x > k.x + m && p.x < k.x + k.w - m && p.y > k.y + m && p.y < k.y + k.h - m) {
      if (!target || (k.z || 0) > (target.z || 0)) target = k;
    }
  }
  if (g.dropId === (target?.id || null)) return;
  clearDropTarget(g);
  g.dropId = target?.id || null;
  if (target) {
    elMap.get(target.id)?.classList.add('drop-target');
    hintEl.textContent = `放開就會放進「${nodeLabel(target)}」裡面`;
    hintEl.hidden = false;
  }
}
function clearDropTarget(g) {
  if (g.dropId) elMap.get(g.dropId)?.classList.remove('drop-target');
  g.dropId = null;
  hintEl.hidden = !view.linkFrom;
}

function onPointerEnd(e, cancelled) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    if (pointers.size < 2) {
      gesture = pointers.size ? { type: 'none' } : null;
      floatBar.classList.remove('dragging');
      saveCurrentView();
    }
    return;
  }
  if (pointers.size) return;
  gesture = null;
  floatBar.classList.remove('dragging');
  if (g.type === 'none') return;

  if (g.moved) {
    if (g.type === 'card') {
      elMap.get(g.id)?.classList.remove('dragging');
      if (g.dropId && !cancelled) nestInto(g.id, g.dropId);
      clearDropTarget(g);
      end(g.token);
      render();
    } else if (g.type === 'resize') {
      end(g.token);
      render();
    } else if (g.type === 'pan') {
      saveCurrentView();
    }
    positionFloatBar();
    return;
  }
  if (cancelled) return;

  if (g.type === 'card') tapCard(g.id, g.badge);
  else if (g.type === 'link') { if (!view.linkFrom) select({ kind: 'link', id: g.id }); }
  else if (g.type === 'pan') {
    if (g.endedEdit) { lastTap = { id: null, t: 0 }; if (view.sel) select(null); }
    else tapEmpty(e);
  }
}

viewport.addEventListener('pointerup', (e) => onPointerEnd(e, false));
viewport.addEventListener('pointercancel', (e) => onPointerEnd(e, true));

function nestInto(id, targetId) {
  const n = node(id), t = node(targetId);
  if (!n || !t) return;
  const spot = findFreeSpot(t.id, n.w, n.h, innerRegion);
  n.parent = t.id;
  n.x = spot.x; n.y = spot.y;
  n.z = topZ(t.id) + 1;
  removeLinksOf(id);
  view.sel = { kind: 'node', id: t.id };
  toast(`已放進「${nodeLabel(t)}」（可按「復原」取消）`);
}

function tapCard(id, onBadge) {
  if (view.linkFrom) {
    const from = view.linkFrom;
    view.linkFrom = null;
    if (from !== id) {
      const exists = store.board.links.some((l) => (l.from === from && l.to === id) || (l.from === id && l.to === from));
      if (exists) toast('這兩張卡片已經連過了');
      else {
        const lid = uid();
        commit((b) => { b.links.push({ id: lid, from, to: id, arrow: 'end' }); });
        view.sel = { kind: 'link', id: lid };
      }
    }
    render();
    return;
  }
  if (onBadge) { goTo(id); return; }
  const now = Date.now();
  if (lastTap.id === id && now - lastTap.t < 350) {
    lastTap = { id: null, t: 0 };
    const n = node(id);
    if (n.type === 'text') startEdit(id);
    else view.hooks.openViewer?.(id);
    return;
  }
  lastTap = { id, t: now };
  select({ kind: 'node', id });
}

function tapEmpty(e) {
  const now = Date.now();
  const dbl = lastTap.id === '__empty' && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
  if (view.linkFrom) { view.linkFrom = null; updateSelectionUI(); return; }
  if (dbl) {
    lastTap = { id: null, t: 0 };
    addTextCard(toWorld(e.clientX, e.clientY));
    return;
  }
  lastTap = { id: '__empty', t: now, x: e.clientX, y: e.clientY };
  if (view.sel) select(null);
}

// 觸控板：兩指捲動＝移動畫布；捏合（ctrl＋滾輪）＝縮放
viewport.addEventListener('wheel', (e) => {
  if (e.target.closest('#float-toolbar')) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    applyTransform();
    saveCurrentView();
  }
}, { passive: false });

// Mac Safari 的觸控板捏合
let gestureScale = 1;
viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
viewport.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (pointers.size >= 2) return;
  zoomAt(e.clientX, e.clientY, e.scale / gestureScale);
  gestureScale = e.scale;
});
viewport.addEventListener('gestureend', (e) => e.preventDefault());

// ---------- 鍵盤 ----------

export function handleBoardKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') {
    if (view.linkFrom) { view.linkFrom = null; updateSelectionUI(); }
    else if (view.sel) select(null);
    else goUp();
    return true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && view.sel) { deleteSelected(); return true; }
  if (e.key === 'Enter' && view.sel?.kind === 'node' && node(view.sel.id)?.type === 'text') { startEdit(view.sel.id); return true; }
  if (mod && e.key.toLowerCase() === 'd' && view.sel?.kind === 'node') { duplicate(view.sel.id); return true; }
  return false;
}
