# Antigravity Phone Connect — Bug Tracking

This document serves as the central hub for tracking known issues, squashed bugs, and testing strategies. Keeping this log updated ensures that future agent sessions have context on what has already been fixed, preventing regressions and duplicate debugging efforts.

## 🐛 Known Bug Patterns
*(These are critical patterns discovered during debugging that should NEVER be repeated. They are also mirrored in `GEMINI.md` for quick context assembly).*

- **Undefined Index in CDP Scripts**: Never pass an `undefined` index to CDP `Runtime.evaluate` injection strings. It resolves as `elements[undefined]`, breaking the entire execution block. Always default to `0` or use safe stringification.
- **Stale DOM Selectors**: Antigravity's UI has moved from `#conversation`/`#chat`/`#cascade` to `[data-testid="conversation-view"]`. Never scope `querySelectorAll` strictly to the old IDs without including the new `data-testid`.
- **Aggressive Input Removal**: Do not use `[class*="input"]` to strip elements for the snapshot; it strips essential UI elements like action buttons.
- **Client-Side CSS Overrides**: When forcing layout changes on the client side (like forcing the chat container to be scrollable via `height: auto`), ensure the overrides target `[data-testid="conversation-view"]` so native scrolling works.
- **CSP & Data URL Fetching**: Chrome Content Security Policy (CSP) blocks `fetch()` calls to `data:` scheme URLs. Decode base64 to Blobs/Files synchronously using atob.
- **Direct Template Variable Nesting**: Avoid direct backtick template interpolation for variables in evaluated scripts. Use JSON.stringify on the server first, then embed the string literal.
- **Blind Context Looping**: Do not execute mutations or clicks across all CDP contexts without checking if the default context (`auxData?.isDefault === true`) already succeeded, otherwise events will duplicate.

---

## 🛑 Open Issues

*(Add new bugs here as they are discovered)*

| Status | Issue | Description | Affected Component |
|---|---|---|---|
| 🟢 | None reported | No active bugs tracked at this time. | N/A |

---

## ✅ Resolved Bugs Log

### [June 6, 2026] - Attachment & Send Button Failure

**Symptoms:**
- Attaching an image and pressing "Send" did not send the image to PC.
- The send button from the phone UI did not trigger "Send" in the Antigravity desktop app.

**Root Causes & Fixes:**
1. **Broken Template String Evaluation**: The CDP injection script used backticks inside node template strings (`\`${"${base64Image || ''}"}\``) which evaluated to strings wrapped in literal double quotes. This caused `fetch` to try loading invalid data URLs like `"data:image/png..."` (with quotes) or `"\"\""` when no image was attached, throwing exceptions in the browser.
2. **CSP Connection Blocks**: Browser Content Security Policy (CSP) blocked the `fetch()` call to `data:` URLs. Bypassed `fetch` completely by implementing a synchronous base64-to-Blob decoding function directly in pure JS.
3. **Submit Button Selector & Dynamic Send Button**: The submit button selector previously searched for `svg.lucide-arrow-right` closest button, which returned null in the Lexical editor setup because the SVG does not use Lucide class names and is rendered dynamically when text content is present (replacing the voice memo button). Updated the submit selector to target `[data-testid="send-button"]`, `[data-tooltip-id="input-send-button-send-tooltip"]`, `[aria-label="Send message"]`, and the legacy Lucide SVG, allowing successful programmatic clicking. Also cleared the file input value before setting files to ensure successful change event dispatch for image attachments.

### [June 6, 2026] - CDP Sync & Scroll Fixes

**Symptoms:**
- Clicking on chat history did not open the chat.
- Allow/Deny buttons and Send button from phone UI did nothing.
- Unable to scroll up in the conversation view on the phone.

**Root Causes & Fixes:**
1. **`clickElement` Index Bug**: Fixed `/switch-chat`, `/agent-action`, and `/remote-click` which failed because `clickElement` evaluated `${index}` as `undefined`. Added fallback logic (`index = 0`).
2. **Selector Scope in `clickElement`**: Broadened the search scope to `document` (with a shadow DOM fallback) so sidebar pills and action buttons outside the main chat container can be found.
3. **Aggressive Input Stripping**: Modified `captureSnapshot` to surgically remove `[data-testid="chat-input"]` instead of anything matching `[class*="input"]`, preserving the Allow/Deny/Review action buttons.
4. **Editor Discovery**: Updated `injectMessage` to look inside `[data-testid="conversation-view"]` and added a document-wide fallback so messages can be sent successfully.
5. **Scroll & UI Sync**: Updated `remoteScroll` and `hasChatOpen` to use `[data-testid="conversation-view"]`.
6. **Phone UI Scrolling**: Fixed the client-side `app.js` CSS overrides. The `[data-testid="conversation-view"]` container was keeping its fixed height because the CSS override (`height: auto !important`) only targeted the legacy `#conversation` IDs. Added the new selector, enabling the phone's native momentum scrolling.

---

## 🛠 Tracking Strategy (How to Use This File)

To maintain a light context assembly while retaining project history:
1. **Log Major Fixes**: After fixing a complex bug, log it in the **Resolved Bugs Log** with symptoms, root cause, and fix. 
2. **Update Bug Patterns**: If a bug reveals a systemic issue or architectural quirk, add it to the **Known Bug Patterns** section AND mirror the most critical summary in `GEMINI.md`.
3. **Link in Prompts**: When investigating a new issue, agents will be directed here via `GEMINI.md` to see if a similar issue was previously resolved or is currently tracked.
