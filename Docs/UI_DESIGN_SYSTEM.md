# Antigravity Phone Connect — UI Design System

This document is the canonical source of truth for all UI design philosophy, CSS architecture, rendering pipelines, and visual bug patterns in the Antigravity Phone Connect project.

---

## 1. Design Language & Philosophy

### Mobile-First Navigation
The mobile UI utilizes a **Premium Full-Screen History Layer**. Mobile screens are too small for sidebar navigation. By utilizing a sleek modal-layered approach—complete with elevated cards, gradient icons, and responsive micro-animations—we provide high-density information (recent chats) as a purely native mobile experience without cluttering the primary viewing area. Bi-directional synchronization is enforced by executing a programmatic Escape keypress on the desktop when the history layer is closed on the phone, preventing stale UI popups.

### Visual Parity (The Dark Mode Bridge)
Antigravity themes have thousands of CSS variables. Instead of trying to mirror every variable perfectly, we use **Aggressive CSS Inheritance**. The frontend captures the raw HTML and wraps it in a modern, slate-dark UI that feels premium and natively mobile, regardless of the Desktop's theme. This is layered with **Glassmorphism UI components** and fine-tuned dark mode styling, ensuring that settings bars, model states, and quick actions remain frictionlessly readable.

---

## 2. Color Palette & CSS Variables

The core variables override Antigravity's Tailwind variables during snapshot rendering to enforce our dark theme:

- **Backgrounds**: `--bg-app: #090e17`, `--background: #090e17`
- **Cards**: `--card: rgba(30, 41, 59, 0.9)`, `--muted: #1e293b`
- **Text**: `--text-main: #f8fafc`, `--text-muted: #94a3b8`
- **Borders**: `--border-color: #334155`, `--card-border: rgba(51, 65, 85, 0.6)`
- **Accent**: `--accent: #6366f1` (Indigo)

---

## 3. Native Mobile CSS Architecture

The native mobile interface (`public/css/style.css`) is structured into distinct functional sections:

- **Layout**: Fixed header + flex-growing body + fixed bottom input. Overscroll bounce is prevented on iOS.
- **Sidebar Drawer**: Slides in from the left with backdrop blur. Groups chats by project with custom folder icons.
- **History Layer**: A full-screen overlay for standalone conversation history.
- **Quick Actions**: Horizontal scrolling chips below the input area.
- **Modals & Settings**: Glassmorphism overlays for model/mode selection and SSL banner.

---

## 4. Snapshot CSS Design System

The `darkModeOverrides` string in `app.js` is injected into the snapshot to rewrite Antigravity's styling. It is organized into 14 numbered sections:

1. **Tailwind CSS Variable Overrides**: Forces dark theme tokens.
2. **Conversation Container**: Ensures `[data-testid="conversation-view"]` is scrollable and readable.
3. **User Messages**: Gets indigo-accent floating cards with a left border. `sticky` positioning is removed to prevent scroll overlap.
4. **User Card Inner Surface**: Shimmer gradients for `.bg-card-border`.
5. **Tool/Command Blocks**: Dark glass styling for terminal outputs.
6. **Agent Action Buttons**: Gradient pills (green Allow, red Deny, blue Review).
7. **Typography & Text Colors**: Overrides hardcoded black text to `#e2e8f0`.
8. **Images & Icons**: Hides local absolute path images (`C:`, `/AppData`) while preserving valid base64 attachments.
9. **Code Blocks**: Indigo-tinted glass for inline code, JetBrains Mono for pre blocks.
10. **Copy Button**: Injects native mobile copy buttons into `pre` blocks.
11. **Blockquotes & Tables**: Indigo borders and translucent backgrounds.
12. **Scrollbar & White BG Overrides**: Hides webkit scrollbars.
13. **Headings Polish**: Tightens margins and letter-spacing for h1/h2/h3.
14. **List Styling**: Corrects padding and line-heights for ul/ol.

---

## 5. Snapshot Rendering Pipeline

**Capture (`server.js`):**
1. Uses `querySelectorAll('[data-testid="conversation-view"]')` + `offsetParent !== null` to find the *visible* container (ignoring hidden cached DOM nodes).
2. Clones the container.
3. Tags prompt action buttons with `.agent-allow-btn`, etc.
4. Surgically removes inputs (`[data-testid="chat-input"]`) and Lexical placeholders (`[class*="placeholder"]`, `[data-placeholder]`).

**Render (`public/js/app.js`):**
1. Injects the `cdp-styles` block containing the 14-section `darkModeOverrides`.
2. Injects the HTML into `#chatContent`.
3. Calls `addMobileCopyButtons()`.
4. Executes smart scrolling (respects user scroll lock, otherwise auto-scrolls to bottom).

> **Debug Tip**: Access `GET /debug-snapshot` in your desktop browser to render the raw HTML snapshot without the mobile wrapper, useful for diagnosing capture vs. display issues.

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
