#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000; // 1 second
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';

// Security warning for default credentials
if (APP_PASSWORD === 'antigravity') {
    console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default APP_PASSWORD ("antigravity").');
    console.warn('\x1b[33m%s\x1b[0m', '   Set a strong APP_PASSWORD in your .env file for production use.\n');
}

// Note: hashString is defined later, so we'll initialize the token inside createServer or use a simple string for now.
let AUTH_TOKEN = 'ag_default_token';


// Shared CDP connection
let cdpConnection = null;
let lastSnapshot = null;
let lastSnapshotHash = null;
let cachedModels = [
    "Gemini 3.5 Flash (High)",
    "Gemini 3.5 Flash (Medium)",
    "Gemini 3.5 Flash (Low)",
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];
let modelsSynced = false;

// Kill any existing process on the server port (prevents EADDRINUSE)
function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            // Windows: Find PID using netstat and kill it
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        } else {
            // Linux/macOS: Use lsof and kill
            const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const pids = result.trim().split('\n').filter(p => p);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        }
        // Small delay to let the port be released
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        // No process found on port - this is fine
        return Promise.resolve();
    }
}

// Get local IP address for mobile access
// Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name: name,
                    // Prioritize common home/office network ranges
                    priority: iface.address.startsWith('192.168.') ? 1 :
                        iface.address.startsWith('10.') ? 2 :
                            iface.address.startsWith('172.') ? 3 : 4
                });
            }
        }
    }

    // Sort by priority and return the best one
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Helper: HTTP GET JSON
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function discoverCDP() {
    const errors = [];
    const portsToTry = [...PORTS];
    
    // Add macOS active port file to top priority
    try {
        const activePortFile = '/Users/mdaffanahmed/Library/Application Support/Antigravity/DevToolsActivePort';
        if (fs.existsSync(activePortFile)) {
            const content = fs.readFileSync(activePortFile, 'utf8');
            const port = parseInt(content.split('\\n')[0].trim(), 10);
            if (port && !portsToTry.includes(port)) {
                portsToTry.unshift(port);
            }
        }
    } catch (e) { }

    for (const port of portsToTry) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);

            // Priority 1: Page targets (usually where Agent mode lives)
            const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) {
                console.log('Found Agent page target:', page.title);
                return { port, url: page.webSocketDebuggerUrl };
            }

            // Priority 2: Standard Workbench (The main window)
            const workbench = list.find(t => t.url?.includes('workbench.html') || (t.title && t.title.includes('workbench')));
            if (workbench && workbench.webSocketDebuggerUrl) {
                console.log('Found Workbench target:', workbench.title);
                return { port, url: workbench.webSocketDebuggerUrl };
            }

            // Priority 3: Jetski/Launchpad (Fallback)
            const jetski = list.find(t => t.url?.includes('jetski') || t.title === 'Launchpad');
            if (jetski && jetski.webSocketDebuggerUrl) {
                console.log('Found Jetski/Launchpad target:', jetski.title);
                return { port, url: jetski.webSocketDebuggerUrl };
            }
        } catch (e) {
            errors.push(`${port}: ${e.message}`);
        }
    }
    const errorSummary = errors.length ? `Errors: ${errors.join(', ')}` : 'No ports responding';
    throw new Error(`CDP not found. ${errorSummary}`);
}

// Connect to CDP
async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map(); // Track pending calls by ID
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout

    // Single centralized message handler (fixes MaxListenersExceeded warning)
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle CDP method responses
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);

                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle execution context events
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const id = data.params.executionContextId;
                const idx = contexts.findIndex(c => c.id === id);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;

        // Setup timeout to prevent memory leaks from never-resolved calls
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts };
}

// Capture chat snapshot
// Capture agent chat snapshot
async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        // Target Agent Mode container exclusively - MUST check visibility to avoid hidden cached DOM nodes
        const cascades = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
        const cascade = cascades.find(el => el.offsetParent !== null) || cascades[cascades.length - 1];
        
        if (!cascade) {
            return { error: 'Agent container not found', debug: { active: false } };
        }
        
        const cascadeStyles = window.getComputedStyle(cascade);
        const scrollContainer = cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };
        
        // Clone cascade to modify it
        const clone = cascade.cloneNode(true);
        
        // Tag interactive elements so frontend can hook them
        // 1. Artifacts/Plans
        clone.querySelectorAll('[class*="implementation"], [class*="plan"], a[href*=".md"]').forEach(el => {
            el.classList.add('artifact-card');
        });
        
        // 2. Action Buttons (Allow/Deny/Review)
        clone.querySelectorAll('button, div[role="button"]').forEach(btn => {
            const text = (btn.innerText || '').trim();
            if (text === 'Allow') btn.classList.add('agent-allow-btn');
            if (text === 'Deny') btn.classList.add('agent-deny-btn');
            if (text === 'Review Changes') btn.classList.add('agent-review-btn');
        });

        // Remove input areas to keep UI clean (we have our own input)
        // IMPORTANT: Don't remove action buttons (Allow/Deny/Review) that were tagged above
        try {
            const interactionSelectors = [
                '[contenteditable="true"]',
                '[data-lexical-editor]',
                'form',
                // Only remove actual input-related elements, not anything with 'input' in class
                '[data-testid="chat-input"]',
                '[data-testid="message-input"]',
                '[data-testid*="input-area"]',
                // Remove Lexical placeholders that ghost after editor is removed
                '[class*="placeholder"]',
                '[class*="Placeholder"]',
                '.editor-placeholder',
                '[data-placeholder]'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    // Don't remove tagged action buttons
                    if (el.classList.contains('agent-allow-btn') || 
                        el.classList.contains('agent-deny-btn') || 
                        el.classList.contains('agent-review-btn')) return;
                    try { el.remove(); } catch(e) {}
                });
            });
        } catch (globalErr) { }

        // Convert local images to base64
        const images = clone.querySelectorAll('img');
        const promises = Array.from(images).map(async (img) => {
            const rawSrc = img.getAttribute('src');
            if (rawSrc && (rawSrc.startsWith('/') || rawSrc.startsWith('vscode-file:')) && !rawSrc.startsWith('data:')) {
                try {
                    const res = await fetch(rawSrc);
                    const blob = await res.blob();
                    await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => { img.src = reader.result; r(); };
                        reader.onerror = () => r();
                        reader.readAsDataURL(blob);
                    });
                } catch(e) {}
            }
        });
        await Promise.all(promises);

        // Fix inline file references (div inside p/span)
        try {
            const inlineTags = new Set(['SPAN', 'P', 'A', 'LABEL', 'EM', 'STRONG', 'CODE']);
            const allDivs = Array.from(clone.querySelectorAll('div'));
            for (const div of allDivs) {
                try {
                    if (!div.parentNode) continue;
                    const parent = div.parentElement;
                    if (!parent) continue;
                    
                    const parentIsInline = inlineTags.has(parent.tagName) || 
                        (parent.className && (parent.className.includes('inline-flex') || parent.className.includes('inline-block')));
                        
                    if (parentIsInline) {
                        const span = document.createElement('span');
                        while (div.firstChild) {
                            span.appendChild(div.firstChild);
                        }
                        if (div.className) span.className = div.className;
                        if (div.getAttribute('style')) span.setAttribute('style', div.getAttribute('style'));
                        span.style.display = 'inline-flex';
                        span.style.alignItems = 'center';
                        span.style.verticalAlign = 'middle';
                        div.replaceWith(span);
                    }
                } catch(e) {}
            }
        } catch(e) {}
        
        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
                }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        return {
            html: html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo: scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    // Try default context first (fastest)
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });

            if (result.result?.value && !result.result.value.error) {
                return result.result.value;
            }
        } catch (e) { }
    }

    // Fallback to all contexts
    for (const ctx of cdp.contexts) {
        if (ctx.id === defaultCtx?.id) continue;
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.result?.value && !result.result.value.error) {
                return result.result.value;
            }
        } catch (e) { }
    }

    return null;
}

// Capture sidebar state (active chats)
async function captureSidebar(cdp) {
    const SCRIPT = `(() => {
        const sidebar = document.querySelector('.bg-sidebar');
        if (!sidebar) return { error: 'Sidebar not found' };
        
        const sections = Array.from(sidebar.querySelectorAll('[class*="group/section"]'));
        const result = {
            projects: [],
            conversations: []
        };
        
        sections.forEach(sec => {
            const projectCard = sec.querySelector('[data-project-card="true"]');
            const projectTitleEl = projectCard || sec.querySelector('h2');
            let sectionName = '';
            if (projectTitleEl) {
                sectionName = (projectTitleEl.innerText || '').split('\\n')[0].trim();
            }
            
            const pills = Array.from(sec.querySelectorAll('[data-testid^="convo-pill-"]'));
            const chats = pills.map(pill => {
                const parent = pill.closest('div');
                const isActive = parent && (parent.className.includes('bg-sidebar-muted') || parent.className.includes('bg-accent'));
                return {
                    id: pill.getAttribute('data-testid').replace('convo-pill-', ''),
                    title: (pill.innerText || '').trim(),
                    isActive
                };
            });
            
            if (chats.length === 0) return;
            
            if (projectCard || (sectionName && sectionName !== 'Conversations')) {
                result.projects.push({
                    name: sectionName || 'Project',
                    chats
                });
            } else {
                result.conversations.push(...chats);
            }
        });
        
        // Fallback: If no section structure was parsed but there are convo-pills, put them in a flat list
        if (result.projects.length === 0 && result.conversations.length === 0) {
            const pills = Array.from(sidebar.querySelectorAll('[data-testid^="convo-pill-"]'));
            result.conversations = pills.map(pill => {
                const parent = pill.closest('div');
                const isActive = parent && (parent.className.includes('bg-sidebar-muted') || parent.className.includes('bg-accent'));
                return {
                    id: pill.getAttribute('data-testid').replace('convo-pill-', ''),
                    title: (pill.innerText || '').trim(),
                    isActive
                };
            });
        }
        
        return result;
    })()`;

    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) {}
    }
    return { projects: [], conversations: [] };
}

// Inject message into Antigravity
// Inject message into Antigravity
async function injectMessage(cdp, text, base64Image = null, waitMs = 1500) {
    let imageUrl = null;
    let textWithImage = text;

    if (base64Image) {
        try {
            const tempUploadsDir = join(__dirname, 'public', 'temp_uploads');
            if (!fs.existsSync(tempUploadsDir)) {
                fs.mkdirSync(tempUploadsDir, { recursive: true });
            }

            // Cleanup old files (> 24 hours)
            try {
                const files = fs.readdirSync(tempUploadsDir);
                const now = Date.now();
                for (const file of files) {
                    const filePath = join(tempUploadsDir, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                    }
                }
            } catch (err) {}

            const parts = base64Image.split(',');
            if (parts.length === 2) {
                const mimeMatch = parts[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                const ext = mime.split('/')[1] || 'png';
                const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
                const buffer = Buffer.from(parts[1], 'base64');
                fs.writeFileSync(join(tempUploadsDir, filename), buffer);
                imageUrl = `http://localhost:${SERVER_PORT}/temp_uploads/${filename}`;
                textWithImage = `${text}\n\n[Attached Image: ${imageUrl}]`;
            }
        } catch (e) {
            console.error('[injectMessage] Error saving temp image:', e);
        }
    }

    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(textWithImage);
    const safeImage = JSON.stringify(base64Image || '');

    const EXPRESSION = `(async () => {
        const logs = [];
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            return { ok:false, reason:"busy", logs };
        }

        const editors = [...document.querySelectorAll('[data-testid="conversation-view"] [contenteditable="true"], #conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"]')]
            .filter(el => el.offsetParent !== null);
        // Fallback: search entire document if scoped search finds nothing
        const allEditors = editors.length > 0 ? editors : [...document.querySelectorAll('[contenteditable="true"]')].filter(el => el.offsetParent !== null);
        const editor = allEditors.at(-1);
        if (!editor) {
            return { ok:false, error:"editor_not_found", logs };
        }
        logs.push("editor_found");

        const textToInsert = ${safeText};
        const imageToInsert = ${safeImage};

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);
        logs.push("editor_cleared");

        let inserted = false;
        if (textToInsert) {
            try { 
                inserted = !!document.execCommand?.("insertText", false, textToInsert); 
                logs.push("execCommand_insertText: " + inserted);
            } catch(err) {
                logs.push("execCommand_error: " + err.message);
            }
            if (!inserted) {
                editor.textContent = textToInsert;
                logs.push("textContent_fallback_set");
                // Only dispatch full InputEvents if we manually set textContent
                editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data: textToInsert }));
                editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
                logs.push("input_events_dispatched");
            } else {
                // If inserted naturally, just dispatch a generic input event so framework detects changes
                // without adding the text AGAIN via the data property.
                editor.dispatchEvent(new Event("input", { bubbles:true }));
            }
        }

        if (imageToInsert) {
            try {
                const parts = imageToInsert.split(',');
                if (parts.length === 2) {
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                    const bstr = atob(parts[1]);
                    let n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    while (n--) {
                        u8arr[n] = bstr.charCodeAt(n);
                    }
                    const blob = new Blob([u8arr], { type: mime });
                    const file = new File([blob], "image.png", { type: mime });
                    
                    const dt = new DataTransfer();
                    dt.items.add(file);

                    // 1. File Input method (Highly reliable for React web apps)
                    const fileInput = document.querySelector('input[type="file"]');
                    if (fileInput) {
                        fileInput.value = '';
                        fileInput.files = dt.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        logs.push("file_input_changed");
                    } else {
                        // 2. Try ClipboardEvent paste
                        const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
                        if (!pasteEvent.clipboardData) {
                            try { Object.defineProperty(pasteEvent, 'clipboardData', { value: dt, writable: false, configurable: true }); } catch(err) {}
                        }
                        editor.dispatchEvent(pasteEvent);
                        logs.push("paste_event_dispatched");
                    }
                }
            } catch(e) {
                logs.push("image_insert_error: " + e.message);
            }
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Wait significantly longer if there was an image, to ensure React finishes attaching/previewing it before we hit send
        if (imageToInsert) {
            await new Promise(r => setTimeout(r, ${waitMs}));
        }

        const submit = document.querySelector('[data-testid="send-button"], [data-tooltip-id="input-send-button-send-tooltip"], [aria-label="Send message"], svg.lucide-arrow-right')?.closest("button") || document.querySelector('[data-testid="send-button"], [data-tooltip-id="input-send-button-send-tooltip"], [aria-label="Send message"]');
        if (submit) {
            logs.push("submit_button_found");
            submit.disabled = false;
            submit.removeAttribute("disabled");
            submit.click();
            logs.push("submit_button_clicked");
            return { ok:true, method:"click_submit", logs };
        }

        // Submit button not found, but text is inserted - trigger Enter key
        logs.push("submit_button_not_found_dispatching_enter");
        const enterProps = { bubbles:true, cancelable:true, key:"Enter", code:"Enter", keyCode:13, which:13 };
        editor.dispatchEvent(new KeyboardEvent("keydown", enterProps));
        editor.dispatchEvent(new KeyboardEvent("keypress", enterProps));
        editor.dispatchEvent(new KeyboardEvent("keyup", enterProps));
        
        return { ok:true, method:"enter_keypress", logs };
    })()`;

    // Try default context first (fastest and prevents double-send)
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });

            if (result.exceptionDetails) {
                console.error('[CDP injectMessage] Exception in default context', defaultCtx.id, ':', result.exceptionDetails);
            }

            if (result.result && result.result.value) {
                if (result.result.value.error === "editor_not_found") {
                    // Editor not found in default context, let it fall back
                } else {
                    console.log(`[CDP injectMessage] Success in default context. Method: "${result.result.value.method}". Steps:`, result.result.value.logs);
                    return result.result.value;
                }
            }
        } catch (e) {
            console.error('[CDP injectMessage] Call failed for default context', defaultCtx.id, ':', e);
            // If the call failed because the context was navigated/destroyed, it means the submit action went through!
            if (e.message && (e.message.includes('Promise was collected') || e.message.includes('destroyed') || e.message.includes('ruined'))) {
                return { ok: true, method: "default_context_destroyed_on_submit" };
            }
        }
    }

    // Fallback to remaining contexts only if default failed/errored
    for (const ctx of cdp.contexts) {
        if (defaultCtx && ctx.id === defaultCtx.id) continue;
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.exceptionDetails) {
                console.error('[CDP injectMessage] Exception in fallback context', ctx.id, ':', result.exceptionDetails);
            }

            if (result.result && result.result.value) {
                if (result.result.value.error === "editor_not_found") {
                    continue;
                } else {
                    console.log(`[CDP injectMessage] Success in fallback context. Method: "${result.result.value.method}". Steps:`, result.result.value.logs);
                    return result.result.value;
                }
            }
        } catch (e) {
            console.error('[CDP injectMessage] Call failed for fallback context', ctx.id, ':', e);
            if (e.message && (e.message.includes('Promise was collected') || e.message.includes('destroyed') || e.message.includes('ruined'))) {
                return { ok: true, method: "fallback_context_destroyed_on_submit" };
            }
        }
    }

    return { ok: false, reason: "no_context" };
}

// Set functionality mode (Fast vs Planning)
async function setMode(cdp, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the current mode indicator.
            // It will have text 'Fast' or 'Planning'.
            // It might not be a <button>, could be a <div> with cursor-pointer.
            
            // 1. Get all elements with text 'Fast' or 'Planning'
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have single text node child to avoid parents
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });

            // 2. Find the one that looks interactive (cursor-pointer)
            // Traverse up from text node to find clickable container
            let modeBtn = null;
            
            for (const el of candidates) {
                let current = el;
                // Go up max 4 levels
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current;
                        break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }

            if (!modeBtn) return { error: 'Mode indicator/button not found' };

            // Check if already set
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };

            // 3. Click to open menu
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 4. Find the dialog
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            
            // Fallback: Just look for any new visible container if role=dialog is missing
            if (!visibleDialog) {
                // Maybe it's not role=dialog? Look for a popover-like div
                 visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText.includes('${mode}') &&
                               !d.innerText.includes('Files With Changes'); // Anti-context menu
                    });
            }

            if (!visibleDialog) return { error: 'Dropdown not opened or options not visible' };

            // 5. Click the option
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${mode}'
            );

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }
            
            return { error: 'Mode option text not found in dialog. Dialog text: ' + visibleDialog.innerText.substring(0, 50) };

        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Stop Generation
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        // Look for the cancel button
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            cancel.click();
            return { success: true };
        }
        
        // Fallback: Look for a square icon in the send button area
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Click Element (Remote)
async function clickElement(cdp, { selector, index = 0, textContent }) {
    const safeText = JSON.stringify(textContent || '');
    const safeIndex = Number(index) || 0;

    const EXP = `(async () => {
        try {
            // Search the full document first — sidebar pills, action buttons, etc. live outside chat containers
            let elements = Array.from(document.querySelectorAll('${selector}')).filter(el => el.offsetParent !== null);
            
            // If nothing found at document level, also try shadow DOM roots
            if (elements.length === 0) {
                document.querySelectorAll('*').forEach(el => {
                    try {
                        if (el.shadowRoot) {
                            elements = elements.concat(Array.from(el.shadowRoot.querySelectorAll('${selector}')).filter(e => e.offsetParent !== null));
                        }
                    } catch(e) {}
                });
            }
            
            const filterText = ${safeText};
            if (filterText) {
                elements = elements.filter(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const firstLine = txt.split('\\n')[0].trim();
                    // Match if first line matches (thought blocks) or if it contains the label (buttons)
                    return firstLine === filterText || txt.includes(filterText);
                });
                
                // CRITICAL: If elements are nested (e.g. <div><span>Text</span></div>), 
                // both will match. We only want the most specific (inner-most) one.
                elements = elements.filter(el => {
                    return !elements.some(other => other !== el && el.contains(other));
                });
            }

            const idx = ${safeIndex};
            const target = elements[idx];

            if (target) {
                // Focus and Click
                if (target.focus) target.focus();
                target.click();
                return { success: true, found: elements.length, indexUsed: idx };
            }
            
            return { error: 'Element not found at index ' + idx + ' among ' + elements.length + ' matches', selector: '${selector}', filterText: filterText };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
            // If we found it but click didn't return success (unlikely with this script), continue to next context
        } catch (e) { }
    }
    return { error: 'Click failed in all contexts or element not found at index' };
}

// Remote scroll - sync phone scroll to desktop
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const convViews = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
            const convView = convViews.find(el => el.offsetParent !== null) || convViews[convViews.length - 1];
            const scrollables = [...document.querySelectorAll('[data-testid="conversation-view"] [class*="scroll"], #conversation [class*="scroll"], #chat [class*="scroll"], #cascade [class*="scroll"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('[data-testid="conversation-view"] .overflow-y-auto, [data-testid="conversation-view"] [data-scroll-area]') ||
                document.querySelector('#conversation .overflow-y-auto, #chat .overflow-y-auto, #cascade .overflow-y-auto');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main container element
                const cascade = convView || document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}

// Set AI Model
async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
            // STRATEGY: Multi-layered approach to find and click the model selector
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];
            
            let modelBtn = null;
            
            // Strategy 1: Look for data-tooltip-id patterns (most reliable)
            modelBtn = document.querySelector('[data-tooltip-id*="model"], [data-tooltip-id*="provider"]');
            
            // Strategy 2: Look for buttons/elements containing model keywords with SVG icons
            if (!modelBtn) {
                const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                    .filter(el => {
                        const txt = el.innerText?.trim() || '';
                        return KNOWN_KEYWORDS.some(k => txt.includes(k)) && el.offsetParent !== null;
                    });

                // Find the best one (has chevron icon or cursor pointer)
                modelBtn = candidates.find(el => {
                    const style = window.getComputedStyle(el);
                    const hasSvg = el.querySelector('svg.lucide-chevron-up') || 
                                   el.querySelector('svg.lucide-chevron-down') || 
                                   el.querySelector('svg[class*="chevron"]') ||
                                   el.querySelector('svg');
                    return (style.cursor === 'pointer' || el.tagName === 'BUTTON') && hasSvg;
                }) || candidates[0];
            }
            
            // Strategy 3: Traverse from text nodes up to clickable parents
            if (!modelBtn) {
                const allEls = Array.from(document.querySelectorAll('*'));
                const textNodes = allEls.filter(el => {
                    if (el.children.length > 0) return false;
                    const txt = el.textContent;
                    return KNOWN_KEYWORDS.some(k => txt.includes(k));
                });

                for (const el of textNodes) {
                    let current = el;
                    for (let i = 0; i < 5; i++) {
                        if (!current) break;
                        if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                            modelBtn = current;
                            break;
                        }
                        current = current.parentElement;
                    }
                    if (modelBtn) break;
                }
            }

            if (!modelBtn) return { error: 'Model selector button not found' };

            // Click to open menu
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // Find the dialog/dropdown - search globally (React portals render at body level)
            let visibleDialog = null;
            
            // Try specific dialog patterns first
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'));
            visibleDialog = dialogs.find(d => d.offsetHeight > 0 && d.innerText?.includes('${modelName}'));
            
            // Fallback: look for positioned divs
            if (!visibleDialog) {
                visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText?.includes('${modelName}') && 
                               !d.innerText?.includes('Files With Changes');
                    });
            }

            if (!visibleDialog) {
                // Blind search across entire document as last resort
                const allElements = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'));
                const target = allElements.find(el => 
                    el.offsetParent !== null && 
                    (el.innerText?.trim() === '${modelName}' || el.innerText?.includes('${modelName}'))
                );
                if (target) {
                    target.click();
                    return { success: true, method: 'blind_search' };
                }
                return { error: 'Model list not opened' };
            }

            // Select specific model inside the dialog
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const validEls = allDialogEls.filter(el => el.children.length === 0 && el.textContent?.trim().length > 0);
            
            // A. Exact Match (Best)
            let target = validEls.find(el => el.textContent.trim() === '${modelName}');
            
            // B. Page contains Model
            if (!target) {
                target = validEls.find(el => el.textContent.includes('${modelName}'));
            }

            // C. Closest partial match
            if (!target) {
                const partialMatches = validEls.filter(el => '${modelName}'.includes(el.textContent.trim()));
                if (partialMatches.length > 0) {
                    partialMatches.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length);
                    target = partialMatches[0];
                }
            }

            if (target) {
                target.scrollIntoView({block: 'center'});
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }

            return { error: 'Model "${modelName}" not found in list. Visible: ' + visibleDialog.innerText.substring(0, 100) };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Sync available models from Antigravity by briefly opening the model selector dropdown
async function syncModelsFromCDP(cdp) {
    if (!cdp || !cdp.contexts || cdp.contexts.length === 0) return null;
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    if (!defaultCtx) return null;

    const EXP = `(async () => {
        try {
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT"];
            
            // Find model button specifically outside the sidebar
            const modelBtn = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'))
                .find(el => {
                    if (el.closest('.bg-sidebar, [role="navigation"], [data-testid="sidebar-drawer"]')) return false;
                    const text = el.innerText || '';
                    return KNOWN_KEYWORDS.some(k => text.includes(k)) && el.offsetParent !== null;
                });

            if (!modelBtn) return { error: 'Model button not found' };

            // Check if dropdown is already open
            let isAlreadyOpen = !!document.querySelector('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]');
            
            if (!isAlreadyOpen) {
                modelBtn.click();
                await new Promise(r => setTimeout(r, 600));
            }

            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'))
                .find(d => d.offsetHeight > 0);

            let models = [];
            if (visibleDialog) {
                const options = Array.from(visibleDialog.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"]'));
                if (options.length > 0) {
                    models = options.map(el => el.innerText.trim().split('\\n')[0].trim()).filter(Boolean);
                } else {
                    const leaves = Array.from(visibleDialog.querySelectorAll('*'))
                        .filter(el => el.children.length === 0 && el.innerText?.trim());
                    const seen = new Set();
                    for (const el of leaves) {
                        const txt = el.innerText.trim().split('\\n')[0].trim();
                        if (KNOWN_KEYWORDS.some(k => txt.includes(k)) && txt.length < 50 && !seen.has(txt)) {
                            seen.add(txt);
                            models.push(txt);
                        }
                    }
                }
            } else {
                const options = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
                    .filter(el => el.offsetParent !== null);
                models = options.map(el => el.innerText.trim().split('\\n')[0].trim()).filter(Boolean);
            }

            if (!isAlreadyOpen) {
                modelBtn.click();
                await new Promise(r => setTimeout(r, 200));
                document.body.click();
            }

            models = Array.from(new Set(models))
                .filter(m => KNOWN_KEYWORDS.some(k => m.includes(k)) && m.length < 50);

            return { models };
        } catch(err) {
            return { error: err.toString() };
        }
    })()`;

    try {
        const res = await cdp.call("Runtime.evaluate", {
            expression: EXP,
            returnByValue: true,
            awaitPromise: true,
            contextId: defaultCtx.id
        });
        if (res.result?.value && !res.result.value.error && res.result.value.models) {
            return res.result.value.models;
        }
        if (res.result?.value?.error) {
            console.warn(`[SYNC-MODELS] CDP returned error: ${res.result.value.error}`);
        }
    } catch (e) {
        console.warn(`[SYNC-MODELS] Failed to sync models via CDP: ${e.message}`);
    }
    return null;
}

// Start New Chat - Click the + button at the TOP of the chat window (NOT the context/media + button)
async function startNewChat(cdp) {
    const EXP = `(async () => {
        try {
            // Priority 1: Exact selector from user (data-tooltip-id="new-conversation-tooltip")
            const exactBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (exactBtn) {
                exactBtn.click();
                return { success: true, method: 'data-tooltip-id' };
            }

            // Fallback: Use previous heuristics
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            
            // Find all buttons with plus icons
            const plusButtons = allButtons.filter(btn => {
                if (btn.offsetParent === null) return false; // Skip hidden
                const hasPlusIcon = btn.querySelector('svg.lucide-plus') || 
                                   btn.querySelector('svg.lucide-square-plus') ||
                                   btn.querySelector('svg[class*="plus"]');
                return hasPlusIcon;
            });
            
            // Filter only top buttons (toolbar area)
            const topPlusButtons = plusButtons.filter(btn => {
                const rect = btn.getBoundingClientRect();
                return rect.top < 200;
            });

            if (topPlusButtons.length > 0) {
                 topPlusButtons.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                 topPlusButtons[0].click();
                 return { success: true, method: 'filtered_top_plus', count: topPlusButtons.length };
            }
            
            // Fallback: aria-label
             const newChatBtn = allButtons.find(btn => {
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                const title = btn.getAttribute('title')?.toLowerCase() || '';
                return (ariaLabel.includes('new') || title.includes('new')) && btn.offsetParent !== null;
            });
            
            if (newChatBtn) {
                newChatBtn.click();
                return { success: true, method: 'aria_label_new' };
            }
            
            return { error: 'New chat button not found' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Start New Chat in a Specific Project
async function startNewProjectChat(cdp, projectName) {
    const EXP = `(async () => {
        try {
            const sidebar = document.querySelector('.bg-sidebar');
            if (!sidebar) return { error: 'Sidebar not found' };
            
            const sections = Array.from(sidebar.querySelectorAll('[class*="group/section"]'));
            for (const sec of sections) {
                const projectCard = sec.querySelector('[data-project-card="true"]');
                const projectTitleEl = projectCard || sec.querySelector('h2');
                let sectionName = '';
                if (projectTitleEl) {
                    sectionName = (projectTitleEl.innerText || '').split('\\n')[0].trim();
                }
                
                if (sectionName === ${JSON.stringify(projectName)}) {
                    const buttons = Array.from(sec.querySelectorAll('button, [role="button"], a'));
                    const plusBtn = buttons.find(btn => {
                        if (btn.offsetParent === null) return false;
                        return btn.querySelector('svg.lucide-plus') || 
                               btn.querySelector('svg.lucide-square-plus') ||
                               btn.querySelector('svg[class*="plus"]') ||
                               (btn.getAttribute('aria-label') || '').toLowerCase().includes('new');
                    });
                    
                    if (plusBtn) {
                        plusBtn.click();
                        return { success: true, method: 'project-plus-btn' };
                    }
                }
            }
            return { error: 'Project or new chat button not found' };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Get Chat History - Click history button and scrape conversations
async function getChatHistory(cdp) {
    const EXP = `(async () => {
        try {
            const chats = [];
            const seenTitles = new Set();

            // Priority 1: Look for tooltip ID pattern (history/past/recent)
            let historyBtn = document.querySelector('[data-tooltip-id*="history"], [data-tooltip-id*="past"], [data-tooltip-id*="recent"], [data-tooltip-id*="conversation-history"]');
            
            // Priority 2: Look for button ADJACENT to the new chat button
            if (!historyBtn) {
                const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
                if (newChatBtn) {
                    const parent = newChatBtn.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(el => el !== newChatBtn);
                        historyBtn = siblings.find(el => el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
                    }
                }
            }

            // Fallback: Use previous heuristics (icon/aria-label)
            if (!historyBtn) {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[data-tooltip-id]'));
                for (const btn of allButtons) {
                    if (btn.offsetParent === null) continue;
                    const hasHistoryIcon = btn.querySelector('svg.lucide-clock') ||
                                           btn.querySelector('svg.lucide-history') ||
                                           btn.querySelector('svg.lucide-folder') ||
                                           btn.querySelector('svg[class*="clock"]') ||
                                           btn.querySelector('svg[class*="history"]');
                    if (hasHistoryIcon) {
                        historyBtn = btn;
                        break;
                    }
                }
            }
            
            if (!historyBtn) {
                return { error: 'History button not found', chats: [] };
            }

            // Click and Wait
            historyBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            
            // Find the side panel
            let panel = null;
            let inputsFoundDebug = [];
            
            // Strategy 1: The search input has specific placeholder
            let searchInput = null;
            const inputs = Array.from(document.querySelectorAll('input'));
            searchInput = inputs.find(i => {
                const ph = (i.placeholder || '').toLowerCase();
                return ph.includes('select') || ph.includes('conversation');
            });
            
            // Strategy 2: Look for any text input that looks like a search bar (based on user snippet classes)
            if (!searchInput) {
                const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
                inputsFoundDebug = allInputs.map(i => 'ph:' + i.placeholder + ', cls:' + i.className);
                
                searchInput = allInputs.find(i => 
                    i.offsetParent !== null && 
                    (i.className.includes('w-full') || i.classList.contains('w-full'))
                );
            }
            
            // Strategy 3: Find known text in the panel (Anchor Text Strategy)
            let anchorElement = null;
            if (!searchInput) {
                 const allSpans = Array.from(document.querySelectorAll('span, div, p'));
                 anchorElement = allSpans.find(s => {
                     const t = (s.innerText || '').trim();
                     return t === 'Current' || t === 'Refining Chat History Scraper'; // specific known title
                 });
            }

            const startElement = searchInput || anchorElement;

            if (startElement) {
                // Walk up to find the panel container
                let container = startElement;
                for (let i = 0; i < 15; i++) { 
                    if (!container.parentElement) break;
                    container = container.parentElement;
                    const rect = container.getBoundingClientRect();
                    
                    // Panel should have good dimensions
                    // Relaxed constraints for mobile
                    if (rect.width > 50 && rect.height > 100) {
                        panel = container;
                        
                        // If it looks like a modal/popover (fixed or absolute pos), that's definitely it
                        const style = window.getComputedStyle(container);
                        if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 10) {
                            break;
                        }
                    }
                }
                
                // Fallback if loop finishes without specific break
                if (!panel && startElement) {
                     // Just go up 4 levels
                     let p = startElement;
                     for(let k=0; k<4; k++) { if(p.parentElement) p = p.parentElement; }
                     panel = p;
                }
            }
            
            const debugInfo = { 
                panelFound: !!panel, 
                panelWidth: panel?.offsetWidth || 0,
                inputFound: !!searchInput,
                anchorFound: !!anchorElement,
                inputsDebug: inputsFoundDebug.slice(0, 5)
            };
            
            if (panel) {
                // Chat titles are in <span> elements
                const spans = Array.from(panel.querySelectorAll('span'));
                
                // Section headers and workspace labels to skip
                const SKIP_EXACT = new Set([
                    'current', 'other conversations', 'now',
                    'projects', 'personal', 'workspace', 'default', 'phone connect antigravity'
                ]);
                
                for (const span of spans) {
                    const text = span.textContent?.trim() || '';
                    const lower = text.toLowerCase();
                    
                    // Skip empty or too short
                    if (text.length < 3) continue;

                    // Sibling-span heuristic: skip tag/badge labels (like workspaces)
                    // If a short span has a longer sibling span, it's likely a tag next to the actual title
                    if (text.length < 40 && span.parentElement) {
                        let hasLongerSiblingSpan = false;
                        for (const child of span.parentElement.children) {
                            if (child !== span && child.tagName === 'SPAN') {
                                const childTextLength = (child.textContent?.trim() || '').length;
                                if (childTextLength > text.length) {
                                    hasLongerSiblingSpan = true;
                                    break;
                                }
                            }
                        }
                        if (hasLongerSiblingSpan) continue;
                    }
                    
                    // Skip section headers
                    if (SKIP_EXACT.has(lower)) continue;
                    if (lower.startsWith('recent in ')) continue;
                    if (lower.startsWith('show ') && lower.includes('more')) continue;
                    
                    // Skip timestamps
                    if (lower.endsWith(' ago') || /^\\d+\\s*(sec|min|hr|day|wk|mo|yr)/i.test(lower)) continue;
                    
                    // Skip very long text (containers)
                    if (text.length > 100) continue;
                    
                    // Skip duplicates
                    if (seenTitles.has(text)) continue;
                    
                    seenTitles.add(text);
                    chats.push({ title: text, date: 'Recent' });
                    
                    if (chats.length >= 50) break;
                }
            }
            
            // Note: Panel is left open on PC as requested ("launch history on pc")

            return { success: true, chats: chats, debug: debugInfo };
        } catch(e) {
            return { error: e.toString(), chats: [] };
        }
    })()`;

    let lastError = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
            // If result.value is null/undefined but no error thrown, check exceptionDetails
            if (res.exceptionDetails) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: 'Context failed: ' + (lastError || 'No contexts available'), chats: [] };
}

async function selectChat(cdp, chatTitle) {
    const safeChatTitle = JSON.stringify(chatTitle);

    const EXP = `(async () => {
        try {
            const targetTitle = ${safeChatTitle};
            let debugInfo = [];
            const log = (msg) => debugInfo.push(msg);
            log('Starting selectChat for: ' + targetTitle);

            // 1. Open History Panel (same robust method style as getChatHistory)
            let historyBtn = document.querySelector('[data-tooltip-id="history-tooltip"]');
            
            if (!historyBtn) {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
                
                // Try icon first
                historyBtn = allButtons.find(btn => {
                    if (btn.offsetParent === null) return false;
                    return btn.querySelector('svg.lucide-clock') ||
                        btn.querySelector('svg.lucide-history') ||
                        btn.querySelector('svg.lucide-folder') ||
                        btn.querySelector('svg.lucide-clock-rotate-left');
                });
                
                // Try position strategy (second button near new chat)
                if (!historyBtn) {
                    const topButtons = allButtons.filter(btn => {
                        if (btn.offsetParent === null) return false;
                        const rect = btn.getBoundingClientRect();
                        return rect.top < 100 && rect.top > 0;
                    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                    
                    if (topButtons.length >= 2) historyBtn = topButtons[1];
                }
            }

            if (!historyBtn) return { error: 'History button not found', debug: debugInfo };

            historyBtn.click();
            log('Clicked history button');

            // 2. Wait-for-visible polling (up to 3s)
            let panel = null;
            let panelFound = false;
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 200));

                const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
                const searchInput = inputs.find(input =>
                    input.offsetParent !== null &&
                    (input.placeholder?.toLowerCase().includes('select') ||
                     input.placeholder?.toLowerCase().includes('conversation') ||
                     input.className.includes('w-full'))
                );

                const allSpans = Array.from(document.querySelectorAll('span, div, p'));
                const anchorSpan = allSpans.find(s => s.offsetParent !== null && (s.innerText || '').trim() === 'Current');

                const anchor = searchInput || anchorSpan;
                if (anchor) {
                    let container = anchor;
                    for (let j = 0; j < 15; j++) {
                        if (!container) break;
                        const rect = container.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 100) {
                            const style = window.getComputedStyle(container);
                            if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 10) {
                                panel = container;
                                panelFound = true;
                                break;
                            }
                        }
                        container = container.parentElement;
                    }
                }
                if (panelFound) break;
            }

            if (!panelFound) return { error: 'History panel did not open', debug: debugInfo };
            log('Panel found');

            // Give panel a bit more time to render list items
            await new Promise(r => setTimeout(r, 300));

            // 3. Scored fuzzy matching
            let candidates = Array.from(panel.querySelectorAll('span, p, div'))
                .filter(el => {
                    const text = el.textContent?.trim() || '';
                    return text.length >= 3 && el.children.length === 0 && el.offsetParent !== null;
                })
                .map(el => {
                    const text = el.textContent.trim();
                    const targetLower = targetTitle.toLowerCase();
                    const textLower = text.toLowerCase();

                    let score = 0;
                    if (text === targetTitle) score += 100;
                    else if (textLower === targetLower) score += 90;
                    else if (text.includes(targetTitle)) score += 60;
                    else if (textLower.includes(targetLower)) score += 50;
                    else if (targetLower.includes(textLower)) score += 40;
                    else if (textLower.startsWith(targetLower.substring(0, Math.min(20, targetLower.length)))) score += 30;

                    // Penalty for tiny labels/tags
                    if (text.length < 5) score -= 10;

                    // Bonus for deeper nodes (usually more specific)
                    let depth = 0;
                    let p = el;
                    while (p) { depth++; p = p.parentElement; }
                    score += depth;

                    return { el, text, score };
                })
                .filter(c => c.score >= 30)
                .sort((a, b) => b.score - a.score);

            if (candidates.length === 0) return { error: 'Chat title not found in panel', title: targetTitle, debug: debugInfo };

            log('Found ' + candidates.length + ' candidates. Best match: "' + candidates[0].text + '" (Score: ' + candidates[0].score + ')');

            // 4. Click execution with MouseEvent fallback
            const executeClick = (targetEl) => {
                let clickable = targetEl;
                let foundClickable = false;

                for (let i = 0; i < 5; i++) {
                    if (!clickable) break;
                    const style = window.getComputedStyle(clickable);
                    if (style.cursor === 'pointer' || clickable.tagName === 'BUTTON' || clickable.onclick) {
                        foundClickable = true;
                        break;
                    }
                    if (clickable.parentElement) clickable = clickable.parentElement;
                }

                const finalTarget = foundClickable ? clickable : targetEl;
                finalTarget.click();

                try {
                    const rect = finalTarget.getBoundingClientRect();
                    const centerX = rect.left + (rect.width / 2);
                    const centerY = rect.top + (rect.height / 2);
                    const events = ['mousedown', 'mouseup', 'click'];
                    events.forEach(type => {
                        finalTarget.dispatchEvent(new MouseEvent(type, {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: centerX,
                            clientY: centerY,
                            button: 0
                        }));
                    });
                } catch (e) {
                    log('MouseEvent fallback failed: ' + e.message);
                }
            };

            executeClick(candidates[0].el);
            log('Executed click on candidate 0');

            // 5. Verify/retry if panel still open
            await new Promise(r => setTimeout(r, 1500));
            const isPanelStillOpen = panel.offsetParent !== null && panel.style.display !== 'none' && panel.getBoundingClientRect().height > 0;

            if (isPanelStillOpen && candidates.length > 1) {
                log('Panel still open, retrying with candidate 1: "' + candidates[1].text + '"');
                executeClick(candidates[1].el);
                await new Promise(r => setTimeout(r, 1000));
            }

            // Ensure panel closes
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));

            return { success: true, method: 'heuristic_click', bestMatch: candidates[0].text, retried: isPanelStillOpen, debug: debugInfo };
        } catch (e) {
            return { error: 'JS Exception: ' + e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Close History Panel (Escape)
async function closeHistory(cdp) {
    const EXP = `(async () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', bubbles: true }));
            return { success: true };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Failed to close history panel' };
}

// Check if a chat is currently open (has cascade element)
async function hasChatOpen(cdp) {
    const EXP = `(() => {
    const chatContainers = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
    let chatContainer = chatContainers.find(el => el.offsetParent !== null) || chatContainers[chatContainers.length - 1];
    if (!chatContainer) chatContainer = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
    const hasMessages = chatContainer && chatContainer.querySelectorAll('[class*="message"], [data-message]').length > 0;
    const editorFound = !!document.querySelector('[contenteditable="true"]');
    return {
        hasChat: !!chatContainer,
        hasMessages: hasMessages,
        editorFound: editorFound
    };
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { hasChat: false, hasMessages: false, editorFound: false };
}

// Get Right Pane Snapshot
async function getRightPaneSnapshot(cdp) {
    const EXP = `(() => {
        try {
            const chat = document.querySelector('[data-testid="conversation-view"]');
            if (!chat) return '<div style="padding: 20px; color: #94a3b8; text-align: center;">No active chat view found.</div>';
            
            let rightPane = null;
            
            // 1. Try explicit IDs often used in AG
            const explicit = document.querySelector('[data-testid*="artifact"], [data-testid*="right-panel"], [data-testid*="review"]');
            if (explicit && explicit.offsetParent) {
                rightPane = explicit;
            } else {
                // 2. Heuristic search: Find a large container on the right side of the screen
                const allElements = Array.from(document.querySelectorAll('div, aside, section, main'));
                const candidates = allElements.filter(el => {
                    if (!el.offsetParent) return false;
                    const rect = el.getBoundingClientRect();
                    // Must be reasonably large
                    if (rect.width < 200 || rect.height < 200) return false;
                    // Center of the element must be on the right half of the screen
                    if (rect.left + (rect.width / 2) < window.innerWidth / 2) return false;
                    // It should not wrap the entire screen
                    if (rect.width > window.innerWidth * 0.9) return false;
                    // It should not be the conversation view itself or its parent
                    if (el === chat || el.contains(chat) || chat.contains(el)) return false;
                    return true;
                });
                
                if (candidates.length > 0) {
                    // Sort by area (smallest first) to get the most specific container
                    candidates.sort((a, b) => {
                        const aRect = a.getBoundingClientRect();
                        const bRect = b.getBoundingClientRect();
                        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
                    });
                    rightPane = candidates[0];
                }
            }
            
            if (!rightPane) {
                return '<div style="padding: 20px; color: #94a3b8; text-align: center; margin-top: 50px;">Right pane is not open on desktop.</div>';
            }
            
            const clone = rightPane.cloneNode(true);
            
            // Strip hidden elements to save payload
            clone.querySelectorAll('*').forEach(el => {
                if (el.style && el.style.display === 'none') {
                    el.remove();
                }
            });
            
            return clone.innerHTML;
        } catch (e) {
            return '<div style="padding: 20px; color: #ef4444;">Error capturing pane: ' + e.message + '</div>';
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result && res.result.value) {
                return { hasFiles: true, html: res.result.value };
            }
        } catch (e) { }
    }
    
    return { hasFiles: false, html: '' };
}

// Get App State (Mode & Model)
async function getAppState(cdp) {
    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown' };

        // 1. Get Mode (Fast/Planning)
        // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
        // It's usually a button or div with cursor:pointer containing the mode text
        const allEls = Array.from(document.querySelectorAll('*'));

        // Find elements that are likely mode buttons
        for (const el of allEls) {
            if (el.children.length > 0) continue;
            const text = (el.innerText || '').trim();
            if (text !== 'Fast' && text !== 'Planning') continue;

            // Check if this or a parent is clickable (the actual mode selector)
            let current = el;
            for (let i = 0; i < 5; i++) {
                if (!current) break;
                const style = window.getComputedStyle(current);
                if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                    state.mode = text;
                    break;
                }
                current = current.parentElement;
            }
            if (state.mode !== 'Unknown') break;
        }

        // Fallback: Just look for visible text
        if (state.mode === 'Unknown') {
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
            else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
        }

        // 2. Get Model
        // Strategy: Look for leaf text nodes containing a known model keyword
        const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
        const textNodes2 = allEls.filter(el => el.children.length === 0 && el.innerText);
        
        // First try: find inside a clickable parent (button, cursor:pointer)
        let modelEl = textNodes2.find(el => {
            const txt = el.innerText.trim();
            if (!KNOWN_MODELS.some(k => txt.includes(k))) return false;
            // Must be in a clickable context (header/toolbar, not chat content)
            let parent = el;
            for (let i = 0; i < 8; i++) {
                if (!parent) break;
                if (parent.tagName === 'BUTTON' || window.getComputedStyle(parent).cursor === 'pointer') return true;
                parent = parent.parentElement;
            }
            return false;
        });
        
        // Fallback: any leaf node with a known model name
        if (!modelEl) {
            modelEl = textNodes2.find(el => {
                const txt = el.innerText.trim();
                return KNOWN_MODELS.some(k => txt.includes(k)) && txt.length < 60;
            });
        }

        if (modelEl) {
            state.model = modelEl.innerText.trim();
        }

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Simple hash function
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// Check if a request is from the same Wi-Fi (internal network)
function isLocalRequest(req) {
    // 1. Check for proxy headers (Cloudflare, ngrok, etc.)
    // If these exist, the request is coming via an external tunnel/proxy
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) {
        return false;
    }

    // 2. Check the remote IP address
    const ip = req.ip || req.socket.remoteAddress || '';

    // Standard local/private IPv4 and IPv6 ranges
    return ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.2') || ip.startsWith('172.3') ||
        ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.');
}

// Initialize CDP connection
async function initCDP() {
    console.log('🔍 Discovering Antigravity CDP endpoint...');
    const cdpInfo = await discoverCDP();
    console.log(`✅ Found Antigravity on port ${cdpInfo.port} `);

    console.log('🔌 Connecting to CDP...');
    cdpConnection = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected! Found ${cdpConnection.contexts.length} execution contexts\n`);
}

// Background polling
async function startPolling(wss) {
    let lastErrorLog = 0;
    let isConnecting = false;

    const poll = async () => {
        if (!cdpConnection || (cdpConnection.ws && cdpConnection.ws.readyState !== WebSocket.OPEN)) {
            if (!isConnecting) {
                console.log('🔍 Looking for Antigravity CDP connection...');
                isConnecting = true;
            }
            if (cdpConnection) {
                console.log('🔄 CDP connection lost. Attempting to reconnect...');
                cdpConnection = null;
            }
            try {
                await initCDP();
                if (cdpConnection) {
                    console.log('✅ CDP Connection established from polling loop');
                    isConnecting = false;
                }
            } catch (err) {}
            setTimeout(poll, 2000);
            return;
        }

        try {
            const snapshot = await captureSnapshot(cdpConnection);
            const sidebar = await captureSidebar(cdpConnection);
            
            if (snapshot && !snapshot.error) {
                snapshot.sidebar = sidebar; // Attach sidebar data to snapshot
                const hash = hashString(snapshot.html + JSON.stringify(sidebar));

                if (hash !== lastSnapshotHash) {
                    lastSnapshot = snapshot;
                    lastSnapshotHash = hash;

                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'snapshot_update',
                                timestamp: new Date().toISOString()
                            }));
                        }
                    });
                }
            } else {
                const now = Date.now();
                if (!lastErrorLog || now - lastErrorLog > 10000) {
                    const errorMsg = snapshot?.error || 'No valid snapshot captured (check contexts)';
                    console.warn(`⚠️  Snapshot capture issue: ${errorMsg} `);
                    lastErrorLog = now;
                }
            }
        } catch (err) {
            console.error('Poll error:', err.message);
        }


        setTimeout(poll, POLL_INTERVAL);
    };

    poll();
}

// Create Express app
async function createServer() {
    const app = express();

    // Check for SSL certificates
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });

    // Initialize Auth Token using a unique salt from environment
    const authSalt = process.env.AUTH_SALT || 'antigravity_default_salt_99';
    AUTH_TOKEN = hashString(APP_PASSWORD + authSalt);

    app.use(compression());
    app.use(express.json({ limit: '10mb' }));

    // Use a secure session secret from .env if available
    const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';

    if (sessionSecret === 'antigravity_secret_key_1337') {
        console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default SESSION_SECRET ("antigravity_secret_key_1337").');
        console.warn('\x1b[33m%s\x1b[0m', '   Set a strong SESSION_SECRET in your .env file for production use.\n');
    }
    app.use(cookieParser(sessionSecret));

    // Ngrok Bypass Middleware
    app.use((req, res, next) => {
        // Tell ngrok to skip the "visit" warning for API requests
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // Auth Middleware
    app.use((req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/')) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[AUTH_COOKIE_NAME];
        if (token === AUTH_TOKEN) {
            return next();
        }

        // If it's an API request, return 401, otherwise redirect to login
        if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/snapshot') || req.path.startsWith('/send')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    });

    app.use(express.static(join(__dirname, 'public')));

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.json({ success: true });
    });

    // Get current snapshot
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(lastSnapshot);
    });

    // Debug: View raw snapshot HTML in browser
    app.get('/debug-snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).send('No snapshot yet');
        }
        const htmlLen = lastSnapshot.html ? lastSnapshot.html.length : 0;
        const first500 = lastSnapshot.html ? lastSnapshot.html.substring(0, 2000) : 'NO HTML';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<html><body style="background:#111;color:#eee;font-family:monospace;padding:20px;">
            <h2>Snapshot Debug</h2>
            <p>HTML length: ${htmlLen} chars</p>
            <p>Stats: ${JSON.stringify(lastSnapshot.stats)}</p>
            <h3>First 2000 chars of HTML:</h3>
            <pre style="white-space:pre-wrap;word-break:break-all;border:1px solid #444;padding:10px;max-height:400px;overflow:auto;">${first500.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            <h3>Rendered HTML:</h3>
            <div style="border:2px solid #f00;padding:10px;background:#0a0a0a;">${lastSnapshot.html}</div>
        </body></html>`);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(__dirname, 'certs', 'server.key');
        const certPath = join(__dirname, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node generate_ssl.js', { cwd: __dirname, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint
    app.get('/debug-ui', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdpConnection);
        console.log('--- UI TREE ---');
        console.log(uiTree);
        console.log('---------------');
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdpConnection, mode);
        res.json(result);
    });

    // Get Available Models
    app.get('/available-models', async (req, res) => {
        if (!cdpConnection) return res.json({ models: cachedModels });
        const models = await syncModelsFromCDP(cdpConnection);
        if (models && models.length > 0) {
            cachedModels = models;
            res.json({ models });
        } else {
            res.json({ models: cachedModels }); // return cached fallback
        }
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdpConnection, model);
        res.json(result);
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdpConnection);
        res.json(result);
    });

    // Send message
    app.post('/send', async (req, res) => {
        const { message, image, imageWaitMs } = req.body;
        console.log(`[HTTP POST /send] Message: "${message || ''}", Image payload size: ${image ? image.length : 0} bytes`);

        if (!message && !image) {
            return res.status(400).json({ error: 'Message or image required' });
        }

        if (!cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const waitMs = typeof imageWaitMs === 'number' ? imageWaitMs : 1500;
        const result = await injectMessage(cdpConnection, message || '', image, waitMs);

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });

    // UI Inspection endpoint - Returns all buttons as JSON for debugging
    app.get('/ui-inspect', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });

        const EXP = `(() => {
    try {
        // Safeguard for non-DOM contexts
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return { error: 'Non-DOM context' };
        }

        // Helper to get string class name safely (handles SVGAnimatedString)
        function getCls(el) {
            if (!el) return '';
            if (typeof el.className === 'string') return el.className;
            if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
            return '';
        }

        // Helper to pierce Shadow DOM
        function findAllElements(selector, root = document) {
            let results = Array.from(root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
                try {
                    if (el.shadowRoot) {
                        results = results.concat(Array.from(el.shadowRoot.querySelectorAll(selector)));
                    }
                } catch (e) { }
            }
            return results;
        }

        // Get standard info
        const url = window.location ? window.location.href : '';
        const title = document.title || '';
        const bodyLen = document.body ? document.body.innerHTML.length : 0;
        const hasCascade = !!document.getElementById('cascade') || !!document.querySelector('.cascade');

        // Scan for buttons
        const allLucideElements = findAllElements('svg[class*="lucide"]').map(svg => {
            const parent = svg.closest('button, [role="button"], div, span, a');
            if (!parent || parent.offsetParent === null) return null;
            const rect = parent.getBoundingClientRect();
            return {
                type: 'lucide-icon',
                tag: parent.tagName.toLowerCase(),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                svgClasses: getCls(svg),
                className: getCls(parent).substring(0, 100),
                ariaLabel: parent.getAttribute('aria-label') || '',
                title: parent.getAttribute('title') || '',
                parentText: (parent.innerText || '').trim().substring(0, 50)
            };
        }).filter(Boolean);

        const buttons = findAllElements('button, [role="button"]').map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const svg = btn.querySelector('svg');

            return {
                type: 'button',
                index: i,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                text: (btn.innerText || '').trim().substring(0, 50) || '(empty)',
                ariaLabel: btn.getAttribute('aria-label') || '',
                title: btn.getAttribute('title') || '',
                svgClasses: getCls(svg),
                className: getCls(btn).substring(0, 100),
                visible: btn.offsetParent !== null
            };
        }).filter(b => b.visible);

        return {
            url, title, bodyLen, hasCascade,
            buttons, lucideIcons: allLucideElements
        };
    } catch (err) {
        return { error: err.toString(), stack: err.stack };
    }
})()`;

        try {
            // 1. Get Frames
            const { frameTree } = await cdpConnection.call("Page.getFrameTree");
            function flattenFrames(node) {
                let list = [{
                    id: node.frame.id,
                    url: node.frame.url,
                    name: node.frame.name,
                    parentId: node.frame.parentId
                }];
                if (node.childFrames) {
                    for (const child of node.childFrames) list = list.concat(flattenFrames(child));
                }
                return list;
            }
            const allFrames = flattenFrames(frameTree);

            // 2. Map Contexts
            const contexts = cdpConnection.contexts.map(c => ({
                id: c.id,
                name: c.name,
                origin: c.origin,
                frameId: c.auxData ? c.auxData.frameId : null,
                isDefault: c.auxData ? c.auxData.isDefault : false
            }));

            // 3. Scan ALL Contexts
            const contextResults = [];
            for (const ctx of contexts) {
                try {
                    const result = await cdpConnection.call("Runtime.evaluate", {
                        expression: EXP,
                        returnByValue: true,
                        contextId: ctx.id
                    });

                    if (result.result?.value) {
                        const val = result.result.value;
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            url: val.url,
                            title: val.title,
                            hasCascade: val.hasCascade,
                            buttonCount: val.buttons.length,
                            lucideCount: val.lucideIcons.length,
                            buttons: val.buttons, // Store buttons for analysis
                            lucideIcons: val.lucideIcons
                        });
                    } else if (result.exceptionDetails) {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: `Script Exception: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''} `
                        });
                    } else {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: 'No value returned (undefined)'
                        });
                    }
                } catch (e) {
                    contextResults.push({ contextId: ctx.id, error: e.message });
                }
            }

            // 4. Match and Analyze
            const cascadeFrame = allFrames.find(f => f.url.includes('cascade'));
            const matchingContext = contextResults.find(c => c.frameId === cascadeFrame?.id);
            const contentContext = contextResults.sort((a, b) => (b.buttonCount || 0) - (a.buttonCount || 0))[0];

            // Prepare "useful buttons" from the best context
            const bestContext = matchingContext || contentContext;
            const usefulButtons = bestContext ? (bestContext.buttons || []).filter(b =>
                b.ariaLabel?.includes('New Conversation') ||
                b.title?.includes('New Conversation') ||
                b.ariaLabel?.includes('Past Conversations') ||
                b.title?.includes('Past Conversations') ||
                b.ariaLabel?.includes('History')
            ) : [];

            res.json({
                summary: {
                    frameFound: !!cascadeFrame,
                    cascadeFrameId: cascadeFrame?.id,
                    contextFound: !!matchingContext,
                    bestContextId: bestContext?.contextId
                },
                frames: allFrames,
                contexts: contexts,
                scanResults: contextResults.map(c => ({
                    id: c.contextId,
                    frameId: c.frameId,
                    url: c.url,
                    hasCascade: c.hasCascade,
                    buttons: c.buttonCount,
                    error: c.error
                })),
                usefulButtons: usefulButtons,
                bestContextData: bestContext // Full data for the best context
            });

        } catch (e) {
            res.status(500).json({ error: e.message, stack: e.stack });
        }
    });

    // Endpoint to list all CDP targets - helpful for debugging connection issues
    app.get('/cdp-targets', async (req, res) => {
        const results = {};
        for (const port of PORTS) {
            try {
                const list = await getJson(`http://127.0.0.1:${port}/json/list`);
                results[port] = list;
            } catch (e) {
                results[port] = e.message;
            }
        }
        res.json(results);
    });

    // WebSocket connection with Auth check
    wss.on('connection', (ws, req) => {
        // Parse cookies from headers
        const rawCookies = req.headers.cookie || '';
        const parsedCookies = {};
        rawCookies.split(';').forEach(c => {
            const [k, v] = c.trim().split('=');
            if (k && v) {
                try {
                    parsedCookies[k] = decodeURIComponent(v);
                } catch (e) {
                    parsedCookies[k] = v;
                }
            }
        });

        // Verify signed cookie manually
        const signedToken = parsedCookies[AUTH_COOKIE_NAME];
        let isAuthenticated = false;

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            isAuthenticated = true;
        } else if (signedToken) {
            const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';

            if (sessionSecret === 'antigravity_secret_key_1337') {
                // Warning already printed on startup, but we check here for token verification
            }

            const token = cookieParser.signedCookie(signedToken, sessionSecret);
            if (token === AUTH_TOKEN) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');
        
        // Reset sync flag so that we refresh the model list from Antigravity for this new session
        modelsSynced = false;

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        await initCDP();
    } catch (err) {
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=9000 to connect.');
    }

    try {
        const { server, wss, app, hasSSL } = await createServer();

        // Start background polling (it will now handle reconnections)
        startPolling(wss);

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdpConnection, { selector, index, textContent });
            res.json(result);
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdpConnection, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            if (!cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown', models: cachedModels });
            
            if (!modelsSynced) {
                modelsSynced = true;
                syncModelsFromCDP(cdpConnection).then(models => {
                    if (models && models.length > 0) {
                        cachedModels = models;
                        console.log(`[SYNC-MODELS] Dynamic sync: ${models.length} models loaded: ${models.join(', ')}`);
                    } else {
                        modelsSynced = false;
                    }
                });
            }

            const result = await getAppState(cdpConnection);
            result.models = cachedModels;
            res.json(result);
        });

        // Start New Chat
        app.post('/new-chat', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await startNewChat(cdpConnection);
            res.json(result);
        });

        // Start New Chat in Project
        app.post('/new-project-chat', async (req, res) => {
            const { projectName } = req.body;
            if (!projectName) return res.status(400).json({ error: 'Project name required' });
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await startNewProjectChat(cdpConnection, projectName);
            res.json(result);
        });

        // Get Chat History
        app.get('/chat-history', async (req, res) => {
            if (!cdpConnection) return res.json({ error: 'CDP disconnected', chats: [] });
            const result = await getChatHistory(cdpConnection);
            res.json(result);
        });

        // Select a Chat
        app.post('/select-chat', async (req, res) => {
            const { title } = req.body;
            if (!title) return res.status(400).json({ error: 'Chat title required' });
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await selectChat(cdpConnection, title);
            res.json(result);
        });

        // Switch Chat (by ID)
        app.post('/switch-chat', async (req, res) => {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Chat ID required' });
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdpConnection, { selector: `[data-testid="convo-pill-${id}"]` });
            res.json(result);
        });

        // Agent Action (Allow/Deny/Review)
        app.post('/agent-action', async (req, res) => {
            const { action } = req.body; // 'allow', 'deny', 'review'
            if (!action) return res.status(400).json({ error: 'Action required' });
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            
            const textContentMap = {
                'allow': 'Allow',
                'deny': 'Deny',
                'review': 'Review Changes'
            };
            const textContent = textContentMap[action];
            if (!textContent) return res.status(400).json({ error: 'Invalid action' });

            const result = await clickElement(cdpConnection, { selector: 'button, div[role="button"]', textContent });
            res.json(result);
        });

        // Close Chat History
        app.post('/close-history', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await closeHistory(cdpConnection);
            res.json(result);
        });

        // Check if Chat is Open
        app.get('/chat-status', async (req, res) => {
            if (!cdpConnection) return res.json({ hasChat: false, hasMessages: false, editorFound: false });
            const result = await hasChatOpen(cdpConnection);
            res.json(result);
        });

        // Get Right Pane
        app.get('/api/planning-files', async (req, res) => {
            if (!cdpConnection) return res.json({ error: 'CDP disconnected', hasFiles: false });
            const result = await getRightPaneSnapshot(cdpConnection);
            res.json(result);
        });

        // Kill any existing process on the port before starting
        await killPortProcess(SERVER_PORT);

        // Start server
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(SERVER_PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on ${protocol}://${localIP}:${SERVER_PORT}`);
            if (hasSSL) {
                console.log(`💡 First time on phone? Accept the security warning to proceed.`);
            }
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (cdpConnection?.ws) {
                cdpConnection.ws.close();
                console.log('   CDP connection closed');
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
