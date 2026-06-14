// Capture agent chat snapshot
export async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        // Target Agent Mode container exclusively - MUST check visibility to avoid hidden cached DOM nodes
        const cascades = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
        const cascade = cascades.find(el => el.offsetParent !== null);
        
        if (!cascade) {
            return { error: 'Agent container not found or not visible', debug: { active: false, totalNodes: cascades.length } };
        }
        
        const cascadeStyles = window.getComputedStyle(cascade);
        const scrollContainer = cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };
        
        // Clone cascade to modify it
        const clone = cascade.cloneNode(true);
        
        // Tag interactive elements so frontend can hook them
        // 1. Artifacts/Plans
        clone.querySelectorAll('[class*="implementation"], [class*="plan"], a[href*=".md"]').forEach(el => {
            el.classList.add('artifact-card');
        });
        
        // 2. Action Buttons (Allow/Deny/Review)
        clone.querySelectorAll('button, div[role="button"]').forEach(btn => {
            const text = (btn.innerText || '').trim();
            if (text === 'Allow') btn.classList.add('agent-allow-btn');
            if (text === 'Deny') btn.classList.add('agent-deny-btn');
            if (text === 'Review Changes') btn.classList.add('agent-review-btn');
        });

        // Remove input areas to keep UI clean (we have our own input)
        // IMPORTANT: Don't remove action buttons (Allow/Deny/Review) that were tagged above
        try {
            const interactionSelectors = [
                '[contenteditable="true"]',
                '[data-lexical-editor]',
                'form',
                // Only remove actual input-related elements, not anything with 'input' in class
                '[data-testid="chat-input"]',
                '[data-testid="message-input"]',
                '[data-testid*="input-area"]',
                // Remove Lexical placeholders that ghost after editor is removed
                '[class*="placeholder"]',
                '[class*="Placeholder"]',
                '.editor-placeholder',
                '[data-placeholder]'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    // Don't remove tagged action buttons
                    if (el.classList.contains('agent-allow-btn') || 
                        el.classList.contains('agent-deny-btn') || 
                        el.classList.contains('agent-review-btn')) return;
                    try { el.remove(); } catch(e) {}
                });
            });
        } catch (globalErr) { }

        // Convert local images to base64
        const images = clone.querySelectorAll('img');
        const promises = Array.from(images).map(async (img) => {
            const rawSrc = img.getAttribute('src');
            if (rawSrc && (rawSrc.startsWith('/') || rawSrc.startsWith('vscode-file:')) && !rawSrc.startsWith('data:')) {
                try {
                    const res = await fetch(rawSrc);
                    const blob = await res.blob();
                    await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => { img.src = reader.result; r(); };
                        reader.onerror = () => r();
                        reader.readAsDataURL(blob);
                    });
                } catch(e) {}
            }
        });
        await Promise.all(promises);

        // Fix inline file references (div inside p/span)
        try {
            const inlineTags = new Set(['SPAN', 'P', 'A', 'LABEL', 'EM', 'STRONG', 'CODE']);
            const allDivs = Array.from(clone.querySelectorAll('div'));
            for (const div of allDivs) {
                try {
                    if (!div.parentNode) continue;
                    const parent = div.parentElement;
                    if (!parent) continue;
                    
                    const parentIsInline = inlineTags.has(parent.tagName) || 
                        (parent.className && (parent.className.includes('inline-flex') || parent.className.includes('inline-block')));
                        
                    if (parentIsInline) {
                        const span = document.createElement('span');
                        while (div.firstChild) {
                            span.appendChild(div.firstChild);
                        }
                        if (div.className) span.className = div.className;
                        if (div.getAttribute('style')) span.setAttribute('style', div.getAttribute('style'));
                        span.style.display = 'inline-flex';
                        span.style.alignItems = 'center';
                        span.style.verticalAlign = 'middle';
                        div.replaceWith(span);
                    }
                } catch(e) {}
            }
        } catch(e) {}
        
        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
                }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        return {
            html: html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo: scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    // Try default context first (fastest)
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });

            if (result.result?.value && !result.result.value.error) {
                return result.result.value;
            }
        } catch (e) { }
    }

    // Fallback to all contexts
    for (const ctx of cdp.contexts) {
        if (ctx.id === defaultCtx?.id) continue;
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.result?.value && !result.result.value.error) {
                return result.result.value;
            }
        } catch (e) { }
    }

    return null;
}
