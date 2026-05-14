// Let's Copy — page-side unlock script.
//
// Runs in the MAIN world at document_start (when registered as a dynamic
// content script) or on-demand via chrome.scripting.executeScript when the
// user just toggled the extension on.
//
// Strategy:
//   1. Install capture-phase listeners that swallow blocking events BEFORE
//      the page's own handlers can see them. This is what makes right-click
//      unlock work reliably, since most sites use addEventListener('contextmenu')
//      which can't be undone by setting `element.oncontextmenu = null`.
//   2. Strip inline event attributes (oncontextmenu, oncopy, ...) on existing
//      and future elements via MutationObserver.
//   3. Inject a stylesheet that overrides `user-select: none` and friends.
//   4. Apply a couple of well-known site-specific tweaks (CSDN designMode).

(() => {
  if (window.__letsCopyActive) return;
  window.__letsCopyActive = true;

  // Events we swallow in capture phase. `selectionchange` is intentionally
  // omitted: it fires AFTER selection happens and isn't preventable, so
  // stopping it would only break legitimate text-selection UI without
  // protecting anything.
  const BLOCKED_EVENTS = [
    "contextmenu",
    "selectstart",
    "copy",
    "cut",
    "paste",
    "beforecopy",
    "beforecut",
    "beforepaste",
    "dragstart",
  ];

  const INLINE_ATTRS = [
    "oncontextmenu",
    "oncopy",
    "oncut",
    "onpaste",
    "onbeforecopy",
    "onbeforecut",
    "onbeforepaste",
    "onselectstart",
    "onselect",
    "ondragstart",
    "onmousedown",
    "onmouseup",
    "unselectable",
  ];

  // 1. Capture-phase blocker — stops any other listener (page-level or element-
  //    level) from receiving these events. We run at document_start, so we
  //    register before the page does.
  const swallow = (e) => {
    e.stopImmediatePropagation();
  };
  for (const evt of BLOCKED_EVENTS) {
    window.addEventListener(evt, swallow, { capture: true });
    document.addEventListener(evt, swallow, { capture: true });
  }

  // Right-click via mousedown(button=2) is sometimes used to suppress menus.
  // Only neutralise the right-button case so left-click selection still works.
  const rightClickSwallow = (e) => {
    if (e.button === 2) e.stopImmediatePropagation();
  };
  window.addEventListener("mousedown", rightClickSwallow, { capture: true });
  window.addEventListener("mouseup", rightClickSwallow, { capture: true });

  // 2. Strip inline handlers on existing and future elements.
  const clearOn = (el) => {
    if (!el) return;
    for (const attr of INLINE_ATTRS) {
      if (el.removeAttribute) el.removeAttribute(attr);
      try { el[attr] = null; } catch {}
    }
  };

  const sweep = (root) => {
    if (!root) return;
    clearOn(root);
    if (root.querySelectorAll) {
      const sel = INLINE_ATTRS.map(a => `[${a}]`).join(",");
      root.querySelectorAll(sel).forEach(clearOn);
    }
  };

  const initialSweep = () => {
    clearOn(document);
    clearOn(document.documentElement);
    if (document.body) sweep(document.body);
  };

  // 3. Inject override stylesheet.
  const STYLE_ID = "__letscopy_style__";
  const css = `
    *, *::before, *::after {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      -ms-user-select: auto !important;
      user-select: auto !important;
      -webkit-touch-callout: default !important;
      -webkit-tap-highlight-color: initial !important;
    }
    html, body { -webkit-user-select: auto !important; user-select: auto !important; }
  `;
  const injectStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement || document).appendChild(style);
  };

  const apply = () => {
    injectStyle();
    initialSweep();
  };

  apply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  }

  // 4. MutationObserver — re-strip handlers when the page mutates (SPAs, lazy
  //    content, frameworks re-rendering with onContextMenu props, etc.).
  const startObserver = () => {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes") {
          clearOn(m.target);
        } else {
          m.addedNodes.forEach(n => {
            if (n.nodeType === 1) sweep(n);
          });
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: INLINE_ATTRS,
    });
  };
  startObserver();

  // 5. Site-specific tweaks for cases that need more than the generic pass.
  try {
    const host = location.hostname;
    if (/(^|\.)csdn\.net$/.test(host)) {
      // CSDN's code block uses CSS contenteditable trickery; flipping designMode
      // makes selection work everywhere.
      if (document.designMode === "off") document.designMode = "on";
    }
  } catch {}

  // 6. Toast — only when injected after the page already loaded (i.e. the user
  //    just toggled the extension on). On document_start auto-injection the
  //    readyState is "loading" and we stay silent so it doesn't flash on every
  //    visit to an enabled site.
  if (document.readyState !== "loading") showToast();

  function showToast() {
    const TOAST_ID = "__letscopy_toast__";
    const run = () => {
      if (document.getElementById(TOAST_ID)) return;
      const root = document.body || document.documentElement;
      if (!root) return;
      const el = document.createElement("div");
      el.id = TOAST_ID;
      el.textContent = "Let's Copy 已啟用";
      el.style.cssText = [
        "all: initial",
        "position: fixed",
        "top: 18px",
        "right: 18px",
        "z-index: 2147483647",
        "padding: 9px 14px",
        "border-radius: 10px",
        "background: linear-gradient(135deg, #6366f1, #8b5cf6)",
        "color: #fff",
        'font: 600 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", sans-serif',
        "letter-spacing: 0.02em",
        "box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35)",
        "opacity: 0",
        "transform: translateY(-6px)",
        "transition: opacity .22s ease, transform .22s ease",
        "pointer-events: none",
      ].join(";");
      root.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      });
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px)";
        setTimeout(() => { try { el.remove(); } catch {} }, 280);
      }, 1400);
    };
    if (document.body) run();
    else document.addEventListener("DOMContentLoaded", run, { once: true });
  }
})();
