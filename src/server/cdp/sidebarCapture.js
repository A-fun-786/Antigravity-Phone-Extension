// Capture sidebar state (active chats)
export async function captureSidebar(cdp) {
    const SCRIPT = `(() => {
        const sidebar = document.querySelector('.bg-sidebar');
        if (!sidebar) return { error: 'Sidebar not found' };
        
        const sections = Array.from(sidebar.querySelectorAll('[class*="group/section"]'));
        const result = {
            projects: [],
            conversations: []
        };
        
        sections.forEach(sec => {
            const projectCard = sec.querySelector('[data-project-card="true"]');
            const projectTitleEl = projectCard || sec.querySelector('h2');
            let sectionName = '';
            if (projectTitleEl) {
                sectionName = (projectTitleEl.innerText || '').split('\\n')[0].trim();
            }
            
            const pills = Array.from(sec.querySelectorAll('[data-testid^="convo-pill-"]'));
            const chats = pills.map(pill => {
                const parent = pill.closest('div');
                const isActive = parent && (parent.className.includes('bg-sidebar-muted') || parent.className.includes('bg-accent'));
                return {
                    id: pill.getAttribute('data-testid').replace('convo-pill-', ''),
                    title: (pill.innerText || '').trim(),
                    isActive
                };
            });
            
            if (chats.length === 0) return;
            
            if (projectCard || (sectionName && sectionName !== 'Conversations')) {
                result.projects.push({
                    name: sectionName || 'Project',
                    chats
                });
            } else {
                result.conversations.push(...chats);
            }
        });
        
        // Fallback: If no section structure was parsed but there are convo-pills, put them in a flat list
        if (result.projects.length === 0 && result.conversations.length === 0) {
            const pills = Array.from(sidebar.querySelectorAll('[data-testid^="convo-pill-"]'));
            result.conversations = pills.map(pill => {
                const parent = pill.closest('div');
                const isActive = parent && (parent.className.includes('bg-sidebar-muted') || parent.className.includes('bg-accent'));
                return {
                    id: pill.getAttribute('data-testid').replace('convo-pill-', ''),
                    title: (pill.innerText || '').trim(),
                    isActive
                };
            });
        }
        
        return result;
    })()`;

    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) {}
    }
    return { projects: [], conversations: [] };
}
