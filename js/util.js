// 共用小工具：id、DOM、圖片處理、存檔、提示訊息、幾何計算

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const $ = (s) => document.querySelector(s);

export const MAX_IMAGE_SIDE = 1600;
export const IMAGE_PAD = 8;
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

// h('div', { class: 'x', onclick: fn }, '文字', childEl)
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 圖片 ----------

// 讀取 Blob 成可畫到 canvas 的物件（會依照片 EXIF 轉正）
export async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
    try { return await createImageBitmap(blob); } catch {}
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return img;
}

const sizeOf = (src) => [
  src.videoWidth || src.naturalWidth || src.width,
  src.videoHeight || src.naturalHeight || src.height,
];

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.86) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('無法輸出圖片'))), type, quality));
}

// 把照片／影片畫面縮到最長邊 1600px 並轉成 JPEG，避免佔滿儲存空間
export async function normalizeImage(source, maxSide = MAX_IMAGE_SIDE) {
  const src = source instanceof Blob ? await loadBitmap(source) : source;
  const [sw, sh] = sizeOf(src);
  if (!sw || !sh) throw new Error('圖片尺寸不正確');
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * s), h2 = Math.round(sh * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h2);
  ctx.drawImage(src, 0, 0, w, h2);
  if (source instanceof Blob && src.close) src.close();
  return { blob: await canvasToBlob(c), w, h: h2 };
}

// 圖片卡的大小（含外框留白）
export function imageCardSize(iw, ih, maxW = 260, maxH = 320) {
  const s = Math.min(maxW / iw, maxH / ih);
  return { w: Math.round(iw * s) + IMAGE_PAD * 2, h: Math.round(ih * s) + IMAGE_PAD * 2 };
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export const dataURLToBlob = (url) => fetch(url).then((r) => r.blob());

// iPad 上用分享選單（可存到相簿／檔案），電腦上直接下載
export async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export const safeFilename = (s) => (s || '未命名').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);

// ---------- 幾何 ----------

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// 從矩形中心往 (tx,ty) 的射線與矩形邊緣的交點
function edgePoint(r, tx, ty, gap = 6) {
  const c = center(r);
  const dx = tx - c.x, dy = ty - c.y;
  const len = Math.hypot(dx, dy);
  if (!len) return c;
  const t = Math.min((r.w / 2) / Math.abs(dx || 1e-9), (r.h / 2) / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
}

export function linkPoints(a, b) {
  const ac = center(a), bc = center(b);
  return { p1: edgePoint(a, bc.x, bc.y), p2: edgePoint(b, ac.x, ac.y) };
}

export function boundsOf(list) {
  if (!list.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of list) {
    x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// 依閱讀順序排序（由上而下分列，每列由左而右）
export function readingOrder(list) {
  const sorted = [...list].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const n of sorted) {
    const row = rows[rows.length - 1];
    if (row && n.y < row.top + row.ref * 0.5) row.items.push(n);
    else rows.push({ top: n.y, ref: n.h, items: [n] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}
