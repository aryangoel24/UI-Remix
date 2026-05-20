# UI Remix

UI Remix is a Manifest V3 Chrome Extension MVP for making simple, persistent UI changes on websites you visit.

## What It Does

- Enable edit mode from the popup.
- Hover page elements to highlight them.
- Click an element and choose an action: hide, change text, style, or resize.
- Type a simple natural language command and preview a proposed rule before applying it.
- Save rules to `chrome.storage.local`.
- Re-apply saved rules automatically when you revisit the same domain.
- Re-apply rules on dynamic pages with a debounced `MutationObserver`.

## Setup

Use Node.js 20.19+ or 22.12+ for the cleanest Vite 7 toolchain support.

```bash
npm install
npm run build
```

The production extension is generated in `dist/`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `dist/` folder from this project.
5. Open any regular website tab and click the UI Remix extension icon.

Chrome blocks content scripts on internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-managed pages.

## Local Development

For extension testing, build after changes:

```bash
npm run build
```

Then click the reload button for UI Remix in `chrome://extensions`. Refresh the website tab you are testing.

`npm run dev` is available for Vite development, but Chrome extension content scripts and service workers should be tested from the built `dist/` folder.

## Architecture

- `public/manifest.json` defines the MV3 extension shell.
- `src/background/index.ts` contains the service worker.
- `src/popup/` contains the React popup UI.
- `src/content/` contains the page edit mode controller and floating editor overlay.
- `src/shared/types.ts` defines the extensible rule model.
- `src/shared/storage.ts` wraps `chrome.storage.local`.
- `src/shared/selector.ts` generates selectors for clicked elements.
- `src/shared/ruleEngine.ts` applies, reapplies, and removes UI rules.
- `src/shared/commandParser.ts` maps natural language variants to structured `ParsedCommand` objects with confidence scores.
- `src/content/commandResolver.ts` resolves parsed commands against the current page and creates previewable `UIRule` objects.

The rule engine is intentionally data-driven. `InjectRule` is present in the type system so future AI-generated or advanced rules can be added without reshaping the storage model. The command parser is isolated so a future LLM can replace the mock parser and produce the same command intent shape, or emit selector-backed `UIRule` objects directly.

## Mock Commands

The current local parser supports deterministic wording variants, including:

- `hide the sidebar`
- `remove the sidebar`
- `get rid of the sidebar`
- `hide ads`
- `remove advertisements`
- `hide popups`
- `remove distractions`
- `focus mode`
- `clean up this page`
- `make this page cleaner`
- `make buttons bigger`
- `make the main button larger`
- `increase the heading size`
- `make text bigger`
- `make the background blue`
- `change the title to My Dashboard`
- `rename this heading to My Dashboard`

Commands are previewed first. Applying the preview saves the generated rule or rules for the current domain. If parsing succeeds but the page target is unclear, UI Remix enters a manual pick mode and asks you to click the element the command should apply to.

## Known MVP Limitations

- Selectors are best-effort and can break if a site changes its markup.
- Text changes overwrite `textContent`, so nested rich markup inside the selected element is replaced.
- Style editing supports only a small set of basic properties.
- Resize is saved as a style rule with width and height.
- Natural language commands are mock parser heuristics, not AI. They work best on common labels like sidebar, button, heading, nav, header, footer, and distraction-like elements.
- Deleting a rule from the popup does not always undo the current page immediately; refresh reflects deletion reliably.
- Pages with strict browser restrictions may not accept content scripts.
- Rules are domain-scoped with `pathPattern: "*"`. Per-path matching is reserved for a later version.
