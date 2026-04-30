// Auto-detect backend URL: same host as the page, port 8000
// Override by setting window.API_BASE before this script loads
const API_BASE = window.API_BASE ||
  `${location.protocol}//${location.hostname}:8000`;

const api = (() => {
  let _sessionId = null;
  let _ws = null;
  let _wsHandlers = {};
  let _token = '';

  function setToken(token) {
    _token = token;
  }

  function _authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    return headers;
  }

  async function createSession(levelId = 'level1') {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ level_id: levelId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to create session: ${res.status}`);
    }
    const data = await res.json();
    _sessionId = data.session_id;
    return data;
  }

  async function runCommand(sessionId, command, hclContent = null) {
    const body = { command };
    if (hclContent !== null) body.hcl_content = hclContent;

    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Run command failed: ${res.status}`);
    }
    return res.json();
  }

  function connectWebSocket(wsUrl, handlers = {}) {
    _wsHandlers = handlers;

    // Auth: append token as query param (WS doesn't support custom headers)
    const url = _token ? `${wsUrl}?token=${encodeURIComponent(_token)}` : wsUrl;
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      if (handlers.onOpen) handlers.onOpen();
    };

    _ws.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (handlers.onMessage) handlers.onMessage(frame);
    };

    _ws.onerror = (err) => {
      console.error('[WS] error', err);
      if (handlers.onError) handlers.onError(err);
    };

    _ws.onclose = (event) => {
      if (handlers.onClose) handlers.onClose(event);
    };

    return _ws;
  }

  function sendRun(command, hclContent = null) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: 'run', command };
    if (hclContent !== null) msg.hcl_content = hclContent;
    _ws.send(JSON.stringify(msg));
  }

  function ping() {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  async function deleteSession(sessionId) {
    await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: _authHeaders(),
    });
  }

  async function saveProgress(data) {
    await fetch(`${API_BASE}/api/users/me/progress`, {
      method: 'PATCH',
      headers: _authHeaders(),
      body: JSON.stringify(data),
    });
  }

  async function getProgress() {
    const res = await fetch(`${API_BASE}/api/users/me/progress`, {
      headers: _authHeaders(),
    });
    return res.ok ? res.json() : null;
  }

  return {
    setToken,
    createSession,
    runCommand,
    connectWebSocket,
    sendRun,
    ping,
    deleteSession,
    saveProgress,
    getProgress,
    get sessionId() { return _sessionId; },
  };
})();
