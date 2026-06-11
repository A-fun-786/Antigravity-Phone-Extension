// --- Elements ---
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachmentBtn = document.getElementById('attachmentBtn');
const imageInput = document.getElementById('imageInput');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');

const modelBtn = document.getElementById('modelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const modalTitle = document.getElementById('modalTitle');
const modelText = document.getElementById('modelText');
const historyLayer = document.getElementById('historyLayer');
const historyList = document.getElementById('historyList');

// Agent & Drawer Elements
const hamburgerBtn = document.getElementById('hamburgerBtn');
const drawerOverlay = document.getElementById('drawerOverlay');
const sidebarDrawer = document.getElementById('sidebarDrawer');
const drawerChatList = document.getElementById('drawerChatList');
const drawerNewChatBtn = document.getElementById('drawerNewChatBtn');
const drawerCollapseBtn = document.getElementById('drawerCollapseBtn');
const drawerHistoryBtn = document.getElementById('drawerHistoryBtn');
const drawerPlanningBtn = document.getElementById('drawerPlanningBtn');
const drawerScheduleBtn = document.getElementById('drawerScheduleBtn');
const drawerSettingsBtn = document.getElementById('drawerSettingsBtn');

const artifactViewLayer = document.getElementById('artifactViewLayer');
const closeArtifactBtn = document.getElementById('closeArtifactBtn');
const artifactTitle = document.getElementById('artifactTitle');
const artifactContent = document.getElementById('artifactContent');

// New elements for event listeners
const enableHttpsBtn = document.getElementById('enableHttpsBtn');
const dismissSslBtn = document.querySelector('.dismiss-btn');
const closeModalBtn = document.getElementById('closeModalBtn');
const supportBtn = document.getElementById('supportBtn');
const supportOverlay = document.getElementById('supportOverlay');
const closeSupportBtn = document.getElementById('closeSupportBtn');
const backHistoryBtn = document.querySelector('.history-header .icon-btn');
const quickActionChips = document.querySelectorAll('.action-chip');

// --- State ---
let autoRefreshEnabled = true;
let userIsScrolling = false;
let userScrollLockUntil = 0; // Timestamp until which we respect user scroll
let lastScrollPosition = 0;
let ws = null;
let idleTimer = null;
let lastHash = '';
let currentMode = 'Fast';
let chatIsOpen = true; // Track if a chat is currently open


// --- State Variables ---
let currentDarkModeOverrides = '';

// --- Auth Utilities ---
async function fetchWithAuth(url, options = {}) {
    // Add ngrok skip warning header to all requests
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';

    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            console.log('[AUTH] Unauthorized, redirecting to login...');
            window.location.href = '/login.html';
            return new Promise(() => { }); // Halt execution
        }
        return res;
    } catch (e) {
        throw e;
    }
}
const USER_SCROLL_LOCK_DURATION = 3000; // 3 seconds of scroll protection

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    try {
        const res = await fetchWithAuth('/app-state');
        const data = await res.json();

        // Mode Sync (Fast/Planning) - Desktop is source of truth
        if (data.mode && data.mode !== 'Unknown') {
            currentMode = data.mode;
        }

        // Model Sync - Desktop is source of truth
        if (data.model && data.model !== 'Unknown') {
            modelText.textContent = data.model;
        }

        // Model List Sync - Update options dynamically
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            MODELS = data.models;
        }

        console.log('[SYNC] State refreshed from Desktop:', data);
    } catch (e) { console.error('[SYNC] Failed to sync state', e); }
}

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    // Only show banner if currently on HTTP
    if (window.location.protocol === 'https:') return;

    // Check if user dismissed the banner before
    if (localStorage.getItem('sslBannerDismissed')) return;

    sslBanner.style.display = 'flex';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ ${data.message}</span>
                <button id="sslReloadBtn">Reload After Restart</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
            
            // Add listener to the newly created button
            const reloadBtn = document.getElementById('sslReloadBtn');
            if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());
        } else {
            btn.textContent = 'Failed - Retry';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = 'Error - Retry';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

// Check SSL on load
checkSslStatus();
// --- Models ---
let MODELS = [
    "Gemini 3.5 Flash (High)",
    "Gemini 3.5 Flash (Medium)",
    "Gemini 3.5 Flash (Low)",
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (low)",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

// --- WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WS Connected');
        updateStatus(true);
        loadSnapshot();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
            return;
        }
        if (data.type === 'snapshot_update' && autoRefreshEnabled && !userIsScrolling) {
            loadSnapshot();
        }
    };

    ws.onclose = () => {
        console.log('WS Disconnected');
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };
}

function updateStatus(connected) {
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Live';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Reconnecting';
    }
}

// --- Rendering ---
async function loadSnapshot() {
    try {
        const response = await fetchWithAuth('/snapshot');
        if (!response.ok) {
            if (response.status === 503) {
                // No snapshot available - likely no chat open
                chatIsOpen = false;
                showEmptyState();
                return;
            }
            throw new Error('Failed to load');
        }

        // Mark chat as open since we got a valid snapshot
        chatIsOpen = true;

        const data = await response.json();

        // Capture scroll state BEFORE updating content
        const scrollPos = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        const clientHeight = chatContainer.clientHeight;
        const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
        const isUserScrollLocked = Date.now() < userScrollLockUntil;

        // --- UPDATE STATS ---
        if (data.stats) {
            const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
            const nodes = data.stats.nodes;
            const statsText = document.getElementById('statsText');
            if (statsText) statsText.textContent = `${nodes} Nodes · ${kbs}KB`;
        }

        // --- CSS INJECTION (Cached) ---
        let styleTag = document.getElementById('cdp-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'cdp-styles';
            document.head.appendChild(styleTag);
        }

        const darkModeOverrides = '/* --- BASE SNAPSHOT CSS --- */\n' +
            data.css +
            '\n\n/* === NEURAL AGENTIC IDE DARK THEME === */\n' +

            /* ── 1. CSS Variable Overrides ── */
            ':root {\n' +
            '    --bg-app: #000000;\n' +
            '    --text-main: #e5e2e1;\n' +
            '    --text-muted: #c4c7c7;\n' +
            '    --border-color: #444748;\n' +
            '    --background: #000000;\n' +
            '    --card: rgba(32, 31, 31, 0.9);\n' +
            '    --card-border: rgba(68, 71, 72, 0.6);\n' +
            '    --card-foreground: #e5e2e1;\n' +
            '    --foreground: #e5e2e1;\n' +
            '    --muted: #141313;\n' +
            '    --muted-foreground: #c4c7c7;\n' +
            '    --accent: #00dbe9;\n' +
            '    --accent-foreground: #000000;\n' +
            '    --border: #444748;\n' +
            '    --surface-bg: #000000;\n' +
            '    --surface-hover: #2a2a2a;\n' +
            '}\n' +

            /* ── 2. Conversation Container ── */
            '#conversation, #chat, #cascade, [data-testid="conversation-view"] {\n' +
            '    background-color: transparent !important;\n' +
            '    color: var(--text-main) !important;\n' +
            '    font-family: \'Hanken Grotesk\', system-ui, sans-serif !important;\n' +
            '    position: relative !important;\n' +
            '    width: 100% !important;\n' +
            '    height: auto !important;\n' +
            '    min-height: 0 !important;\n' +
            '    overflow: visible !important;\n' +
            '    font-size: 14px !important;\n' +
            '}\n' +
            '/* Flatten nested scroll/height containers from Tailwind */\n' +
            '[data-testid="conversation-view"] > div,\n' +
            '[data-testid="conversation-view"] > div > div,\n' +
            '#planningContent .h-full,\n' +
            '#planningContent .flex-1,\n' +
            '#planningContent .overflow-y-auto,\n' +
            '#planningContent .min-h-0 {\n' +
            '    height: auto !important;\n' +
            '    min-height: 0 !important;\n' +
            '    overflow: visible !important;\n' +
            '    max-height: none !important;\n' +
            '}\n' +

            /* ── 3. User Messages — Cyan Accent Border ── */
            '[aria-label="User message"] {\n' +
            '    position: relative !important;\n' +
            '    top: auto !important;\n' +
            '    z-index: auto !important;\n' +
            '    background: rgba(0, 219, 233, 0.04) !important;\n' +
            '    border-left: 3px solid #00dbe9 !important;\n' +
            '    border-radius: 0 12px 12px 0 !important;\n' +
            '    margin: 16px 0 12px 0 !important;\n' +
            '    padding: 12px 14px !important;\n' +
            '    box-shadow: 0 2px 12px rgba(0, 219, 233, 0.06) !important;\n' +
            '}\n' +
            '[aria-label="User message"]::after {\n' +
            '    content: none !important;\n' +
            '    display: none !important;\n' +
            '}\n' +

            /* ── 4. Card Surfaces ── */
            '.bg-card-border {\n' +
            '    background: linear-gradient(135deg, rgba(0, 219, 233, 0.12), rgba(124, 244, 255, 0.06)) !important;\n' +
            '    border-radius: 12px !important;\n' +
            '    padding: 1px !important;\n' +
            '}\n' +
            '.bg-card {\n' +
            '    background: rgba(32, 31, 31, 0.85) !important;\n' +
            '    border-radius: 11px !important;\n' +
            '    color: #e5e2e1 !important;\n' +
            '}\n' +
            '.bg-background {\n' +
            '    background-color: #000000 !important;\n' +
            '}\n' +

            /* ── 5. Tool/Command Blocks ── */
            '[class*="group/run-command"] {\n' +
            '    background: rgba(14, 14, 14, 0.7) !important;\n' +
            '    border: 1px solid rgba(68, 71, 72, 0.5) !important;\n' +
            '    border-radius: 10px !important;\n' +
            '    margin: 6px 0 !important;\n' +
            '    overflow: hidden !important;\n' +
            '}\n' +

            /* ── 6. Agent Action Buttons ── */
            '.agent-allow-btn {\n' +
            '    background: linear-gradient(135deg, #00dbe9, #7cf4ff) !important;\n' +
            '    color: #000 !important;\n' +
            '    border: none !important;\n' +
            '    border-radius: 8px !important;\n' +
            '    padding: 8px 18px !important;\n' +
            '    font-weight: 600 !important;\n' +
            '    font-size: 13px !important;\n' +
            '    cursor: pointer !important;\n' +
            '    box-shadow: 0 2px 10px rgba(0, 219, 233, 0.25) !important;\n' +
            '    transition: transform 0.2s, box-shadow 0.2s !important;\n' +
            '}\n' +
            '.agent-deny-btn {\n' +
            '    background: transparent !important;\n' +
            '    color: #ffb4ab !important;\n' +
            '    border: 1px solid rgba(255, 180, 171, 0.4) !important;\n' +
            '    border-radius: 8px !important;\n' +
            '    padding: 8px 18px !important;\n' +
            '    font-weight: 600 !important;\n' +
            '    font-size: 13px !important;\n' +
            '    cursor: pointer !important;\n' +
            '    transition: transform 0.2s, box-shadow 0.2s !important;\n' +
            '}\n' +
            '.agent-review-btn {\n' +
            '    background: transparent !important;\n' +
            '    color: #00dbe9 !important;\n' +
            '    border: 1px solid rgba(0, 219, 233, 0.4) !important;\n' +
            '    border-radius: 8px !important;\n' +
            '    padding: 8px 18px !important;\n' +
            '    font-weight: 600 !important;\n' +
            '    font-size: 13px !important;\n' +
            '    cursor: pointer !important;\n' +
            '    box-shadow: 0 2px 10px rgba(0, 219, 233, 0.15) !important;\n' +
            '    transition: transform 0.2s, box-shadow 0.2s !important;\n' +
            '}\n' +

            /* ── 7. Typography & Text Colors ── */
            '#conversation p, #chat p, #cascade p, [data-testid="conversation-view"] p,\n' +
            '#conversation h1, #chat h1, #cascade h1, [data-testid="conversation-view"] h1,\n' +
            '#conversation h2, #chat h2, #cascade h2, [data-testid="conversation-view"] h2,\n' +
            '#conversation h3, #chat h3, #cascade h3, [data-testid="conversation-view"] h3,\n' +
            '#conversation h4, #chat h4, #cascade h4, [data-testid="conversation-view"] h4,\n' +
            '#conversation span, #chat span, #cascade span, [data-testid="conversation-view"] span,\n' +
            '#conversation div, #chat div, #cascade div, [data-testid="conversation-view"] div,\n' +
            '#conversation li, #chat li, #cascade li, [data-testid="conversation-view"] li {\n' +
            '    color: inherit !important;\n' +
            '}\n' +
            '[style*="color: rgb(0, 0, 0)"], [style*="color: black"],\n' +
            '[style*="color:#000"], [style*="color: #000"] {\n' +
            '    color: #e5e2e1 !important;\n' +
            '}\n' +
            '#conversation a, #chat a, #cascade a, [data-testid="conversation-view"] a {\n' +
            '    color: #7cf4ff !important;\n' +
            '    text-decoration: underline;\n' +
            '    text-decoration-color: rgba(124, 244, 255, 0.3) !important;\n' +
            '    text-underline-offset: 2px !important;\n' +
            '}\n' +

            /* ── 8. Images & Icons ── */
            'img[src^="/c:"], img[src^="/C:"], img[src*="AppData"] {\n' +
            '    display: none !important;\n' +
            '}\n' +
            'img, svg {\n' +
            '    display: inline !important;\n' +
            '    vertical-align: middle !important;\n' +
            '}\n' +
            'div:has(> img[src^="data:"]), div:has(> img[alt]), span:has(> img) {\n' +
            '    display: inline !important;\n' +
            '    vertical-align: middle !important;\n' +
            '}\n' +
            '[class*="inline-flex"], [class*="inline-block"], [class*="items-center"]:has(img) {\n' +
            '    display: inline-flex !important;\n' +
            '    vertical-align: middle !important;\n' +
            '}\n' +

            /* ── 9. Code Blocks ── */
            ':not(pre) > code {\n' +
            '    padding: 1px 5px !important;\n' +
            '    border-radius: 4px !important;\n' +
            '    background-color: rgba(0, 219, 233, 0.1) !important;\n' +
            '    color: #7cf4ff !important;\n' +
            '    font-size: 0.85em !important;\n' +
            '    line-height: 1.2 !important;\n' +
            '    white-space: normal !important;\n' +
            '    font-family: \'JetBrains Mono\', monospace !important;\n' +
            '}\n' +
            'pre, code, .monaco-editor-background, [class*="terminal"] {\n' +
            '    background-color: #0e0e0e !important;\n' +
            '    color: #e5e2e1 !important;\n' +
            '    font-family: \'JetBrains Mono\', monospace !important;\n' +
            '    border-radius: 8px;\n' +
            '    border: 1px solid #444748;\n' +
            '}\n' +
            'pre {\n' +
            '    position: relative !important;\n' +
            '    white-space: pre-wrap !important;\n' +
            '    word-break: break-word !important;\n' +
            '    padding: 10px 12px !important;\n' +
            '    margin: 6px 0 !important;\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '}\n' +
            'pre.has-copy-btn {\n' +
            '    padding-right: 32px !important;\n' +
            '}\n' +
            'pre.single-line-pre {\n' +
            '    display: inline-block !important;\n' +
            '    width: auto !important;\n' +
            '    max-width: 100% !important;\n' +
            '    padding: 1px 6px !important;\n' +
            '    margin: 0px !important;\n' +
            '    vertical-align: middle !important;\n' +
            '    background-color: #0e0e0e !important;\n' +
            '    font-size: 0.85em !important;\n' +
            '}\n' +
            'pre.single-line-pre > code {\n' +
            '    display: inline !important;\n' +
            '    white-space: nowrap !important;\n' +
            '}\n' +
            'pre:not(.single-line-pre) > code {\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '    overflow-x: auto !important;\n' +
            '    background: transparent !important;\n' +
            '    border: none !important;\n' +
            '    padding: 0 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +

            /* ── 10. Copy Button ── */
            '.mobile-copy-btn {\n' +
            '    position: absolute !important;\n' +
            '    top: 6px !important;\n' +
            '    right: 6px !important;\n' +
            '    background: rgba(0, 219, 233, 0.12) !important;\n' +
            '    color: #00dbe9 !important;\n' +
            '    border: none !important;\n' +
            '    width: 26px !important;\n' +
            '    height: 26px !important;\n' +
            '    padding: 0 !important;\n' +
            '    cursor: pointer !important;\n' +
            '    display: flex !important;\n' +
            '    align-items: center !important;\n' +
            '    justify-content: center !important;\n' +
            '    border-radius: 6px !important;\n' +
            '    transition: all 0.2s ease !important;\n' +
            '    -webkit-tap-highlight-color: transparent !important;\n' +
            '    z-index: 10 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +
            '.mobile-copy-btn:hover, .mobile-copy-btn:focus {\n' +
            '    background: rgba(0, 219, 233, 0.25) !important;\n' +
            '    color: #7cf4ff !important;\n' +
            '}\n' +
            '.mobile-copy-btn svg {\n' +
            '    width: 14px !important;\n' +
            '    height: 14px !important;\n' +
            '    stroke: currentColor !important;\n' +
            '    stroke-width: 2 !important;\n' +
            '    fill: none !important;\n' +
            '}\n' +

            /* ── 11. Blockquotes & Tables ── */
            'blockquote {\n' +
            '    border-left: 3px solid #00dbe9 !important;\n' +
            '    background: rgba(0, 219, 233, 0.04) !important;\n' +
            '    color: #c4c7c7 !important;\n' +
            '    padding: 10px 14px !important;\n' +
            '    margin: 8px 0 !important;\n' +
            '    border-radius: 0 8px 8px 0 !important;\n' +
            '}\n' +
            'table {\n' +
            '    border-collapse: collapse !important;\n' +
            '    width: 100% !important;\n' +
            '    border: 1px solid #444748 !important;\n' +
            '    border-radius: 8px !important;\n' +
            '}\n' +
            'th, td {\n' +
            '    border: 1px solid #444748 !important;\n' +
            '    padding: 8px 10px !important;\n' +
            '    color: #e5e2e1 !important;\n' +
            '}\n' +
            'th {\n' +
            '    background: rgba(0, 219, 233, 0.06) !important;\n' +
            '    font-weight: 600 !important;\n' +
            '}\n' +

            /* ── 12. Scrollbar & White BG Overrides ── */
            '::-webkit-scrollbar {\n' +
            '    width: 0 !important;\n' +
            '}\n' +
            '[style*="background-color: rgb(255, 255, 255)"],\n' +
            '[style*="background-color: white"],\n' +
            '[style*="background: white"] {\n' +
            '    background-color: transparent !important;\n' +
            '}\n' +

            /* ── 13. Headings Polish ── */
            '[data-testid="conversation-view"] h1,\n' +
            '[data-testid="conversation-view"] h2,\n' +
            '[data-testid="conversation-view"] h3 {\n' +
            '    font-weight: 700 !important;\n' +
            '    letter-spacing: -0.01em !important;\n' +
            '    margin-top: 16px !important;\n' +
            '    margin-bottom: 8px !important;\n' +
            '}\n' +
            '[data-testid="conversation-view"] h1 { font-size: 1.3em !important; }\n' +
            '[data-testid="conversation-view"] h2 { font-size: 1.15em !important; }\n' +
            '[data-testid="conversation-view"] h3 { font-size: 1.05em !important; }\n' +

            /* ── 14. List Styling ── */
            '[data-testid="conversation-view"] ul,\n' +
            '[data-testid="conversation-view"] ol {\n' +
            '    padding-left: 20px !important;\n' +
            '    margin: 4px 0 !important;\n' +
            '}\n' +
            '[data-testid="conversation-view"] li {\n' +
            '    margin: 2px 0 !important;\n' +
            '    line-height: 1.6 !important;\n' +
            '}';
        styleTag.textContent = darkModeOverrides;
        currentDarkModeOverrides = darkModeOverrides; // Save for right pane rendering

        chatContent.innerHTML = data.html;

        // Populate Sidebar Drawer if data exists
        if (data.sidebar) {
            drawerChatList.innerHTML = '';
            
            // 1. Render Projects
            if (data.sidebar.projects && data.sidebar.projects.length > 0) {
                data.sidebar.projects.forEach(project => {
                    const projectSection = document.createElement('div');
                    projectSection.className = 'drawer-project-section';
                    
                    const projectHeader = document.createElement('div');
                    projectHeader.className = 'drawer-project-header';
                    projectHeader.style.display = 'flex';
                    projectHeader.style.justifyContent = 'space-between';
                    projectHeader.style.alignItems = 'center';
                    projectHeader.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="material-symbols-outlined" style="font-size:20px; color: var(--accent);">folder</span>
                            <span>${project.name}</span>
                        </div>
                        <button class="project-new-chat-btn" aria-label="New Chat" style="background:transparent; border:none; color:var(--accent); cursor:pointer; padding:4px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition: background 0.2s;">
                            <span class="material-symbols-outlined" style="font-size:18px;">add</span>
                        </button>
                    `;
                    
                    const newProjectChatBtn = projectHeader.querySelector('.project-new-chat-btn');
                    newProjectChatBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        toggleDrawer(false);
                        try {
                            await fetchWithAuth('/new-project-chat', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ projectName: project.name })
                            });
                            setTimeout(loadSnapshot, 500);
                            setTimeout(loadSnapshot, 1000);
                        } catch (err) {
                            console.error('Failed to create new project chat:', err);
                        }
                    });
                    
                    projectSection.appendChild(projectHeader);
                    
                    const projectChats = document.createElement('div');
                    projectChats.className = 'drawer-project-chats';
                    
                    project.chats.forEach(chat => {
                        const item = document.createElement('div');
                        item.className = 'drawer-chat-item' + (chat.isActive ? ' active' : '');
                        item.textContent = chat.title || 'New Conversation';
                        item.addEventListener('click', async () => {
                            toggleDrawer(false);
                            try {
                                await fetchWithAuth('/switch-chat', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: chat.id })
                                });
                                setTimeout(loadSnapshot, 500);
                            } catch (e) {}
                        });
                        projectChats.appendChild(item);
                    });
                    
                    projectSection.appendChild(projectChats);
                    drawerChatList.appendChild(projectSection);
                });
            }
            
            // 2. Render General/Standalone Conversations
            if (data.sidebar.conversations && data.sidebar.conversations.length > 0) {
                // The "Conversations" section header has been completely removed to maintain spacing
                
                data.sidebar.conversations.forEach(chat => {
                    const item = document.createElement('div');
                    item.className = 'drawer-chat-item' + (chat.isActive ? ' active' : '');
                    item.textContent = chat.title || 'New Conversation';
                    item.addEventListener('click', async () => {
                        toggleDrawer(false);
                        try {
                            await fetchWithAuth('/switch-chat', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: chat.id })
                            });
                            setTimeout(loadSnapshot, 500);
                        } catch (e) {}
                    });
                    drawerChatList.appendChild(item);
                });
            }
            
            // 3. Fallback to flat chats if legacy structure or empty
            if ((!data.sidebar.projects || data.sidebar.projects.length === 0) &&
                (!data.sidebar.conversations || data.sidebar.conversations.length === 0) &&
                data.sidebar.chats) {
                data.sidebar.chats.forEach(chat => {
                    const item = document.createElement('div');
                    item.className = 'drawer-chat-item' + (chat.isActive ? ' active' : '');
                    item.textContent = chat.title || 'New Conversation';
                    item.addEventListener('click', async () => {
                        toggleDrawer(false);
                        try {
                            await fetchWithAuth('/switch-chat', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: chat.id })
                            });
                            setTimeout(loadSnapshot, 500);
                        } catch (e) {}
                    });
                    drawerChatList.appendChild(item);
                });
            }
        }


        // Add mobile copy buttons to all code blocks
        addMobileCopyButtons();

        // Smart scroll behavior: respect user scroll, only auto-scroll when appropriate
        if (isUserScrollLocked) {
            // User recently scrolled - try to maintain their approximate position
            // Use percentage-based restoration for better accuracy
            const scrollPercent = scrollHeight > 0 ? scrollPos / scrollHeight : 0;
            const newScrollPos = chatContainer.scrollHeight * scrollPercent;
            chatContainer.scrollTop = newScrollPos;
        } else if (isNearBottom || scrollPos === 0) {
            // User was at bottom or hasn't scrolled - auto scroll to bottom
            scrollToBottom();
        } else {
            // Preserve exact scroll position
            chatContainer.scrollTop = scrollPos;
        }

    } catch (err) {
        console.error(err);
    }
}

// --- Mobile Code Block Copy Functionality ---
function addMobileCopyButtons() {
    // Find all pre elements (code blocks) in the chat
    const codeBlocks = chatContent.querySelectorAll('pre');

    codeBlocks.forEach((pre, index) => {
        // Skip if already has our button
        if (pre.querySelector('.mobile-copy-btn')) return;

        // Get the code text
        const codeElement = pre.querySelector('code') || pre;
        const textToCopy = (codeElement.textContent || codeElement.innerText).trim();

        // Check if there's a newline character in the TRIMMED text
        // This ensures single-line blocks with trailing newlines don't get buttons
        const hasNewline = /\n/.test(textToCopy);

        // If it's a single line code block, don't add the copy button
        if (!hasNewline) {
            pre.classList.remove('has-copy-btn');
            pre.classList.add('single-line-pre');
            return;
        }

        // Add class for padding
        pre.classList.remove('single-line-pre');
        pre.classList.add('has-copy-btn');

        // Create the copy button (icon only)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'mobile-copy-btn';
        copyBtn.setAttribute('data-code-index', index);
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            `;

        // Add click handler for copy
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const success = await copyToClipboard(textToCopy);

            if (success) {
                // Visual feedback - show checkmark
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            `;

                // Reset after 2 seconds
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            } else {
                // Show X icon briefly on error
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
            `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            }
        });

        // Insert button into pre element
        pre.appendChild(copyBtn);
    });
}

// --- Cross-platform Clipboard Copy ---
async function copyToClipboard(text) {
    // Method 1: Modern Clipboard API (works on HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('[COPY] Success via Clipboard API');
            return true;
        } catch (err) {
            console.warn('[COPY] Clipboard API failed:', err);
        }
    }

    // Method 2: Fallback using execCommand (works on HTTP, older browsers)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom on iOS
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0';

        document.body.appendChild(textArea);

        // iOS specific handling
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textArea.setSelectionRange(0, text.length);
        } else {
            textArea.select();
        }

        const success = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (success) {
            console.log('[COPY] Success via execCommand fallback');
            return true;
        }
    } catch (err) {
        console.warn('[COPY] execCommand fallback failed:', err);
    }

    // Method 3: For Android WebView or restricted contexts
    // Show the text in a selectable modal if all else fails
    console.error('[COPY] All copy methods failed');
    return false;
}

function scrollToBottom() {
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

let attachedImageBase64 = null;
const originalAttachmentIcon = `<span class="material-symbols-outlined">add</span>`;
const attachedCheckmarkIcon = `<span class="material-symbols-outlined" style="color: var(--success);">check</span>`;

// --- Inputs ---
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message && !attachedImageBase64) return;

    console.log("[Client] sendMessage called. Message:", message, "Has image:", !!attachedImageBase64);

    // Optimistic UI updates
    const previousValue = messageInput.value;
    const previousImage = attachedImageBase64;
    messageInput.value = ''; // Clear immediately
    messageInput.style.height = 'auto'; // Reset height
    messageInput.blur(); // Close keyboard on mobile immediately
    
    attachedImageBase64 = null;
    if (attachmentBtn) {
        attachmentBtn.style.color = 'var(--text-muted)';
        attachmentBtn.innerHTML = originalAttachmentIcon;
    }

    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    try {
        // If no chat is open, start a new one first
        if (!chatIsOpen) {
            const newChatRes = await fetchWithAuth('/new-chat', { method: 'POST' });
            const newChatData = await newChatRes.json();
            if (newChatData.success) {
                // Wait for the new chat to be ready
                await new Promise(r => setTimeout(r, 800));
                chatIsOpen = true;
            }
        }

        console.log("[Client] Sending POST request to /send with payload size:", JSON.stringify({ message, image: previousImage }).length);

        const res = await fetchWithAuth('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message, 
                image: previousImage,
                imageWaitMs: 1500 
            })
        });

        // Always reload snapshot to check if message appeared
        setTimeout(loadSnapshot, 300);
        setTimeout(loadSnapshot, 800);
        setTimeout(checkChatStatus, 1000);

        // Don't revert the input - if user sees the message in chat, it was sent
        // Only log errors for debugging, don't show alert popups
        if (!res.ok) {
            console.warn('Send response not ok, but message may have been sent:', await res.json().catch(() => ({})));
        }
    } catch (e) {
        // Network error - still try to refresh in case it went through
        console.error('Send error:', e);
        setTimeout(loadSnapshot, 500);
    } finally {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
    }
}

// --- Event Listeners ---
sendBtn.addEventListener('click', sendMessage);

function compressImage(base64Str, maxWidth = 1200, maxHeight = 1200, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Export as JPEG with configured quality
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => {
            // Fallback to original base64 if anything fails
            resolve(base64Str);
        };
    });
}

if (attachmentBtn && imageInput) {
    attachmentBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        console.log("[Client] Image file selected:", file.name, "size:", file.size, "bytes");

        const reader = new FileReader();
        reader.onload = async (event) => {
            const rawBase64 = event.target.result;
            attachedImageBase64 = await compressImage(rawBase64);
            // Visual feedback
            attachmentBtn.style.color = 'var(--success)';
            attachmentBtn.innerHTML = attachedCheckmarkIcon;
            
            // Clear input so same file can be selected again
            imageInput.value = '';
        };
        reader.onerror = () => {
            imageInput.value = '';
        };
        reader.readAsDataURL(file);
    });
}

// Refresh is now auto-only (no manual refresh button in Neural UI)

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// --- Support Modal Logic ---
if (supportBtn) {
    supportBtn.addEventListener('click', () => {
        if (supportOverlay) {
            supportOverlay.classList.add('show');
        }
    });
}

if (closeSupportBtn) {
    closeSupportBtn.addEventListener('click', () => {
        if (supportOverlay) {
            supportOverlay.classList.remove('show');
        }
    });
}

if (supportOverlay) {
    supportOverlay.addEventListener('click', (e) => {
        if (e.target === supportOverlay) {
            supportOverlay.classList.remove('show');
        }
    });
}

// --- Scroll Sync to Desktop ---
let scrollSyncTimeout = null;
let lastScrollSync = 0;
const SCROLL_SYNC_DEBOUNCE = 150; // ms between scroll syncs
let snapshotReloadPending = false;

async function syncScrollToDesktop() {
    const scrollPercent = chatContainer.scrollTop / (chatContainer.scrollHeight - chatContainer.clientHeight);
    try {
        await fetchWithAuth('/remote-scroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scrollPercent })
        });

        // After scrolling desktop, reload snapshot to get newly visible content
        // (Antigravity uses virtualized scrolling - only visible messages are in DOM)
        if (!snapshotReloadPending) {
            snapshotReloadPending = true;
            setTimeout(() => {
                loadSnapshot();
                snapshotReloadPending = false;
            }, 300);
        }
    } catch (e) {
        console.log('Scroll sync failed:', e.message);
    }
}

chatContainer.addEventListener('scroll', () => {
    userIsScrolling = true;
    // Set a lock to prevent auto-scroll jumping for a few seconds
    userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;
    clearTimeout(idleTimer);

    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 120;
    if (isNearBottom) {
        scrollToBottomBtn.classList.remove('show');
        // If user scrolled to bottom, clear the lock so auto-scroll works
        userScrollLockUntil = 0;
    } else {
        scrollToBottomBtn.classList.add('show');
    }

    // Debounced scroll sync to desktop
    const now = Date.now();
    if (now - lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
        lastScrollSync = now;
        clearTimeout(scrollSyncTimeout);
        scrollSyncTimeout = setTimeout(syncScrollToDesktop, 100);
    }

    idleTimer = setTimeout(() => {
        userIsScrolling = false;
        autoRefreshEnabled = true;
    }, 5000);
});

scrollToBottomBtn.addEventListener('click', () => {
    userIsScrolling = false;
    userScrollLockUntil = 0; // Clear lock so auto-scroll works again
    scrollToBottom();
});

// --- Quick Actions ---
function quickAction(text) {
    messageInput.value = text;
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
    messageInput.focus();
}

// --- Stop Logic ---
stopBtn.addEventListener('click', async () => {
    stopBtn.style.opacity = '0.5';
    try {
        const res = await fetchWithAuth('/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            // alert('Stopped');
        } else {
            // alert('Error: ' + data.error);
        }
    } catch (e) { }
    setTimeout(() => stopBtn.style.opacity = '1', 500);
});

// --- New Chat Logic ---
async function startNewChat() {
    newChatBtn.style.opacity = '0.5';
    newChatBtn.style.pointerEvents = 'none';

    try {
        const res = await fetchWithAuth('/new-chat', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            // Reload snapshot to show new empty chat
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1000);
            setTimeout(checkChatStatus, 1500);
        } else {
            console.error('Failed to start new chat:', data.error);
        }
    } catch (e) {
        console.error('New chat error:', e);
    }

    setTimeout(() => {
        newChatBtn.style.opacity = '1';
        newChatBtn.style.pointerEvents = 'auto';
    }, 500);
}

newChatBtn.addEventListener('click', startNewChat);

// --- Chat History Logic ---
async function showChatHistory() {
    const historyLayer = document.getElementById('historyLayer');
    const historyList = document.getElementById('historyList');

    // Show loading state
    historyList.innerHTML = `
        <div class="history-state-container">
            <div class="history-spinner"></div>
            <div class="history-state-text">Loading History...</div>
        </div>
    `;
    historyLayer.classList.add('show');

    try {
        const res = await fetchWithAuth('/chat-history');
        const data = await res.json();

        if (data.error) {
            historyList.innerHTML = `
                <div class="history-state-container">
                    <div class="history-state-icon">⚠️</div>
                    <div class="history-state-title">Error loading history</div>
                    <div class="history-state-desc">${data.error}</div>
                    <button class="history-new-btn mt-4">
                        <span class="material-symbols-outlined" style="font-size:20px;">add</span>
                        Start New Conversation
                    </button>
                </div>
            `;
            return;
        }

        const chats = data.chats || [];
        if (chats.length === 0) {
            historyList.innerHTML = `
                <div class="history-state-container">
                    <div class="history-state-icon">📝</div>
                    <div class="history-state-title">No recent chats found</div>
                    <div class="history-state-desc">Start a new conversation to see them here.</div>
                    <button class="history-new-btn mt-4">
                        <span class="material-symbols-outlined" style="font-size:20px;">add</span>
                        Start New Conversation
                    </button>
                </div>
            `;
            return;
        }

        // Render chats
        let html = `
            <div class="history-action-container">
                <button class="history-new-btn">
                    <span class="material-symbols-outlined" style="font-size:20px;">add</span>
                    New Conversation
                </button>
            </div>
            <div class="history-list-group">
        `;

        chats.forEach(chat => {
            const safeTitle = chat.title.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            html += `
                <div class="history-card" data-title="${safeTitle}">
                    <div class="history-card-icon">
                        <span class="material-symbols-outlined" style="font-size:20px;">chat_bubble_outline</span>
                    </div>
                    <div class="history-card-content">
                        <span class="history-card-title">${escapeHtml(chat.title)}</span>
                    </div>
                    <div class="history-card-arrow">
                        <span class="material-symbols-outlined" style="font-size:20px;">chevron_right</span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        historyList.innerHTML = html;

    } catch (e) {
        historyList.innerHTML = `
            <div class="history-state-container">
                <div class="history-state-icon">🔌</div>
                <div class="history-state-title">Connection Error</div>
                <div class="history-state-desc">Failed to reach the server.</div>
            </div>
        `;
    }
}


function hideChatHistory() {
    historyLayer.classList.remove('show');
    // Send an escape key to Antigravity to close the History panel
    try {
        fetchWithAuth('/close-history', { method: 'POST' });
    } catch (e) {
        console.error('Failed to close history on desktop:', e);
    }
}

async function selectChat(title) {
    try {
        const res = await fetchWithAuth('/select-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await res.json();
        if (data.success) {
            let attempts = 0;
            const poll = setInterval(async () => {
                await loadSnapshot();
                attempts++;
                if (attempts > 10) clearInterval(poll);
            }, 500);
        } else {
            console.error('Failed to select chat:', data.error);
            setTimeout(loadSnapshot, 500);
        }
    } catch (e) {
        console.error('Select chat error:', e);
        setTimeout(loadSnapshot, 500);
    }
}

// --- Check Chat Status ---
async function checkChatStatus() {
    try {
        const res = await fetchWithAuth('/chat-status');
        const data = await res.json();

        chatIsOpen = data.hasChat || data.editorFound;

        if (!chatIsOpen) {
            showEmptyState();
        }
    } catch (e) {
        console.error('Chat status check failed:', e);
    }
}

// --- Empty State (No Chat Open) ---
function showEmptyState() {
    chatContent.innerHTML = `
        <div class="empty-state">
            <span class="material-symbols-outlined" style="font-size:72px; color: var(--accent); opacity:0.8; filter: drop-shadow(0 0 16px rgba(0,219,233,0.25)); margin-bottom:24px;">chat_bubble_outline</span>
            <h2>No Chat Open</h2>
            <p>Start a new conversation or select one from your history to begin chatting.</p>
            <button class="empty-state-btn" id="newChatFromEmptyBtn">
                Start New Conversation
            </button>
        </div>
    `;
}

// --- Utility: Escape HTML ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Settings Logic ---


function openModal(title, options, onSelect) {
    modalTitle.textContent = title;
    modalList.innerHTML = '';
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'modal-option';
        div.textContent = opt;
        div.addEventListener('click', () => {
            onSelect(opt);
            closeModal();
        });
        modalList.appendChild(div);
    });
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

// Mode selection is now integrated into model selector modal
// When user opens model picker, they can also toggle mode

modelBtn.addEventListener('click', async () => {
    const prevText = modelText.textContent;
    modelText.textContent = 'Loading...';
    try {
        const res = await fetchWithAuth('/available-models');
        const data = await res.json();
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            MODELS = data.models;
        }
    } catch (e) {
        console.error('Failed to fetch models:', e);
    } finally {
        modelText.textContent = prevText;
    }

    openModal('Select Model', MODELS, async (model) => {
        const prev = modelText.textContent;
        modelText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth('/set-model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            const data = await res.json();
            if (data.success) {
                modelText.textContent = model;
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modelText.textContent = prev;
            }
        } catch (e) {
            modelText.textContent = prev;
        }
    });
});

// --- Viewport / Keyboard Handling ---
// This fixes the issue where the keyboard hides the input or layout breaks
if (window.visualViewport) {
    function handleResize() {
        // Resize the body to match the visual viewport (screen minus keyboard)
        document.body.style.height = window.visualViewport.height + 'px';

        // Scroll to bottom if keyboard opened
        if (document.activeElement === messageInput) {
            setTimeout(scrollToBottom, 100);
        }
    }

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    handleResize(); // Init
} else {
    // Fallback for older browsers without visualViewport support
    window.addEventListener('resize', () => {
        document.body.style.height = window.innerHeight + 'px';
    });
    document.body.style.height = window.innerHeight + 'px'; // Init
}

// --- Remote Click Logic (Thinking/Thought) ---
chatContainer.addEventListener('click', async (e) => {
    // Strategy: Check if the clicked element OR its parent contains "Thought" or "Thinking" text.
    // This handles both opening (collapsed) and closing (expanded) states.

    // 1. Find the nearest container that might be the "Thought" block
    const target = e.target.closest('div, span, p, summary, button, details');
    if (!target) return;

    const text = target.innerText || '';

    // Check if this looks like a clickable UI toggle from Antigravity/Cascade
    // Includes: Thought blocks, Worked status, Edited files status, and File lists
    const isUiToggle = /Thought|Thinking|Worked for|Edited|\d+\s+file/i.test(text) && text.length < 500;

    if (isUiToggle) {
        // Visual feedback - briefly dim the clicked element
        target.style.opacity = '0.5';
        setTimeout(() => target.style.opacity = '1', 300);

        // Extract just the first line for matching
        const firstLine = text.split('\n')[0].trim();

        // Determine which occurrence of this text the user tapped
        // This handles multiple Thought blocks with identical labels
        const allElements = chatContainer.querySelectorAll(target.tagName.toLowerCase());
        let tapIndex = 0;
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const elText = el.innerText || '';
            const elFirstLine = elText.split('\n')[0].trim();

            // Only count if it looks like a UI toggle and matches the first line exactly
            if (/Thought|Thinking|Worked for|Edited|\d+\s+file/i.test(elText) && elText.length < 500 && elFirstLine === firstLine) {
                // If this is our target (or contains it), we've found the correct index
                if (el === target || el.contains(target)) {
                    break;
                }
                tapIndex++;
            }
        }

        try {
            const response = await fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: target.tagName.toLowerCase(),
                    index: tapIndex,
                    textContent: firstLine  // Use first line for more reliable matching
                })
            });

            // Reload snapshot multiple times to catch the UI change
            // Desktop animation takes time, so we poll a few times
            setTimeout(loadSnapshot, 400);   // Quick check
            setTimeout(loadSnapshot, 800);   // After animation starts
            setTimeout(loadSnapshot, 1500);  // After animation completes
        } catch (e) {
            console.error('Remote click failed:', e);
        }
        return;
    }

    // --- Command Action Buttons (Run, Reject, Allow, Deny, etc.) ---
    const btn = e.target.closest('button, [role="button"]');
    if (btn) {
        const btnText = (btn.innerText || '').trim();

        // Match various action keywords
        const actionKeywords = [
            'Allow this conversation', 'Always allow', 'Allow once',
            'Review changes', 'Review',
            'Confirm', 'Accept', 'Reject', 'Discard',
            'Allow', 'Deny', 'Apply', 'Save', 'Run',
            'Yes', 'No'
        ];

        const btnTextLower = btnText.toLowerCase();
        const matchedKeyword = actionKeywords.find(kw =>
            btnTextLower.includes(kw.toLowerCase())
        );
        if (matchedKeyword) {
            btn.style.opacity = '0.5';
            setTimeout(() => btn.style.opacity = '1', 300);

            // Determine which occurrence of this button text the user tapped
            const allButtons = Array.from(chatContainer.querySelectorAll('button, [role="button"]'));

            // Filter to only those that match our specific keyword
            const matchingButtons = allButtons.filter(b =>
                (b.innerText || '').toLowerCase().includes(matchedKeyword.toLowerCase())
            );
            const btnIndex = matchingButtons.indexOf(btn);

            try {
                await fetchWithAuth('/remote-click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selector: btn.tagName.toLowerCase() === 'button' ? 'button' : '[role="button"]',
                        index: btnIndex >= 0 ? btnIndex : 0,
                        textContent: matchedKeyword
                    })
                });

                // Rapidly poll for updates as actions usually trigger DOM changes
                setTimeout(loadSnapshot, 400);
                setTimeout(loadSnapshot, 1000);
                setTimeout(loadSnapshot, 2500);
            } catch (err) {
                console.error('Remote button click failed:', err);
            }
        }
    }
});

// --- Initial Event Listeners (Refactored from inline) ---
if (enableHttpsBtn) enableHttpsBtn.addEventListener('click', enableHttps);
if (dismissSslBtn) dismissSslBtn.addEventListener('click', dismissSslBanner);
if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (backHistoryBtn) backHistoryBtn.addEventListener('click', hideChatHistory);

quickActionChips.forEach(chip => {
    chip.addEventListener('click', () => {
        const actionText = chip.getAttribute('data-action') || chip.innerText.trim();
        // Handle specific cases if needed, otherwise just pass the text
        if (actionText.includes('Explain')) {
            quickAction('Explain this code in detailed and elaborate manner.');
        } else if (actionText.includes('Fix')) {
            quickAction('Please fix the bugs in this code...');
        } else if (actionText.includes('Create')) {
            quickAction('Please create or update documentation for this code.');
        } else {
            quickAction(actionText);
        }
    });
});

// Delegation for dynamic history items
if (historyList) {
    historyList.addEventListener('click', (e) => {
        const newBtn = e.target.closest('.history-new-btn');
        const card = e.target.closest('.history-card');
        
        if (newBtn) {
            hideChatHistory();
            startNewChat();
        } else if (card) {
            const title = card.getAttribute('data-title');
            hideChatHistory();
            selectChat(title);
        }
    });
}

// Delegation for empty state
chatContent.addEventListener('click', (e) => {
    if (e.target.closest('#newChatFromEmptyBtn')) {
        startNewChat();
    }
});

// --- Init ---
connectWebSocket();
// Sync state initially and every 5 seconds to keep phone in sync with desktop changes
fetchAppState();
setInterval(fetchAppState, 5000);

// Check chat status initially and periodically
checkChatStatus();
setInterval(checkChatStatus, 10000); // Check every 10 seconds


/* =========================================
   AGENT ACTIONS & DRAWER LOGIC
   ========================================= */

// Drawer Toggle
function toggleDrawer(show) {
    if (show) {
        drawerOverlay.classList.add('active');
        sidebarDrawer.classList.add('active');
    } else {
        drawerOverlay.classList.remove('active');
        sidebarDrawer.classList.remove('active');
    }
}

if (hamburgerBtn) hamburgerBtn.addEventListener('click', () => toggleDrawer(true));
if (drawerOverlay) drawerOverlay.addEventListener('click', () => toggleDrawer(false));
if (drawerCollapseBtn) drawerCollapseBtn.addEventListener('click', () => toggleDrawer(false));
if (drawerNewChatBtn) {
    drawerNewChatBtn.addEventListener('click', () => {
        toggleDrawer(false);
        startNewChat();
    });
}
if (drawerHistoryBtn) {
    drawerHistoryBtn.addEventListener('click', () => {
        toggleDrawer(false);
        showChatHistory();
    });
}
if (drawerPlanningBtn) {
    drawerPlanningBtn.addEventListener('click', () => {
        toggleDrawer(false);
        openPlanningDrawer();
    });
}

// Event Delegation for Agent Buttons and Artifacts
chatContent.addEventListener('click', async (e) => {
    const target = e.target;
    
    // Intercept planning/artifact markdown links
    const link = target.closest('a');
    if (link) {
        const href = link.getAttribute('href') || '';
        if (href.includes('/brain/') && href.includes('.md')) {
            e.preventDefault();
            const textContent = link.textContent.trim();
            
            // Trigger remote click so desktop opens the right pane
            fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selector: 'a', textContent })
            });

            // Wait briefly for the desktop to render the right pane, then open phone drawer
            setTimeout(() => {
                openPlanningDrawer();
            }, 800);
            return;
        }
    }
    
    // Allow Button
    const allowBtn = target.closest('.agent-allow-btn');
    if (allowBtn) {
        allowBtn.style.opacity = '0.5';
        await executeAgentAction('allow');
        return;
    }
    
    // Deny Button
    const denyBtn = target.closest('.agent-deny-btn');
    if (denyBtn) {
        denyBtn.style.opacity = '0.5';
        await executeAgentAction('deny');
        return;
    }

    // Review Button
    const reviewBtn = target.closest('.agent-review-btn');
    if (reviewBtn) {
        reviewBtn.style.opacity = '0.5';
        await executeAgentAction('review');
        // Now that the action and snapshot reload are complete, mirror the right pane
        openPlanningDrawer();
        return;
    }
    
    // Artifact Card
    const artifactCard = target.closest('.artifact-card');
    if (artifactCard) {
        artifactCard.style.opacity = '0.5';
        // Trigger remote click on desktop to open the pane
        const textContent = artifactCard.innerText.split('\n')[0].trim();
        await fetchWithAuth('/remote-click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                selector: 'a[href*=".md"], [class*="implementation"], [class*="plan"], [class*="walkthrough"], [class*="review"], .artifact-card', 
                textContent 
            })
        });
        
        // Wait for desktop React DOM to render the new pane, then mirror it
        await new Promise(r => setTimeout(r, 600));
        openPlanningDrawer();
        return;
    }
});

async function executeAgentAction(action) {
    try {
        await fetchWithAuth('/agent-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        
        // Wait briefly for AG to process the action, then reload snapshot
        await new Promise(r => setTimeout(r, 600));
        await loadSnapshot();
    } catch (e) {
        console.error('Agent action failed', e);
    }
}

// Artifact Full Screen View
function openArtifactView(cardElement) {
    const title = cardElement.innerText.split('\n')[0] || 'Document';
    artifactTitle.textContent = title;
    
    artifactContent.innerHTML = '';
    const clone = cardElement.cloneNode(true);
    clone.style.margin = '20px';
    clone.style.background = 'transparent';
    clone.style.border = 'none';
    artifactContent.appendChild(clone);
    
    artifactViewLayer.classList.add('active');
}

if (closeArtifactBtn) {
    closeArtifactBtn.addEventListener('click', () => {
        artifactViewLayer.classList.remove('active');
    });
}

// ==========================================
// PLANNING PANE LOGIC
// ==========================================
// planningBtn is now drawerPlanningBtn (wired in drawer handlers above)
const planningLayer = document.getElementById('planningLayer');
const closePlanningBtn = document.getElementById('closePlanningBtn');
const planningContent = document.getElementById('planningContent');
const fontIncBtn = document.getElementById('fontIncBtn');
const fontDecBtn = document.getElementById('fontDecBtn');

let planningHTML = '';
let currentFontSize = 15;

async function openPlanningDrawer() {
    planningLayer.classList.add('show');
    planningContent.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Loading desktop right pane...</p></div>';
    
    try {
        const res = await fetchWithAuth('/api/planning-files');
        const data = await res.json();
        
        if (data.hasFiles && data.html) {
            planningHTML = data.html;
            planningContent.innerHTML = '<style>' + currentDarkModeOverrides + '</style>' + planningHTML;
        } else {
            planningHTML = '<div class="loading-state"><p>Right pane is currently closed on desktop.</p></div>';
            planningContent.innerHTML = planningHTML;
        }
    } catch (e) {
        planningContent.innerHTML = '<div class="loading-state"><p>Error connecting to desktop.</p></div>';
    }
}

// Planning button is now in sidebar (drawerPlanningBtn), wired above

if (closePlanningBtn) {
    closePlanningBtn.addEventListener('click', () => {
        planningLayer.classList.remove('show');
    });
}

function renderPlanningTabs() {
    // Deprecated: We now mirror the desktop UI directly
}

if (fontIncBtn && fontDecBtn) {
    fontIncBtn.addEventListener('click', () => {
        if (currentFontSize < 24) currentFontSize += 2;
        planningContent.style.fontSize = currentFontSize + 'px';
    });
    fontDecBtn.addEventListener('click', () => {
        if (currentFontSize > 11) currentFontSize -= 2;
        planningContent.style.fontSize = currentFontSize + 'px';
    });
}

function renderPlanningContent() {
    // Deprecated: Content is injected directly in openPlanningDrawer
}

function parseMarkdown(md) {
    if (!md) return '<p>No content available.</p>';
    
    let html = md;
    
    // Protect code blocks first
    let codeBlocks = [];
    html = html.replace(/```(?:[a-z]*)\n([\s\S]*?)```/gim, (match, code) => {
        codeBlocks.push(`<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Protect inline code
    let inlineCodes = [];
    html = html.replace(/`([^`]+)`/gim, (match, code) => {
        inlineCodes.push(`<code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`);
        return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" style="color:var(--accent); text-decoration:underline">$1</a>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // GitHub alerts
    html = html.replace(/> \[!([A-Z]+)\]\n((?:> .*\n?)+)/gim, (match, type, content) => {
        const cleanContent = content.replace(/^> /gm, '').trim();
        const lowerType = type.toLowerCase();
        return `<div class="github-alert ${lowerType}"><div class="github-alert-title">${type}</div><p>${cleanContent}</p></div>`;
    });

    // Checkbox lists (tasks)
    html = html.replace(/^- \[ \]/gim, '<li class="task-list-item"><input type="checkbox" disabled>');
    html = html.replace(/^- \[x\]/gi, '<li class="task-list-item"><input type="checkbox" checked disabled>');
    html = html.replace(/^- \[\/\]/gim, '<li class="task-list-item"><input type="checkbox" disabled style="opacity:0.5; accent-color: yellow"> <em>(In Progress)</em>');
    
    // Normal lists
    html = html.replace(/^- (?!\[)(.*$)/gim, '<li>$1</li>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');

    // Wrap in paragraphs
    let lines = html.split('\n');
    let htmlLines = [];
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line === '') {
            if (inList) { htmlLines.push('</ul>'); inList = false; }
            continue;
        }
        
        if (line.startsWith('<li')) {
            if (!inList) { htmlLines.push('<ul>'); inList = true; }
            htmlLines.push(line);
        } else if (line.startsWith('<h') || line.startsWith('<div') || line.startsWith('__CODE_BLOCK')) {
            if (inList) { htmlLines.push('</ul>'); inList = false; }
            htmlLines.push(line);
        } else {
            if (inList) { htmlLines.push('</ul>'); inList = false; }
            htmlLines.push('<p>' + line + '</p>');
        }
    }
    if (inList) htmlLines.push('</ul>');
    
    html = htmlLines.join('\n');

    // Restore inline codes
    for (let i = 0; i < inlineCodes.length; i++) {
        html = html.replace(`__INLINE_CODE_${i}__`, inlineCodes[i]);
    }

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
        html = html.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
    }

    return html;
}
