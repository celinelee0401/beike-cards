// 手寫：筆、螢光筆、橡皮擦
//
// 筆跡（stroke）= { c: 顏色, w: 粗細, o: 透明度（螢光筆才有）, p: [x1, y1, x2, y2, ...] }
// 卡片上的筆跡存在 node.ink = { w, h, v, strokes }：座標以「開始寫時的卡片大小 w×h」為準，卡片縮放時跟著縮放
// 畫布上的筆跡存在 board.ink[容器id 或 'root'] = { v, strokes }：座標就是畫布座標

import { $, h, clamp, uid } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

export const PEN_COLORS = ['#1f2a26', '#d63a2f', '#2563c9', '#1f8a4c', '#e08a1e', '#8b3fc4'];
export const PEN_SIZES = [2, 4, 8];
const MARKER_MULT = 4;
const MARKER_OPACITY = 0.35;
const ERASER_PX = 14;

export const pen = {
  on: false,
  tool: 'pen',          // 'pen' | 'marker' | 'eraser'
  color: PEN_COLORS[1],
  size: PEN_SIZES[1],
  penSeen: false,       // 用過 Apple Pencil 之後，手指就改成移動畫布
};

const listeners = new Set();
export const onPenChange = (f) => listeners.add(f);
const emit = () => listeners.forEach((f) => f());

// 這個指標要不要拿來寫字
export function isInkInput(e) {
  if (!pen.on) return false;
  if (e.pointerType === 'pen') { pen.penSeen = true; return true; }
  if (e.pointerType === 'mouse') return true;
  return !pen.penSeen;
}

export const newInkVersion = () => uid();

// ---------- 繪製 ----------

const r1 = (v) => Math.round(v * 10) / 10;

export function strokeD(p) {
  const n = p.length / 2;
  if (n < 1) return '';
  let d = `M${p[0]} ${p[1]}`;
  if (n === 1) return d + 'l0.01 0';
  if (n === 2) return d + `L${p[2]} ${p[3]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1], nx = p[i * 2 + 2], ny = p[i * 2 + 3];
    d += `Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}

function strokeEl(s) {
  const el = document.createElementNS(NS, 'path');
  el.setAttribute('d', strokeD(s.p));
  el.setAttribute('stroke', s.c);
  el.setAttribute('stroke-width', s.w);
  if (s.o) el.setAttribute('stroke-opacity', s.o);
  return el;
}

export function fillInk(svg, strokes) {
  svg.replaceChildren(...(strokes || []).map(strokeEl));
}

export function cardInkSvg(ink) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'card-ink');
  svg.setAttribute('viewBox', `0 0 ${ink.w} ${ink.h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  fillInk(svg, ink.strokes);
  return svg;
}

// 開始一筆。toLocal 把螢幕座標換成筆跡座標；unitPx = 一個筆跡單位在螢幕上幾 px
export function startStroke(svg, toLocal, unitPx) {
  const marker = pen.tool === 'marker';
  const s = { c: pen.color, w: r1(Math.max(0.2, (pen.size * (marker ? MARKER_MULT : 1)) / unitPx)), p: [] };
  if (marker) s.o = MARKER_OPACITY;
  const el = strokeEl(s);
  svg.append(el);
  const minStep = 1.5 / unitPx;
  return {
    add(cx, cy) {
      const q = toLocal(cx, cy);
      const p = s.p;
      if (p.length && Math.hypot(q.x - p[p.length - 2], q.y - p[p.length - 1]) < minStep) return;
      p.push(r1(q.x), r1(q.y));
      el.setAttribute('d', strokeD(p));
    },
    finish() { el.remove(); return s.p.length ? s : null; },
    cancel() { el.remove(); },
  };
}

// ---------- 橡皮擦：碰到的整筆刪掉 ----------

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hits(s, x, y, r) {
  const p = s.p;
  const rr = r + s.w / 2;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 0; i < p.length - 2; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true;
  return false;
}

// 回傳是否有刪掉東西
export function eraseIn(inkObj, x, y, r) {
  if (!inkObj?.strokes?.length) return false;
  const before = inkObj.strokes.length;
  inkObj.strokes = inkObj.strokes.filter((s) => !hits(s, x, y, r));
  if (inkObj.strokes.length === before) return false;
  inkObj.v = newInkVersion();
  return true;
}
export const eraserRadius = (unitPx) => ERASER_PX / unitPx;

// 卡片上的筆跡座標換算（卡片元素可能在畫布上，也可能在全螢幕裡被放大）
export function cardInkMapper(n, cardEl) {
  const r = cardEl.getBoundingClientRect();
  const sx = n.ink.w / r.width, sy = n.ink.h / r.height;
  return {
    toLocal: (cx, cy) => ({ x: (cx - r.left) * sx, y: (cy - r.top) * sy }),
    unitPx: r.width / n.ink.w,
  };
}

export function ensureCardInk(n) {
  if (!n.ink) n.ink = { w: n.w, h: n.h, v: newInkVersion(), strokes: [] };
  return n.ink;
}

export function ensureCardInkSvg(n, cardEl) {
  let svg = cardEl.querySelector(':scope > .card-ink');
  if (!svg) {
    svg = cardInkSvg(n.ink);
    const badge = cardEl.querySelector(':scope > .badge');
    if (badge) badge.before(svg); else cardEl.append(svg);
  }
  return svg;
}

// 畫到 canvas（匯出圖片用）
export function drawInk(ctx, strokes) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes || []) {
    ctx.globalAlpha = s.o || 1;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.stroke(new Path2D(strokeD(s.p)));
  }
  ctx.restore();
}

// ---------- 工具列 ----------

const bar = $('#pen-bar');

export function setPen(on) {
  pen.on = on;
  bar.hidden = !on;
  document.body.classList.toggle('pen-on', on);
  emit();
}

function buildBar() {
  const tool = (id, label) => h('button', { class: 'pb-tool' + (pen.tool === id ? ' on' : ''), 'data-tool': id }, label);
  bar.replaceChildren(
    h('div', { class: 'pb-group' }, tool('pen', '筆'), tool('marker', '螢光筆'), tool('eraser', '橡皮擦')),
    h('div', { class: 'pb-group' + (pen.tool === 'eraser' ? ' dim' : '') }, PEN_COLORS.map((c) =>
      h('button', { class: 'pb-color' + (pen.color === c ? ' on' : ''), 'data-color': c, style: { background: c }, 'aria-label': '筆的顏色' }))),
    h('div', { class: 'pb-group' + (pen.tool === 'eraser' ? ' dim' : '') }, PEN_SIZES.map((s) =>
      h('button', { class: 'pb-size' + (pen.size === s ? ' on' : ''), 'data-size': String(s), 'aria-label': '筆的粗細' },
        h('span', { style: { width: s * 2 + 4 + 'px', height: s * 2 + 4 + 'px' } })))),
    h('button', { class: 'pb-done', 'data-done': '1' }, '完成'),
  );
}

bar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.done) { setPen(false); return; }
  if (b.dataset.tool) pen.tool = b.dataset.tool;
  if (b.dataset.color) { pen.color = b.dataset.color; if (pen.tool === 'eraser') pen.tool = 'pen'; }
  if (b.dataset.size) { pen.size = Number(b.dataset.size); if (pen.tool === 'eraser') pen.tool = 'pen'; }
  buildBar();
});
bar.addEventListener('pointerdown', (e) => e.stopPropagation());

onPenChange(() => { if (pen.on) buildBar(); });
