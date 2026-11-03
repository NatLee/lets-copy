# Privacy Policy — Let's Copy

**Effective date:** 2026-11-03

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
| `host_permissions: <all_urls>` | Required so the unlock script can run on any site you choose to enable, and so the popup can see which site the current tab is on |

The extension only injects code into tabs whose hostname matches your enabled list (or every tab, if you turn on **Always on**).

## Third-party services

None. The popup shows the icon your browser already has for the current tab (with `referrerpolicy="no-referrer"`). If the browser has no icon for it, the popup shows a built-in globe instead.

Versions up to 2.1.0 asked Google's public favicon service (`https://www.google.com/s2/favicons?domain={hostname}`) for an icon in that case, which sent it the hostname of the current tab. That request was removed in the version after 2.1.0.

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

**生效日期：** 2026-11-03

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
| `host_permissions: <all_urls>` | 允許在任何使用者選擇啟用的站台上注入腳本，並讓 popup 知道目前分頁所在的站台 |

擴充功能只會將腳本注入主機名稱符合已啟用清單的分頁；若開啟 **Always on**，則套用到所有分頁。

## 第三方服務

無。Popup 顯示的站台圖示，是瀏覽器已經為當前分頁取得的圖示（並使用 `referrerpolicy="no-referrer"`）。如果瀏覽器沒有這個分頁的圖示，popup 會改用內建的地球圖示。

2.1.0 以前的版本在這種情況下會向 Google 的公開 favicon 服務（`https://www.google.com/s2/favicons?domain={hostname}`）要圖示，請求中會帶有當前分頁的主機名稱。2.1.0 之後的版本已移除這個請求。

## 分析、遙測、廣告

無。擴充功能不含任何分析、遙測、錯誤回報、廣告或指紋追蹤代碼，亦不發出其他任何對外網路請求。

## 兒童

擴充功能非以兒童為對象，不會主動蒐集任何人（無論成人或兒童）的資料。

## 政策變更

重要的政策異動會反映在此檔案的 [git 歷史](https://github.com/NatLee/lets-copy/commits/main/PRIVACY.md)。

## 聯絡方式

問題與回饋：<https://github.com/NatLee/lets-copy/issues>
