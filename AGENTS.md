# 備課卡片（beike-cards）

老師自己備課用的卡片白板網頁 App，用來取代 LoiLoNote 的個人備課功能（學校停止付費後也能繼續用）。
功能細節與操作方式見 [README.md](README.md)。

## 專案性質

- 純前端靜態網站：HTML + CSS + 原生 ES modules，**沒有建置步驟、沒有套件依賴**。
- 資料只存在使用者設備的 IndexedDB（`js/db.js`），沒有伺服器、沒有帳號。
- 主要設備：iPad（Safari／加入主畫面）。相機需要 HTTPS，所以部署在 GitHub Pages。
- 介面文字一律繁體中文；使用者是老師，說明用教學現場的說法，不用工程術語。

## 開發

```bash
python3 -m http.server 5180 --bind 127.0.0.1
```

- 改了 `js/`、`css/` 或新增檔案時，同步更新 `sw.js` 的 `ASSETS`，並把 `CACHE` 版本號加一，否則 iPad 會一直用舊版。
- 資料結構寫在 `js/store.js` 開頭的註解；改結構時要相容舊的筆記與備份檔（`.beike.json`）。
- 觸控優先：所有操作都要能用手指完成，按鈕至少 40px 高；滑鼠、鍵盤是加分。
- 驗證：在瀏覽器實際操作（拖拉、連線、拍照放到畫布／放進卡片、匯出）。窗格裡沒有相機時，可用 `canvas.captureStream()` 假裝鏡頭；真的相機要在 iPad 上測。

## 部署

推到 `main` 後，GitHub Pages 會自動發布：<https://celinelee0401.github.io/beike-cards/>

## Agent skills

- Issue tracker：本地 markdown，放在 `docs/issues/`（說明見 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)）
- Domain docs：根目錄 [CONTEXT.md](CONTEXT.md)；架構決策放 [docs/adr/](docs/adr/)（說明見 [docs/agents/domain.md](docs/agents/domain.md)）
- 建議主流程：`/grill-with-docs -> /to-spec -> /to-tickets -> /implement -> /code-review`
- 交接：開工讀 [handoff.md](handoff.md)，收工更新它；踩坑記在 [踩坑紀錄.md](踩坑紀錄.md)
