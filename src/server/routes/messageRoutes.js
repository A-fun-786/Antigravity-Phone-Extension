import { stopGeneration } from '../cdp/modelControl.js';
import { injectMessage } from '../cdp/messageInjection.js';

export function registerMessageRoutes(app, context) {
    const { state } = context;

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(state.cdpConnection);
        res.json(result);
    });

    // Send message
    app.post('/send', async (req, res) => {
        const { message, image, imageWaitMs } = req.body;
        console.log(`[HTTP POST /send] Message: "${message || ''}", Image payload size: ${image ? image.length : 0} bytes`);

        if (!message && !image) {
            return res.status(400).json({ error: 'Message or image required' });
        }

        if (!state.cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const waitMs = typeof imageWaitMs === 'number' ? imageWaitMs : 1500;
        const result = await injectMessage(state.cdpConnection, message || '', image, waitMs);

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });
}
