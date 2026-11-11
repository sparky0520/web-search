// Client Application State
let currentSessionId = null;
let activeAbortController = null;
let currentSources = new Map(); // n -> source object
let activeStreamingText = '';
let activeMessageElement = null;

const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

// DOM Elements
const sessionListEl = document.getElementById('session-list');
const messagesContainerEl = document.getElementById('messages-container');
const chatFormEl = document.getElementById('chat-form');
const chatInputEl = document.getElementById('chat-input');
const sendBtnEl = document.getElementById('send-btn');
const stopBtnEl = document.getElementById('stop-btn');
const turnStatusContainerEl = document.getElementById('turn-status-container');
const statusTextEl = document.getElementById('status-text');
const liveSourcesTrayEl = document.getElementById('live-sources-tray');
const welcomeCardEl = document.getElementById('welcome-card');
const currentChatTitleEl = document.getElementById('current-chat-title');
const currentClockEl = document.getElementById('current-clock');
const newChatBtn = document.getElementById('new-chat-btn');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sidebarEl = document.getElementById('sidebar');
const debugPanelEl = document.getElementById('debug-panel');
const debugContentEl = document.getElementById('debug-content');
const closeDebugBtn = document.getElementById('close-debug-btn');

// Check ?debug=1
const urlParams = new URLSearchParams(window.location.search);
const isDebugMode = urlParams.get('debug') === '1';
if (isDebugMode && debugPanelEl) {
  debugPanelEl.style.display = 'flex';
}

if (closeDebugBtn) {
  closeDebugBtn.addEventListener('click', () => {
    debugPanelEl.style.display = 'none';
  });
}

function logDebug(type, data) {
  if (!isDebugMode || !debugContentEl) return;
  const entry = document.createElement('div');
  entry.className = 'debug-entry';
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${type}: ${JSON.stringify(data, null, 2)}`;
  debugContentEl.appendChild(entry);
  debugContentEl.scrollTop = debugContentEl.scrollHeight;
}

// Clock Display
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
  currentClockEl.textContent = `${dateStr}, ${timeStr} (${userTz})`;
}
setInterval(updateClock, 30000);
updateClock();

// Sidebar Toggle
toggleSidebarBtn.addEventListener('click', () => {
  sidebarEl.classList.toggle('open');
});

// Load Sessions in Left Rail
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return;
    const data = await res.json();
    renderSessionList(data.sessions || []);
  } catch (err) {
    console.warn('Failed to load sessions:', err);
  }
}

function renderSessionList(sessions) {
  sessionListEl.innerHTML = '';
  if (sessions.length === 0) {
    sessionListEl.innerHTML = '<p class="muted" style="padding: 8px; font-size: 0.8rem;">No saved chats.</p>';
    return;
  }

  // Group by date (e.g. "Today", "Yesterday", or "11 Nov 2026")
  const groups = new Map();
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const s of sessions) {
    const d = new Date(s.createdAt);
    let label = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    if (d.toDateString() === todayStr) label = 'Today';
    else if (d.toDateString() === yesterdayStr) label = 'Yesterday';

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(s);
  }

  for (const [groupLabel, groupSessions] of groups.entries()) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'date-group';

    const header = document.createElement('div');
    header.className = 'date-group-header';
    header.textContent = groupLabel;
    groupDiv.appendChild(header);

    for (const s of groupSessions) {
      const itemBtn = document.createElement('button');
      itemBtn.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
      itemBtn.textContent = s.title || 'Untitled Chat';
      itemBtn.title = s.title;
      itemBtn.addEventListener('click', () => selectSession(s.id));
      groupDiv.appendChild(itemBtn);
    }

    sessionListEl.appendChild(groupDiv);
  }
}

async function selectSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    const session = await res.json();
    currentSessionId = session.id;
    currentChatTitleEl.textContent = session.title;
    sidebarEl.classList.remove('open');

    // Render session messages
    welcomeCardEl.style.display = 'none';
    messagesContainerEl.innerHTML = '';

    for (const msg of session.messages) {
      appendRenderedMessage(msg.role, msg.content, msg.sources, msg.ts);
    }

    loadSessions();
  } catch (err) {
    console.error('Error fetching session:', err);
  }
}

newChatBtn.addEventListener('click', () => {
  currentSessionId = null;
  currentChatTitleEl.textContent = 'New Conversation';
  messagesContainerEl.innerHTML = '';
  welcomeCardEl.style.display = 'block';
  messagesContainerEl.appendChild(welcomeCardEl);
  loadSessions();
});

// Sample prompts click handler
document.querySelectorAll('.sample-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const prompt = chip.getAttribute('data-prompt');
    if (prompt) {
      chatInputEl.value = prompt;
      sendMessage();
    }
  });
});

// Input Keyboard handler (Enter sends, Shift+Enter adds line) & Auto-resize
chatInputEl.addEventListener('input', () => {
  chatInputEl.style.height = 'auto';
  chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 180) + 'px';
});

// Escape key closes open drawers
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (sidebarEl.classList.contains('open')) {
      sidebarEl.classList.remove('open');
    }
    if (debugPanelEl && debugPanelEl.style.display !== 'none' && !isDebugMode) {
      debugPanelEl.style.display = 'none';
    }
  }
});

chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatInputEl.style.height = 'auto';
    sendMessage();
  }
});

chatFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

// Render citation chip links with hover tooltips
function formatMarkdownWithCitations(rawMarkdown, sourcesMap) {
  let html = window.marked ? window.marked.parse(rawMarkdown) : rawMarkdown;

  // Replace [n] citations with custom interactive chips
  html = html.replace(/\[(\d+)\]/g, (match, nStr) => {
    const n = parseInt(nStr, 10);
    const source = sourcesMap.get(n);
    if (!source) {
      return `<span class="citation-chip unverified" title="Unverified citation">[${n}]</span>`;
    }
    const pub = source.publishedAt ? ` · ${source.publishedAt}` : '';
    const tooltip = `${source.title} (${source.domain}${pub})`;
    return `<a href="${source.url}" target="_blank" rel="noopener noreferrer" class="citation-chip" title="${tooltip}">[${n}]</a>`;
  });

  return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
}

function appendRenderedMessage(role, content, sources = [], ts = null) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'message-body';

  const sourcesMap = new Map();
  if (sources) {
    for (const s of sources) sourcesMap.set(s.n, s);
  }

  bodyEl.innerHTML = formatMarkdownWithCitations(content, sourcesMap);

  // Add copy button to pre code blocks
  bodyEl.querySelectorAll('pre').forEach((pre) => {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code';
    copyBtn.onclick = () => {
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
      });
    };
    pre.style.position = 'relative';
    pre.appendChild(copyBtn);
  });

  msgEl.appendChild(bodyEl);

  if (role === 'assistant') {
    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer';

    const dateFormatted = ts ? new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    let footerText = dateFormatted ? `As of ${dateFormatted}` : '';
    if (sources && sources.length > 0) {
      footerText += ` · ${sources.length} source${sources.length === 1 ? '' : 's'}`;
    }
    footerEl.textContent = footerText;

    if (sources && sources.length > 0) {
      const tray = document.createElement('div');
      tray.className = 'sources-tray';
      for (const s of sources) {
        const chip = document.createElement('a');
        chip.className = 'source-item-chip';
        chip.href = s.url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.title = `${s.title}\n${s.url}`;
        chip.textContent = `[${s.n}] ${s.domain}`;
        tray.appendChild(chip);
      }
      footerEl.appendChild(tray);
    }

    msgEl.appendChild(footerEl);
  }

  messagesContainerEl.appendChild(msgEl);
  messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

// Send Message & Handle SSE Streaming
async function sendMessage() {
  const text = chatInputEl.value.trim();
  if (!text || activeAbortController) return;

  welcomeCardEl.style.display = 'none';
  chatInputEl.value = '';
  chatInputEl.disabled = true;
  sendBtnEl.disabled = true;

  // Append user message to view
  appendRenderedMessage('user', text);

  // Setup streaming state
  currentSources.clear();
  activeStreamingText = '';
  turnStatusContainerEl.style.display = 'block';
  statusTextEl.textContent = 'Resolving context...';
  liveSourcesTrayEl.innerHTML = '';

  // Setup assistant streaming element
  activeMessageElement = document.createElement('div');
  activeMessageElement.className = 'message assistant';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'message-body';
  activeMessageElement.appendChild(bodyEl);
  messagesContainerEl.appendChild(activeMessageElement);

  activeAbortController = new AbortController();

  stopBtnEl.onclick = () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      statusTextEl.textContent = 'Stopped by user.';
      turnStatusContainerEl.style.display = 'none';
      chatInputEl.disabled = false;
      sendBtnEl.disabled = false;
      chatInputEl.focus();
    }
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: currentSessionId,
        tz: userTz,
      }),
      signal: activeAbortController.signal,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Server responded with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/event:\s*([^\n]+)/);
        const dataMatch = block.match(/data:\s*([^\n]+)/);

        if (eventMatch && dataMatch) {
          const eventType = eventMatch[1].trim();
          const eventData = JSON.parse(dataMatch[1].trim());
          handleSSEEvent(eventType, eventData, bodyEl);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      statusTextEl.textContent = 'Stopped.';
    } else {
      console.error('Chat error:', err);
      bodyEl.innerHTML += `<p class="error" style="color: var(--error-color);">Error: ${err.message}</p>`;
    }
  } finally {
    turnStatusContainerEl.style.display = 'none';
    chatInputEl.disabled = false;
    sendBtnEl.disabled = false;
    activeAbortController = null;
    chatInputEl.focus();
    loadSessions();
  }
}

function handleSSEEvent(type, data, bodyEl) {
  logDebug(type, data);

  switch (type) {
    case 'status':
      statusTextEl.textContent = data.text;
      break;

    case 'search':
      const qSummary = data.queries.map((q) => q.query).join(', ');
      statusTextEl.textContent = `Searching: ${qSummary}`;
      break;

    case 'sources':
      for (const item of data.items) {
        currentSources.set(item.n, item);

        // Add to live sources tray
        const chip = document.createElement('a');
        chip.className = 'source-item-chip';
        chip.href = item.url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.textContent = `[${item.n}] ${item.domain}`;
        liveSourcesTrayEl.appendChild(chip);
      }
      break;

    case 'delta':
      activeStreamingText += data.text;
      bodyEl.innerHTML = formatMarkdownWithCitations(activeStreamingText, currentSources);
      messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
      break;

    case 'reset':
      activeStreamingText = '';
      bodyEl.innerHTML = '';
      break;

    case 'done':
      currentSessionId = data.sessionId;
      // Append footer to completed assistant message
      const footerEl = document.createElement('div');
      footerEl.className = 'message-footer';
      const sec = (data.timings.totalMs / 1000).toFixed(1);
      const sourcesCount = currentSources.size;
      footerEl.textContent = `Completed in ${sec}s · ${sourcesCount} source${sourcesCount === 1 ? '' : 's'}`;

      if (sourcesCount > 0) {
        const tray = document.createElement('div');
        tray.className = 'sources-tray';
        for (const s of currentSources.values()) {
          const chip = document.createElement('a');
          chip.className = 'source-item-chip';
          chip.href = s.url;
          chip.target = '_blank';
          chip.rel = 'noopener noreferrer';
          chip.title = `${s.title}\n${s.url}`;
          chip.textContent = `[${s.n}] ${s.domain}`;
          tray.appendChild(chip);
        }
        footerEl.appendChild(tray);
      }

      activeMessageElement.appendChild(footerEl);
      break;

    case 'error':
      statusTextEl.textContent = `Error: ${data.message}`;
      break;
  }
}

// Initial session load
loadSessions();

