import { DEFAULT_CACHED_MODELS } from './config.js';

export function createRuntimeState() {
    return {
        cdpConnection: null,
        lastSnapshot: null,
        lastSnapshotHash: null,
        cachedModels: [...DEFAULT_CACHED_MODELS],
        modelsSynced: false,
        authToken: 'ag_default_token'
    };
}
