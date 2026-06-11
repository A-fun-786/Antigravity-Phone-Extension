import fs from 'fs';
import WebSocket from 'ws';
import { PORTS } from '../config.js';
import { getJson } from '../utils/network.js';

export async function discoverCDP() {
    const errors = [];
    const portsToTry = [...PORTS];
    
    // Add macOS active port file to top priority
    try {
        const activePortFile = '/Users/mdaffanahmed/Library/Application Support/Antigravity/DevToolsActivePort';
        if (fs.existsSync(activePortFile)) {
            const content = fs.readFileSync(activePortFile, 'utf8');
            const port = parseInt(content.split('\n')[0].trim(), 10);
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
export async function connectCDP(url) {
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

// Initialize CDP connection and update shared state
export async function initCDP(state) {
    console.log('🔍 Discovering Antigravity CDP endpoint...');
    const cdpInfo = await discoverCDP();
    console.log(`✅ Found Antigravity on port ${cdpInfo.port} `);

    console.log('🔌 Connecting to CDP...');
    state.cdpConnection = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected! Found ${state.cdpConnection.contexts.length} execution contexts\n`);
    return state.cdpConnection;
}
