// 拍照：開相機連拍，每按一次快門就立刻變成一張卡片

import { $, normalizeImage, toast } from './util.js';

const el = $('#camera');
const video = $('#cam-video');
const destEl = $('#cam-dest');
const countEl = $('#cam-count');
const thumbEl = $('#cam-thumb');
const errEl = $('#cam-error');
const errText = $('#cam-error-text');
const flashEl = $('#cam-flash');
const fileCapture = $('#file-capture');
const filePick = $('#file-pick');

let stream = null;
let facing = 'environment';
let session = null;   // { label, onPhoto(img), onClose(count), count }
let busy = false;
let thumbURL = null;

const canLiveCamera = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

// 要在按鈕的 click 裡直接呼叫（iPad 規定開相機／選檔要由使用者手勢觸發）
export function openCamera(opts) {
  session = { ...opts, count: 0 };
  if (!canLiveCamera()) { pick(fileCapture); return; }
  el.hidden = false;
  destEl.textContent = opts.label;
  countEl.textContent = '';
  thumbEl.hidden = true;
  errEl.hidden = true;
  startStream();
}

// 從相簿選照片（可多選）
export function pickPhotos(opts) {
  session = { ...opts, count: 0 };
  pick(filePick);
}

export const cameraOpen = () => !el.hidden;

async function startStream() {
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    if (el.hidden) { stopStream(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    errEl.hidden = true;
  } catch (e) {
    errEl.hidden = false;
    errText.textContent =
      e.name === 'NotAllowedError' ? '沒有使用相機的權限。請在瀏覽器的網站設定允許相機，或改用下面的「系統相機」。'
      : e.name === 'NotFoundError' ? '這台設備找不到相機。可以改從相簿選照片。'
      : `相機打不開（${e.name || e.message}）。可以改用系統相機或從相簿選。`;
  }
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

export function closeCamera() {
  stopStream();
  el.hidden = true;
  const s = session;
  session = null;
  s?.onClose?.(s.count);
}

async function shoot() {
  if (busy || !stream || !video.videoWidth || !session) return;
  busy = true;
  flashEl.classList.remove('go');
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
  try {
    const img = await normalizeImage(video);
    await deliver(img);
  } catch (e) {
    toast('拍照失敗：' + e.message);
  } finally {
    busy = false;
  }
}

async function deliver(img) {
  const s = session;
  if (!s) return;
  await s.onPhoto(img);
  s.count++;
  countEl.textContent = `已加入 ${s.count} 張`;
  if (thumbURL) URL.revokeObjectURL(thumbURL);
  thumbURL = URL.createObjectURL(img.blob);
  thumbEl.src = thumbURL;
  thumbEl.hidden = false;
}

function pick(input) {
  input.value = '';
  input.click();
}

async function onFiles(input) {
  const files = [...(input.files || [])].filter((f) => f.type.startsWith('image/') || !f.type);
  const s = session;
  if (!files.length || !s) return;
  let failed = 0;
  for (const f of files) {
    try { await deliver(await normalizeImage(f)); } catch { failed++; }
  }
  if (failed) toast(`有 ${failed} 張照片讀不進來`);
  if (el.hidden) {
    session = null;
    s.onClose?.(s.count);
  }
}

fileCapture.addEventListener('change', () => onFiles(fileCapture));
filePick.addEventListener('change', () => onFiles(filePick));

$('#cam-shutter').addEventListener('click', shoot);
$('#cam-close').addEventListener('click', closeCamera);
$('#cam-done').addEventListener('click', closeCamera);
$('#cam-switch').addEventListener('click', () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  startStream();
});
$('#cam-album').addEventListener('click', () => pick(filePick));
$('#cam-system').addEventListener('click', () => pick(fileCapture));
$('#cam-album2').addEventListener('click', () => pick(filePick));

export function handleCameraKey(e) {
  if (el.hidden) return false;
  if (e.key === 'Escape') closeCamera();
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shoot(); }
  return true;
}
