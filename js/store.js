// 目前開啟的筆記、復原／重做、自動存檔
//
// 資料結構（以後要多台同步時，以 id 和 updatedAt 為基礎合併）：
// board = { id, title, createdAt, updatedAt, nodes: {id: node}, links: [link], views: {容器id: {x,y,scale}}, ink: {容器id: 筆跡}, thumb }
// node  = { id, parent: null | 卡片id, type: 'text'|'image', x, y, w, h, z, color, text, fontSize, imageId, ink }
//         ink 是卡片上的手寫筆跡，格式見 ink.js
//         parent 是 null 代表在畫布上；是某張卡片的 id 代表「放在那張卡片裡面」
// link  = { id, from, to, arrow: 'end'|'both'|'none' }

import { db } from './db.js';
import { uid } from './util.js';

export const store = { board: null };

let undoStack = [];
let redoStack = [];
const listeners = new Set();
let saveTimer = null;

export function newBoard(title = '未命名筆記') {
  const t = Date.now();
  return { id: uid(), title, createdAt: t, updatedAt: t, nodes: {}, links: [], views: {}, ink: {} };
}

export function setBoard(b) {
  if (b) {
    b.nodes ||= {};
    b.links ||= [];
    b.views ||= {};
    b.ink ||= {};
  }
  store.board = b;
  undoStack = [];
  redoStack = [];
}

const snapshot = () => JSON.stringify({ nodes: store.board.nodes, links: store.board.links, ink: store.board.ink });

// begin() 記下修改前的狀態；end() 比對後放進復原紀錄
export const begin = () => snapshot();
export function end(before) {
  if (!store.board || snapshot() === before) return false;
  undoStack.push(before);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  changed();
  return true;
}
export function commit(fn) {
  const t = begin();
  fn(store.board);
  return end(t);
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}
function restore(s) {
  const o = JSON.parse(s);
  store.board.nodes = o.nodes;
  store.board.links = o.links;
  store.board.ink = o.ink || {};
  changed();
}

function changed() {
  store.board.updatedAt = Date.now();
  scheduleSave();
  listeners.forEach((f) => f());
}
export const onChange = (f) => listeners.add(f);

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}
export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (store.board) await db.putBoard(store.board);
}

// ---------- 卡片操作 ----------

export const node = (id) => (id ? store.board?.nodes[id] : null);

export function children(parent) {
  const p = parent ?? null;
  return Object.values(store.board.nodes)
    .filter((n) => (n.parent ?? null) === p)
    .sort((a, b) => (a.z || 0) - (b.z || 0));
}

export function descendants(id) {
  const out = [];
  const stack = [id];
  const all = Object.values(store.board.nodes);
  while (stack.length) {
    const cur = stack.pop();
    for (const n of all) if (n.parent === cur) { out.push(n.id); stack.push(n.id); }
  }
  return out;
}

export const topZ = (parent) => children(parent).reduce((m, n) => Math.max(m, n.z || 0), 0);

export function addNode(p) {
  const n = { id: uid(), parent: null, x: 0, y: 0, w: 220, h: 140, color: '#ffffff', ...p };
  n.parent = n.parent ?? null;
  n.z = topZ(n.parent) + 1;
  store.board.nodes[n.id] = n;
  return n;
}

// 刪除卡片（連同放在裡面的卡片和相關連線）
export function removeNodes(ids) {
  const set = new Set(ids);
  for (const id of ids) for (const d of descendants(id)) set.add(d);
  for (const id of set) { delete store.board.nodes[id]; delete store.board.ink?.[id]; }
  store.board.links = store.board.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  return set.size;
}

export function removeLinksOf(id) {
  store.board.links = store.board.links.filter((l) => l.from !== id && l.to !== id);
}

export function nodeLabel(n) {
  if (!n) return '';
  if (n.type === 'text') {
    const t = (n.text || '').trim().split('\n')[0];
    return t ? (t.length > 10 ? t.slice(0, 10) + '…' : t) : '文字卡';
  }
  return '圖片卡';
}
