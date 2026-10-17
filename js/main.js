// 進入點：筆記列表、上方工具列、鍵盤、貼上、拖放檔案

import { store, newBoard, setBoard, flush, onChange, undo, redo, canUndo, canRedo, node, nodeLabel } from './store.js';
import { db, cleanupImages } from './db.js';
import { $, h, toast, normalizeImage } from './util.js';
import {
  view, render, openBoardView, addTextCard, addTextCards, addPhoto, finishEdit, zoomBy, fitView,
  saveCurrentView, handleBoardKey, applyTransform,
} from './view.js';
import { openCamera, pickPhotos, handleCameraKey, cameraOpen } from './camera.js';
import {
  askText, confirmBox, chooseAction, openViewer, openEditor, handleViewerKey, handleEditorKey,
  anyOverlayOpen, dialogOpen,
} from './modals.js';
import { exportPNG, printView, exportBackup, importBackup, makeThumb } from './export.js';

const homeEl = $('#home');
const boardEl = $('#board');
const titleEl = $('#board-title');
const listEl = $('#board-list');

// ---------- 筆記列表 ----------

async function showHome() {
  homeEl.hidden = false;
  boardEl.hidden = true;
  document.title = '備課卡片';
  const boards = (await db.allBoards()).sort((a, b) => b.updatedAt - a.updatedAt);
  listEl.replaceChildren();
  $('#home-empty').hidden = boards.length > 0;
  for (const b of boards) {
    const count = Object.keys(b.nodes || {}).length;
    const d = new Date(b.updatedAt);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    listEl.append(h('div', { class: 'tile' },
      h('button', { class: 'tile-open', onclick: () => { location.hash = '#/b/' + b.id; } },
        h('div', { class: 'tile-thumb' }, b.thumb ? h('img', { src: b.thumb, alt: '' }) : h('span', {}, '空白筆記')),
        h('div', { class: 'tile-title' }, b.title || '未命名筆記'),
        h('div', { class: 'tile-meta' }, `${count} 張卡片 · ${when}`)),
      h('button', { class: 'tile-more', 'aria-label': '更多動作', onclick: () => boardMenu(b) }, '⋯')));
  }
}

async function boardMenu(b) {
  const act = await chooseAction(b.title || '未命名筆記', [
    { label: '重新命名', value: 'rename' },
    { label: '複製一份', value: 'dup' },
    { label: '備份成檔案', value: 'backup', hint: '可以存到雲端硬碟，或在別台設備匯入' },
    { label: '刪除', value: 'del', danger: true },
  ]);
  if (act === 'rename') {
    const t = await askText({ title: '重新命名', value: b.title });
    if (t?.trim()) { b.title = t.trim(); await db.putBoard(b); }
  } else if (act === 'dup') {
    const c = structuredClone(b);
    Object.assign(c, { id: newBoard().id, title: b.title + '（副本）', createdAt: Date.now(), updatedAt: Date.now() });
    await db.putBoard(c);
  } else if (act === 'backup') {
    await exportBackup(b);
  } else if (act === 'del') {
    const ok = await confirmBox({ title: `刪除「${b.title}」？`, message: '刪除後無法復原。建議先備份成檔案。', okText: '刪除', danger: true });
    if (ok) { await db.deleteBoard(b.id); cleanupImages().catch(() => {}); }
  }
  if (act) showHome();
}

$('#btn-new-board').addEventListener('click', async () => {
  const d = new Date();
  const t = await askText({ title: '新增筆記', value: `${d.getMonth() + 1}/${d.getDate()} 備課`, okText: '建立' });
  if (t == null) return;
  const b = newBoard(t.trim() || '未命名筆記');
  await db.putBoard(b);
  location.hash = '#/b/' + b.id;
});

$('#btn-import').addEventListener('click', () => { const i = $('#file-backup'); i.value = ''; i.click(); });
$('#file-backup').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const b = await importBackup(f);
    toast(`已匯入「${b.title}」`);
    showHome();
  } catch (err) {
    toast('匯入失敗：' + err.message, 4000);
  }
});

// ---------- 開啟／關閉筆記 ----------

async function openBoard(b) {
  if (store.board?.id === b.id) return;
  await closeBoard();
  setBoard(b);
  homeEl.hidden = true;
  boardEl.hidden = false;
  titleEl.textContent = b.title || '未命名筆記';
  document.title = (b.title || '未命名筆記') + ' · 備課卡片';
  openBoardView();
  updateUndo();
}

async function closeBoard() {
  if (!store.board) return;
  finishEdit();
  saveCurrentView();
  try { store.board.thumb = await makeThumb(); } catch {}
  await flush();
  setBoard(null);
}

async function route() {
  const m = location.hash.match(/^#\/b\/(.+)$/);
  if (m) {
    const b = await db.getBoard(decodeURIComponent(m[1]));
    if (b) return openBoard(b);
    location.replace('#');
  }
  await closeBoard();
  showHome();
}

// ---------- 上方工具列 ----------

const destLabel = (target) => (target ? `放進「${nodeLabel(node(target))}」裡面` : (view.container ? `放到「${nodeLabel(node(view.container))}」裡面` : '放到畫布上'));

function photoSession(target) {
  return {
    label: destLabel(target),
    onPhoto: (img) => addPhoto(img, target),
    onClose: (count) => {
      if (count) toast(target && target !== view.container ? `已放進「${nodeLabel(node(target))}」${count} 張照片` : `已加入 ${count} 張照片`);
      render();
    },
  };
}

view.hooks.openCamera = (into) => openCamera(photoSession(into));
view.hooks.openViewer = openViewer;
view.hooks.openEditor = openEditor;

$('#btn-home').addEventListener('click', () => { location.hash = ''; });
titleEl.addEventListener('click', async () => {
  const t = await askText({ title: '筆記名稱', value: store.board.title });
  if (!t?.trim()) return;
  store.board.title = t.trim();
  titleEl.textContent = store.board.title;
  await flush();
});
$('#btn-text').addEventListener('click', () => addTextCard());
$('#btn-camera').addEventListener('click', () => { finishEdit(); openCamera(photoSession(view.container)); });
$('#btn-photos').addEventListener('click', () => { finishEdit(); pickPhotos(photoSession(view.container)); });
$('#btn-batch').addEventListener('click', async () => {
  finishEdit();
  const t = await askText({
    title: '一次新增多張文字卡',
    hint: '每一段會變成一張卡片，段落之間空一行。也可以把別處寫好的內容整段貼上。',
    placeholder: '第一張卡片\n\n第二張卡片\n可以有很多行\n\n第三張卡片',
    multiline: true,
    okText: '建立卡片',
  });
  if (!t) return;
  const paras = splitParagraphs(t);
  if (paras.length) toast(`已新增 ${addTextCards(paras)} 張卡片`);
});
$('#btn-undo').addEventListener('click', () => { finishEdit(); undo(); });
$('#btn-redo').addEventListener('click', () => { finishEdit(); redo(); });
$('#btn-export').addEventListener('click', async () => {
  finishEdit();
  const where = view.container ? '這張卡片裡面的內容' : '整個畫布';
  const act = await chooseAction('匯出', [
    { label: '存成圖片（PNG）', value: 'png', hint: `${where}存成一張圖` },
    { label: '列印／存成 PDF', value: 'print', hint: '在列印畫面選「存成 PDF」' },
    { label: '備份這份筆記', value: 'backup', hint: '含所有卡片和照片，可在別台設備匯入' },
  ]);
  try {
    if (act === 'png' && !(await exportPNG(view.container))) toast('這裡還沒有卡片');
    if (act === 'print' && !(await printView(view.container))) toast('這裡還沒有卡片');
    if (act === 'backup') { await flush(); await exportBackup(store.board); }
  } catch (e) {
    toast('匯出失敗：' + e.message, 4000);
  }
});
$('#zoom-in').addEventListener('click', () => zoomBy(1.25));
$('#zoom-out').addEventListener('click', () => zoomBy(0.8));
$('#zoom-fit').addEventListener('click', () => fitView());

function updateUndo() {
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
}
onChange(() => { render(); updateUndo(); });

const splitParagraphs = (t) => t.split(/\n\s*\n/).map((s) => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);

// ---------- 鍵盤、貼上、拖放 ----------

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (dialogOpen()) return;
  if (handleCameraKey(e) || handleViewerKey(e) || handleEditorKey(e)) return;
  if (boardEl.hidden || typing(document.activeElement)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (handleBoardKey(e)) e.preventDefault();
});

document.addEventListener('paste', async (e) => {
  if (boardEl.hidden || anyOverlayOpen() || cameraOpen() || typing(document.activeElement)) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    for (const f of files) await addPhoto(await normalizeImage(f), view.container);
    return;
  }
  const text = e.clipboardData?.getData('text/plain');
  if (!text?.trim()) return;
  e.preventDefault();
  const paras = splitParagraphs(text);
  if (paras.length > 1 && await confirmBox({
    title: `要拆成 ${paras.length} 張卡片嗎？`,
    message: '貼上的文字有好幾段（中間有空行）。',
    okText: `拆成 ${paras.length} 張`, cancelText: '合成一張',
  })) addTextCards(paras);
  else addTextCards([text.trim()]);
});

const vp = $('#viewport');
vp.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); vp.classList.add('drop-files'); } });
vp.addEventListener('dragleave', () => vp.classList.remove('drop-files'));
vp.addEventListener('drop', async (e) => {
  vp.classList.remove('drop-files');
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) {
    try { await addPhoto(await normalizeImage(f), view.container); } catch { toast('有一張圖片讀不進來'); }
  }
});

// 避免 iPad 雙指縮放整個網頁
document.addEventListener('gesturestart', (e) => e.preventDefault());

// 切到別的 App 或關掉分頁時先存檔（並更新列表上的縮圖）
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'hidden' || !store.board) return;
  saveCurrentView();
  await flush();
  try { store.board.thumb = await makeThumb(); await flush(); } catch {}
});
window.addEventListener('resize', () => { if (store.board) applyTransform(); });

// ---------- 啟動 ----------

async function init() {
  navigator.storage?.persist?.().catch(() => {});
  try { await cleanupImages(); } catch (e) { console.warn(e); }
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
