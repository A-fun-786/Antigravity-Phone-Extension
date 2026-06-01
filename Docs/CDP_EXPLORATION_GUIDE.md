# 📡 CDP Exploration & Model Quota Integration Guide

This guide documents the Chrome DevTools Protocol (CDP) utilities added to the workspace to enable live DOM extraction and real-time Model Quota/Usage parsing from the running Antigravity IDE. It is designed to help developer agents quickly understand which files to edit, run, or integrate when a user requests features related to the **Agent Mode fullscreen view** or **Model Usage monitoring**.

---

## 📂 New & Updated Files Reference

### 1. `capture_models.js` [NEW]
* **Role**: Orchestrates the headless navigation of the Antigravity Settings modal to parse active AI model quotas.
* **When to Touch / Use**:
  * If the user asks to "refresh model quota stats", "show active limits", or if you need to fetch live rate limits.
  * To integrate active model statistics into the phone backend (`server.js` or an API endpoint `/api/usage`).
* **Detailed Working**:
  * **macOS Auto-Port Discovery**: Reads the active CDP debug port dynamically from the macOS environment:
    `/Users/mdaffanahmed/Library/Application Support/Antigravity/DevToolsActivePort`
  * **CDP Connection**: Establishes a WebSocket connection to the main web page (default execution context `1`).
  * **Simulated Clicks**: Opens settings by dispatching fully bubbled pointer events (`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`) on `[data-testid="settings-button"]` to satisfy React event listeners.
  * **Quota Segment Parsing**: Navigates to `[data-testid="settings-nav-item-Models"]`, extracts the modal outer HTML, parses the filled segments (width `100%`) vs. empty segments (width `0%`) for each model row block, and writes the output to `parsed_model_quotas.json`.
  * **Graceful Restoration**: Simulates a click on the close button to restore the user's workspace back to the chat view.

### 2. `dom_explorer.js` [MODIFY]
* **Role**: Maps the complete DOM layout tree, IDs, roles, and agent keywords to support phone mirroring.
* **When to Touch / Use**:
  * If the user requests updates to the phone's fullscreen UI, sidebar replication, or DOM-based layout syncing.
* **Detailed Working**:
  * Dynamic port discovery fallback (checks the macOS `DevToolsActivePort` file as well as ports `9000-9003`).
  * Resolves targets using `t.type === 'page'` fallback, ensuring it always successfully hooks the active editor/workspace view.

---

## 📈 Current Quota Output Structure (`parsed_model_quotas.json`)

When `capture_models.js` is run, it outputs a clean payload containing the timestamp, token budget, and model quotas:

```json
{
  "timestamp": "2026-06-01T17:14:43.000Z",
  "customizationBudgetAvailable": "94.3%",
  "modelQuotas": [
    {
      "name": "Gemini 3.5 Flash (High)",
      "refreshText": "Refreshes in 1 hour, 29 minutes",
      "segments": [100, 100, 100, 100, 0],
      "quota": "4/5",
      "percentage": "80%"
    },
    {
      "name": "Claude Sonnet 4.6 (Thinking)",
      "refreshText": "Refreshes in 1 hour, 41 minutes",
      "segments": [100, 100, 0, 0, 0],
      "quota": "2/5",
      "percentage": "40%"
    }
  ]
}
```

---

## 🔄 How to Integrate Quota Stats into `server.js`

To make this data available to the mobile phone connect interface:
1. Import `exec` from `child_process` in `server.js`.
2. Expose a new Express endpoint:
   ```javascript
   app.get('/api/quota', (req, res) => {
       exec('node capture_models.js', (err) => {
           if (err) return res.status(500).json({ error: 'Failed to capture quotas' });
           const data = JSON.parse(fs.readFileSync('./parsed_model_quotas.json', 'utf8'));
           res.json(data);
       });
   });
   ```
3. Fetch and display this data in `public/js/app.js` using a progress indicator bar in the phone connect mobile header!
