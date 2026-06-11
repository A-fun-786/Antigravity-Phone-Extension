import { getRightPaneSnapshot } from '../cdp/rightPane.js';

export function registerPlanningRoutes(app, context) {
    const { state } = context;

    // Get Right Pane
    app.get('/api/planning-files', async (req, res) => {
        if (!state.cdpConnection) return res.json({ error: 'CDP disconnected', hasFiles: false });
        const result = await getRightPaneSnapshot(state.cdpConnection);
        res.json(result);
    });
}
