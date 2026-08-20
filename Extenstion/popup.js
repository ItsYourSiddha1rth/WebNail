const statusLine = document.getElementById("statusLine");
const selectBtn = document.getElementById("selectBtn");
const fullBtn = document.getElementById("fullBtn");
const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");
const favicon = document.getElementById("favicon");
const modeChips = document.querySelectorAll(".mode-chip");
const openSite = document.getElementById("openSite");

let activeFormat = "html";
let currentTab = null;

modeChips.forEach(chip => {
  chip.addEventListener("click", () => {
    modeChips.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeFormat = chip.dataset.format;
  });
});

openSite.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "https://webnail.app" });
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    if (!tab || !tab.url) {
      pageTitle.textContent = "No active tab";
      pageUrl.textContent = "";
      disableForRestrictedPage();
      return;
    }
    pageTitle.textContent = tab.title || tab.url;
    pageUrl.textContent = tab.url;

    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl;
    }

    if (isRestrictedUrl(tab.url)) {
      disableForRestrictedPage();
    }
  } catch (err) {
    statusLine.textContent = "Couldn't read the current tab.";
  }
}

function isRestrictedUrl(url) {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url);
}

function disableForRestrictedPage() {
  statusLine.textContent = "WebNail can't run on this page. Try it on a regular website.";
  selectBtn.disabled = true;
  fullBtn.disabled = true;
}

selectBtn.addEventListener("click", async () => {
  if (!currentTab) return;
  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: "WEBNAIL_START_SELECTION", format: activeFormat });
    statusLine.textContent = "Drag a box around anything on the page…";
    statusLine.classList.add("active");
    window.close();
  } catch (err) {
    // content script may not be injected yet (e.g. page loaded before install)
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: currentTab.id }, files: ["content.css"] });
      await chrome.tabs.sendMessage(currentTab.id, { type: "WEBNAIL_START_SELECTION", format: activeFormat });
      statusLine.textContent = "Drag a box around anything on the page…";
      window.close();
    } catch (err2) {
      statusLine.textContent = "Couldn't start selection on this page.";
    }
  }
});

fullBtn.addEventListener("click", async () => {
  if (!currentTab) return;
  statusLine.textContent = "Capturing full page…";
  chrome.runtime.sendMessage(
    { type: "WEBNAIL_CAPTURE_FULL", tabId: currentTab.id, format: activeFormat },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        statusLine.textContent = "Couldn't capture this page.";
        return;
      }
      statusLine.textContent = "Captured — generating code…";
    }
  );
});

init();
