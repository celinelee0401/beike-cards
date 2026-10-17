// 對話框、全螢幕檢視、圖片裁切旋轉

import { children, commit, node } from './store.js';
import { db, imageURL } from './db.js';
import { $, h, clamp, uid, toast, loadBitmap, normalizeImage, readingOrder, IMAGE_PAD } from './util.js';

// ---------- 對話框 ----------

const dlg = $('#dialog');

function openDialog(build) {
  return new Promise((resolve) => {
    const box = h('div', { class: 'dlg-box', role: 'dialog', 'aria-modal': 'true' });
    const close = (v) => {
      dlg.hidden = true;
      dlg.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);
    dlg.onpointerdown = (e) => { if (e.target === dlg) close(null); };
    build(box, close);
    dlg.replaceChildren(box);
    dlg.hidden = false;
    box.querySelector('[autofocus]')?.focus();
  });
}

export const dialogOpen = () => !dlg.hidden;

export function askText({ title, value = '', placeholder = '', okText = '確定', multiline = false, hint = '' }) {
  return openDialog((box, close) => {
    const input = multiline
      ? h('textarea', { class: 'dlg-input', rows: '10', value, placeholder, autofocus: true })
      : h('input', { class: 'dlg-input', type: 'text', value, placeholder, autofocus: true });
    const form = h('form', {
      onsubmit: (e) => { e.preventDefault(); close(input.value); },
    },
    h('h3', {}, title),
    hint && h('p', { class: 'dlg-hint' }, hint),
    input,
    h('div', { class: 'dlg-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, '取消'),
      h('button', { type: 'submit', class: 'btn primary' }, okText)));
    if (multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close(input.value); });
    box.append(form);
  });
}

export function confirmBox({ title, message = '', okText = '確定', cancelText = '取消', danger = false }) {
  return openDialog((box, close) => {
    box.append(
      h('h3', {}, title),
      message && h('p', { class: 'dlg-hint' }, message),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', onclick: () => close(false) }, cancelText),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => close(true), autofocus: true }, okText)));
  });
}

// actions: [{ label, value, danger, hint }]
export function chooseAction(title, actions) {
  return openDialog((box, close) => {
    box.append(h('h3', {}, title),
      h('div', { class: 'dlg-list' }, actions.map((a) =>
        h('button', { class: 'dlg-item' + (a.danger ? ' danger' : ''), onclick: () => close(a.value) },
          h('span', {}, a.label), a.hint && h('small', {}, a.hint)))),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消')));
  });
}

// ---------- 全螢幕檢視（投影學生作品用） ----------

const viewer = $('#viewer');
const vStage = $('#viewer-stage');
const vCount = $('#viewer-count');
const vPrev = $('#viewer-prev');
const vNext = $('#viewer-next');
let vs = null;

export function openViewer(id) {
  const n = node(id);
  if (!n) return;
  const list = readingOrder(children(n.parent));
  vs = { list, idx: Math.max(0, list.findIndex((k) => k.id === id)) };
  viewer.hidden = false;
  showViewer();
}

function showViewer() {
  const n = vs.list[vs.idx];
  vStage.replaceChildren();
  if (n.type === 'image') {
    const img = h('img', { class: 'viewer-img', alt: '' });
    imageURL(n.imageId).then((u) => { if (u) img.src = u; });
    vStage.append(img);
  } else {
    vStage.append(h('div', { class: 'viewer-text', style: { background: n.color || '#fff' } }, n.text || ''));
  }
  vCount.textContent = `${vs.idx + 1} / ${vs.list.length}`;
  vPrev.disabled = vs.idx === 0;
  vNext.disabled = vs.idx === vs.list.length - 1;
}

function stepViewer(d) {
  if (!vs) return;
  const i = clamp(vs.idx + d, 0, vs.list.length - 1);
  if (i !== vs.idx) { vs.idx = i; showViewer(); }
}
export function closeViewer() { viewer.hidden = true; vs = null; vStage.replaceChildren(); }

vPrev.addEventListener('click', () => stepViewer(-1));
vNext.addEventListener('click', () => stepViewer(1));
$('#viewer-close').addEventListener('click', closeViewer);
let swipe = null;
vStage.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
vStage.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) stepViewer(dx < 0 ? 1 : -1);
});

export function handleViewerKey(e) {
  if (viewer.hidden) return false;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') stepViewer(-1);
  else if (e.key === 'ArrowRight' || e.key === ' ') stepViewer(1);
  return true;
}

// ---------- 裁切與旋轉 ----------

const editor = $('#editor');
const eStage = $('#editor-stage');
const eCanvas = $('#editor-canvas');
const cropBox = $('#crop-box');
let ed = null;   // { nodeId, bmp, rot, crop: {x,y,w,h}（0~1，以旋轉後的圖片為準）, disp }

export async function openEditor(nodeId) {
  const n = node(nodeId);
  const rec = n && await db.getImage(n.imageId);
  if (!rec) { toast('找不到這張照片'); return; }
  ed = { nodeId, bmp: await loadBitmap(rec.blob), rot: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
  editor.hidden = false;
  layoutEditor();
}

const rotatedSize = () => (ed.rot % 180 ? [ed.bmp.height, ed.bmp.width] : [ed.bmp.width, ed.bmp.height]);

function drawRotated(ctx, W, H) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((ed.rot * Math.PI) / 180);
  const [dw, dh] = ed.rot % 180 ? [H, W] : [W, H];
  ctx.drawImage(ed.bmp, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function layoutEditor() {
  if (!ed) return;
  const area = eStage.getBoundingClientRect();
  const [rw, rh] = rotatedSize();
  const s = Math.min((area.width - 32) / rw, (area.height - 32) / rh);
  const dw = Math.round(rw * s), dh = Math.round(rh * s);
  const dpr = window.devicePixelRatio || 1;
  eCanvas.width = dw * dpr;
  eCanvas.height = dh * dpr;
  eCanvas.style.width = dw + 'px';
  eCanvas.style.height = dh + 'px';
  const ctx = eCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawRotated(ctx, dw, dh);
  ed.disp = { w: dw, h: dh, left: (area.width - dw) / 2, top: (area.height - dh) / 2 };
  eCanvas.style.left = ed.disp.left + 'px';
  eCanvas.style.top = ed.disp.top + 'px';
  drawCrop();
}

function drawCrop() {
  const { disp, crop } = ed;
  Object.assign(cropBox.style, {
    left: disp.left + crop.x * disp.w + 'px',
    top: disp.top + crop.y * disp.h + 'px',
    width: crop.w * disp.w + 'px',
    height: crop.h * disp.h + 'px',
  });
}

let cropDrag = null;
cropBox.addEventListener('pointerdown', (e) => {
  if (!ed) return;
  e.preventDefault();
  try { cropBox.setPointerCapture(e.pointerId); } catch {}
  cropDrag = { mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, c0: { ...ed.crop } };
});
cropBox.addEventListener('pointermove', (e) => {
  if (!cropDrag || !ed) return;
  const dx = (e.clientX - cropDrag.sx) / ed.disp.w;
  const dy = (e.clientY - cropDrag.sy) / ed.disp.h;
  const c0 = cropDrag.c0;
  const MIN = 0.05;
  let { x, y, w, h: hh } = c0;
  const m = cropDrag.mode;
  if (m === 'move') {
    x = clamp(c0.x + dx, 0, 1 - c0.w);
    y = clamp(c0.y + dy, 0, 1 - c0.h);
  } else {
    let x2 = c0.x + c0.w, y2 = c0.y + c0.h;
    if (m.includes('w')) x = clamp(c0.x + dx, 0, x2 - MIN);
    if (m.includes('e')) x2 = clamp(x2 + dx, c0.x + MIN, 1);
    if (m.includes('n')) y = clamp(c0.y + dy, 0, y2 - MIN);
    if (m.includes('s')) y2 = clamp(y2 + dy, c0.y + MIN, 1);
    w = x2 - x; hh = y2 - y;
  }
  ed.crop = { x, y, w, h: hh };
  drawCrop();
});
cropBox.addEventListener('pointerup', () => { cropDrag = null; });
cropBox.addEventListener('pointercancel', () => { cropDrag = null; });

function rotate(d) {
  ed.rot = (ed.rot + d + 360) % 360;
  ed.crop = { x: 0, y: 0, w: 1, h: 1 };
  layoutEditor();
}

async function applyEdit() {
  const n = node(ed.nodeId);
  if (!n) { closeEditor(); return; }
  const [rw, rh] = rotatedSize();
  const full = document.createElement('canvas');
  full.width = rw; full.height = rh;
  drawRotated(full.getContext('2d'), rw, rh);
  const c = ed.crop;
  const cx = Math.round(c.x * rw), cy = Math.round(c.y * rh);
  const cw = Math.max(1, Math.round(c.w * rw)), ch = Math.max(1, Math.round(c.h * rh));
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
  const img = await normalizeImage(out);
  const imageId = uid();
  await db.putImage({ id: imageId, blob: img.blob, w: img.w, h: img.h });
  commit((b) => {
    const k = b.nodes[ed.nodeId];
    k.imageId = imageId;
    const innerW = k.w - IMAGE_PAD * 2;
    k.h = Math.round(innerW * (img.h / img.w)) + IMAGE_PAD * 2;
  });
  closeEditor();
}

export function closeEditor() {
  if (ed?.bmp?.close) ed.bmp.close();
  ed = null;
  editor.hidden = true;
}

$('#editor-rotl').addEventListener('click', () => rotate(-90));
$('#editor-rotr').addEventListener('click', () => rotate(90));
$('#editor-reset').addEventListener('click', () => { ed.crop = { x: 0, y: 0, w: 1, h: 1 }; drawCrop(); });
$('#editor-cancel').addEventListener('click', closeEditor);
$('#editor-apply').addEventListener('click', () => applyEdit().catch((e) => toast('套用失敗：' + e.message)));
window.addEventListener('resize', () => { if (ed) layoutEditor(); });

export function handleEditorKey(e) {
  if (editor.hidden) return false;
  if (e.key === 'Escape') closeEditor();
  return true;
}

export const anyOverlayOpen = () => !viewer.hidden || !editor.hidden || !dlg.hidden;
