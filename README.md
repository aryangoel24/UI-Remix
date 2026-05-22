# UI Remix

UI Remix is a Manifest V3 Chrome Extension MVP for making simple, persistent UI changes on websites you visit.

## What It Does

- Enable edit mode from the popup.
- Hover page elements to highlight them.
- Click an element and choose an action: hide, change text, style, or resize.
- Type a simple natural language command and preview a proposed rule before applying it.
- Use an optional local AI interpreter for more flexible command understanding, with parser fallback.
- Enable, disable, delete, or clear saved rules from the popup.
- Deleted, disabled, and cleared rules are undone immediately on the active page when possible.
- If a command target is unclear, click the element on the page and confirm with the in-page Apply/Cancel prompt.
- Save rules to `chrome.storage.local`.
- Re-apply saved rules automatically when you revisit the same domain.
- Re-apply rules on dynamic pages with a throttled `MutationObserver` that checks added DOM nodes.

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

Run parser unit tests with:

```bash
npm test
```

## AI Command Layer

UI Remix can call a local AI endpoint before falling back to the deterministic parser. The extension never stores an OpenAI API key; the key stays in a local or hosted backend.

Start the local AI server:

```bash
OPENAI_API_KEY=your_api_key npm run ai:server
```

Optional:

```bash
OPENAI_MODEL=gpt-5.4-nano OPENAI_API_KEY=your_api_key npm run ai:server
```

The extension service worker calls this by default:

```txt
http://127.0.0.1:8787/api/interpret-command
```

You can override the endpoint at build time:

```bash
VITE_AI_ENDPOINT=https://your-api.example.com/api/interpret-command npm run build
```

If your hosted proxy has invite gating enabled, users enter their access token in the extension popup. The token is stored in `chrome.storage.local` and sent as `x-ui-remix-access-token` on AI requests.

The AI request includes the user command plus a capped list of visible page candidates: tag, text snippet, role, aria-label, selector, and bounding box. The AI server returns structured JSON with an intent, candidate IDs, styles/text/preset values, confidence, and reason. The extension converts that result into the same preview/apply flow used by local rules.

If the AI server is not running, returns `unknown`, or fails, UI Remix uses the local parser automatically.

### Backend Proxy Configuration

The local AI server is also the deployable backend/proxy. It keeps `OPENAI_API_KEY` out of the Chrome extension and adds a small production safety layer around OpenAI calls.

Useful environment variables:

```bash
OPENAI_API_KEY=sk-proj-your-openai-api-key
OPENAI_MODEL=gpt-5.4-nano
PORT=8787
HOST=0.0.0.0
ALLOWED_ORIGINS=chrome-extension://your-extension-id
INVITE_TOKENS=beta-token-one,beta-token-two
INVITE_TOKEN_HASHES=
LOG_REQUESTS=true
REDIS_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
USAGE_STORE_KEY_PREFIX=ui-remix
OPENAI_TIMEOUT_MS=15000
MAX_REQUEST_BYTES=180000
MAX_CANDIDATES=120
MAX_COMMAND_LENGTH=500
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

`.env.example` is included as a reference. Export these variables in your shell or set them in your host's environment/secret settings.

`ALLOWED_ORIGINS` is a comma-separated exact allowlist. For local development, leaving it empty allows `chrome-extension://*` origins and local Vite origins. For production, set it to your actual extension origin after Chrome gives the extension an ID.

Set `INVITE_TOKENS` for a quick private beta, or set `INVITE_TOKEN_HASHES` to comma-separated SHA-256 hashes if you do not want raw invite tokens stored in your host environment. If neither is set, the proxy does not require an access token.

Create a token hash with:

```bash
node -e "const { createHash } = require('crypto'); console.log(createHash('sha256').update(process.argv[1]).digest('hex'))" "your-beta-token"
```

When `LOG_REQUESTS=true`, the proxy logs status, latency, domain, command length, candidate count, intent, target count, and hashed IP/access-token identifiers. It does not log full commands or page text snippets.

For persistent rate limits and usage counters, configure one of:

```bash
# Render Key Value or any Redis-compatible service
REDIS_URL=redis://...
```

or:

```bash
# Upstash Redis REST
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

If neither Redis option is configured, the proxy falls back to in-memory counters for local development. Saved website UI rules still remain local in Chrome storage; Redis is used only for backend rate limits and daily usage counters.

The proxy exposes:

- `GET /health` for deployment health checks.
- `POST /api/interpret-command` for AI command interpretation.

Production deployment flow:

1. Deploy this repo to a Node-capable host such as Render, Railway, or Fly.io.
2. Set `HOST=0.0.0.0`.
3. Set `OPENAI_API_KEY` in the host's secret/environment settings.
4. Set `ALLOWED_ORIGINS=chrome-extension://your-extension-id`.
5. Optionally set `INVITE_TOKENS` or `INVITE_TOKEN_HASHES` for private beta access.
6. Add Render Key Value and set its `REDIS_URL`, or set Upstash REST credentials.
7. Start the service with `npm run ai:server`.
8. Build the extension with `VITE_AI_ENDPOINT=https://your-deployed-host/api/interpret-command npm run build`.
9. Reload the unpacked `dist/` extension in Chrome.
10. If invite gating is enabled, enter the access token in the popup's AI Access section.

## Architecture

- `public/manifest.json` defines the MV3 extension shell.
- `src/background/index.ts` contains the service worker.
- `src/popup/` contains the React popup UI.
- `src/content/` contains the page edit mode controller and floating editor overlay.
- `src/content/pageCandidates.ts` extracts capped, visible page candidates for AI interpretation.
- `src/content/aiCommandResolver.ts` converts AI command interpretations into previewable rules.
- `src/shared/types.ts` defines the extensible rule model.
- `src/shared/aiTypes.ts` defines the AI request/response contract.
- `src/shared/storage.ts` wraps `chrome.storage.local`.
- `src/shared/selector.ts` generates selectors for clicked elements.
- `src/shared/ruleEngine.ts` applies, reapplies, and removes UI rules, including subtree-scoped dynamic reapply.
- `src/shared/commandParser.ts` maps natural language variants to structured `ParsedCommand` objects with confidence scores.
- `src/content/commandResolver.ts` resolves local parsed commands against the current page and creates previewable `UIRule` objects.
- `server/ai-server.ts` is the OpenAI-backed backend/proxy. It handles CORS allowlisting, optional beta-token checks, request size caps, rate limiting, OpenAI timeouts, and structured response validation.
- `server/usage-store.ts` persists backend rate limits and daily usage counters in Redis/Upstash when configured, with an in-memory fallback for local development.
- `public/privacy-policy.html` is a static privacy policy artifact that can be hosted for Chrome Web Store review.

The rule engine is intentionally data-driven. `InjectRule` is present in the type system so future AI-generated or advanced rules can be added without reshaping the storage model. The command parser is isolated so a future LLM can replace the mock parser and produce the same command intent shape, or emit selector-backed `UIRule` objects directly.

## Permissions

UI Remix requests `activeTab`, `storage`, and `scripting`. It keeps `<all_urls>` host access because the core feature is applying saved rules automatically on arbitrary websites after page load. The unused `tabs` permission has been removed.

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

Commands are previewed first. Applying the preview saves the generated rule or rules for the current domain. If parsing succeeds but the page target is unclear, UI Remix enters a manual pick mode and asks you to click the element the command should apply to. After you pick the element, an in-page confirmation appears with Apply and Cancel actions.

## Known MVP Limitations

- Selectors are best-effort and can break if a site changes its markup.
- Text changes overwrite `textContent`, so nested rich markup inside the selected element is replaced.
- Style editing supports only a small set of basic properties.
- Resize is saved as a style rule with width and height.
- AI command interpretation requires the local or hosted AI endpoint to be running. Without it, natural language commands fall back to local parser heuristics.
- The AI layer can only target candidates extracted from the page. It cannot run arbitrary JavaScript or write arbitrary CSS.
- Immediate undo works for changes the rule engine applied in the current tab. If the site re-renders heavily, refreshing still provides the reliable source-of-truth state from storage.
- Dynamic reapply only checks added DOM subtrees. If a site mutates an existing matched element in place without adding nodes, a refresh or later matching DOM addition may still be needed.
- Pages with strict browser restrictions may not accept content scripts.
- Rules are domain-scoped with `pathPattern: "*"`. Per-path matching is reserved for a later version.
