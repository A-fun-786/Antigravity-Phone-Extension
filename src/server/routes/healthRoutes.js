import fs from 'fs';
import { execSync } from 'child_process';
import { getPathFromRoot } from '../utils/paths.js';

export function registerHealthRoutes(app, context) {
    const { state } = context;

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: state.cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: state.hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = getPathFromRoot('certs', 'server.key');
        const certPath = getPathFromRoot('certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: state.hasSSL,
            certsExist: certsExist,
            message: state.hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            execSync('node generate_ssl.js', { cwd: getPathFromRoot(), stdio: 'pipe' });
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
}
