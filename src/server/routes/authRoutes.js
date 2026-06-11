export function registerAuthRoutes(app, context) {
    const { config, auth } = context;

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === auth.appPassword) {
            res.cookie(auth.authCookieName, auth.authToken, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(auth.authCookieName);
        res.json({ success: true });
    });
}
