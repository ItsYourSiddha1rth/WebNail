(() => {
  if (window.__webnailInjected) return;
  window.__webnailInjected = true;

  let overlay = null;
  let selectionBox = null;
  let toolbar = null;
  let startX = 0, startY = 0;
  let dragging = false;
  let currentFormat = "html";
  let currentRect = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "WEBNAIL_START_SELECTION") {
      currentFormat = message.format || "html";
      startSelectionMode();
      sendResponse({ ok: true });
    }
  });

  function startSelectionMode() {
    teardown();

    overlay = document.createElement("div");
    overlay.id = "webnail-overlay";

    const hint = document.createElement("div");
    hint.id = "webnail-hint";
    hint.textContent = "Drag to select a region — Esc to cancel";
    overlay.appendChild(hint);

    document.documentElement.appendChild(overlay);

    overlay.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
  }

  function onMouseDown(e) {
    if (e.target.closest("#webnail-toolbar")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox = document.createElement("div");
    selectionBox.id = "webnail-selection-box";
    positionBox(startX, startY, startX, startY);
    overlay.appendChild(selectionBox);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    positionBox(startX, startY, e.clientX, e.clientY);
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const rect = selectionBox.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      selectionBox.remove();
      selectionBox = null;
      return;
    }
    currentRect = {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    showToolbar(rect);
  }

  function positionBox(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    selectionBox.style.left = left + "px";
    selectionBox.style.top = top + "px";
    selectionBox.style.width = width + "px";
    selectionBox.style.height = height + "px";

    let label = selectionBox.querySelector(".webnail-dims");
    if (!label) {
      label = document.createElement("span");
      label.className = "webnail-dims";
      selectionBox.appendChild(label);
    }
    label.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  }

  function showToolbar(rect) {
    toolbar = document.createElement("div");
    toolbar.id = "webnail-toolbar";

    const top = rect.bottom + 10;
    const spaceBelow = window.innerHeight - rect.bottom;
    toolbar.style.left = Math.max(8, rect.left) + "px";
    if (spaceBelow < 60) {
      toolbar.style.top = Math.max(8, rect.top - 52) + "px";
    } else {
      toolbar.style.top = top + "px";
    }

    const genBtn = document.createElement("button");
    genBtn.className = "webnail-btn webnail-btn-primary";
    genBtn.textContent = "Generate code";
    genBtn.addEventListener("click", onGenerateClick);

    const copyBtn = document.createElement("button");
    copyBtn.className = "webnail-btn";
    copyBtn.textContent = "Cancel";
    copyBtn.addEventListener("click", teardown);

    toolbar.appendChild(genBtn);
    toolbar.appendChild(copyBtn);
    overlay.appendChild(toolbar);
  }

  function onGenerateClick() {
    const genBtn = toolbar.querySelector(".webnail-btn-primary");
    genBtn.textContent = "Generating…";
    genBtn.disabled = true;

    chrome.runtime.sendMessage(
      { type: "WEBNAIL_SELECTION_MADE", rect: currentRect, format: currentFormat },
      (response) => {
        if (!response || !response.ok) {
          genBtn.textContent = "Try again";
          genBtn.disabled = false;
          return;
        }
        showResultPanel();
      }
    );
  }

  function showResultPanel() {
    const panel = document.createElement("div");
    panel.id = "webnail-result-panel";
    panel.innerHTML = `
      <div class="webnail-rp-head">
        <span>Generated code</span>
        <button class="webnail-rp-close" aria-label="Close">&times;</button>
      </div>
      <pre class="webnail-rp-code">&lt;!-- WebNail export --&gt;
&lt;section class="card"&gt;
  &lt;h2&gt;Ready when you are&lt;/h2&gt;
  &lt;p&gt;This selection (${currentRect.width}×${currentRect.height}px)
     is ready to be wired to the WebNail generation API.&lt;/p&gt;
  &lt;button class="pill"&gt;Get Started&lt;/button&gt;
&lt;/section&gt;</pre>
      <div class="webnail-rp-foot">
        <button class="webnail-btn" id="webnail-rp-copy">Copy code</button>
      </div>
    `;
    overlay.appendChild(panel);
    panel.querySelector(".webnail-rp-close").addEventListener("click", teardown);
    panel.querySelector("#webnail-rp-copy").addEventListener("click", () => {
      const code = panel.querySelector(".webnail-rp-code").textContent;
      navigator.clipboard.writeText(code).catch(() => {});
      const btn = panel.querySelector("#webnail-rp-copy");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy code"), 1200);
    });
  }

  function onKeyDown(e) {
    if (e.key === "Escape") teardown();
  }

  function teardown() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    selectionBox = null;
    toolbar = null;
    dragging = false;
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
})();
