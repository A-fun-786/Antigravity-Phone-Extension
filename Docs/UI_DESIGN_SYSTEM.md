# Antigravity Phone Connect — UI Design System

This document is the canonical source of truth for all UI design philosophy, CSS architecture, rendering pipelines, and visual bug patterns in the Antigravity Phone Connect project.

---

## 1. Design Language & Philosophy

### Mobile-First Navigation
The mobile UI utilizes a **Sidebar Drawer Navigation System**. Instead of a cluttered header or isolated history layer, a sleek sliding drawer groups chats by project and houses core action buttons (New Chat, History, Schedule Task, Planning). This utilizes Material Symbols and a native mobile feel. The History view remains available as a full-screen overlay for deep dives.

### Visual Parity (Neural Agentic IDE Theme)
Antigravity themes have thousands of CSS variables. Instead of trying to mirror every variable perfectly, we use **Aggressive CSS Inheritance**. The frontend captures the raw HTML and wraps it in a modern, OLED-optimized Neural Agentic IDE UI that feels like a high-precision instrument. This is layered with **Glassmorphism UI components** and fine-tuned dark mode styling, ensuring that model states, quick actions, and sidebar interactions remain sleek and highly responsive.

---

## 2. Color Palette & CSS Variables

The core variables override Antigravity's Tailwind variables during snapshot rendering to enforce our Neural theme:

- **Backgrounds**: `--bg-app: #000000`, `--background: #000000`, `--surface-hover: #2a2a2a`
- **Cards**: `--card: rgba(32, 31, 31, 0.9)`, `--muted: #141313`
- **Text**: `--text-main: #e5e2e1` (Warm Neutral), `--text-muted: #c4c7c7`
- **Borders**: `--border-color: #444748`, `--card-border: rgba(68, 71, 72, 0.6)`
- **Accent**: `--accent: #00dbe9` (Neon Cyan)
- **Typography**: `Hanken Grotesk` (Body), `JetBrains Mono` (Code/Labels)

---

## 3. Native Mobile CSS Architecture

The native mobile interface (`public/css/style.css`) is structured into distinct functional sections:

- **Layout**: Clean header (Hamburger + Model Pill + New Chat) + flex-growing body + fixed bottom input. Overscroll bounce is prevented on iOS.
- **Sidebar Drawer**: Slides in from the left. Contains primary action buttons, project-grouped chats, and a user footer (avatar, PRO badge, support).
- **Input Bar**: Pill-shaped input area with circular attachment and send buttons. Contextual STOP button floats above as a pill (`.stop-pill.show`).
- **History Layer**: A full-screen overlay for standalone conversation history.
- **Quick Actions**: Horizontal scrolling chips below the input area.
- **Modals & Overlays**: Glassmorphism overlays for model selection, SSL banners, and planning layers.

---

## 4. Snapshot CSS Design System

The `darkModeOverrides` string in `public/js/app.js` is injected into the snapshot to rewrite Antigravity's styling. It is organized into 14 numbered sections:

1. **CSS Variable Overrides**: Forces Neural dark theme tokens.
2. **Conversation Container**: Ensures `[data-testid="conversation-view"]` is scrollable, using `Hanken Grotesk`.
3. **User Messages**: Gets neon cyan accent floating cards with a left border. `sticky` positioning is removed to prevent scroll overlap.
4. **Card Surfaces**: Shimmer gradients for `.bg-card-border` (cyan/teal blend).
5. **Tool/Command Blocks**: Dark glass styling for terminal outputs.
6. **Agent Action Buttons**: Solid/Ghost pills (Cyan gradient Allow, Pink outline Deny, Cyan outline Review).
7. **Typography & Text Colors**: Overrides hardcoded black text to `#e5e2e1`. Links styled cyan.
8. **Images & Icons**: Hides local absolute path images (`C:`, `/AppData`) while preserving valid base64 attachments.
9. **Code Blocks**: Cyan-tinted glass for inline code, JetBrains Mono for pre blocks (`#0e0e0e` background).
10. **Copy Button**: Injects native mobile copy buttons into `pre` blocks.
11. **Blockquotes & Tables**: Cyan borders and translucent backgrounds.
12. **Scrollbar & White BG Overrides**: Hides webkit scrollbars.
13. **Headings Polish**: Tightens margins and letter-spacing for h1/h2/h3.
14. **List Styling**: Corrects padding and line-heights for ul/ol.

---

## 5. Snapshot Rendering Pipeline

**Capture (`src/server/cdp/snapshotCapture.js`):**
1. Uses `querySelectorAll('[data-testid="conversation-view"]')` + `offsetParent !== null` to find the *visible* container (ignoring hidden cached DOM nodes).
2. Clones the container.
3. Tags prompt action buttons with `.agent-allow-btn`, etc.
4. Surgically removes inputs (`[data-testid="chat-input"]`) and Lexical placeholders (`[class*="placeholder"]`, `[data-placeholder]`).

**Render (`public/js/app.js`):**
1. Injects the `cdp-styles` block containing the 14-section `darkModeOverrides`.
2. Injects the HTML into `#chatContent`.
3. Calls `addMobileCopyButtons()`.
4. Executes smart scrolling (respects user scroll lock, otherwise auto-scrolls to bottom).

> **Debug Tip**: Access `GET /debug-snapshot` (handled in `src/server/routes/debugRoutes.js`) in your desktop browser to render the raw HTML snapshot without the mobile wrapper, useful for diagnosing capture vs. display issues.

---

## 6. UI Update & Bug Tracking Log

*(Major UI updates and their corresponding bug fixes are logged here to preserve reasoning without polluting BUG_TRACKING.md with CSS specifics.)*

### [UPDATE: Premium Chat Redesign & Rendering Fixes]
**Reason**: Tailwind layout classes and Lexical editor updates were breaking the snapshot display on mobile.

- **Zero-Height Scroll Trap Fix**: The snapshot HTML contains Antigravity's Tailwind classes (`h-full`, `overflow-y-auto`, `min-h-0`) on deeply nested divs. These created invisible zero-height scroll containers on mobile. *Fix: Flattened these by forcing `height: auto !important; overflow: visible !important; max-height: none !important;` on `[data-testid="conversation-view"]` and its children.*
- **Placeholder Ghosting Fix**: The Lexical editor uses empty placeholder spans that misaligned text when the input was removed. *Fix: Surgically stripped `[class*="placeholder"]` and `[data-placeholder]` during capture.*
- **Scroll Overlap Fix**: User messages had CSS `sticky` and a gradient pseudo-element `::after` that caused overlap. *Fix: Removed sticky positioning and killed the pseudo-element in Section 3 of `darkModeOverrides`.*
- **Stale Selectors Update**: The UI moved from `#conversation`/`#chat`/`#cascade` to `[data-testid="conversation-view"]`. *Fix: All query selectors and client-side overrides now target the new test ID to ensure native momentum scrolling works.*
- **Aggressive Input Stripping**: Previously, `[class*="input"]` was used to clean the DOM, which accidentally stripped the prompt action buttons. *Fix: Changed to target `[data-testid="chat-input"]` specifically.*
