import {
    startNewChat,
    startNewProjectChat,
    getChatHistory,
    selectChat,
    closeHistory,
    hasChatOpen
} from '../cdp/chatControl.js';
import { clickElement } from '../cdp/remoteControl.js';

export function registerChatRoutes(app, context) {
    const { state } = context;

    // Start New Chat
    app.post('/new-chat', async (req, res) => {
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await startNewChat(state.cdpConnection);
        // Invalidate cached snapshot so polling captures the new chat fresh
        if (result.success) {
            state.lastSnapshot = null;
            state.lastSnapshotHash = null;
        }
        res.json(result);
    });

    // Start New Chat in Project
    app.post('/new-project-chat', async (req, res) => {
        const { projectName } = req.body;
        if (!projectName) return res.status(400).json({ error: 'Project name required' });
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await startNewProjectChat(state.cdpConnection, projectName);
        // Invalidate cached snapshot so polling captures the new chat fresh
        if (result.success) {
            state.lastSnapshot = null;
            state.lastSnapshotHash = null;
        }
        res.json(result);
    });

    // Get Chat History
    app.get('/chat-history', async (req, res) => {
        if (!state.cdpConnection) return res.json({ error: 'CDP disconnected', chats: [] });
        const result = await getChatHistory(state.cdpConnection);
        res.json(result);
    });

    // Select a Chat
    app.post('/select-chat', async (req, res) => {
        const { title } = req.body;
        if (!title) return res.status(400).json({ error: 'Chat title required' });
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await selectChat(state.cdpConnection, title);
        res.json(result);
    });

    // Switch Chat (by ID)
    app.post('/switch-chat', async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Chat ID required' });
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await clickElement(state.cdpConnection, { selector: `[data-testid="convo-pill-${id}"]` });
        res.json(result);
    });

    // Close Chat History
    app.post('/close-history', async (req, res) => {
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await closeHistory(state.cdpConnection);
        res.json(result);
    });

    // Check if Chat is Open
    app.get('/chat-status', async (req, res) => {
        if (!state.cdpConnection) return res.json({ hasChat: false, hasMessages: false, editorFound: false });
        const result = await hasChatOpen(state.cdpConnection);
        res.json(result);
    });
}
