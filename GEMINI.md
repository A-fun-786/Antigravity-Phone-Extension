# Antigravity Phone Connect — Agent Configuration

> **Priority: TOKEN EFFICIENCY.** Every instruction below exists to minimize token burn while maximizing output quality.

---

## 🚫 Hard Rules (Non-Negotiable)

1. **NO SUBAGENTS.** Never invoke `invoke_subagent`, `define_subagent`, or spawn parallel workers. All work happens in this single conversation thread, sequentially.
2. **NO PARALLEL TOOL CALLS for writes.** Never issue multiple `write_to_file`, `replace_file_content`, or `run_command` calls simultaneously on the same file. Read calls may be parallelized.
3. **NO FULL-FILE REWRITES.** Always use `replace_file_content` or `multi_replace_file_content` for edits. Never rewrite an entire file unless creating it for the first time.
4. **NO SPECULATIVE EXPLORATION.** Do not `list_dir` or `view_file` on directories/files unless you have a concrete reason tied to the current task. The project map below tells you where everything is.
5. **NO ECHOING FILE CONTENTS.** After reading a file, do NOT repeat its contents back to the user. Summarize in ≤3 sentences, then act.
6. **NO PLAN RE-SUMMARIZATION.** After creating or updating an artifact, do NOT re-summarize it. Say "Plan updated — please review the artifact" and stop.
7. **MINIMAL RESPONSES.** Keep all non-code responses under 200 words. Be direct. No filler.

---

## 📂 Project Map (Use This Instead of Exploring)

```
antigravity_phone_chat/
├── server.js              # THE core file. Express + WebSocket + CDP. ~94KB. All backend logic.
├── capture_models.js      # Model quota extraction & CDP settings helper [NEW]
├── public/
│   ├── index.html         # Mobile frontend HTML
│   ├── css/style.css      # All mobile styling
│   └── js/app.js          # Client-side JS (WebSocket, API, UI)
├── launcher.py            # Python process manager (server + tunnel + QR)
├── generate_ssl.js        # SSL cert generator
├── ui_inspector.js        # CDP UI debug utility
├── start_ag_phone_connect.sh/.bat      # LAN launcher
├── start_ag_phone_connect_web.sh/.bat  # Web/tunnel launcher
├── install_context_menu.sh/.bat        # OS context menu installer
├── .env / .env.example    # Config (passwords, tokens, tunnel provider)
├── package.json           # Node deps: express, ws
└── Docs/
    ├── UI_DESIGN_SYSTEM.md    # [NEW] All UI philosophy, CSS architecture, rendering, and UI bugs
    ├── CODE_DOCUMENTATION.md  # Architecture, API endpoints, data flow
    ├── CDP_EXPLORATION_GUIDE.md # CDP DOM exploration & model quotas
    ├── INTERACTIVE_AGENT_MODE.md # Interactive Agent Mode, Sidebar Chats, Prompt Actions
    ├── BUG_TRACKING.md        # Central hub for known issues, squashed bugs, and testing
    ├── DESIGN_PHILOSOPHY.md   # Product philosophy (non-UI decisions)
    ├── SECURITY.md            # HTTPS, CSP, auth model
    ├── CONTRIBUTING.md        # Dev guidelines
    ├── RELEASE_NOTES.md       # Changelog
    └── SOCIAL_MEDIA.md        # Marketing copy
```

### Key Architecture Facts (so you never need to re-discover them)
- **Backend**: Single `server.js` handles everything — Express HTTP/S server, WebSocket for real-time updates, CDP bridge to Antigravity.
- **Frontend**: Vanilla HTML/CSS/JS in `public/`. No framework. No build step.
- **CDP Flow**: `server.js` polls Antigravity every 1s via CDP → hashes DOM → broadcasts delta to phone via WebSocket.
- **CDP DOM Selectors (CRITICAL)**: Antigravity's main chat container is `[data-testid="conversation-view"]` — NOT `#conversation`/`#chat`/`#cascade` (those are legacy). Sidebar pills use `[data-testid^="convo-pill-"]` inside `.bg-sidebar`. The editor is `[contenteditable="true"]`. Submit button is `[data-testid="send-button"]`, `[data-tooltip-id="input-send-button-send-tooltip"]`, `[aria-label="Send message"]`, or legacy `svg.lucide-arrow-right` closest `button`.
- **clickElement()**: Searches `document` globally (not scoped to chat container). Defaults `index` to `0`. Filters visible elements only (`offsetParent !== null`). Used by `/switch-chat`, `/agent-action`, `/remote-click`.
- **injectMessage()**: Finds `[contenteditable="true"]` with fallback from scoped → document-wide. Injects text via `execCommand("insertText")`, clears/attaches images to the file input, and clicks the send button (or falls back to Enter key event).
- **captureSnapshot()**: Uses `querySelectorAll('[data-testid="conversation-view"]')` + `offsetParent !== null` to find the **visible** container (avoids hidden cached DOM nodes). Clones it, tags buttons with `.agent-allow-btn`/`.agent-deny-btn`/`.agent-review-btn` classes, strips input areas AND Lexical placeholders (`[class*="placeholder"]`, `[data-placeholder]`) surgically.
- **UI Design System & Snapshot Rendering**: All rules for capturing snapshots, overriding Tailwind traps (`h-full`), and injecting the premium dark mode CSS design system are centralized. See `Docs/UI_DESIGN_SYSTEM.md` for UI/CSS work.
- **Debug endpoint**: `GET /debug-snapshot` renders raw snapshot HTML in-browser for diagnosing capture vs. display issues.
- **Model Quota / CDP Navigation**: `capture_models.js` automates Settings → Models navigation to write real-time stats to `parsed_model_quotas.json`. Integrates into `server.js` or phone connect quota UI. Refer to `Docs/CDP_EXPLORATION_GUIDE.md` first.
- **Model Selector (DYNAMIC SYNC)**: When the user clicks the model selection button on the phone, the client fetches the active list of options in real-time from `GET /available-models`. The server runs `syncModelsFromCDP()` to briefly click open the dropdown on the desktop, parse the visible options, close it, and return them. Selected changes are pushed via `POST /set-model`, which opens the dropdown again, selects the matched model, and closes it.
- **Auth**: Signed httpOnly cookies. LAN auto-trusts. External requires password from `.env`.
- **Tunnel**: `launcher.py` manages ngrok/cloudflare/pinggy tunnels as child processes.
- **Security**: Strict CSP (no inline JS), XSS-safe HTML escaping, input sanitization via JSON.stringify.

### ⚠️ Known Bug Patterns (Don't Repeat These)
- **Never pass `undefined` index to clickElement** — it renders as `elements[undefined]` in CDP JS, which is always falsy.  
- **Never scope querySelector to `#conversation`/`#chat`/`#cascade`** — use `[data-testid="conversation-view"]` as primary.
- **Never fetch data/base64 URLs in browser CDP scripts** — CSP connect-src will block them. Decode base64 to Blobs/Files synchronously in JS.
- **Never use backticks to nest template variables directly in CDP scripts** — use `JSON.stringify` on the server first, then embed the string literal directly.
- **Never loop all CDP contexts blindly for mutations/actions** — this causes actions to execute multiple times (e.g. duplicate messages). Always use default-context-first pattern (`auxData?.isDefault === true`) and check for success before checking other contexts.
- **Never rely on fixed icon classes like `svg.lucide-arrow-right` for send buttons** — Lexical editors render them dynamically and swap icons (like voice record vs send). Use robust selectors like `[data-testid="send-button"]`, `[data-tooltip-id="input-send-button-send-tooltip"]`, or `[aria-label="Send message"]`.
- **Never use `querySelector` for `[data-testid="conversation-view"]`** — use `querySelectorAll` + `offsetParent !== null` filter. Antigravity caches hidden conversation-view nodes in the DOM; `querySelector` grabs the first (often hidden/empty) one.
- **Never set `position: static !important` on snapshot child divs** — this breaks Antigravity's flex/absolute layout and causes content to collapse to the top.
- **Never allow Tailwind `h-full` / `overflow-y-auto` to survive on injected snapshot HTML** — these create nested zero-height scroll containers. Always override with `height: auto; overflow: visible;` in the dark mode CSS overrides.
- **Never forget to strip Lexical placeholder elements** (`[class*="placeholder"]`, `[data-placeholder]`) during snapshot capture — they ghost as misaligned text when the editor is removed.

---

## 🔧 Pipeline Skills (How to Work on This Project)

Instead of asking the agent to figure things out, use these **command words** to trigger the correct skill:

| Command Word | Skill Triggered | What It Does |
|:---|:---|:---|
| `"backend"` or `"server"` | `backend-work` | Read/edit `server.js`. Knows the module map. |
| `"frontend"` or `"UI"` or `"mobile"` | `frontend-work` | Read/edit `public/` files. Knows the CSS/JS architecture. |
| `"launcher"` or `"scripts"` | `launcher-work` | Read/edit `.sh`, `.bat`, `launcher.py`. Cross-platform parity. |
| `"security"` or `"auth"` or `"HTTPS"` | `security-work` | Read/edit auth, CSP, SSL, `.env`. References `SECURITY.md`. |
| `"docs"` or `"readme"` | `docs-work` | Read/edit markdown documentation files. |
| `"debug"` or `"inspect"` | `debug-pipeline` | Run server, check logs, use `ui_inspector.js`, health endpoint. |
| `"CDP"` or `"quota"` or `"usage"` | `backend-work` / `frontend-work` | Refer to `Docs/CDP_EXPLORATION_GUIDE.md`. Run/integrate `capture_models.js`. |

### How to Use the Pipeline

**You (the user) just describe what you want.** Examples:

- *"Add a dark mode toggle to the mobile UI"* → I use `frontend-work` skill internally.
- *"Fix the CDP reconnection logic when Antigravity restarts"* → I use `backend-work` skill.
- *"Update the README to document the new Pinggy tunnel option"* → I use `docs-work` skill.
- *"The server crashes when no `.env` file exists"* → I use `debug-pipeline` + `launcher-work`.
- *"Show my Gemini quota usage on the phone connect screen"* → I use `Docs/CDP_EXPLORATION_GUIDE.md` + `backend-work`.

You do NOT need to memorize skill names. I route automatically based on your description.

---

## 🚀 Feature Modules & Documentation Routing

When a prompt matches one of these features, read the corresponding documentation file before writing code:

### 1. Interactive Agent Mode & Right Pane Mirroring
* **Role/Summary**: Real-time mirroring of active agent conversations, sidebar chats segregated by project, action prompts (Allow/Deny), and desktop right-pane mirroring (Planning Drawer for Implementation Plans, Walkthroughs, Reviews) using remote click triggers, delayed React DOM fetching (600ms-800ms), and custom CSS overrides.
* **Key Files**: `server.js` (endpoints `/switch-chat`, `/agent-action`, `/remote-click`, `/api/planning-files`, functions `captureSidebar`, `getRightPaneSnapshot`), `public/js/app.js` (drawer initialization, remote clicks, render delay, and style overrides), `public/css/style.css` (drawer transitions and styling).
* **Routing Rule**: If the prompt involves sidebar chats, Allow/Deny/Review buttons, artifact rendering, or right-pane mirroring, read [INTERACTIVE_AGENT_MODE.md](file:///Users/mdaffanahmed/VS%20Code/Git%20Projects/antigravity_phone_chat/Docs/INTERACTIVE_AGENT_MODE.md) first.

### 2. Model Quota & Usage Monitoring
* **Role/Summary**: Headless settings traversal using CDP, parsing active AI model quotas, and writing usage data.
* **Key Files**: `capture_models.js` (modal automation script), `parsed_model_quotas.json` (parsed output data).
* **Routing Rule**: If the prompt involves API quotas, Gemini/Claude usage limits, Settings modal navigation, or parsing rate limits, read [CDP_EXPLORATION_GUIDE.md](file:///Users/mdaffanahmed/VS%20Code/Git%20Projects/antigravity_phone_chat/Docs/CDP_EXPLORATION_GUIDE.md) first.

### 3. Bug Tracking & Issue Resolution
* **Role/Summary**: Centralized hub for known issues, squash logs, and architectural bug patterns to prevent regressions and duplicate debugging.
* **Key Files**: `Docs/BUG_TRACKING.md`
* **Routing Rule**: If the prompt reports a bug, mentions an error, or asks to debug an issue, read [BUG_TRACKING.md](file:///Users/mdaffanahmed/VS%20Code/Git%20Projects/antigravity_phone_chat/Docs/BUG_TRACKING.md) to check for previously encountered issues or known limitations before taking action.

### 4. Image Attachments & File Handling
* **Role/Summary**: Real-time mobile-to-desktop photo attachment injection via drag-and-drop and temp-file link fallback.
* **Key Files**: `server.js` (endpoint `/send` and `injectMessage`), `public/js/app.js` (`sendMessage` and `compressImage`), `public/temp_uploads/` (static file repository).
* **Routing Rule**: If the prompt involves uploading files, attaching images, base64 payload sizes, or pasting images, read the Attachment & Send Button Failure section in [BUG_TRACKING.md](file:///Users/mdaffanahmed/VS%20Code/Git%20Projects/antigravity_phone_chat/Docs/BUG_TRACKING.md) and inspect the `injectMessage` function implementation in `server.js`.

### 5. UI Design System & Snapshot CSS
* **Role/Summary**: Complete UI design language, CSS architecture (native + snapshot), rendering pipeline, and UI-specific bug patterns.
* **Key Files**: `public/css/style.css`, `public/js/app.js` (darkModeOverrides), `server.js` (captureSnapshot, /debug-snapshot).
* **Routing Rule**: If the prompt involves CSS, dark mode, snapshot rendering, layout bugs, or visual design, read [UI_DESIGN_SYSTEM.md](file:///Users/mdaffanahmed/VS%20Code/Git%20Projects/antigravity_phone_chat/Docs/UI_DESIGN_SYSTEM.md) first.

---

## 📏 Token Budget Guidelines

### For the Agent:
- **Read only what you need.** If the task is about the `/send` endpoint, grep for `'/send'` in `server.js` — don't read all 94KB.
- **Use `grep_search` before `view_file`.** Find the exact line range first, then view only that range.
- **One edit per turn.** Make one logical change, verify it, then move to the next. Don't batch unrelated edits.
- **Skip verification for trivial changes.** Comment additions, typo fixes, and doc edits don't need `run_command` verification.
- **Never generate images unless explicitly asked.** No mock-ups, no diagrams unless the user says "show me".
