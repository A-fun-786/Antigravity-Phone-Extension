import * as config from './config.js';
import { createRuntimeState } from './state.js';
import { createAuthContext } from './auth.js';
import { initCDP } from './cdp/client.js';
import { createExpressApp } from './app.js';
import { createHttpServer } from './httpServer.js';
import { createWebSocketServer } from './websocket.js';
import { startPolling } from './polling.js';
import { killPortProcess, getLocalIP } from './utils/network.js';

export async function main() {
    // 1. Create mutable runtime state
    const state = createRuntimeState();

    // 2. Initialize Auth Context
    const auth = createAuthContext(config);

    // 3. Create Shared Context
    const context = {
        config,
        state,
        auth
    };

    // 4. Try initial CDP connection
    try {
        await initCDP(state);
    } catch (err) {
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=9000 to connect.');
    }

    try {
        // 5. Create Express app
        const app = createExpressApp(context);

        // 6. Create HTTP/HTTPS server
        const { server, hasSSL } = createHttpServer(app, state);

        // 7. Create WebSocket Server
        const wss = createWebSocketServer(server, context);

        // 8. Start background polling (it handles reconnections automatically)
        startPolling(wss, context);

        // 9. Kill any existing process on the port before starting
        await killPortProcess(config.SERVER_PORT);

        // 10. Start server listening
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(config.SERVER_PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on ${protocol}://${localIP}:${config.SERVER_PORT}`);
            if (hasSSL) {
                console.log(`💡 First time on phone? Accept the security warning to proceed.`);
            }
        });

        // 11. Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (state.cdpConnection?.ws) {
                state.cdpConnection.ws.close();
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
