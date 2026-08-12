const API = "";

const state = {
    models: [],
    currentModel: null,
    conversations: [],
    currentConvId: null,
    streaming: false,
    autoScroll: true,
    attachments: [], // { name, mime, dataUrl, kind: 'image' }
};

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const el = {
    app: document.querySelector(".app"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    statusDot: document.getElementById("statusDot"),
    ollamaStatus: document.getElementById("ollamaStatus"),
    newChatBtn: document.getElementById("newChatBtn"),
    conversationList: document.getElementById("conversationList"),
    modelSelectBtn: document.getElementById("modelSelectBtn"),
    modelSelectLabel: document.getElementById("modelSelectLabel"),
    modelDropdown: document.getElementById("modelDropdown"),
    convTitle: document.getElementById("convTitle"),
    signalStrip: document.getElementById("signalStrip"),
    chatScroll: document.getElementById("chatScroll"),
    emptyState: document.getElementById("emptyState"),
    messages: document.getElementById("messages"),
    composerForm: document.getElementById("composerForm"),
    promptInput: document.getElementById("promptInput"),
    sendBtn: document.getElementById("sendBtn"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleLabel: document.getElementById("themeToggleLabel"),
    attachBtn: document.getElementById("attachBtn"),
    fileInput: document.getElementById("fileInput"),
    attachmentRow: document.getElementById("attachmentRow"),
    clearChatBtn: document.getElementById("clearChatBtn"),
    emptyModelBtn: document.getElementById("emptyModelBtn"),
};

marked.setOptions({ breaks: true, gfm: true });

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
init();

async function init() {
    // Sidebar toggle
    el.sidebarToggle.addEventListener("click", () => {
        el.app.classList.toggle("sidebar-collapsed");
    });

    // Close sidebar on overlay click (mobile)
    document.addEventListener("click", (e) => {
        if (window.innerWidth <= 820) {
            const sidebar = document.getElementById("sidebar");
            if (!el.app.classList.contains("sidebar-collapsed") &&
                !sidebar.contains(e.target) &&
                !el.sidebarToggle.contains(e.target) &&
                !el.newChatBtn.contains(e.target)) {
                el.app.classList.add("sidebar-collapsed");
            }
        }
    });

    // New chat
    el.newChatBtn.addEventListener("click", startNewChat);

    // Model dropdown
    el.modelSelectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        el.modelDropdown.classList.toggle("open");
    });
    document.addEventListener("click", () => el.modelDropdown.classList.remove("open"));

    // Clear chat
    el.clearChatBtn.addEventListener("click", () => {
        if (state.currentConvId) {
            if (confirm("Clear all messages in this conversation?")) {
                clearCurrentChat();
            }
        }
    });

    // Empty state model button
    el.emptyModelBtn.addEventListener("click", () => {
        el.modelDropdown.classList.toggle("open");
    });

    // Composer
    el.composerForm.addEventListener("submit", onSubmit);
    el.promptInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            el.composerForm.requestSubmit();
        }
    });
    el.promptInput.addEventListener("input", autoResize);

    // Theme
    initTheme();
    el.themeToggle.addEventListener("click", toggleTheme);

    // Attachments
    el.attachBtn.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", onFilesSelected);

    // Auto-scroll
    el.chatScroll.addEventListener("scroll", onChatScroll);

    // Load data
    await loadModels();
    await loadConversations();

    // Focus input
    el.promptInput.focus();
}

// ---------------------------------------------------------------------
// Scroll handling
// ---------------------------------------------------------------------
const SCROLL_BOTTOM_THRESHOLD = 72;

function onChatScroll() {
    const { scrollTop, scrollHeight, clientHeight } = el.chatScroll;
    state.autoScroll = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;
}

function scrollToBottom(force = false) {
    if (!force && !state.autoScroll) return;
    requestAnimationFrame(() => {
        el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
    });
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
function initTheme() {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    applyTheme(theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggleLabel.textContent = theme === "light" ? "Light mode" : "Dark mode";
    localStorage.setItem("theme", theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
}

// ---------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------
const TEXT_FILE_MAX_CHARS = 20000;

function onFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(handleFile);
    el.fileInput.value = "";
}

function handleFile(file) {
    if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
            state.attachments.push({
                name: file.name,
                mime: file.type,
                dataUrl: reader.result,
                kind: "image",
            });
            renderAttachmentRow();
            el.promptInput.focus();
        };
        reader.readAsDataURL(file);
    } else {
        const reader = new FileReader();
        reader.onload = () => {
            let content = reader.result;
            let truncated = false;
            if (content.length > TEXT_FILE_MAX_CHARS) {
                content = content.slice(0, TEXT_FILE_MAX_CHARS);
                truncated = true;
            }
            const ext = (file.name.split(".").pop() || "").toLowerCase();
            const block = `\n\nAttached file: ${file.name}${truncated ? " (truncated)" : ""}\n\`\`\`${ext}\n${content}\n\`\`\`\n`;
            el.promptInput.value = (el.promptInput.value + block).trimStart();
            autoResize();
            el.promptInput.focus();
        };
        reader.onerror = () => alert(`Couldn't read ${file.name} as text.`);
        reader.readAsText(file);
    }
}

function renderAttachmentRow() {
    if (!state.attachments.length) {
        el.attachmentRow.innerHTML = "";
        return;
    }
    el.attachmentRow.innerHTML = state.attachments
        .map(
            (a, i) => `<div class="attachment-chip">
                <img src="${a.dataUrl}" alt="" />
                <span class="chip-name">${escapeHtml(a.name)}</span>
                <button type="button" class="chip-remove" data-idx="${i}" aria-label="Remove attachment">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>`
        )
        .join("");
    el.attachmentRow.querySelectorAll(".chip-remove").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.attachments.splice(Number(btn.dataset.idx), 1);
            renderAttachmentRow();
        });
    });
}

function autoResize() {
    el.promptInput.style.height = "auto";
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + "px";
}

// ---------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------
async function loadModels() {
    try {
        const res = await fetch(`${API}/api/models`);
        if (!res.ok) throw new Error((await res.json()).detail || "failed");
        const data = await res.json();
        state.models = data.models || [];
        el.statusDot.classList.add("online");
        el.ollamaStatus.className = "status-line online";
        el.ollamaStatus.innerHTML = `<span class="status-dot"></span> ollama connected · ${state.models.length} model(s)`;
        renderModelDropdown();
        if (!state.currentModel && state.models.length) {
            setCurrentModel(state.models[0].name);
        }
    } catch (err) {
        el.statusDot.classList.remove("online");
        el.ollamaStatus.className = "status-line offline";
        el.ollamaStatus.innerHTML = `<span class="status-dot"></span> ollama unreachable`;
        el.modelDropdown.innerHTML = `<div class="empty-models">Can't reach Ollama.<br>Run "ollama serve" and reload.</div>`;
    }
}

function renderModelDropdown() {
    if (!state.models.length) {
        el.modelDropdown.innerHTML = `<div class="empty-models">No local models found.<br>Try: ollama pull llama3</div>`;
        return;
    }
    el.modelDropdown.innerHTML = state.models
        .map((m) => {
            const meta = [m.parameter_size, m.family].filter(Boolean).join(" · ");
            const selected = m.name === state.currentModel ? "selected" : "";
            return `<div class="model-option ${selected}" data-model="${m.name}">
                     <span class="m-name">${m.name}</span>
                     ${meta ? `<span class="m-meta">${meta}</span>` : ""}
                   </div>`;
        })
        .join("");
    el.modelDropdown.querySelectorAll(".model-option").forEach((node) => {
        node.addEventListener("click", () => {
            setCurrentModel(node.dataset.model);
            el.modelDropdown.classList.remove("open");
        });
    });
}

function setCurrentModel(name) {
    state.currentModel = name;
    el.modelSelectLabel.textContent = name;
    renderModelDropdown();
    if (state.currentConvId) {
        fetch(`${API}/api/conversations/${state.currentConvId}/model`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: name }),
        }).catch(() => {});
    }
}

// ---------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------
async function loadConversations() {
    try {
        const res = await fetch(`${API}/api/conversations`);
        const data = await res.json();
        state.conversations = data.conversations || [];
        renderConversationList();
    } catch (err) {
        console.error("Failed to load conversations:", err);
    }
}

function renderConversationList() {
    if (!state.conversations.length) {
        el.conversationList.innerHTML = `<div style="padding:20px 12px;text-align:center;color:var(--text-faint);font-size:13px;">No conversations yet</div>`;
        return;
    }
    el.conversationList.innerHTML = state.conversations
        .map(
            (c) => `<div class="conv-item ${c.id === state.currentConvId ? "active" : ""}" data-id="${c.id}">
                <span class="conv-label">${escapeHtml(c.title)}</span>
                <button class="conv-delete" data-id="${c.id}" title="Delete" aria-label="Delete conversation">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/>
                    </svg>
                </button>
            </div>`
        )
        .join("");

    el.conversationList.querySelectorAll(".conv-item").forEach((node) => {
        node.addEventListener("click", (e) => {
            if (e.target.closest(".conv-delete")) return;
            openConversation(node.dataset.id);
        });
    });
    el.conversationList.querySelectorAll(".conv-delete").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await fetch(`${API}/api/conversations/${btn.dataset.id}`, { method: "DELETE" });
            if (state.currentConvId === btn.dataset.id) {
                state.currentConvId = null;
                showEmptyState();
            }
            await loadConversations();
        });
    });
}

function startNewChat() {
    state.currentConvId = null;
    el.convTitle.textContent = "";
    el.messages.innerHTML = "";
    showEmptyState();
    renderConversationList();
    el.promptInput.focus();
    if (window.innerWidth <= 820) {
        el.app.classList.add("sidebar-collapsed");
    }
}

async function openConversation(id) {
    try {
        const res = await fetch(`${API}/api/conversations/${id}`);
        if (!res.ok) return;
        const conv = await res.json();
        state.currentConvId = conv.id;
        el.convTitle.textContent = conv.title;
        if (conv.model) setCurrentModel(conv.model);
        el.emptyState.style.display = "none";
        el.messages.innerHTML = "";
        conv.messages.forEach((m) => appendMessage(m.role, m.content, conv.model, false, m.id));
        renderConversationList();
        state.autoScroll = true;
        scrollToBottom(true);
        if (window.innerWidth <= 820) {
            el.app.classList.add("sidebar-collapsed");
        }
    } catch (err) {
        console.error("Failed to open conversation:", err);
    }
}

function showEmptyState() {
    el.emptyState.style.display = "block";
    el.messages.innerHTML = "";
}

async function clearCurrentChat() {
    if (!state.currentConvId) return;
    try {
        await fetch(`${API}/api/conversations/${state.currentConvId}/messages`, {
            method: "DELETE",
        });
        el.messages.innerHTML = "";
        showEmptyState();
    } catch (err) {
        console.error("Failed to clear chat:", err);
    }
}

// ---------------------------------------------------------------------
// Chat submit + streaming
// ---------------------------------------------------------------------
async function onSubmit(e) {
    e.preventDefault();
    const text = el.promptInput.value.trim();
    const attachments = state.attachments;
    if ((!text && !attachments.length) || state.streaming) return;
    if (!state.currentModel) {
        alert("No model selected. Pull a model with Ollama first, e.g. `ollama pull llama3`.");
        return;
    }

    if (!state.currentConvId) {
        try {
            const res = await fetch(`${API}/api/conversations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: state.currentModel, title: "New chat" }),
            });
            const conv = await res.json();
            state.currentConvId = conv.id;
            await loadConversations();
        } catch (err) {
            showError("Failed to create conversation.");
            return;
        }
    }

    const imageMarkdown = attachments.map((a) => `![${a.name}](${a.dataUrl})`).join("\n");
    const fullText = [imageMarkdown, text].filter(Boolean).join("\n\n");
    const rawImages = attachments.map((a) => a.dataUrl.split(",")[1]);

    el.emptyState.style.display = "none";
    const userWrap = appendMessage("user", fullText, state.currentModel);
    el.promptInput.value = "";
    state.attachments = [];
    renderAttachmentRow();
    autoResize();
    state.autoScroll = true;
    scrollToBottom(true);

    const assistantEl = appendMessage("assistant", "", state.currentModel, true);
    setStreaming(true);

    try {
        const res = await fetch(`${API}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: state.currentConvId,
                message: fullText,
                model: state.currentModel,
                images: rawImages.length ? rawImages : undefined,
            }),
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.user_message_id) {
                        userWrap.dataset.messageId = chunk.user_message_id;
                        continue;
                    }
                    if (chunk.error) {
                        showError(chunk.error);
                        continue;
                    }
                    full += chunk.content || "";
                    renderAssistantContent(assistantEl, full);
                    scrollToBottom();
                } catch (parseErr) {
                    // Skip invalid JSON
                }
            }
        }
    } catch (err) {
        showError("Lost connection to the backend.");
    } finally {
        assistantEl.querySelector(".msg-body")?.classList.remove("streaming");
        setStreaming(false);
        loadConversations();
    }
}

function setStreaming(active) {
    state.streaming = active;
    el.sendBtn.disabled = active;
    el.signalStrip.classList.toggle("active", active);
}

function appendMessage(role, content, model, streaming = false, messageId = null) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    if (messageId) wrap.dataset.messageId = messageId;
    wrap._rawContent = content || ""; // kept for Copy / Edit — not shown as HTML
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const actionsHtml = role === "user" ? `
        <div class="msg-actions">
            <button type="button" class="msg-action-btn copy-msg-btn" title="Copy" aria-label="Copy message">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
            </button>
            <button type="button" class="msg-action-btn edit-msg-btn" title="Edit" aria-label="Edit message">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
            </button>
        </div>` : "";
    wrap.innerHTML = `
        <div class="msg-meta">
            ${role === "assistant" ? `<span class="msg-badge">${escapeHtml(model || "")}</span>` : ""}
            <span>${role === "user" ? "you" : "assistant"} · ${time}</span>
            ${actionsHtml}
        </div>
        <div class="msg-body ${streaming ? "streaming" : ""}"></div>
    `;
    if (content) {
        renderAssistantContent(wrap, content);
    }
    el.messages.appendChild(wrap);

    if (role === "user") {
        wrap.querySelector(".copy-msg-btn").addEventListener("click", (e) => {
            copyUserMessage(wrap, e.currentTarget);
        });
        wrap.querySelector(".edit-msg-btn").addEventListener("click", () => {
            startEditMessage(wrap);
        });
    }

    return wrap;
}

// Strips embedded base64 image markdown so Copy/Edit deal with readable text
// only (mirrors the same cleanup the backend does before hitting Ollama).
function stripImageMarkdown(text) {
    return (text || "").replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, "").trim();
}

function copyUserMessage(wrap, btn) {
    const text = stripImageMarkdown(wrap._rawContent);
    const done = () => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1200);
    };
    navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
    });
}

// Swaps a user message into an editable textarea with Save & send / Cancel.
function startEditMessage(wrap) {
    if (state.streaming || wrap.querySelector(".edit-box")) return;

    const body = wrap.querySelector(".msg-body");
    const text = stripImageMarkdown(wrap._rawContent);

    const editBox = document.createElement("div");
    editBox.className = "edit-box";

    const ta = document.createElement("textarea");
    ta.className = "edit-textarea";
    ta.value = text;
    ta.rows = 1;

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML = `
        <button type="button" class="edit-cancel">Cancel</button>
        <button type="button" class="edit-send">Save &amp; send</button>
    `;

    editBox.appendChild(ta);
    editBox.appendChild(actions);
    body.style.display = "none";
    wrap.appendChild(editBox);

    const resize = () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
    };
    resize();
    ta.addEventListener("input", resize);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const cancel = () => {
        editBox.remove();
        body.style.display = "";
    };

    actions.querySelector(".edit-cancel").addEventListener("click", cancel);
    actions.querySelector(".edit-send").addEventListener("click", () => {
        const newText = ta.value.trim();
        if (!newText) return;
        resendEditedMessage(wrap, newText);
    });

    ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            actions.querySelector(".edit-send").click();
        } else if (e.key === "Escape") {
            cancel();
        }
    });
}

// Deletes this message + everything after it (server and UI), then resends
// the edited text through the normal submit flow so a fresh reply is generated.
async function resendEditedMessage(wrap, newText) {
    const messageId = wrap.dataset.messageId;
    if (!state.currentConvId || !messageId) {
        showError("Can't edit this message yet — please wait a moment and try again.");
        return;
    }

    try {
        const res = await fetch(
            `${API}/api/conversations/${state.currentConvId}/messages/from/${messageId}`,
            { method: "DELETE" }
        );
        if (!res.ok) throw new Error("delete failed");
    } catch (err) {
        showError("Couldn't update the conversation on the server.");
        return;
    }

    let node = wrap;
    while (node) {
        const next = node.nextElementSibling;
        node.remove();
        node = next;
    }

    el.promptInput.value = newText;
    autoResize();
    el.composerForm.requestSubmit();
}

function renderAssistantContent(wrapEl, content) {
    const body = wrapEl.querySelector(".msg-body");
    if (!body) return;
    body.innerHTML = marked.parse(content || "");
    body.querySelectorAll("img").forEach((img) => img.classList.add("attached-image"));
    body.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block);
        addCopyButton(block);
    });
}

function addCopyButton(codeEl) {
    const pre = codeEl.closest("pre");
    if (!pre || pre.parentElement.classList.contains("code-block")) return;

    const lang = (codeEl.className.match(/language-(\w+)/) || [])[1] || "text";

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";
    toolbar.innerHTML = `<span>${lang}</span>
        <button type="button" class="copy-code-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            <span class="copy-label">Copy</span>
        </button>`;

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);

    const btn = toolbar.querySelector(".copy-code-btn");
    btn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(codeEl.textContent);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = codeEl.textContent;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        const label = btn.querySelector(".copy-label");
        btn.classList.add("copied");
        label.textContent = "Copied";
        setTimeout(() => {
            btn.classList.remove("copied");
            label.textContent = "Copy";
        }, 1500);
    });
}

function showError(msg) {
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.textContent = msg;
    el.messages.appendChild(banner);
    scrollToBottom(true);
}

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}