// Get Right Pane Snapshot
export async function getRightPaneSnapshot(cdp) {
    const EXP = `(() => {
        try {
            const chat = document.querySelector('[data-testid="conversation-view"]');
            if (!chat) return '<div style="padding: 20px; color: #94a3b8; text-align: center;">No active chat view found.</div>';
            
            let rightPane = null;
            
            // 1. Try explicit IDs often used in AG
            const explicit = document.querySelector('[data-testid*="artifact"], [data-testid*="right-panel"], [data-testid*="review"]');
            if (explicit && explicit.offsetParent) {
                rightPane = explicit;
            } else {
                // 2. Heuristic search: Find a large container on the right side of the screen
                const allElements = Array.from(document.querySelectorAll('div, aside, section, main'));
                const candidates = allElements.filter(el => {
                    if (!el.offsetParent) return false;
                    const rect = el.getBoundingClientRect();
                    // Must be reasonably large
                    if (rect.width < 200 || rect.height < 200) return false;
                    // Center of the element must be on the right half of the screen
                    if (rect.left + (rect.width / 2) < window.innerWidth / 2) return false;
                    // It should not wrap the entire screen
                    if (rect.width > window.innerWidth * 0.9) return false;
                    // It should not be the conversation view itself or its parent
                    if (el === chat || el.contains(chat) || chat.contains(el)) return false;
                    return true;
                });
                
                if (candidates.length > 0) {
                    // Sort by area (smallest first) to get the most specific container
                    candidates.sort((a, b) => {
                        const aRect = a.getBoundingClientRect();
                        const bRect = b.getBoundingClientRect();
                        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
                    });
                    rightPane = candidates[0];
                }
            }
            
            if (!rightPane) {
                return '<div style="padding: 20px; color: #94a3b8; text-align: center; margin-top: 50px;">Right pane is not open on desktop.</div>';
            }
            
            const clone = rightPane.cloneNode(true);
            
            // Strip hidden elements to save payload
            clone.querySelectorAll('*').forEach(el => {
                if (el.style && el.style.display === 'none') {
                    el.remove();
                }
            });
            
            return clone.innerHTML;
        } catch (e) {
            return '<div style="padding: 20px; color: #94a3b8; text-align: center;">Error capturing pane: ' + e.message + '</div>';
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result && res.result.value) {
                return { hasFiles: true, html: res.result.value };
            }
        } catch (e) { }
    }
    
    return { hasFiles: false, html: '' };
}
