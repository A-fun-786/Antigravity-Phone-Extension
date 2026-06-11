import fs from 'fs';
import { SERVER_PORT } from '../config.js';
import { getPathFromRoot } from '../utils/paths.js';

// Inject message into Antigravity
export async function injectMessage(cdp, text, base64Image = null, waitMs = 1500) {
    let imageUrl = null;
    let textWithImage = text;

    if (base64Image) {
        try {
            const tempUploadsDir = getPathFromRoot('public', 'temp_uploads');
            if (!fs.existsSync(tempUploadsDir)) {
                fs.mkdirSync(tempUploadsDir, { recursive: true });
            }

            // Cleanup old files (> 24 hours)
            try {
                const files = fs.readdirSync(tempUploadsDir);
                const now = Date.now();
                for (const file of files) {
                    const filePath = getPathFromRoot('public', 'temp_uploads', file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                    }
                }
            } catch (err) {}

            const parts = base64Image.split(',');
            if (parts.length === 2) {
                const mimeMatch = parts[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                const ext = mime.split('/')[1] || 'png';
                const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
                const buffer = Buffer.from(parts[1], 'base64');
                fs.writeFileSync(getPathFromRoot('public', 'temp_uploads', filename), buffer);
                imageUrl = `http://localhost:${SERVER_PORT}/temp_uploads/${filename}`;
                textWithImage = `${text}\n\n[Attached Image: ${imageUrl}]`;
            }
        } catch (e) {
            console.error('[injectMessage] Error saving temp image:', e);
        }
    }

    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(textWithImage);
    const safeImage = JSON.stringify(base64Image || '');

    const EXPRESSION = `(async () => {
        const logs = [];
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            return { ok:false, reason:"busy", logs };
        }

        const editors = [...document.querySelectorAll('[data-testid="conversation-view"] [contenteditable="true"], #conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"]')]
            .filter(el => el.offsetParent !== null);
        // Fallback: search entire document if scoped search finds nothing
        const allEditors = editors.length > 0 ? editors : [...document.querySelectorAll('[contenteditable="true"]')].filter(el => el.offsetParent !== null);
        const editor = allEditors.at(-1);
        if (!editor) {
            return { ok:false, error:"editor_not_found", logs };
        }
        logs.push("editor_found");

        const textToInsert = ${safeText};
        const imageToInsert = ${safeImage};

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);
        logs.push("editor_cleared");

        let inserted = false;
        if (textToInsert) {
            try { 
                inserted = !!document.execCommand?.("insertText", false, textToInsert); 
                logs.push("execCommand_insertText: " + inserted);
            } catch(err) {
                logs.push("execCommand_error: " + err.message);
            }
            if (!inserted) {
                editor.textContent = textToInsert;
                logs.push("textContent_fallback_set");
                // Only dispatch full InputEvents if we manually set textContent
                editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data: textToInsert }));
                editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
                logs.push("input_events_dispatched");
            } else {
                // If inserted naturally, just dispatch a generic input event so framework detects changes
                // without adding the text AGAIN via the data property.
                editor.dispatchEvent(new Event("input", { bubbles:true }));
            }
        }

        if (imageToInsert) {
            try {
                const parts = imageToInsert.split(',');
                if (parts.length === 2) {
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                    const bstr = atob(parts[1]);
                    let n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    while (n--) {
                        u8arr[n] = bstr.charCodeAt(n);
                    }
                    const blob = new Blob([u8arr], { type: mime });
                    const file = new File([blob], "image.png", { type: mime });
                    
                    const dt = new DataTransfer();
                    dt.items.add(file);

                    // 1. File Input method (Highly reliable for React web apps)
                    const fileInput = document.querySelector('input[type="file"]');
                    if (fileInput) {
                        fileInput.value = '';
                        fileInput.files = dt.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        logs.push("file_input_changed");
                    } else {
                        // 2. Try ClipboardEvent paste
                        const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
                        if (!pasteEvent.clipboardData) {
                            try { Object.defineProperty(pasteEvent, 'clipboardData', { value: dt, writable: false, configurable: true }); } catch(err) {}
                        }
                        editor.dispatchEvent(pasteEvent);
                        logs.push("paste_event_dispatched");
                    }
                }
            } catch(e) {
                logs.push("image_insert_error: " + e.message);
            }
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // Wait significantly longer if there was an image, to ensure React finishes attaching/previewing it before we hit send
        if (imageToInsert) {
            await new Promise(r => setTimeout(r, ${waitMs}));
        }

        const submit = document.querySelector('[data-testid="send-button"], [data-tooltip-id="input-send-button-send-tooltip"], [aria-label="Send message"], svg.lucide-arrow-right')?.closest("button") || document.querySelector('[data-testid="send-button"], [data-tooltip-id="input-send-button-send-tooltip"], [aria-label="Send message"]');
        if (submit) {
            logs.push("submit_button_found");
            submit.disabled = false;
            submit.removeAttribute("disabled");
            submit.click();
            logs.push("submit_button_clicked");
            return { ok:true, method:"click_submit", logs };
        }

        // Submit button not found, but text is inserted - trigger Enter key
        logs.push("submit_button_not_found_dispatching_enter");
        const enterProps = { bubbles:true, cancelable:true, key:"Enter", code:"Enter", keyCode:13, which:13 };
        editor.dispatchEvent(new KeyboardEvent("keydown", enterProps));
        editor.dispatchEvent(new KeyboardEvent("keypress", enterProps));
        editor.dispatchEvent(new KeyboardEvent("keyup", enterProps));
        
        return { ok:true, method:"enter_keypress", logs };
    })()`;

    // Try default context first (fastest and prevents double-send)
    const defaultCtx = cdp.contexts.find(ctx => ctx.auxData?.isDefault === true) || cdp.contexts[0];
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id
            });

            if (result.exceptionDetails) {
                console.error('[CDP injectMessage] Exception in default context', defaultCtx.id, ':', result.exceptionDetails);
            }

            if (result.result && result.result.value) {
                if (result.result.value.error === "editor_not_found") {
                    // Editor not found in default context, let it fall back
                } else {
                    console.log(`[CDP injectMessage] Success in default context. Method: "${result.result.value.method}". Steps:`, result.result.value.logs);
                    return result.result.value;
                }
            }
        } catch (e) {
            console.error('[CDP injectMessage] Call failed for default context', defaultCtx.id, ':', e);
            // If the call failed because the context was navigated/destroyed, it means the submit action went through!
            if (e.message && (e.message.includes('Promise was collected') || e.message.includes('destroyed') || e.message.includes('ruined'))) {
                return { ok: true, method: "default_context_destroyed_on_submit" };
            }
        }
    }

    // Fallback to remaining contexts only if default failed/errored
    for (const ctx of cdp.contexts) {
        if (defaultCtx && ctx.id === defaultCtx.id) continue;
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.exceptionDetails) {
                console.error('[CDP injectMessage] Exception in fallback context', ctx.id, ':', result.exceptionDetails);
            }

            if (result.result && result.result.value) {
                if (result.result.value.error === "editor_not_found") {
                    continue;
                } else {
                    console.log(`[CDP injectMessage] Success in fallback context. Method: "${result.result.value.method}". Steps:`, result.result.value.logs);
                    return result.result.value;
                }
            }
        } catch (e) {
            console.error('[CDP injectMessage] Call failed for fallback context', ctx.id, ':', e);
            if (e.message && (e.message.includes('Promise was collected') || e.message.includes('destroyed') || e.message.includes('ruined'))) {
                return { ok: true, method: "fallback_context_destroyed_on_submit" };
            }
        }
    }

    return { ok: false, reason: "no_context" };
}
