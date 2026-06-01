#!/usr/bin/env node
/**
 * Capture Models & Quotas Utility for Antigravity Phone Connect
 * 
 * This utility:
 * 1. Discovers the active Antigravity CDP port dynamically (supports macOS DevToolsActivePort).
 * 2. Connects to the CDP WebSocket in the default main execution context.
 * 3. Simulates pointer events to open the Settings modal.
 * 4. Navigates to the "Models" settings tab.
 * 5. Grabs the modal HTML, parses the segmented progress bars, and extracts real-time quota metrics.
 * 6. Cleanly restores the chat view.
 * 7. Saves the parsed metrics to `parsed_model_quotas.json`.
 */

import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';

const PORTS = [9000, 9001, 9002, 9003];
const OUTPUT_FILE = './parsed_model_quotas.json';

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
    const portsToTry = [...PORTS];
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
            const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) {
                return { port, url: page.webSocketDebuggerUrl };
            }
        } catch (e) { }
    }
    throw new Error('No Antigravity CDP endpoint found.');
}

async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map();
    const contexts = [];

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);
                if (data.error) reject(data.error);
                else resolve(data.result);
            }
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            }
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => {
            pendingCalls.delete(id);
            reject(new Error(`CDP call ${method} timed out`));
        }, 15000);
        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts };
}

async function runInDefaultContext(cdp, expression) {
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    const res = await cdp.call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        contextId: defaultCtx.id
    });
    return res.result?.value;
}

async function main() {
    console.log('🔍 Discovering Antigravity CDP...');
    const cdpInfo = await discoverCDP();
    const cdp = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected on port ${cdpInfo.port}`);

    // Let the contexts register
    await new Promise(r => setTimeout(r, 500));

    // 1. Click Settings button
    console.log('👆 Opening Settings modal...');
    await runInDefaultContext(cdp, `(() => {
        const btn = document.querySelector('[data-testid="settings-button"]');
        if (btn) {
            const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
            events.forEach(name => {
                const e = new MouseEvent(name, { bubbles: true, cancelable: true, view: window });
                btn.dispatchEvent(e);
            });
        }
    })()`);

    console.log('⏳ Waiting 1.5 seconds...');
    await new Promise(r => setTimeout(r, 1500));

    // 2. Click "Models" tab
    console.log('👆 Navigating to "Models" tab...');
    await runInDefaultContext(cdp, `(() => {
        const btn = document.querySelector('[data-testid="settings-nav-item-Models"]');
        if (btn) {
            const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
            events.forEach(name => {
                const e = new MouseEvent(name, { bubbles: true, cancelable: true, view: window });
                btn.dispatchEvent(e);
            });
        }
    })()`);

    console.log('⏳ Waiting 2 seconds for Models page to load...');
    await new Promise(r => setTimeout(r, 2000));

    // 3. Grab Modal outerHTML
    console.log('📊 Capturing modal DOM...');
    const html = await runInDefaultContext(cdp, `(() => {
        const modal = document.querySelector('.bg-background.w-full.h-full.max-w-5xl');
        return modal ? modal.outerHTML : 'modal_not_found';
    })()`);

    if (html === 'modal_not_found') {
        console.error('❌ Settings modal not found in DOM.');
        cdp.ws.close();
        process.exit(1);
    }

    // 4. Parse Quota Details
    console.log('⚙️ Parsing model quota metrics...');
    const blocks = html.split('<div class="text-sm">');
    const results = [];

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const name = block.split('</div>')[0].trim();
        
        // Extract refresh text
        const refreshParts = block.split('<div class="text-xs text-muted-foreground">');
        let refreshText = 'N/A';
        if (refreshParts.length > 1) {
            refreshText = refreshParts[1].split('</div>')[0].trim();
        }
        
        if (block.includes('flex gap-1') || block.includes('rounded-full')) {
            const parts = block.split(/class="flex gap-1"[^>]*/);
            if (parts.length > 1) {
                const segmentsBlock = parts[1].split('<div class="flex items-center justify-between')[0];
                
                const segmentRegex = /style="width:\s*(\d+)%;"/g;
                let segMatch;
                const segments = [];
                while ((segMatch = segmentRegex.exec(segmentsBlock)) !== null) {
                    segments.push(parseInt(segMatch[1], 10));
                }
                
                if (segments.length > 0) {
                    const total = segments.length;
                    const filled = segments.filter(w => w === 100).length;
                    const sum = segments.reduce((a, b) => a + b, 0);
                    const percentage = Math.round(sum / total);
                    
                    results.push({
                        name,
                        refreshText,
                        segments,
                        quota: `${filled}/${total}`,
                        percentage: `${percentage}%`
                    });
                }
            }
        }
    }

    // Extract budget
    const customizationRegex = /(\d+\.?\d*)% of the customization budget is available\./;
    const custMatch = html.match(customizationRegex);
    const budgetAvailable = custMatch ? `${custMatch[1]}%` : 'N/A';

    const outputPayload = {
        timestamp: new Date().toISOString(),
        customizationBudgetAvailable: budgetAvailable,
        modelQuotas: results
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputPayload, null, 2));
    console.log(`🎉 Capturing and parsing complete! Saved to ${OUTPUT_FILE}`);

    // 5. Restore Chat View
    console.log('🔄 Restoring back to Chat view...');
    await runInDefaultContext(cdp, `(() => {
        const closeBtn = Array.from(document.querySelectorAll('*')).find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            return txt === 'close' || txt === '✕' || txt === 'x' || ariaLabel.includes('close');
        });
        if (closeBtn) closeBtn.click();
    })()`);

    cdp.ws.close();
}

main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
