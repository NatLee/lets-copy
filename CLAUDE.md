# Let's Copy — Claude 指引

## 開發守則

### 介面設計
- 介面設計可以再優化。實作或修改 popup UI（[src/popup.html](src/popup.html)、[src/popup.css](src/popup.css)、[src/popup.js](src/popup.js)）時，主動評估視覺層次、間距、互動回饋等可改進之處，提出更精緻的設計。

### 版本更新
- **每次有功能或行為上的更新，必須同步調整 [src/manifest.json](src/manifest.json) 的 `version` 欄位。**
- 採用語意化版本（Semantic Versioning）：
  - `MAJOR`：架構變動或不相容的破壞性修改
  - `MINOR`：新增功能、向後相容
  - `PATCH`：bug 修復、文案微調、樣式微調
- 純文件（README、註解）更新可不調版本，其餘變更皆需評估。

### 推送與發版
- 推送版本到 `origin` 時，必須建立對應的 annotated git tag `v<version>` 並一同推送，作為發版紀錄。
- Tag 訊息（`git tag -a -m ...`）應包含當次發版重點，方便日後 `git log --tags` 或 GitHub Releases 對照。
- 使用以下腳本自動化（兩者邏輯一致）：
  - Windows：[release.ps1](release.ps1)
  - Unix／WSL／Git Bash：[release.sh](release.sh)
- 腳本行為：
  1. 自動讀取 [src/manifest.json](src/manifest.json) 的 `version`，組出 `v<version>`。
  2. 檢查該 tag 是否已存在於本地或 `origin`，若已存在代表版本未更新，直接中止（避免重複發版）。
  3. 工作目錄非乾淨狀態時中止，避免漏 commit。
  4. 先推送目前分支，再建立 annotated tag 並推送。

### 打包
- [package.ps1](package.ps1) / [package.sh](package.sh) 會依 `version` 產生 `lets-copy-v<version>.zip`，與 [.github/workflows/build.yml](.github/workflows/build.yml) 的 CI 輸出對齊；發 Release 時可直接附上產物。
