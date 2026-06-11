import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { verifyWebSocketAuth } from './auth.js';

export function createWebSocketServer(server, context) {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws, req) => {
        const isAuthenticated = verifyWebSocketAuth(req, context.auth);

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');
        
        // Reset sync flag so that we refresh the model list from Antigravity for this new session
        context.state.modelsSynced = false;

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return wss;
}

export function broadcastSnapshotUpdate(wss, payload) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    });
}
