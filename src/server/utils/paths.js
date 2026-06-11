import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const utilsDir = dirname(__filename);

// paths.js is at: src/server/utils/paths.js
// Root directory is 3 levels up
export const rootDir = join(utilsDir, '..', '..', '..');

export function getPathFromRoot(...args) {
    return join(rootDir, ...args);
}
