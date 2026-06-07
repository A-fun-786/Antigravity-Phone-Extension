# Interactive Agent Mode Documentation

This document describes the design, API endpoints, DOM scraping logic, and user flow for the **Interactive Agent Mode** feature on Antigravity Phone Connect.

---

## 🌟 Features

1. **Project-Segregated Chat History (Sidebar Drawer)**:
   - Chats are parsed and grouped dynamically by project using the native Antigravity project cards.
   - Includes custom folder icons for project sections, bubble icons for standalone conversations, and styled indentation.
   - Users can switch between chats programmatically from their phone.

2. **Interactive Agent Prompt Actions (Allow / Deny)**:
   - The phone connect UI automatically extracts the current execution block's action buttons (e.g., "Allow", "Deny").
   - Users can tap these actions directly on their phone.
   - Under the hood, these actions are simulated on the desktop IDE by programmatically clicking the corresponding buttons in the DevTools console context.

3. **Full-Screen Artifact Viewer**:
   - Highlights files/components under development (Implementation Plans, Walkthroughs, Code Diff cards) in a touch-friendly carousel/slider.
   - Clicking an artifact opens a dedicated, full-screen viewport layer on the phone for comfortable reading.

4. **Image Attachments (Remote Paste)**:
   - Users can select images from their mobile device and send them directly to the Antigravity session.
   - Images are converted to Base64 and remotely injected into the desktop `contenteditable` editor by simulating a clipboard `paste` event.
   - Allows seamless sharing of bug screenshots or mockups without transferring files manually.

---

## 🛠 Architecture & API Endpoints

All features are integrated into the core `server.js` and frontend assets under `public/`.

### 1. Backend API (`server.js`)

- **`captureSidebar(cdp)`**:
  - Targets `.bg-sidebar` and parses elements containing `[class*="group/section"]`.
  - Distinguishes between projects (e.g. elements with `[data-project-card="true"]`) and standalone chats.
  - Returns a structured payload:
    ```json
    {
      "projects": [
        { "name": "Project Name", "chats": [{ "id": "id", "title": "Title", "isActive": true }] }
      ],
      "conversations": [
        { "id": "id", "title": "Title", "isActive": false }
      ]
    }
    ```

- **`POST /switch-chat`**:
  - Request body: `{ id: "convo-pill-id" }`.
  - Simulates a mouse click event using CDP `Runtime.evaluate` on the matching conversation pill in the sidebar.

- **`POST /agent-action`**:
  - Request body: `{ action: "Allow" | "Deny" }`.
  - Scrapes the active chat viewport (`#conversation`, `#cascade`) for button text matching the action, and triggers `.click()`.

### 2. Frontend Assets (`public/`)

- **`index.html`**:
  - Contains `#sidebarDrawer` left pane and `#artifactViewLayer` overlay.
- **`js/app.js`**:
  - Handles sidebar list population, drawer event listeners, and API triggers.
- **`css/style.css`**:
  - Layout and custom transitions for the drawer slider, project groups, text truncation, and buttons.

---

## ⚡ How It Works (CDP Integration)

### Switching Chats
To switch chats, the server locates the element:
```javascript
const pill = document.querySelector('[data-testid="convo-pill-' + id + '"]');
if (pill) pill.click();
```

### Performing Actions
To trigger "Allow" or "Deny", the server executes a CDP snippet inside the editor's execution context. We use the robust `clickElement` utility which searches globally across the document (including shadow DOMs if needed) and filters for visible elements (`offsetParent !== null`):
```javascript
const actionStr = action.trim().toLowerCase();
const activeButtons = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
const target = activeButtons.find(b => b.innerText.trim().toLowerCase() === actionStr);
if (target) {
    target.click();
    return { ok: true };
}
```

## 📝 Right Pane Mirroring (Planning Drawer)

### 1. Overview
The right pane (artifact viewer, implementation plans, walkthroughs, review views) on the desktop is dynamically scraped and rendered inside a collapsible "Planning Drawer" on the phone. This eliminates file-reading overhead and displays live changes.

### 2. API Endpoints & Mechanics
* **`GET /api/planning-files`**:
  * Calls `getRightPaneSnapshot(cdp)` in the backend.
  * Evaluates a CDP script that locates the active conversation view, looks for explicit panels (e.g. `[data-testid*="artifact"]`, `[data-testid*="right-panel"]`, `[data-testid*="review"]`), or uses bounding rect heuristics (width/height > 200px, located on the right half of the screen, not wrapping the entire screen or conversation container) to clone the panel.
  * Strips hidden nodes (`display: none`) and returns the outer HTML.
* **`POST /remote-click`**:
  * Body: `{ selector, index, textContent }`
  * Clicks elements (like artifact cards or file links in chat) remotely on the desktop to open the corresponding right pane views.

### 3. Key Integration Details (Token-Saving Rules)
* **React Render Delay**: When a user triggers a remote click on an artifact card or file link, there is a delay before the right pane renders on the desktop. The frontend client (`public/js/app.js`) **must wait 600ms to 800ms** before fetching `/api/planning-files`. Otherwise, a blank pane is fetched.
* **Tailwind Height/Overflow Overrides**: Antigravity uses Tailwind classes like `h-full` and `overflow-y-auto` which collapse to `0px` in absolute-positioned injected layers. They must be overridden in the CSS overrides layer by setting `height: auto !important` and `overflow: visible !important`.
* **Authenticated Requests**: All network calls from the phone client (like `/api/planning-files`) must use `fetchWithAuth` to ensure session cookies and proxy/ngrok headers are correctly transmitted, preventing 401/403 HTML page responses from breaking JSON parsers.

> 🎨 **Note**: For all UI design decisions, CSS architecture, and details on how agent mode elements are styled (like the gradient prompt pills), see [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md).
