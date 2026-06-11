import fs from 'fs';
import http from 'http';
import https from 'https';
import { getPathFromRoot } from './utils/paths.js';

export function createHttpServer(app, state) {
    // Check for SSL certificates
    const keyPath = getPathFromRoot('certs', 'server.key');
    const certPath = getPathFromRoot('certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    state.hasSSL = hasSSL;

    let server;
    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        server = https.createServer(sslOptions, app);
    } else {
        server = http.createServer(app);
    }

    return { server, hasSSL };
}
