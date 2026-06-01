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
└── Docs:
    ├── CODE_DOCUMENTATION.md  # Architecture, API endpoints, data flow
    ├── CDP_EXPLORATION_GUIDE.md # CDP DOM exploration & model quotas [NEW]
    ├── SECURITY.md            # HTTPS, CSP, auth model
    ├── DESIGN_PHILOSOPHY.md   # Why decisions were made
    ├── CONTRIBUTING.md        # Dev guidelines
    ├── RELEASE_NOTES.md       # Changelog
    └── SOCIAL_MEDIA.md        # Marketing copy
```

### Key Architecture Facts (so you never need to re-discover them)
- **Backend**: Single `server.js` handles everything — Express HTTP/S server, WebSocket for real-time updates, CDP bridge to Antigravity.
- **Frontend**: Vanilla HTML/CSS/JS in `public/`. No framework. No build step.
- **CDP Flow**: `server.js` polls Antigravity every 1s via CDP → hashes DOM → broadcasts delta to phone via WebSocket.
- **Model Quota / CDP Navigation**: `capture_models.js` automates Settings → Models navigation to write real-time stats to `parsed_model_quotas.json`. Integrates into `server.js` or phone connect quota UI. Refer to `Docs/CDP_EXPLORATION_GUIDE.md` first.
- **Auth**: Signed httpOnly cookies. LAN auto-trusts. External requires password from `.env`.
- **Tunnel**: `launcher.py` manages ngrok/cloudflare/pinggy tunnels as child processes.
- **Security**: Strict CSP (no inline JS), XSS-safe HTML escaping, input sanitization via JSON.stringify.

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

## 📏 Token Budget Guidelines

### For the Agent:
- **Read only what you need.** If the task is about the `/send` endpoint, grep for `'/send'` in `server.js` — don't read all 94KB.
- **Use `grep_search` before `view_file`.** Find the exact line range first, then view only that range.
- **One edit per turn.** Make one logical change, verify it, then move to the next. Don't batch unrelated edits.
- **Skip verification for trivial changes.** Comment additions, typo fixes, and doc edits don't need `run_command` verification.
- **Never generate images unless explicitly asked.** No mock-ups, no diagrams unless the user says "show me".

### For the User:
- **Be specific.** "Fix the scroll sync bug where phone scroll doesn't update desktop" is better than "fix scrolling".
- **Name the file if you know it.** "In `server.js`, update `captureSnapshot()` to..." saves tokens vs. "somewhere in the backend..."
- **One task per message.** Compound requests ("do X and also Y and also Z") waste tokens on context-switching.
