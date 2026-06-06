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
To trigger "Allow" or "Deny", the server executes a CDP snippet inside the editor's execution context:
```javascript
const activeButtons = Array.from(document.querySelectorAll('#conversation button, #cascade button'));
const target = activeButtons.find(b => b.innerText.trim().toLowerCase() === action.toLowerCase());
if (target) {
    target.click();
    return { ok: true };
}
```
