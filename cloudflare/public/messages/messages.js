import { api, ensureIdentity, nav, stateLabel } from '/common.js';

nav('messages');

const ACTIVE_CONVERSATION_KEY = 'zungun.activeConversationId';
const PENDING_MESSAGES_KEY = 'zungun.pendingMessages.v1';
const MOBILE_PANE_QUERY = '(max-width:720px)';
let me = null;
let current = null;
let ws = null;
let lastSeq = 0;
let conversations = [];
const pendingSends = new Map();

const convs = document.getElementById('conversations');
const msgs = document.getElementById('messages');
const socket = document.getElementById('socket');
const socketLabel = socket.querySelector('.connection-label');
const sendForm = document.getElementById('send');
const sendButton = sendForm.querySelector('.send-button');
const messageInput = sendForm.elements.body;
const hint = document.getElementById('composer-hint');
const search = document.getElementById('conversation-search');
const empty = document.getElementById('thread-empty');
const threadPane = document.getElementById('thread-pane');

function isMobileLayout() {
  return window.matchMedia(MOBILE_PANE_QUERY).matches;
}

function initials(name) {
  return String(name || 'Z').trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0] || '').join('').toUpperCase() || 'Z';
}

function formatTime(ms) {
  if (!Number.isFinite(Number(ms))) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(Number(ms)));
}

function setSocket(label, state = 'offline') {
  socketLabel.textContent = label;
  socket.dataset.state = state;
}

function updateComposer() {
  const uncertain = pendingSends.size > 0;
  const ready = Boolean(current && me && messageInput.value.trim() && !uncertain);
  sendButton.disabled = !ready;
  messageInput.disabled = uncertain || !current;
  hint.textContent = uncertain
    ? 'A message outcome is uncertain. Check its status before sending another.'
    : current
      ? 'Sent means durable server acceptance.'
      : 'Select a conversation to send.';
}

function scrollToLatest() {
  requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

function clearSavedConversation() {
  try { sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY); } catch { /* storage may be unavailable */ }
}

function saveConversation(conversationId) {
  try { sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId); } catch { /* storage may be unavailable */ }
}

function persistPendingMessages() {
  try {
    sessionStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(Array.from(pendingSends.values())));
  } catch { /* Keep the live page functional if browser storage is disabled. */ }
}

function restorePendingMessages() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PENDING_MESSAGES_KEY) || '[]');
    if (!Array.isArray(stored)) return;
    for (const pending of stored.slice(0, 1)) {
      if (typeof pending?.messageId !== 'string' || !/^msg_[a-f0-9]{32}$/.test(pending.messageId)) continue;
      if (typeof pending.body !== 'string' || pending.body.length < 1 || pending.body.length > 2000) continue;
      if (!Number.isSafeInteger(pending.clientCreatedAtMs) || !Number.isFinite(pending.clientCreatedAtMs)) continue;
      if (typeof pending.conversationId !== 'string' || !/^cv_[a-f0-9]{40}$/.test(pending.conversationId)) continue;
      pendingSends.set(pending.messageId, pending);
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_MESSAGES_KEY); } catch { /* Ignore inaccessible storage. */ }
  }
}

function showThread({ restoring = false } = {}) {
  const alreadyOpen = document.body.classList.contains('conversation-open');
  document.body.classList.add('conversation-open');
  threadPane.removeAttribute('aria-hidden');

  if (isMobileLayout() && !restoring && !alreadyOpen && location.hash !== '#conversation') {
    history.pushState(
      { ...(history.state || {}), zungunMessagesPane: 'thread' },
      '',
      location.pathname + location.search + '#conversation',
    );
  }
}

function showList({ fromHistory = false } = {}) {
  if (!fromHistory && isMobileLayout()
    && location.hash === '#conversation'
    && history.state?.zungunMessagesPane === 'thread') {
    history.back();
    return;
  }

  document.body.classList.remove('conversation-open');
  threadPane.setAttribute('aria-hidden', 'true');
  clearSavedConversation();
  closeSocket();
  current = null;
  lastSeq = 0;
  updateComposer();
  search.focus({ preventScroll: true });
}

function renderConversationList() {
  const q = search.value.trim().toLocaleLowerCase();
  convs.innerHTML = '';
  const visible = conversations.filter((conversation) =>
    String(conversation.peer?.displayName || '').toLocaleLowerCase().includes(q));

  if (!visible.length) {
    convs.innerHTML = '<div class="muted">' +
      (conversations.length ? 'No matching conversations.' : 'No conversations yet.') + '</div>';
    return;
  }

  for (const conversation of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-row';
    button.dataset.conversationId = conversation.conversationId;
    button.setAttribute(
      'aria-current',
      current?.conversationId === conversation.conversationId ? 'true' : 'false',
    );
    button.setAttribute('aria-label', 'Open conversation with ' + conversation.peer.displayName);

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = initials(conversation.peer.displayName);

    const copy = document.createElement('span');
    copy.className = 'conversation-copy';
    const name = document.createElement('span');
    name.className = 'conversation-name';
    name.textContent = conversation.peer.displayName;
    const preview = document.createElement('span');
    preview.className = 'conversation-preview';
    preview.textContent = current?.conversationId === conversation.conversationId
      ? 'Open conversation'
      : 'Tap to open';
    copy.append(name, preview);

    const chevron = document.createElement('span');
    chevron.className = 'conversation-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';

    button.append(avatar, copy, chevron);
    button.addEventListener('click', () => { void openConversation(conversation); });
    convs.append(button);
  }
}

async function loadConversations() {
  if (!me) {
    conversations = [];
    convs.innerHTML = '<div class="notice">Create an identity to start messaging.</div>';
    return;
  }

  try {
    const result = await api('/api/v1/conversations', { method: 'GET', headers: {} });
    conversations = Array.isArray(result.items) ? result.items : [];
    renderConversationList();
  } catch (error) {
    convs.innerHTML = '<div class="error">Could not load conversations.</div>';
    throw error;
  }
}

function messageNode(messageId) {
  return document.getElementById('msg-' + messageId);
}

function updateMessageState(messageId, state) {
  const element = messageNode(messageId);
  if (!element) return false;
  const label = element.querySelector('.message-state');
  if (label) label.textContent = stateLabel(state);
  element.dataset.deliveryState = state;
  return true;
}

function addSafeRetry(messageId) {
  const element = messageNode(messageId);
  if (!element) return;
  let action = element.querySelector('.message-reconcile');
  if (!action) {
    action = document.createElement('button');
    action.type = 'button';
    action.className = 'message-reconcile';
    action.addEventListener('click', () => { void reconcileOrRetry(messageId); });
    element.append(action);
  }
  action.textContent = 'Retry same message safely';
  action.setAttribute('aria-label', 'Retry same message safely');
  action.disabled = false;
}

function render(message, stateOverride = null) {
  lastSeq = Math.max(lastSeq, Number(message.sequence) || 0);
  const existing = messageNode(message.messageId);
  if (existing) {
    const body = existing.querySelector('.message-body');
    if (body) body.textContent = message.body;
    const label = existing.querySelector('.message-state');
    if (label) {
      const state = stateOverride || (
        message.senderId === me?.userId
          ? (message.deliveredAtMs ? 'DELIVERED' : 'SENT')
          : 'DELIVERED'
      );
      label.textContent = stateOverride && !['SENT', 'DELIVERED', 'QUEUED', 'UNKNOWN', 'REJECTED'].includes(stateOverride)
        ? stateOverride
        : state === 'DELIVERED' && message.senderId !== me?.userId
          ? 'Delivered to this client'
          : stateLabel(state);
      existing.dataset.deliveryState = state;
    }
    const time = existing.querySelector('.message-time');
    if (time) time.textContent = formatTime(message.acceptedAtMs || message.clientCreatedAtMs);
    if (!stateOverride || stateOverride === 'SENT' || stateOverride === 'DELIVERED') {
      existing.querySelector('.message-reconcile')?.remove();
    }
    return;
  }

  empty?.remove();
  const element = document.createElement('div');
  element.id = 'msg-' + message.messageId;
  element.className = 'message' + (message.senderId === me?.userId ? ' mine' : '');

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = message.body;

  const metadata = document.createElement('small');
  const state = document.createElement('span');
  state.className = 'message-state';
  const deliveryState = stateOverride || (
    message.senderId === me?.userId
      ? (message.deliveredAtMs ? 'DELIVERED' : 'SENT')
      : 'DELIVERED'
  );
  state.textContent = stateOverride && !['SENT', 'DELIVERED', 'QUEUED', 'UNKNOWN', 'REJECTED'].includes(stateOverride)
    ? stateOverride
    : deliveryState === 'DELIVERED' && message.senderId !== me?.userId
      ? 'Delivered to this client'
      : stateLabel(deliveryState);
  element.dataset.deliveryState = deliveryState;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(message.acceptedAtMs || message.clientCreatedAtMs);
  metadata.append(state, time);
  element.append(body, metadata);
  msgs.append(element);

  if (message.senderId !== me?.userId && !message.deliveredAtMs && current?.conversationId) {
    const conversationId = current.conversationId;
    api(
      '/api/v1/conversations/' + conversationId + '/messages/' +
        encodeURIComponent(message.messageId) + '/ack',
      { method: 'POST', body: '{}' },
    ).then((result) => {
      if (current?.conversationId !== conversationId) return;
      render(result.message);
    }).catch(() => {
      /* A later poll/reconnect can retry the ACK without inventing delivery. */
    });
  }

  scrollToLatest();
}

function renderPending(pending) {
  render({
    messageId: pending.messageId,
    senderId: me.userId,
    body: pending.body,
    clientCreatedAtMs: pending.clientCreatedAtMs,
    acceptedAtMs: null,
    deliveredAtMs: null,
  }, 'Sending…');
}

function clearPending(messageId, message) {
  const pending = pendingSends.get(messageId);
  pendingSends.delete(messageId);
  persistPendingMessages();
  if (message) render(message);
  if (pending && messageInput.value.trim() === pending.body) {
    sendForm.reset();
    messageInput.style.height = 'auto';
  }
  updateComposer();
}

function setPendingUnknown(messageId) {
  persistPendingMessages();
  updateMessageState(messageId, 'UNKNOWN');
  addSafeRetry(messageId);
  updateComposer();
}

async function reconcileOrRetry(messageId) {
  const pending = pendingSends.get(messageId);
  if (!pending || !current || current.conversationId !== pending.conversationId) return;
  const element = messageNode(messageId);
  const action = element?.querySelector('.message-reconcile');
  if (action) {
    action.disabled = true;
    action.textContent = 'Checking status…';
  }
  updateMessageState(messageId, 'UNKNOWN');

  const messageUrl = '/api/v1/conversations/' + pending.conversationId +
    '/messages/' + encodeURIComponent(messageId);
  try {
    const result = await api(messageUrl, { method: 'GET', headers: {} });
    clearPending(messageId, result.message);
    return;
  } catch (error) {
    if (error.status !== 404) {
      setPendingUnknown(messageId);
      return;
    }
  }

  // Only a confirmed 404 permits another POST, and it reuses the original identity.
  try {
    const result = await api(
      '/api/v1/conversations/' + pending.conversationId + '/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          messageId: pending.messageId,
          body: pending.body,
          clientCreatedAtMs: pending.clientCreatedAtMs,
        }),
      },
    );
    clearPending(messageId, result.message);
  } catch {
    setPendingUnknown(messageId);
  }
}

async function poll() {
  if (!current) return;
  const conversationId = current.conversationId;
  try {
    const result = await api(
      '/api/v1/conversations/' + conversationId + '/messages?after=' + lastSeq,
      { method: 'GET', headers: {} },
    );
    if (current?.conversationId !== conversationId) return;
    result.items.forEach((message) => render(message));
  } catch {
    setSocket('Reconnecting', 'polling');
  }
}

function closeSocket() {
  if (ws) {
    try { ws.close(); } catch { /* already closed */ }
    ws = null;
  }
}

function connect() {
  closeSocket();
  if (!current) return;
  const conversationId = current.conversationId;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  setSocket('Connecting', 'connecting');
  ws = new WebSocket(protocol + '//' + location.host +
    '/api/v1/conversations/' + conversationId + '/ws');

  ws.onopen = () => {
    if (current?.conversationId !== conversationId) return;
    setSocket('Live', 'live');
    void poll();
  };
  ws.onclose = () => {
    if (current?.conversationId !== conversationId) return;
    setSocket('Reconnecting', 'polling');
    setTimeout(() => {
      if (current?.conversationId === conversationId) connect();
    }, 2500);
  };
  ws.onerror = () => {
    if (current?.conversationId === conversationId) setSocket('Reconnecting', 'polling');
  };
  ws.onmessage = (event) => {
    if (event.data === 'pong') return;
    try {
      const update = JSON.parse(event.data);
      if (update.type === 'message' && current?.conversationId === conversationId) {
        render(update.message);
      }
      if (update.type === 'delivery_ack') {
        const element = messageNode(update.messageId);
        if (element?.classList.contains('mine')) updateMessageState(update.messageId, 'DELIVERED');
      }
    } catch {
      /* Ignore an invalid frame without modifying delivery-state claims. */
    }
  };
}

async function openConversation(conversation, { restoring = false } = {}) {
  current = conversation;
  lastSeq = 0;
  msgs.innerHTML = '';
  document.getElementById('chat-title').textContent = conversation.peer.displayName;
  document.getElementById('chat-subtitle').textContent = 'Application-level delivery acknowledgement';
  document.getElementById('chat-avatar').textContent = initials(conversation.peer.displayName);
  saveConversation(conversation.conversationId);
  renderConversationList();
  showThread({ restoring });
  updateComposer();
  await poll();
  connect();
  messageInput.focus({ preventScroll: true });
}

window.addEventListener('zungun-identity', (event) => {
  me = event.detail;
  void loadConversations();
  updateComposer();
});

window.addEventListener('zungun-signout', () => {
  me = null;
  current = null;
  pendingSends.clear();
  persistPendingMessages();
  closeSocket();
  msgs.innerHTML = '';
  setSocket('Offline', 'offline');
  clearSavedConversation();
  void showList({ fromHistory: true });
  void loadConversations();
  updateComposer();
});

restorePendingMessages();
const initialMe = await ensureIdentity();
if (initialMe && !me) {
  me = initialMe;
  await loadConversations();
}
if (initialMe) {
  const savedId = (() => {
    try { return sessionStorage.getItem(ACTIVE_CONVERSATION_KEY); } catch { return null; }
  })();
  const pendingConversationId = pendingSends.values().next().value?.conversationId;
  const restoreConversationId = savedId || pendingConversationId;
  const savedConversation = conversations.find((conversation) => conversation.conversationId === restoreConversationId);
  if (savedConversation) {
    await openConversation(savedConversation, { restoring: true });
    for (const pending of pendingSends.values()) {
      if (pending.conversationId !== savedConversation.conversationId) continue;
      if (!messageNode(pending.messageId)) renderPending(pending);
      const state = messageNode(pending.messageId)?.dataset.deliveryState;
      if (state !== 'SENT' && state !== 'DELIVERED') setPendingUnknown(pending.messageId);
      await reconcileOrRetry(pending.messageId);
    }
  } else if (location.hash === '#conversation') {
    history.replaceState(
      { ...(history.state || {}), zungunMessagesPane: undefined },
      '',
      location.pathname + location.search,
    );
  }
}
updateComposer();

document.getElementById('pair').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const error = document.getElementById('pair-error');
  error.textContent = '';
  try {
    const result = await api('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ pairingCode: String(formData.get('code')).toUpperCase() }),
    });
    form.reset();
    await loadConversations();
    await openConversation(result.conversation);
  } catch (caught) {
    error.textContent = caught.message;
  }
});

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('send-error');
  error.textContent = '';
  if (!current) {
    error.textContent = 'Choose a conversation first.';
    return;
  }
  if (pendingSends.size) {
    error.textContent = 'Check the uncertain message before sending another.';
    return;
  }

  const body = messageInput.value.trim();
  if (!body) return;
  const pending = {
    messageId: 'msg_' + crypto.randomUUID(),
    body,
    clientCreatedAtMs: Date.now(),
    conversationId: current.conversationId,
  };
  pendingSends.set(pending.messageId, pending);
  persistPendingMessages();
  renderPending(pending);
  updateComposer();
  sendForm.setAttribute('aria-busy', 'true');

  try {
    const result = await api(
      '/api/v1/conversations/' + pending.conversationId + '/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          messageId: pending.messageId,
          body: pending.body,
          clientCreatedAtMs: pending.clientCreatedAtMs,
        }),
      },
    );
    clearPending(pending.messageId, result.message);
  } catch {
    // Never turn an ambiguous POST response into a different message identity.
    setPendingUnknown(pending.messageId);
    await reconcileOrRetry(pending.messageId);
  } finally {
    sendForm.removeAttribute('aria-busy');
    updateComposer();
    if (current?.conversationId === pending.conversationId) {
      messageInput.focus({ preventScroll: true });
    }
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 124) + 'px';
  updateComposer();
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!sendButton.disabled) sendForm.requestSubmit();
  }
});

search.addEventListener('input', renderConversationList);
document.getElementById('back-to-list').addEventListener('click', () => { showList(); });

window.addEventListener('offline', () => {
  closeSocket();
  setSocket('Offline', 'offline');
});

window.addEventListener('online', () => {
  if (current) connect();
});

window.addEventListener('popstate', () => {
  if (isMobileLayout() && document.body.classList.contains('conversation-open')
    && location.hash !== '#conversation') {
    showList({ fromHistory: true });
  }
});

setInterval(() => {
  if (current) void poll();
}, 5000);
