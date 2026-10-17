// 匯出：存成圖片、列印／PDF、備份檔（可在另一台設備匯入）

import { store, children, newBoard } from './store.js';
import { db } from './db.js';
import {
  $, uid, loadBitmap, canvasToBlob, saveFile, safeFilename, blobToDataURL, dataURLToBlob,
  linkPoints, boundsOf, IMAGE_PAD,
} from './util.js';

const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const BG = '#f6f3ec';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const CJK = '⺀-鿿豈-﫿＀-￯　-〿';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const tok of para.match(TOKEN) || []) {
      if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      const t = line ? tok : tok.trimStart();
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      for (const ch of t) {
        if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawArrowHead(ctx, from, to, size) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a - 0.45), to.y - size * Math.sin(a - 0.45));
  ctx.lineTo(to.x - size * Math.cos(a + 0.45), to.y - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

// 把某一層（畫布或某張卡片的裡面）畫成一張圖
export async function renderToCanvas(containerId, { maxSide = 6000, ratio = 2 } = {}) {
  const b = store.board;
  const kids = children(containerId);
  const box = boundsOf(kids);
  if (!box) return null;
  const pad = 48;
  const W = box.w + pad * 2, H = box.h + pad * 2;
  const scale = Math.min(ratio, maxSide / Math.max(W, H));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(pad - box.x, pad - box.y);

  const ids = new Set(kids.map((k) => k.id));
  const counts = {};
  for (const n of Object.values(b.nodes)) if (n.parent) counts[n.parent] = (counts[n.parent] || 0) + 1;

  ctx.strokeStyle = '#4a5a55';
  ctx.fillStyle = '#4a5a55';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const l of b.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    const { p1, p2 } = linkPoints(b.nodes[l.from], b.nodes[l.to]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    const arrow = l.arrow || 'end';
    if (arrow !== 'none') drawArrowHead(ctx, p1, p2, 14);
    if (arrow === 'both') drawArrowHead(ctx, p2, p1, 14);
  }

  for (const n of kids) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, n.x, n.y, n.w, n.h, 10);
    ctx.fillStyle = n.color || '#fff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, n.x, n.y, n.w, n.h, 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();
    if (n.type === 'text') {
      const fs = n.fontSize || 22;
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = '#24302c';
      ctx.textBaseline = 'top';
      const lh = fs * 1.35;
      const lines = wrapText(ctx, n.text || '', n.w - 28);
      lines.forEach((ln, i) => ctx.fillText(ln, n.x + 14, n.y + 14 + i * lh + (lh - fs) / 2));
    } else {
      const rec = await db.getImage(n.imageId);
      if (rec) {
        const bmp = await loadBitmap(rec.blob);
        const iw = n.w - IMAGE_PAD * 2, ih = n.h - IMAGE_PAD * 2;
        const s = Math.min(iw / bmp.width, ih / bmp.height);
        const dw = bmp.width * s, dh = bmp.height * s;
        const dx = n.x + IMAGE_PAD + (iw - dw) / 2, dy = n.y + IMAGE_PAD + (ih - dh) / 2;
        ctx.save();
        roundRect(ctx, dx, dy, dw, dh, 4);
        ctx.clip();
        ctx.drawImage(bmp, dx, dy, dw, dh);
        ctx.restore();
        if (bmp.close) bmp.close();
      }
    }
    if (counts[n.id]) {
      const label = `▣ ${counts[n.id]}`;
      ctx.font = `bold 14px ${FONT}`;
      const tw = ctx.measureText(label).width + 16;
      roundRect(ctx, n.x + n.w - tw - 6, n.y + n.h - 28, tw, 22, 11);
      ctx.fillStyle = 'rgba(36,48,44,0.85)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, n.x + n.w - tw + 2, n.y + n.h - 17);
    }
    ctx.restore();
  }
  return canvas;
}

export async function exportPNG(containerId) {
  const c = await renderToCanvas(containerId);
  if (!c) return false;
  await saveFile(await canvasToBlob(c, 'image/png'), safeFilename(store.board.title) + '.png');
  return true;
}

export async function printView(containerId) {
  const c = await renderToCanvas(containerId, { maxSide: 4000 });
  if (!c) return false;
  const img = $('#print-img');
  img.src = c.toDataURL('image/png');
  await img.decode().catch(() => {});
  $('#print-page').textContent = `@page { size: ${c.width > c.height ? 'landscape' : 'portrait'}; margin: 10mm; }`;
  window.print();
  return true;
}

export async function makeThumb() {
  const c = await renderToCanvas(null, { maxSide: 480, ratio: 1 });
  return c ? c.toDataURL('image/jpeg', 0.7) : null;
}

// ---------- 備份檔 ----------

export async function exportBackup(board) {
  const images = {};
  for (const n of Object.values(board.nodes)) {
    if (!n.imageId || images[n.imageId]) continue;
    const rec = await db.getImage(n.imageId);
    if (rec) images[n.imageId] = { w: rec.w, h: rec.h, data: await blobToDataURL(rec.blob) };
  }
  const data = { app: 'beike-cards', version: 1, exportedAt: new Date().toISOString(), board, images };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await saveFile(blob, safeFilename(board.title) + '.beike.json');
}

// 匯入時一律建立成新的筆記，不會覆蓋現有的
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'beike-cards' || !data.board?.nodes) throw new Error('這不是備課卡片的備份檔');
  for (const [id, im] of Object.entries(data.images || {})) {
    await db.putImage({ id, w: im.w, h: im.h, blob: await dataURLToBlob(im.data) });
  }
  const b = { ...newBoard(), ...data.board, id: uid(), updatedAt: Date.now() };
  b.links ||= [];
  b.views ||= {};
  await db.putBoard(b);
  return b;
}
