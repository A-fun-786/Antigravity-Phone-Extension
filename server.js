#!/usr/bin/env node
import 'dotenv/config';
import { main } from './src/server/index.js';

main().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
