export async function clickElement(cdp, { selector, index = 0, textContent }) {
    const safeText = JSON.stringify(textContent || '');
    const safeIndex = Number(index) || 0;

    const EXP = `(async () => {
        try {
            // Search the full document first — sidebar pills, action buttons, etc. live outside chat containers
            let elements = Array.from(document.querySelectorAll('${selector}')).filter(el => el.offsetParent !== null);
            
            // If nothing found at document level, also try shadow DOM roots
            if (elements.length === 0) {
                document.querySelectorAll('*').forEach(el => {
                    try {
                        if (el.shadowRoot) {
                            elements = elements.concat(Array.from(el.shadowRoot.querySelectorAll('${selector}')).filter(e => e.offsetParent !== null));
                        }
                    } catch(e) {}
                });
            }
            
            const filterText = ${safeText};
            if (filterText) {
                elements = elements.filter(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const firstLine = txt.split('\\n')[0].trim();
                    // Match if first line matches (thought blocks) or if it contains the label (buttons)
                    return firstLine === filterText || txt.includes(filterText);
                });
                
                // CRITICAL: If elements are nested (e.g. <div><span>Text</span></div>), 
                // both will match. We only want the most specific (inner-most) one.
                elements = elements.filter(el => {
                    return !elements.some(other => other !== el && el.contains(other));
                });
            }

            const idx = ${safeIndex};
            const target = elements[idx];

            if (target) {
                // Focus and Click
                if (target.focus) target.focus();
                target.click();
                return { success: true, found: elements.length, indexUsed: idx };
            }
            
            return { error: 'Element not found at index ' + idx + ' among ' + elements.length + ' matches', selector: '${selector}', filterText: filterText };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
            // If we found it but click didn't return success (unlikely with this script), continue to next context
        } catch (e) { }
    }
    return { error: 'Click failed in all contexts or element not found at index' };
}

// Remote scroll - sync phone scroll to desktop
export async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const convViews = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
            const convView = convViews.find(el => el.offsetParent !== null) || convViews[convViews.length - 1];
            const scrollables = [...document.querySelectorAll('[data-testid="conversation-view"] [class*="scroll"], #conversation [class*="scroll"], #chat [class*="scroll"], #cascade [class*="scroll"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('[data-testid="conversation-view"] .overflow-y-auto, [data-testid="conversation-view"] [data-scroll-area]') ||
                document.querySelector('#conversation .overflow-y-auto, #chat .overflow-y-auto, #cascade .overflow-y-auto');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main container element
                const cascade = convView || document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}
