import { setMode, syncModelsFromCDP, setModel } from '../cdp/modelControl.js';
import { getAppState } from '../cdp/appState.js';

export function registerModelRoutes(app, context) {
    const { state } = context;

    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(state.cdpConnection, mode);
        res.json(result);
    });

    // Get Available Models
    app.get('/available-models', async (req, res) => {
        if (!state.cdpConnection) return res.json({ models: state.cachedModels });
        const models = await syncModelsFromCDP(state.cdpConnection);
        if (models && models.length > 0) {
            state.cachedModels = models;
            res.json({ models });
        } else {
            res.json({ models: state.cachedModels }); // return cached fallback
        }
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!state.cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(state.cdpConnection, model);
        res.json(result);
    });

    // Get App State
    app.get('/app-state', async (req, res) => {
        if (!state.cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown', models: state.cachedModels });
        
        if (!state.modelsSynced) {
            state.modelsSynced = true;
            syncModelsFromCDP(state.cdpConnection).then(models => {
                if (models && models.length > 0) {
                    state.cachedModels = models;
                    console.log(`[SYNC-MODELS] Dynamic sync: ${models.length} models loaded: ${models.join(', ')}`);
                } else {
                    state.modelsSynced = false;
                }
            });
        }

        const result = await getAppState(state.cdpConnection);
        result.models = state.cachedModels;
        res.json(result);
    });
}
