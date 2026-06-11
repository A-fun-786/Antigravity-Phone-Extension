export const PORTS = [9000, 9001, 9002, 9003];
export const POLL_INTERVAL = 1000; // 1 second
export const SERVER_PORT = process.env.PORT || 3000;
export const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
export const AUTH_COOKIE_NAME = 'ag_auth_token';
export const DEFAULT_CACHED_MODELS = [
    "Gemini 3.5 Flash (High)",
    "Gemini 3.5 Flash (Medium)",
    "Gemini 3.5 Flash (Low)",
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];
export const KEY_FILENAME = 'server.key';
export const CERT_FILENAME = 'server.cert';
export const CERTS_DIRNAME = 'certs';
