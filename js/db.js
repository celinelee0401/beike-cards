// 本機資料庫（IndexedDB）：筆記與照片都存在這台設備的瀏覽器裡

const DB_NAME = 'beike-cards';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const db = {
  allBoards: () => tx('boards', 'readonly', (s) => s.getAll()),
  getBoard: (id) => tx('boards', 'readonly', (s) => s.get(id)),
  putBoard: (b) => tx('boards', 'readwrite', (s) => s.put(b)),
  deleteBoard: (id) => tx('boards', 'readwrite', (s) => s.delete(id)),
  getImage: (id) => tx('images', 'readonly', (s) => s.get(id)),
  putImage: (rec) => tx('images', 'readwrite', (s) => s.put(rec)),
  deleteImage: (id) => tx('images', 'readwrite', (s) => s.delete(id)),
  allImageKeys: () => tx('images', 'readonly', (s) => s.getAllKeys()),
};

// 每張照片只建立一次網址，畫面重繪時不用重新讀取
const urlCache = new Map();
export function imageURL(id) {
  if (!id) return Promise.resolve(null);
  if (!urlCache.has(id)) {
    urlCache.set(id, db.getImage(id).then((r) => (r ? URL.createObjectURL(r.blob) : null)));
  }
  return urlCache.get(id);
}

// 清掉沒有任何卡片在用的照片
export async function cleanupImages() {
  const boards = await db.allBoards();
  const used = new Set(boards.flatMap((b) => Object.values(b.nodes || {}).map((n) => n.imageId).filter(Boolean)));
  const keys = await db.allImageKeys();
  for (const k of keys) if (!used.has(k)) await db.deleteImage(k);
}
