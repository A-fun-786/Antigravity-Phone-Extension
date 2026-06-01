#!/usr/bin/env node
/**
 * DOM Explorer for Antigravity Phone Connect
 * Connects to Antigravity via CDP and dumps the full DOM structure.
 * 
 * Usage: node dom_explorer.js
 * Requires: Antigravity running with --remote-debugging-port=9000
 */

import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';

const PORTS = [9000, 9001, 9002, 9003];
const OUTPUT_FILE = './dom_exploration_results.json';

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
    } catch (e) { /* ignore */ }

    for (const port of portsToTry) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            console.log(`\n📋 CDP targets on port ${port}:`);
            list.forEach((t, i) => console.log(`  [${i}] ${t.title} — ${t.url?.substring(0, 80)}`));
            
            const workbench = list.find(t => t.url?.includes('workbench.html') || t.title?.includes('workbench'));
            if (workbench?.webSocketDebuggerUrl) {
                return { port, url: workbench.webSocketDebuggerUrl, targets: list };
            }
            const jetski = list.find(t => t.url?.includes('jetski') || t.title === 'Launchpad');
            if (jetski?.webSocketDebuggerUrl) {
                return { port, url: jetski.webSocketDebuggerUrl, targets: list };
            }
            const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) {
                return { port, url: page.webSocketDebuggerUrl, targets: list };
            }
        } catch (e) { /* port not available */ }
    }
    throw new Error('No Antigravity CDP endpoint found. Is Antigravity running with --remote-debugging-port=9000?');
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
    await new Promise(r => setTimeout(r, 1500));

    return { ws, call, contexts };
}

async function runInContext(cdp, expression) {
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return null;
}

async function main() {
    console.log('🔍 Discovering Antigravity...');
    const cdpInfo = await discoverCDP();
    console.log(`\n✅ Connecting to CDP on port ${cdpInfo.port}...`);
    const cdp = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected! ${cdp.contexts.length} execution contexts found.\n`);

    const results = {};

    // =========================================================================
    // 1. FULL DOM TREE — Top-level structure (depth=3)
    // =========================================================================
    console.log('📊 [1/7] Capturing top-level DOM structure...');
    results.topLevelDOM = await runInContext(cdp, `(() => {
        function serialize(el, depth, maxDepth) {
            if (!el || el.nodeType !== 1) return null;
            if (depth > maxDepth) return '...';
            const tag = el.tagName.toLowerCase();
            const id = el.id ? '#' + el.id : '';
            const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 3).join('.') : '';
            const role = el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '';
            const rect = el.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            const children = Array.from(el.children).map(c => serialize(c, depth + 1, maxDepth)).filter(Boolean);
            return {
                selector: tag + id + cls + role,
                visible,
                size: { w: Math.round(rect.width), h: Math.round(rect.height) },
                childCount: el.children.length,
                children: children.length > 0 ? children : undefined
            };
        }
        return serialize(document.body, 0, 3);
    })()`);

    // =========================================================================
    // 2. ALL ELEMENTS WITH IDs
    // =========================================================================
    console.log('📊 [2/7] Listing all elements with IDs...');
    results.allIDs = await runInContext(cdp, `(() => {
        const els = document.querySelectorAll('[id]');
        return Array.from(els).map(el => {
            const rect = el.getBoundingClientRect();
            return {
                id: el.id,
                tag: el.tagName.toLowerCase(),
                visible: rect.width > 0 && rect.height > 0,
                size: { w: Math.round(rect.width), h: Math.round(rect.height) },
                textPreview: (el.innerText || '').substring(0, 100).replace(/\\n/g, ' ')
            };
        }).filter(e => e.visible);
    })()`);

    // =========================================================================
    // 3. ALL ROLE-BASED ELEMENTS (panels, tabs, dialogs, menus)
    // =========================================================================
    console.log('📊 [3/7] Listing role-based elements (panels, tabs, etc.)...');
    results.roleElements = await runInContext(cdp, `(() => {
        const roles = ['tabpanel', 'tab', 'tablist', 'dialog', 'menu', 'menuitem', 'toolbar',
                       'navigation', 'banner', 'main', 'complementary', 'contentinfo',
                       'tree', 'treeitem', 'listbox', 'option', 'status', 'progressbar'];
        const found = {};
        roles.forEach(role => {
            const els = document.querySelectorAll('[role="' + role + '"]');
            if (els.length > 0) {
                found[role] = Array.from(els).map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        tag: el.tagName.toLowerCase(),
                        id: el.id || null,
                        ariaLabel: el.getAttribute('aria-label') || null,
                        visible: rect.width > 0 && rect.height > 0,
                        textPreview: (el.innerText || '').substring(0, 80).replace(/\\n/g, ' ')
                    };
                }).filter(e => e.visible);
            }
        });
        return found;
    })()`);

    // =========================================================================
    // 4. SIDEBAR / PANEL STRUCTURE
    // =========================================================================
    console.log('📊 [4/7] Exploring sidebar and panel structure...');
    results.panels = await runInContext(cdp, `(() => {
        // Look for sidebar, activity bar, panel, status bar, etc.
        const selectors = [
            '.sidebar', '.activitybar', '.panel', '.statusbar', '.editor-group-container',
            '.minimap', '.title', '.menubar', '[class*="sidebar"]', '[class*="panel"]',
            '[class*="activity"]', '[class*="status"]', '[class*="editor"]', '[class*="terminal"]',
            '[class*="Explorer"]', '[class*="explorer"]', '[class*="tab"]',
            // Antigravity-specific
            '#conversation', '#cascade', '#chat',
            '[class*="agent"]', '[class*="Agent"]',
            '[class*="implementation"]', '[class*="plan"]',
            '[class*="diff"]', '[class*="changes"]',
            '[class*="settings"]', '[class*="Settings"]',
            '[class*="usage"]', '[class*="Usage"]', '[class*="model"]', '[class*="Model"]',
            '[class*="token"]', '[class*="Token"]'
        ];
        const found = {};
        selectors.forEach(sel => {
            try {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    found[sel] = Array.from(els).slice(0, 5).map(el => {
                        const rect = el.getBoundingClientRect();
                        return {
                            tag: el.tagName.toLowerCase(),
                            id: el.id || null,
                            className: (el.className || '').toString().substring(0, 120),
                            visible: rect.width > 0 && rect.height > 0,
                            size: { w: Math.round(rect.width), h: Math.round(rect.height) },
                            textPreview: (el.innerText || '').substring(0, 100).replace(/\\n/g, ' ')
                        };
                    });
                }
            } catch(e) {}
        });
        return found;
    })()`);

    // =========================================================================
    // 5. SETTINGS / GEAR ICON DETECTION
    // =========================================================================
    console.log('📊 [5/7] Looking for settings icons, gear buttons, usage panels...');
    results.settingsAndUsage = await runInContext(cdp, `(() => {
        const result = {};
        
        // Find gear/settings icons
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a, [class*="icon"]'));
        result.gearButtons = allButtons.filter(el => {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const cls = (el.className || '').toString().toLowerCase();
            const text = (el.innerText || '').toLowerCase();
            return ariaLabel.includes('setting') || ariaLabel.includes('gear') || ariaLabel.includes('config') ||
                   title.includes('setting') || title.includes('gear') || title.includes('config') ||
                   cls.includes('setting') || cls.includes('gear') || cls.includes('codicon-gear') ||
                   text.includes('settings') || text.includes('⚙');
        }).map(el => {
            const rect = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                ariaLabel: el.getAttribute('aria-label'),
                title: el.getAttribute('title'),
                className: (el.className || '').toString().substring(0, 100),
                visible: rect.width > 0 && rect.height > 0,
                textPreview: (el.innerText || '').substring(0, 60)
            };
        });

        // Find anything related to model usage, tokens, percentage
        const allEls = Array.from(document.querySelectorAll('*'));
        result.usageElements = allEls.filter(el => {
            const text = (el.innerText || '').toLowerCase();
            const cls = (el.className || '').toString().toLowerCase();
            return (text.includes('usage') || text.includes('token') || text.includes('quota') || 
                    text.includes('limit') || text.includes('remaining') || text.includes('requests') ||
                    cls.includes('usage') || cls.includes('quota') || cls.includes('progress')) &&
                    el.children.length < 5; // leaf-ish elements
        }).slice(0, 20).map(el => {
            const rect = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                id: el.id || null,
                className: (el.className || '').toString().substring(0, 100),
                visible: rect.width > 0 && rect.height > 0,
                textPreview: (el.innerText || '').substring(0, 150).replace(/\\n/g, ' ')
            };
        });

        return result;
    })()`);

    // =========================================================================
    // 6. AGENT MODE SPECIFIC — tasks, tool calls, file changes
    // =========================================================================
    console.log('📊 [6/7] Searching for Agent mode elements (tasks, tool calls, file changes)...');
    results.agentMode = await runInContext(cdp, `(() => {
        const result = {};
        
        // Look for agent-specific keywords in visible elements
        const keywords = ['Allow', 'Deny', 'Run', 'Review Changes', 'Apply', 'Save',
                          'Thinking', 'Working', 'Editing', 'Reading', 'Searching',
                          'files with changes', 'Files with changes', 'implementation plan',
                          'task', 'checkpoint', 'Checkpoint'];
        
        const allEls = Array.from(document.querySelectorAll('*'));
        result.agentKeywords = {};
        
        keywords.forEach(kw => {
            const matches = allEls.filter(el => {
                if (el.children.length > 3) return false;
                const text = (el.innerText || '').trim();
                return text.includes(kw) && text.length < 200;
            });
            if (matches.length > 0) {
                result.agentKeywords[kw] = matches.slice(0, 3).map(el => ({
                    tag: el.tagName.toLowerCase(),
                    className: (el.className || '').toString().substring(0, 80),
                    text: (el.innerText || '').substring(0, 100).replace(/\\n/g, ' '),
                    visible: el.getBoundingClientRect().width > 0
                }));
            }
        });

        // Look for data-testid attributes (common in React/Electron apps)
        const testIds = Array.from(document.querySelectorAll('[data-testid]'));
        result.testIds = testIds.slice(0, 30).map(el => ({
            testId: el.getAttribute('data-testid'),
            tag: el.tagName.toLowerCase(),
            visible: el.getBoundingClientRect().width > 0
        }));

        // Look for tooltip-id attributes (Antigravity uses these)
        const tooltipIds = Array.from(document.querySelectorAll('[data-tooltip-id]'));
        result.tooltipIds = tooltipIds.map(el => ({
            tooltipId: el.getAttribute('data-tooltip-id'),
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute('aria-label'),
            visible: el.getBoundingClientRect().width > 0
        }));

        return result;
    })()`);

    // =========================================================================
    // 7. FULL BODY SNAPSHOT — capturing the complete visible layout
    // =========================================================================
    console.log('📊 [7/7] Capturing complete body layout map...');
    results.bodyLayout = await runInContext(cdp, `(() => {
        // Get all direct children of body and their major sub-sections
        function mapElement(el, depth) {
            if (!el || el.nodeType !== 1 || depth > 4) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return null;
            
            const tag = el.tagName.toLowerCase();
            const id = el.id || null;
            const cls = el.className && typeof el.className === 'string' ? 
                        el.className.split(/\\s+/).slice(0, 4).join(' ') : null;
            const role = el.getAttribute('role') || null;
            const ariaLabel = el.getAttribute('aria-label') || null;
            
            // For deep elements, just get text if it's a leaf
            if (depth >= 3 && el.children.length === 0) {
                const text = (el.innerText || '').trim();
                if (text) return { tag, text: text.substring(0, 80) };
                return null;
            }
            
            const children = Array.from(el.children)
                .map(c => mapElement(c, depth + 1))
                .filter(Boolean);
            
            const node = { tag };
            if (id) node.id = id;
            if (cls) node.class = cls;
            if (role) node.role = role;
            if (ariaLabel) node.ariaLabel = ariaLabel;
            node.rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
            if (children.length > 0) node.children = children;
            else {
                const text = (el.innerText || '').trim();
                if (text) node.text = text.substring(0, 100);
            }
            return node;
        }
        
        return {
            windowSize: { w: window.innerWidth, h: window.innerHeight },
            bodyChildren: Array.from(document.body.children).map(c => mapElement(c, 0)).filter(Boolean)
        };
    })()`);

    // Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results saved to ${OUTPUT_FILE}`);
    console.log(`   File size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 SUMMARY');
    console.log('='.repeat(60));
    console.log(`  IDs found: ${results.allIDs?.length || 0}`);
    console.log(`  Roles: ${Object.keys(results.roleElements || {}).join(', ') || 'none'}`);
    console.log(`  Gear/Settings buttons: ${results.settingsAndUsage?.gearButtons?.length || 0}`);
    console.log(`  Usage elements: ${results.settingsAndUsage?.usageElements?.length || 0}`);
    console.log(`  Agent keywords matched: ${Object.keys(results.agentMode?.agentKeywords || {}).join(', ') || 'none'}`);
    console.log(`  Tooltip IDs: ${results.agentMode?.tooltipIds?.length || 0}`);
    console.log(`  Test IDs: ${results.agentMode?.testIds?.length || 0}`);

    cdp.ws.close();
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Error:', e.message);
    console.log('\n💡 Make sure Antigravity is running with: antigravity . --remote-debugging-port=9000');
    process.exit(1);
});
