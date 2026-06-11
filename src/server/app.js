import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { getPathFromRoot } from './utils/paths.js';
import { authMiddleware } from './auth.js';

// Route registrations
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerSnapshotRoutes } from './routes/snapshotRoutes.js';
import { registerHealthRoutes } from './routes/healthRoutes.js';
import { registerDebugRoutes } from './routes/debugRoutes.js';
import { registerMessageRoutes } from './routes/messageRoutes.js';
import { registerModelRoutes } from './routes/modelRoutes.js';
import { registerRemoteRoutes } from './routes/remoteRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { registerPlanningRoutes } from './routes/planningRoutes.js';

export function createExpressApp(context) {
    const app = express();
    const { config, auth } = context;

    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(cookieParser(auth.sessionSecret));

    // Ngrok Bypass Middleware
    app.use((req, res, next) => {
        // Tell ngrok to skip the "visit" warning for API requests
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // Auth Middleware
    app.use(authMiddleware(auth));

    // Static files
    app.use(express.static(getPathFromRoot('public')));

    // Register routes
    registerAuthRoutes(app, context);
    registerSnapshotRoutes(app, context);
    registerHealthRoutes(app, context);
    registerDebugRoutes(app, context);
    registerMessageRoutes(app, context);
    registerModelRoutes(app, context);
    registerRemoteRoutes(app, context);
    registerChatRoutes(app, context);
    registerPlanningRoutes(app, context);

    return app;
}
