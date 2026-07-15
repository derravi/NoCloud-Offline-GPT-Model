const API = "";

const state = {
  models: [],
  currentModel: null,
  conversations: [],
  currentConvId: null,
  streaming: false,
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
};

marked.setOptions({ breaks: true });

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
init();

async function init() {
  el.sidebarToggle.addEventListener("click", () => el.app.classList.toggle("sidebar-collapsed"));
  el.newChatBtn.addEventListener("click", startNewChat);
  el.modelSelectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.modelDropdown.classList.toggle("open");
  });
  document.addEventListener("click", () => el.modelDropdown.classList.remove("open"));

  el.composerForm.addEventListener("submit", onSubmit);
  el.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.composerForm.requestSubmit();
    }
  });
  el.promptInput.addEventListener("input", autoResize);

  await loadModels();
  await loadConversations();
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
    el.ollamaStatus.textContent = `ollama connected · ${state.models.length} model(s)`;
    renderModelDropdown();
    if (!state.currentModel && state.models.length) {
      setCurrentModel(state.models[0].name);
    }
  } catch (err) {
    el.statusDot.classList.remove("online");
    el.ollamaStatus.textContent = "ollama unreachable";
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
  const res = await fetch(`${API}/api/conversations`);
  const data = await res.json();
  state.conversations = data.conversations || [];
  renderConversationList();
}

function renderConversationList() {
  el.conversationList.innerHTML = state.conversations
    .map(
      (c) => `<div class="conv-item ${c.id === state.currentConvId ? "active" : ""}" data-id="${c.id}">
        <span class="conv-label">${escapeHtml(c.title)}</span>
        <button class="conv-delete" data-id="${c.id}" title="Delete" aria-label="Delete conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
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
  showEmptyState();
  renderConversationList();
  el.promptInput.focus();
}

async function openConversation(id) {
  const res = await fetch(`${API}/api/conversations/${id}`);
  if (!res.ok) return;
  const conv = await res.json();
  state.currentConvId = conv.id;
  el.convTitle.textContent = conv.title;
  if (conv.model) setCurrentModel(conv.model);
  el.emptyState.style.display = "none";
  el.messages.innerHTML = "";
  conv.messages.forEach((m) => appendMessage(m.role, m.content, conv.model));
  renderConversationList();
  scrollToBottom();
}

function showEmptyState() {
  el.emptyState.style.display = "block";
  el.messages.innerHTML = "";
}

// ---------------------------------------------------------------------
// Chat submit + streaming
// ---------------------------------------------------------------------
async function onSubmit(e) {
  e.preventDefault();
  const text = el.promptInput.value.trim();
  if (!text || state.streaming) return;
  if (!state.currentModel) {
    alert("No model selected. Pull a model with Ollama first, e.g. `ollama pull llama3`.");
    return;
  }

  if (!state.currentConvId) {
    const conv = await (
      await fetch(`${API}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: state.currentModel, title: "New chat" }),
      })
    ).json();
    state.currentConvId = conv.id;
    await loadConversations();
  }

  el.emptyState.style.display = "none";
  appendMessage("user", text, state.currentModel);
  el.promptInput.value = "";
  autoResize();
  scrollToBottom();

  const assistantEl = appendMessage("assistant", "", state.currentModel, true);
  setStreaming(true);

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: state.currentConvId,
        message: text,
        model: state.currentModel,
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
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) {
          showError(chunk.error);
          continue;
        }
        full += chunk.content || "";
        renderAssistantContent(assistantEl, full);
        scrollToBottom();
      }
    }
  } catch (err) {
    showError("Lost connection to the backend.");
  } finally {
    assistantEl.querySelector(".msg-body").classList.remove("streaming");
    setStreaming(false);
    loadConversations();
  }
}

function setStreaming(active) {
  state.streaming = active;
  el.sendBtn.disabled = active;
  el.signalStrip.classList.toggle("active", active);
}

function appendMessage(role, content, model, streaming = false) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  wrap.innerHTML = `
    <div class="msg-meta">
      ${role === "assistant" ? `<span class="msg-badge">${escapeHtml(model || "")}</span>` : ""}
      <span>${role === "user" ? "you" : "assistant"} · ${time}</span>
    </div>
    <div class="msg-body ${streaming ? "streaming" : ""}"></div>
  `;
  el.messages.appendChild(wrap);
  const body = wrap.querySelector(".msg-body");
  if (role === "user") {
    body.textContent = content;
  } else {
    renderAssistantContent(wrap, content);
  }
  return wrap;
}

function renderAssistantContent(wrapEl, content) {
  const body = wrapEl.querySelector(".msg-body");
  body.innerHTML = marked.parse(content || "");
  body.querySelectorAll("pre code").forEach((block) => hljs.highlightElement(block));
}

function showError(msg) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = msg;
  el.messages.appendChild(banner);
  scrollToBottom();
}

function scrollToBottom() {
  el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
