# Privacy Policy — Let's Copy

**Effective date:** 2026-05-15

## TL;DR

Let's Copy does not collect, transmit, or share any personal data. Everything the extension stores stays on your device.

## What the extension does

Let's Copy unlocks copying, text selection, and the right-click context menu on websites that disable them. All processing happens locally in the user's browser.

## Data stored locally

The extension uses `chrome.storage.local` to remember:

- The list of hostnames you have explicitly enabled (e.g. `example.com`)
- Whether the **Always on** mode is active

This data:

- Lives only inside your Chrome profile
- Is **never** transmitted to any server
- Is removed when you uninstall the extension

## Permissions explained

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save your per-site preferences locally |
| `scripting` | Inject the unlock script into pages on your enabled list |
| `tabs` | Read the active tab's URL to know which site you are on |
| `host_permissions: <all_urls>` | Required so the unlock script can run on any site you choose to enable |

The extension only injects code into tabs whose hostname matches your enabled list (or every tab, if you turn on **Always on**).

## Third-party services

The popup displays a site's favicon. If Chrome has not yet supplied a favicon for the active tab, the popup falls back to Google's public favicon service:

```
https://www.google.com/s2/favicons?domain={hostname}&sz=64
```

This request:

- Includes only the hostname of the active tab
- Is sent only when the popup is opened
- Uses `referrerpolicy="no-referrer"` so the originating URL is not leaked
- Contains no other information about the user

If you prefer not to contact Google for favicons, disable the extension on sensitive tabs before opening the popup.

## Analytics, telemetry, advertising

None. The extension contains no analytics, telemetry, error reporting, advertising, or fingerprinting code, and makes no other outbound network requests.

## Children

The extension is not directed at children and does not knowingly collect any information from anyone — adult or child.

## Changes to this policy

Material changes will be reflected in this file's [git history](https://github.com/NatLee/lets-copy/commits/main/PRIVACY.md).

## Contact

Questions or concerns: <https://github.com/NatLee/lets-copy/issues>

---

# 隱私權政策 — Let's Copy

**生效日期：** 2026-05-15

## 簡述

Let's Copy 不蒐集、傳送或分享任何個人資料，所有設定僅存放於使用者本機。

## 擴充功能做什麼

Let's Copy 用於解除網站對複製、文字選取、右鍵選單的限制，所有運作都在使用者的瀏覽器內完成。

## 本機儲存的資料

擴充功能使用 `chrome.storage.local` 紀錄：

- 使用者明確啟用過的網站主機名稱清單（例如 `example.com`）
- **Always on** 模式是否啟用

這些資料：

- 僅存在於使用者的 Chrome profile
- **永不**傳送到任何伺服器
- 移除擴充功能時一併刪除

## 權限說明

| 權限 | 用途 |
| --- | --- |
| `storage` | 在本機儲存使用者偏好 |
| `scripting` | 將解鎖腳本注入至已啟用清單上的頁面 |
| `tabs` | 讀取當前分頁網址，以辨識所在站台 |
| `host_permissions: <all_urls>` | 允許在任何使用者選擇啟用的站台上注入腳本 |

擴充功能只會將腳本注入主機名稱符合已啟用清單的分頁；若開啟 **Always on**，則套用到所有分頁。

## 第三方服務

Popup 顯示站台 favicon。若 Chrome 尚未為當前分頁提供 favicon，popup 會 fallback 至 Google 的公開 favicon 服務：

```
https://www.google.com/s2/favicons?domain={hostname}&sz=64
```

此請求：

- 只包含當前分頁的主機名稱
- 僅在 popup 開啟時送出
- 使用 `referrerpolicy="no-referrer"` 避免外洩來源網址
- 不包含任何其他關於使用者的資訊

若不希望與 Google 服務通訊以取得 favicon，請在開啟 popup 前停用該分頁的擴充功能。

## 分析、遙測、廣告

無。擴充功能不含任何分析、遙測、錯誤回報、廣告或指紋追蹤代碼，亦不發出其他任何對外網路請求。

## 兒童

擴充功能非以兒童為對象，不會主動蒐集任何人（無論成人或兒童）的資料。

## 政策變更

重要的政策異動會反映在此檔案的 [git 歷史](https://github.com/NatLee/lets-copy/commits/main/PRIVACY.md)。

## 聯絡方式

問題與回饋：<https://github.com/NatLee/lets-copy/issues>
