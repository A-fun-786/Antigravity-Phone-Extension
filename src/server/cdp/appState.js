// Get App State (Mode & Model)
export async function getAppState(cdp) {
    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown' };

        // 1. Get Mode (Fast/Planning)
        // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
        // It's usually a button or div with cursor:pointer containing the mode text
        const allEls = Array.from(document.querySelectorAll('*'));

        // Find elements that are likely mode buttons
        for (const el of allEls) {
            if (el.children.length > 0) continue;
            const text = (el.innerText || '').trim();
            if (text !== 'Fast' && text !== 'Planning') continue;

            // Check if this or a parent is clickable (the actual mode selector)
            let current = el;
            for (let i = 0; i < 5; i++) {
                if (!current) break;
                const style = window.getComputedStyle(current);
                if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                    state.mode = text;
                    break;
                }
                current = current.parentElement;
            }
            if (state.mode !== 'Unknown') break;
        }

        // Fallback: Just look for visible text
        if (state.mode === 'Unknown') {
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
            else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
        }

        // 2. Get Model
        // Strategy: Look for leaf text nodes containing a known model keyword
        const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
        const textNodes2 = allEls.filter(el => el.children.length === 0 && el.innerText);
        
        // First try: find inside a clickable parent (button, cursor:pointer)
        let modelEl = textNodes2.find(el => {
            const txt = el.innerText.trim();
            if (!KNOWN_MODELS.some(k => txt.includes(k))) return false;
            // Must be in a clickable context (header/toolbar, not chat content)
            let parent = el;
            for (let i = 0; i < 8; i++) {
                if (!parent) break;
                if (parent.tagName === 'BUTTON' || window.getComputedStyle(parent).cursor === 'pointer') return true;
                parent = parent.parentElement;
            }
            return false;
        });
        
        // Fallback: any leaf node with a known model name
        if (!modelEl) {
            modelEl = textNodes2.find(el => {
                const txt = el.innerText.trim();
                return KNOWN_MODELS.some(k => txt.includes(k)) && txt.length < 60;
            });
        }

        if (modelEl) {
            state.model = modelEl.innerText.trim();
        }

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}
