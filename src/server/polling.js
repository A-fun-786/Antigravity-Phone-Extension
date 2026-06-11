import WebSocket from 'ws';
import { hashString } from './utils/hash.js';
import { initCDP } from './cdp/client.js';
import { captureSnapshot } from './cdp/snapshotCapture.js';
import { captureSidebar } from './cdp/sidebarCapture.js';

// Background polling
export async function startPolling(wss, context) {
    const { state, config } = context;
    let lastErrorLog = 0;
    let isConnecting = false;

    const poll = async () => {
        if (!state.cdpConnection || (state.cdpConnection.ws && state.cdpConnection.ws.readyState !== WebSocket.OPEN)) {
            if (!isConnecting) {
                console.log('🔍 Looking for Antigravity CDP connection...');
                isConnecting = true;
            }
            if (state.cdpConnection) {
                console.log('🔄 CDP connection lost. Attempting to reconnect...');
                state.cdpConnection = null;
            }
            try {
                await initCDP(state);
                if (state.cdpConnection) {
                    console.log('✅ CDP Connection established from polling loop');
                    isConnecting = false;
                }
            } catch (err) {}
            setTimeout(poll, 2000);
            return;
        }

        try {
            const snapshot = await captureSnapshot(state.cdpConnection);
            const sidebar = await captureSidebar(state.cdpConnection);
            
            if (snapshot && !snapshot.error) {
                snapshot.sidebar = sidebar; // Attach sidebar data to snapshot
                const hash = hashString(snapshot.html + JSON.stringify(sidebar));

                if (hash !== state.lastSnapshotHash) {
                    state.lastSnapshot = snapshot;
                    state.lastSnapshotHash = hash;

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

        setTimeout(poll, config.POLL_INTERVAL);
    };

    poll();
}
