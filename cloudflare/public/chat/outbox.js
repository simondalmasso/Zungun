(function (root) {
  'use strict';

  const KEY = 'zungun-chat-outbox-v1';
  const MAX_MESSAGES = 100;
  const MAX_BYTES = 260_000;

  function createStore(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('OUTBOX_STORAGE_UNAVAILABLE');
    }

    function read() {
      try {
        const parsed = JSON.parse(storage.getItem(KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item =>
          item && typeof item.userId === 'string' &&
          typeof item.conversationId === 'string' &&
          typeof item.messageId === 'string' &&
          typeof item.body === 'string' &&
          Number.isSafeInteger(item.clientCreatedAtMs) &&
          Number.isSafeInteger(item.queuedAtMs) &&
          ['QUEUED', 'SENDING', 'FAILED'].includes(item.state)
        ) : [];
      } catch {
        return [];
      }
    }

    function write(items) {
      const serialized = JSON.stringify(items);
      if (items.length > MAX_MESSAGES || serialized.length > MAX_BYTES) {
        throw new Error('OUTBOX_FULL');
      }
      storage.setItem(KEY, serialized);
    }

    return {
      list(userId, conversationId) {
        return read()
          .filter(item => item.userId === userId && (!conversationId || item.conversationId === conversationId))
          .sort((a, b) => a.queuedAtMs - b.queuedAtMs);
      },
      pending(userId, transport = 'INTERNET') {
        return this.list(userId).filter(item => (item.transport || 'INTERNET') === transport && item.state !== 'FAILED' && (Number(item.nextAttemptAtMs) || 0) <= Date.now());
      },
      enqueue(record) {
        if (!record || typeof record.userId !== 'string' || typeof record.conversationId !== 'string' ||
            typeof record.messageId !== 'string' || record.messageId.length < 8 ||
            typeof record.body !== 'string' || !record.body.trim() || record.body.length > 2000 ||
            !Number.isSafeInteger(record.clientCreatedAtMs)) {
          throw new TypeError('OUTBOX_RECORD_INVALID');
        }
        const items = read();
        const existing = items.find(item => item.messageId === record.messageId && item.userId === record.userId);
        if (existing) {
          if (existing.body !== record.body || existing.conversationId !== record.conversationId) {
            throw new Error('OUTBOX_MESSAGE_ID_CONFLICT');
          }
          return existing;
        }
        const item = {
          userId: record.userId,
          conversationId: record.conversationId,
          messageId: record.messageId,
          body: record.body,
          clientCreatedAtMs: record.clientCreatedAtMs,
          queuedAtMs: Number.isSafeInteger(record.queuedAtMs) ? record.queuedAtMs : Date.now(),
          state: ['QUEUED', 'SENDING', 'FAILED'].includes(record.state) ? record.state : 'QUEUED',
          transport: record.transport === 'SATELLITE_ONLY' ? 'SATELLITE_ONLY' : 'INTERNET',
          attempts: Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
          nextAttemptAtMs: Number.isSafeInteger(record.nextAttemptAtMs) ? record.nextAttemptAtMs : 0,
          ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
        };
        write([...items, item]);
        return item;
      },
      mark(messageId, userId, nextState, lastError, nextAttemptAtMs) {
        if (!['QUEUED', 'SENDING', 'FAILED'].includes(nextState)) throw new TypeError('OUTBOX_STATE_INVALID');
        const items = read();
        const index = items.findIndex(item => item.messageId === messageId && item.userId === userId);
        if (index < 0) return false;
        const previous = items[index];
        const updated = {
          ...previous,
          state: nextState,
          attempts: (Number(previous.attempts) || 0) + (nextState === 'SENDING' ? 1 : 0),
          nextAttemptAtMs: Number.isSafeInteger(nextAttemptAtMs) ? nextAttemptAtMs : (nextState === 'QUEUED' ? 0 : 0),
        };
        if (lastError) updated.lastError = lastError;
        else delete updated.lastError;
        items[index] = updated;
        write(items);
        return true;
      },
      remove(messageId, userId) {
        const items = read();
        const kept = items.filter(item => !(item.messageId === messageId && item.userId === userId));
        if (kept.length === items.length) return false;
        write(kept);
        return true;
      },
    };
  }

  function isRetryableError(error) {
    const status = Number(error && error.status);
    if (!Number.isFinite(status) || status === 0) return true;
    return status === 408 || status === 429 || status >= 500;
  }

  const TRANSPORT_MODE_KEY = 'zungun-transport-mode-v1';

  function canSendInternet(mode, online, transport = 'INTERNET') {
    return mode === 'INTERNET' && online === true && transport === 'INTERNET';
  }

  function canUseInternetApi(mode) {
    return mode === 'INTERNET';
  }

  function connectionStatusForMode(mode, label, connected) {
    if (mode === 'INTERNET') return { label, connected: Boolean(connected) };
    if (mode !== 'SATELLITE_ONLY') return { label: 'Transporte no verificado', connected: false };
    const chatState = connected ? 'chat online' :
      (/sin conexión/i.test(String(label)) ? 'chat sin conexión' : 'chat reconectando');
    return { label: 'Satélite no verificado · ' + chatState, connected: false };
  }

  function readTransportMode(root) {
    try {
      return root && root.localStorage &&
        root.localStorage.getItem(TRANSPORT_MODE_KEY) === 'SATELLITE_ONLY'
        ? 'SATELLITE_ONLY' : 'INTERNET';
    } catch {
      return 'INTERNET';
    }
  }

  function persistTransportMode(root, mode) {
    if (!root || !['INTERNET', 'SATELLITE_ONLY'].includes(mode)) return false;
    try {
      const storage = root.localStorage;
      if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') return false;
      storage.setItem(TRANSPORT_MODE_KEY, mode);
      return storage.getItem(TRANSPORT_MODE_KEY) === mode;
    } catch {
      return false;
    }
  }

  root.ZungunOutbox = {
    createStore,
    isRetryableError,
    canSendInternet,
    canUseInternetApi,
    connectionStatusForMode,
    readTransportMode,
    persistTransportMode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
