import { clickElement, remoteScroll } from '../cdp/remoteControl.js';

export function registerRemoteRoutes(app, context) {
    const { state } = context;

    // Remote Click
    app.post('/remote-click', async (req, res) => {
        const { selector, index, textContent } = req.body;
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await clickElement(state.cdpConnection, { selector, index, textContent });
        res.json(result);
    });

    // Remote Scroll - sync phone scroll to desktop
    app.post('/remote-scroll', async (req, res) => {
        const { scrollTop, scrollPercent } = req.body;
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await remoteScroll(state.cdpConnection, { scrollTop, scrollPercent });
        res.json(result);
    });

    // Agent Action (Allow/Deny/Review)
    app.post('/agent-action', async (req, res) => {
        const { action } = req.body; // 'allow', 'deny', 'review'
        if (!action) return res.status(400).json({ error: 'Action required' });
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        
        const textContentMap = {
            'allow': 'Allow',
            'deny': 'Deny',
            'review': 'Review Changes'
        };
        const textContent = textContentMap[action];
        if (!textContent) return res.status(400).json({ error: 'Invalid action' });

        const result = await clickElement(state.cdpConnection, { selector: 'button, div[role="button"]', textContent });
        res.json(result);
    });
}
