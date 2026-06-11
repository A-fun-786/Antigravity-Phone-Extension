export function registerSnapshotRoutes(app, context) {
    const { state } = context;

    app.get('/snapshot', (req, res) => {
        if (!state.lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(state.lastSnapshot);
    });

    // Debug: View raw snapshot HTML in browser
    app.get('/debug-snapshot', (req, res) => {
        if (!state.lastSnapshot) {
            return res.status(503).send('No snapshot yet');
        }
        const htmlLen = state.lastSnapshot.html ? state.lastSnapshot.html.length : 0;
        const first500 = state.lastSnapshot.html ? state.lastSnapshot.html.substring(0, 2000) : 'NO HTML';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<html><body style="background:#111;color:#eee;font-family:monospace;padding:20px;">
            <h2>Snapshot Debug</h2>
            <p>HTML length: ${htmlLen} chars</p>
            <p>Stats: ${JSON.stringify(state.lastSnapshot.stats)}</p>
            <h3>First 2000 chars of HTML:</h3>
            <pre style="white-space:pre-wrap;word-break:break-all;border:1px solid #444;padding:10px;max-height:400px;overflow:auto;">${first500.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            <h3>Rendered HTML:</h3>
            <div style="border:2px solid #f00;padding:10px;background:#0a0a0a;">${state.lastSnapshot.html}</div>
        </body></html>`);
    });
}
