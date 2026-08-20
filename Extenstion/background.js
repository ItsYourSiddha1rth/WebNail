chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ webnailFormat: "html" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WEBNAIL_CAPTURE_FULL") {
    const tabId = message.tabId;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ ok: false, error: "tab not found" });
        return;
      }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "capture failed" });
          return;
        }
        // In a real build: POST dataUrl + message.format to the WebNail API here.
        sendResponse({ ok: true, dataUrl });
      });
    });
    return true; // keep the message channel open for the async response
  }

  if (message.type === "WEBNAIL_SELECTION_MADE") {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return; }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "capture failed" });
        return;
      }
      // In a real build: crop dataUrl to message.rect, then POST to the WebNail API.
      sendResponse({ ok: true, dataUrl, rect: message.rect, format: message.format });
    });
    return true;
  }
});
