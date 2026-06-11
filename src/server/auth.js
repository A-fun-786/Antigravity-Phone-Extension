import cookieParser from 'cookie-parser';
import { hashString } from './utils/hash.js';
import { isLocalRequest } from './utils/localRequest.js';

export function createAuthContext(config) {
    const appPassword = config.APP_PASSWORD;
    const authCookieName = config.AUTH_COOKIE_NAME;

    // Initialize Auth Token using a unique salt from environment
    const authSalt = process.env.AUTH_SALT || 'antigravity_default_salt_99';
    const authToken = hashString(appPassword + authSalt);

    // Use a secure session secret from .env if available
    const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';

    if (sessionSecret === 'antigravity_secret_key_1337') {
        console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default SESSION_SECRET ("antigravity_secret_key_1337").');
        console.warn('\x1b[33m%s\x1b[0m', '   Set a strong SESSION_SECRET in your .env file for production use.\n');
    }

    if (appPassword === 'antigravity') {
        console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default APP_PASSWORD ("antigravity").');
        console.warn('\x1b[33m%s\x1b[0m', '   Set a strong APP_PASSWORD in your .env file for production use.\n');
    }

    return {
        appPassword,
        authCookieName,
        authToken,
        sessionSecret
    };
}

export function authMiddleware(authContext) {
    return (req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/')) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === authContext.appPassword) {
            res.cookie(authContext.authCookieName, authContext.authToken, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[authContext.authCookieName];
        if (token === authContext.authToken) {
            return next();
        }

        // If it's an API request, return 401, otherwise redirect to login
        if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/snapshot') || req.path.startsWith('/send')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    };
}

export function verifyWebSocketAuth(req, authContext) {
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
    const signedToken = parsedCookies[authContext.authCookieName];

    // Exempt local Wi-Fi devices from authentication
    if (isLocalRequest(req)) {
        return true;
    } else if (signedToken) {
        const token = cookieParser.signedCookie(signedToken, authContext.sessionSecret);
        if (token === authContext.authToken) {
            return true;
        }
    }

    return false;
}
