# Let's Copy — Claude 指引

## 開發守則

### 介面設計
- 介面設計可以再優化。實作或修改 popup UI（[src/popup.html](src/popup.html)、[src/popup.css](src/popup.css)、[src/popup.js](src/popup.js)）時，主動評估視覺層次、間距、互動回饋等可改進之處，提出更精緻的設計。

### 版本更新
- **每次有功能或行為上的更新時，必須同步更新 [src/manifest.json](src/manifest.json) 的 `version` 欄位。**
- 採用語意化版本（Semantic Versioning）：
  - `MAJOR`：架構變動或不相容的破壞性修改
  - `MINOR`：新增功能、向後相容
  - `PATCH`：bug 修復、文案微調、樣式微調
- 純文件（README、註解）更新可不調版本，其餘變更皆需評估。
