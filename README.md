# WebNail

Turn a screenshot, a link, or any selected part of a live page into code.
Built on the "Flowstate" fluid-simulation theme, rebranded as WebNail.

## Contents

- `website/index.html` — the marketing site. Single self-contained file: hero
  with the WebGL ink simulation, an upload-screenshot / paste-a-link panel,
  a "how it works" section, and an extension showcase section. Open it
  directly in a browser, no build step.
- `extension/` — a Manifest V3 Chrome/Edge extension.
  - `manifest.json` — permissions and entry points.
  - `popup.html` / `popup.js` — the toolbar popup. Shows the current tab and
    two actions: **Select on page** (drag-select) and **Full page** capture.
  - `content.js` / `content.css` — injected into every page. Draws the
    drag-select overlay, dimension readout, and the "Generate code" toolbar
    that appears once you release the drag.
  - `background.js` — service worker that handles `chrome.tabs.captureVisibleTab`
    for both full-page and selection captures.
  - `icons/` — generated brand icons (16/48/128px).

## Running the website

Just open `website/index.html` in a browser — everything (fonts aside) is
inline. The upload and link flows are wired up in the UI (drag-and-drop,
file preview, a fake "scan site" crawl that lists pages with checkboxes) but
stop short of a real backend — `showResult()` in the script renders a
placeholder code panel. Point that function at your actual generation API
to make it real.

## Loading the extension

1. Go to `chrome://extensions` (or the equivalent in your Chromium browser).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin WebNail from the extensions toolbar icon.
5. Open any normal website, click the WebNail icon, and try **Select on page**
   — drag a box around anything, then **Generate code**.

The extension currently mocks the actual generation step (it captures the
visible tab as a PNG and shows a placeholder code block); wire
`WEBNAIL_SELECTION_MADE` and `WEBNAIL_CAPTURE_FULL` in `background.js` to your
API to crop the image to the selection rect and return real output.

## Notes on scope

Both pieces are structural/UI prototypes: they demonstrate the exact flows
you described (screenshot upload, link/page picker, in-page region select)
with real interaction, but the "code generation" is a stand-in — no model
call is wired in. Swap the placeholder functions for real requests to your
backend when you're ready.
