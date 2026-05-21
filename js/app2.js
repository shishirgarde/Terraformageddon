// ═══════════════════════════════════════════════════════
// LEVEL 2 — Missing Config
// Editor starts with only the provider block.
// Player drives the mission from an interactive terminal.
// ═══════════════════════════════════════════════════════

const state = {
  chaos: 0,
  xp: 0,
  initDone: false,
  planPassed: false,
  applyDone: false,
  destroyDone: false,
  chaosTriggered: false,
  failAttempts: 0,
  chaosEventCount: 0,
  chaosReasons: [],
  startTime: Date.now(),
  editor: null,
  tourSkipped: false,
  sessionId: null,
  ws: null,
  commandInFlight: false,
  saveTimer: null,
};

function initDevIdentity() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get('user') || '').trim();
  if (fromQuery) {
    localStorage.setItem('tg_user', fromQuery);
  }
  const username = (localStorage.getItem('tg_user') || 'dev-user').trim();
  api.setToken(`username:${username}`);
}

function avatarSrc(char) {
  if (char === 'CTO')    return 'images/avatar-cto.png';
  if (char === 'INTERN') return 'images/avatar-intern.png';
  return 'images/avatar-system.png';
}

// ═══════════════════════════════════════════════════════
// BACKEND SESSION
// ═══════════════════════════════════════════════════════

async function initSession() {
  try {
    const session = await api.createSession('level2');
    state.sessionId = session.session_id;

    if (state.editor && session.starter_code) {
      state.editor.setValue(session.starter_code);
    }

    state.ws = api.connectWebSocket(session.ws_url, {
      onMessage: handleFrame,
      onClose: () => console.log('[WS] disconnected'),
      onError: (e) => console.error('[WS] error', e),
    });

    setInterval(() => api.ping(), 30000);
  } catch (err) {
    console.error('Failed to create session:', err);
    appendTerminalLine(`ERROR: Could not connect to backend — ${err.message}\n`);
    appendTerminalLine('Offline mode: terminal commands unavailable.\n');
  }
}

function handleFrame(frame) {
  if (frame.type === 'saved') {
    setSaveIndicator('saved');
    return;
  }

  if (frame.type === 'output') {
    appendTerminalLine(frame.line);
    return;
  }

  if (frame.type === 'started') {
    return;
  }

  if (frame.type === 'done') {
    state.commandInFlight = false;
    unlockPrompt();

    const { command, result } = frame;

    if (command === 'init') {
      if (result.success) {
        if (!state.initDone) addXP(10);
        state.initDone = true;
        queueMessages(dialogue.onInit, 1200);
      } else {
        appendTerminalLine('\n✗ Init failed. Check output above.\n');
      }
    }

    if (command === 'plan') {
      if (result.success) {
        if (!state.planPassed) addXP(20);
        state.planPassed = true;
        mapToPlanned();
        queueMessages(dialogue.onPlanSuccess, 1200);
      } else {
        state.failAttempts++;
        state.chaosTriggered = true;
        const errors = result.errors || [];
        const summary = errors[0]?.summary || 'Plan failed with invalid configuration.';
        let chaosDelta = errors.length > 0 ? 10 : 5;
        if (state.failAttempts === 2) chaosDelta = Math.round(chaosDelta * 1.5);
        if (state.failAttempts >= 3)  chaosDelta = Math.round(chaosDelta * 2);
        setChaos(state.chaos + chaosDelta, summary);
        appendTerminalLine('\n✗ Plan failed. Read the error, fix your config, re-run.\n');
        queueMessages(dialogue.onPlanFail, 1200);
      }
    }

    if (command === 'apply') {
      // Chaos: apply before any successful plan
      if (!state.planPassed && !state.chaosFiredApplyBeforePlan) {
        state.chaosFiredApplyBeforePlan = true;
        state.chaosTriggered = true;
        setChaos(state.chaos + 25, 'Ran terraform apply without ever passing terraform plan.');
        queueMessages(dialogue.onChaos, 1200);
      }

      if (result.success && result.mission_success) {
        if (!state.applyDone) addXP(50);
        state.applyDone = true;
        mapToApplied();
        queueMessages(dialogue.onApply, 1200);
      } else if (result.success && !result.mission_success) {
        state.chaosTriggered = true;
        setChaos(state.chaos + 15, 'Applied wrong resource: filename or content did not match mission parameters.');
        appendTerminalLine('\n⚠ Apply succeeded but config artifact not restored.\n');
        appendTerminalLine('Check filename = "config/app.conf" and content = "mode=production"\n');
        queueMessages([
          { char: 'CTO', text: 'Wrong file. The service is still blind. Read the briefing again.' },
          { char: 'INTERN', text: 'bro the path literally says config slash app dot conf' },
        ], 1200);
      } else {
        appendTerminalLine('\n✗ Apply failed. Check output above.\n');
      }
    }

    if (command === 'destroy') {
      if (result.success) {
        if (!state.destroyDone && state.applyDone) addXP(50);
        state.destroyDone = true;
        if (state.applyDone) {
          setChaos(0);
          mapToDestroyed();
          queueMessages(dialogue.onDestroy, 1200);
          setTimeout(showWarRoom, 3500);
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// NPC DIALOGUE
// ═══════════════════════════════════════════════════════

const dialogue = {
  onInit: [
    { char: 'INTERN', text: "wait there's no init button. how am i supposed to —" },
    { char: 'CTO',    text: "You type it. Like a real engineer. The terminal works." },
    { char: 'SYSTEM', text: "Provider ready. Workspace initialized." },
  ],
  onPlanSuccess: [
    { char: 'CTO', text: "Plan looks clean. Don't celebrate yet — apply is the part that breaks production." },
  ],
  onPlanFail: [
    { char: 'CTO',    text: "Read the error. Terraform tells you exactly what's wrong if you actually look." },
    { char: 'INTERN', text: "is it the comma. it's always the comma" },
  ],
  onChaos: [
    { char: 'CTO',    text: "You applied without planning. No buttons to save you this time." },
    { char: 'INTERN', text: "bro..." },
    { char: 'CTO',    text: "Chaos logged. This goes in the post-mortem. With your name on it." },
  ],
  onApply: [
    { char: 'SYSTEM', text: "✓ config/app.conf created. APP SERVICE booting." },
    { char: 'CTO',    text: "Service is back. Now destroy it cleanly. Infrastructure is not a souvenir." },
    { char: 'INTERN', text: "wait we're deleting it?? we just fixed it??" },
    { char: 'CTO',    text: "Terraform doesn't do keepsakes. Destroy it and move on." },
  ],
  onDestroy: [
    { char: 'SYSTEM', text: "✓ local_file.app_config destroyed. config/ removed." },
    { char: 'CTO',    text: "Clean. No drift. No orphaned resources. This is how grown-ups ship." },
    { char: 'INTERN', text: "okay typing the commands felt kind of badass not gonna lie" },
  ],
};

// ═══════════════════════════════════════════════════════
// NPC PANEL
// ═══════════════════════════════════════════════════════

let npcQueue = Promise.resolve();

function npcMessage(char, text, delay = 0) {
  npcQueue = npcQueue.then(() => new Promise(resolve => {
    setTimeout(() => {
      showTyping(char, () => {
        appendMessage(char, text);
        resolve();
      });
    }, delay);
  }));
}

function showTyping(char, cb) {
  const cls = charClass(char);
  const msgs = document.getElementById('npc-messages');

  const wrap = document.createElement('div');
  wrap.className = 'npc-msg npc-typing-row';

  const avatar = document.createElement('img');
  avatar.className = 'npc-avatar';
  avatar.src = avatarSrc(char);
  avatar.alt = char;

  const bubble = document.createElement('div');
  bubble.className = 'npc-bubble';

  const nameEl = document.createElement('div');
  nameEl.className = `npc-name ${cls}`;
  nameEl.textContent = char;

  const dots = document.createElement('div');
  dots.className = `npc-text ${cls}-msg typing-indicator`;
  dots.style.cssText = 'display:flex;gap:4px;align-items:center;width:fit-content';
  dots.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;

  bubble.appendChild(nameEl);
  bubble.appendChild(dots);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;

  const duration = 700 + Math.random() * 500;
  setTimeout(() => {
    if (wrap.parentNode) msgs.removeChild(wrap);
    cb();
  }, duration);
}

function appendMessage(char, text) {
  const cls = charClass(char);
  const msgs = document.getElementById('npc-messages');
  const wrap = document.createElement('div');
  wrap.className = 'npc-msg';

  const avatar = document.createElement('img');
  avatar.className = 'npc-avatar';
  avatar.src = avatarSrc(char);
  avatar.alt = char;

  const bubble = document.createElement('div');
  bubble.className = 'npc-bubble';

  const nameEl = document.createElement('div');
  nameEl.className = `npc-name ${cls}`;
  nameEl.textContent = char;

  const textEl = document.createElement('div');
  textEl.className = `npc-text ${cls}-msg`;
  textEl.textContent = text;

  bubble.appendChild(nameEl);
  bubble.appendChild(textEl);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function charClass(char) {
  if (char === 'CTO') return 'cto';
  if (char === 'INTERN') return 'intern';
  return 'system';
}

function queueMessages(arr, baseDelay = 1500) {
  arr.forEach((m, i) => npcMessage(m.char, m.text, i * baseDelay));
}

// ═══════════════════════════════════════════════════════
// INTERACTIVE TERMINAL
// ═══════════════════════════════════════════════════════

const termHistory = [];
let termHistoryIndex = -1;

function appendTerminalLine(line) {
  const scroll = document.getElementById('terminal-scrollback');
  scroll.appendChild(document.createTextNode(line));
  const out = document.getElementById('terminal-output');
  out.scrollTop = out.scrollHeight;
}

function lockPrompt() {
  const input = document.getElementById('terminal-input');
  input.setAttribute('contenteditable', 'false');
  input.classList.add('locked');
}

function unlockPrompt() {
  const input = document.getElementById('terminal-input');
  input.setAttribute('contenteditable', 'true');
  input.classList.remove('locked');
  // Re-focus so the player can keep typing
  input.focus();
}

function clearScrollback() {
  document.getElementById('terminal-scrollback').innerHTML = '';
}

function printHelp() {
  appendTerminalLine(
    'Available commands:\n' +
    '  terraform init           download providers\n' +
    '  terraform validate       check syntax\n' +
    '  terraform plan           simulate changes\n' +
    '  terraform apply          execute (auto-approved)\n' +
    '  terraform destroy        clean teardown\n' +
    '  terraform fmt            format the file\n' +
    '  ls [path]                list files in workspace\n' +
    '  cat <file>               print file contents\n' +
    '  clear                    clear terminal\n' +
    '  help                     show this help\n'
  );
}

function submitTerminalLine(rawLine) {
  const line = (rawLine || '').trim();
  if (!line) {
    appendTerminalLine('$ \n');
    return;
  }

  termHistory.push(line);
  termHistoryIndex = termHistory.length;

  // Local-only commands
  if (line === 'clear') {
    clearScrollback();
    return;
  }
  if (line === 'help') {
    appendTerminalLine(`$ ${line}\n`);
    printHelp();
    return;
  }

  if (!state.sessionId || !state.ws) {
    appendTerminalLine(`$ ${line}\n`);
    appendTerminalLine('ERROR: no backend session. Refresh the page.\n');
    return;
  }

  // Send to backend — backend echoes the prompt line itself
  state.commandInFlight = true;
  lockPrompt();
  const hcl = state.editor ? state.editor.getValue() : null;
  api.sendCmd(line, hcl);
}

function initTerminal() {
  const input = document.getElementById('terminal-input');
  const out = document.getElementById('terminal-output');

  // Click anywhere in the terminal → focus the input
  out.addEventListener('click', () => {
    if (input.getAttribute('contenteditable') !== 'false') input.focus();
  });

  input.addEventListener('keydown', (e) => {
    if (state.commandInFlight) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const line = input.textContent;
      input.textContent = '';
      submitTerminalLine(line);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (termHistory.length === 0) return;
      termHistoryIndex = Math.max(0, termHistoryIndex - 1);
      input.textContent = termHistory[termHistoryIndex] || '';
      placeCaretEnd(input);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (termHistory.length === 0) return;
      termHistoryIndex = Math.min(termHistory.length, termHistoryIndex + 1);
      input.textContent = termHistory[termHistoryIndex] || '';
      placeCaretEnd(input);
      return;
    }

    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearScrollback();
      return;
    }

    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      const cur = input.textContent;
      appendTerminalLine(`$ ${cur}^C\n`);
      input.textContent = '';
      return;
    }
  });

  // Paste as plain text only
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, text.replace(/\n/g, ' '));
  });
}

function placeCaretEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function toggleTerminal() {
  const panel = document.getElementById('terminal-panel');
  panel.classList.toggle('collapsed');
  document.getElementById('terminal-toggle').textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
}

// ═══════════════════════════════════════════════════════
// CHAOS + XP
// ═══════════════════════════════════════════════════════

function setChaos(val, reason) {
  const prev = state.chaos;
  state.chaos = Math.max(0, Math.min(100, val));
  if (state.chaos > prev) {
    state.chaosEventCount++;
    if (reason) state.chaosReasons.push(reason);
  }
  const bar = document.getElementById('chaos-bar-inner');
  bar.style.width = state.chaos + '%';
  bar.classList.remove('pulse');
  void bar.offsetWidth;
  bar.classList.add('pulse');
  saveState();
}

function addXP(amount) {
  state.xp += amount;
  document.getElementById('xp-counter').textContent = `XP: ${state.xp}`;
  saveState();
}

// ═══════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════

function mapToPlanned() {
  // Solidify the dependency lines
  document.getElementById('dep-line').setAttribute('stroke-dasharray', 'none');
  document.getElementById('dep-line-2').setAttribute('stroke-dasharray', 'none');
}

function mapToApplied() {
  const dirRect = document.getElementById('config-dir-rect');
  const dirLabel = document.getElementById('config-dir-label');
  const dirStatus = document.getElementById('config-dir-status');
  const fileRect = document.getElementById('config-file-rect');
  const fileLabel = document.getElementById('config-file-label');
  const fileStatus = document.getElementById('config-file-status');
  const line1 = document.getElementById('dep-line');
  const line2 = document.getElementById('dep-line-2');
  const dot = document.getElementById('map-dot');

  for (const rect of [dirRect, fileRect]) {
    rect.setAttribute('fill', 'rgba(0,255,159,0.06)');
    rect.setAttribute('stroke', '#00ff9f');
    rect.setAttribute('stroke-dasharray', 'none');
    rect.setAttribute('filter', 'url(#glow-green)');
  }
  dirLabel.setAttribute('fill', '#00ff9f');
  dirStatus.setAttribute('fill', '#00ff9f');
  dirStatus.textContent = 'DIRECTORY CREATED';
  fileLabel.setAttribute('fill', '#00ff9f');
  fileStatus.setAttribute('fill', '#00ff9f');
  fileStatus.textContent = '✓';

  for (const line of [line1, line2]) {
    line.setAttribute('stroke', '#00ff9f');
    line.setAttribute('stroke-dasharray', 'none');
    line.setAttribute('marker-end', 'url(#arrowhead-green)');
  }
  dot.classList.add('green');

  document.getElementById('map-status').innerHTML =
    '<span class="ok">CONFIG RESTORED</span> — app service online';
}

function mapToDestroyed() {
  const dir = document.getElementById('node-config-dir');
  const file = document.getElementById('node-config-file');
  const line1 = document.getElementById('dep-line');
  const line2 = document.getElementById('dep-line-2');

  for (const el of [dir, file, line1, line2]) {
    el.style.transition = 'opacity 1s ease';
    el.style.opacity = '0';
  }

  setTimeout(() => {
    document.getElementById('map-status').innerHTML =
      '<span class="ok">DECOMMISSION COMPLETE</span> — infrastructure clean';
  }, 1000);
}

// ═══════════════════════════════════════════════════════
// SAVE INDICATOR
// ═══════════════════════════════════════════════════════

function setSaveIndicator(stateStr) {
  const el = document.getElementById('editor-save-indicator');
  if (!el) return;
  if (stateStr === 'saving') {
    el.textContent = '● saving…';
    el.style.color = 'var(--orange, #ff9060)';
  } else {
    el.textContent = '● saved';
    el.style.color = 'var(--grey, #7d8590)';
  }
}

function scheduleAutoSave() {
  if (!state.ws) return;
  setSaveIndicator('saving');
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    const hcl = state.editor ? state.editor.getValue() : '';
    api.sendSave(hcl);
  }, 400);
}

// ═══════════════════════════════════════════════════════
// MONACO EDITOR
// ═══════════════════════════════════════════════════════

const STARTER_CODE = `terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

# MISSION PARAMETERS
# ==================
# Required: a local_file resource that creates "config/app.conf"
#           with content "mode=production".
#
# Drive the mission from the terminal below:
#   terraform init | validate | plan | apply | destroy
`;

function initMonaco() {
  monaco.languages.register({ id: 'terraform' });
  monaco.languages.setMonarchTokensProvider('terraform', {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [/"([^"]*)"/, 'string'],
        [/\b(resource|provider|variable|output|module|data|locals|terraform)\b/, 'keyword'],
        [/\b(true|false|null)\b/, 'constant'],
        [/[{}()\[\]]/, 'delimiter'],
        [/[a-zA-Z_]\w*\s*=/, 'attribute'],
        [/\d+/, 'number'],
      ]
    }
  });

  monaco.editor.defineTheme('terraformageddon', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',   foreground: 'ff9060', fontStyle: 'bold' },
      { token: 'string',    foreground: '00e68a' },
      { token: 'comment',   foreground: '4a5568', fontStyle: 'italic' },
      { token: 'attribute', foreground: '79b8ff' },
      { token: 'constant',  foreground: 'ffd700' },
      { token: 'number',    foreground: 'c3a6ff' },
      { token: 'delimiter', foreground: '8b949e' },
    ],
    colors: {
      'editor.background':           '#0d1117',
      'editor.foreground':           '#e6edf3',
      'editor.lineHighlightBackground': '#161d27',
      'editor.selectionBackground':  '#2d4a2d',
      'editorCursor.foreground':     '#00ff9f',
      'editorLineNumber.foreground': '#3d444d',
      'editorLineNumber.activeForeground': '#7d8590',
      'editor.inactiveSelectionBackground': '#1e2530',
    }
  });

  state.editor = monaco.editor.create(document.getElementById('monaco-container'), {
    value: STARTER_CODE,
    language: 'terraform',
    theme: 'terraformageddon',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 12, bottom: 12 },
    scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderIndentGuides: false,
    contextmenu: false,
  });

  state.editor.onDidChangeModelContent(() => scheduleAutoSave());

  const resizeObs = new ResizeObserver(() => state.editor.layout());
  resizeObs.observe(document.getElementById('monaco-container'));
}

// ═══════════════════════════════════════════════════════
// TOUR
// ═══════════════════════════════════════════════════════

const tourSteps = [
  {
    label:  'ORIENTATION · STEP 1 OF 4',
    title:  'The War Room',
    text:   'Your team talks here. The CTO gives orders, the Intern panics, SYSTEM reports the damage. Read carefully — the fix is in the conversation.',
    progress: '● ○ ○ ○',
    target: 'npc-panel',
    cardPos: 'right',
  },
  {
    label:  'ORIENTATION · STEP 2 OF 4',
    title:  'The Editor — Blank Slate',
    text:   'Only the provider block is filled in. You write the rest of main.tf yourself: a local_file resource that creates the missing config. Your edits auto-save.',
    progress: '● ● ○ ○',
    target: 'editor-panel',
    cardPos: 'right',
  },
  {
    label:  'ORIENTATION · STEP 3 OF 4',
    title:  'Infrastructure Map',
    text:   'Live view of the system. The config/ directory and app.conf are both missing. Restore them through Terraform and watch the nodes turn green.',
    progress: '● ● ● ○',
    target: 'map-panel',
    cardPos: 'left',
  },
  {
    label:  'ORIENTATION · STEP 4 OF 4',
    title:  'Terminal — You Drive',
    text:   "No buttons this level. Click here and type real terraform commands: init, validate, plan, apply, destroy. Type 'help' if you forget. ArrowUp recalls history.",
    progress: '● ● ● ●',
    target: 'terminal-panel',
    cardPos: 'top',
    last: true,
  },
];

const finalTourDialogue = [
  { char: 'CTO',    text: 'No training wheels this level. Write the resource, type the commands. Just like prod.' },
  { char: 'INTERN', text: 'wait there are no buttons?? where did the buttons go??' },
  { char: 'CTO',    text: "Type 'help' in the terminal if you forget the commands. Or don't. I'm watching either way." },
];

let tourIndex = 0;

function startTour() {
  tourIndex = 0;
  document.getElementById('tour-overlay').classList.add('visible');
  renderTourStep();
}

function renderTourStep() {
  const step = tourSteps[tourIndex];
  const spotlight = document.getElementById('tour-spotlight');
  const card = document.getElementById('tour-card');
  const target = document.getElementById(step.target);

  document.getElementById('tour-step-label').textContent = step.label;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-progress').textContent = step.progress;
  document.getElementById('tour-next').textContent = step.last ? 'START MISSION →' : 'NEXT →';

  const rect = target.getBoundingClientRect();
  const pad = 4;
  spotlight.style.left   = (rect.left - pad) + 'px';
  spotlight.style.top    = (rect.top - pad) + 'px';
  spotlight.style.width  = (rect.width + pad * 2) + 'px';
  spotlight.style.height = (rect.height + pad * 2) + 'px';

  card.classList.remove('visible');
  requestAnimationFrame(() => {
    const cardW = 300;
    let cardLeft, cardTop;

    if (step.cardPos === 'right') {
      cardLeft = rect.right + 16;
      cardTop  = rect.top + 24;
    } else if (step.cardPos === 'left') {
      cardLeft = rect.left - cardW - 16;
      cardTop  = rect.top + 24;
    } else {
      cardLeft = rect.left + (rect.width / 2) - (cardW / 2);
      cardTop  = rect.top - 200;
    }

    cardLeft = Math.max(8, Math.min(cardLeft, window.innerWidth - cardW - 8));
    cardTop  = Math.max(56, Math.min(cardTop, window.innerHeight - 260));

    card.style.left = cardLeft + 'px';
    card.style.top  = cardTop + 'px';
    card.style.setProperty('--arrow-side', step.cardPos === 'right' ? 'left' : 'right');

    setTimeout(() => card.classList.add('visible'), 40);
  });
}

function tourNext() {
  const card = document.getElementById('tour-card');
  card.classList.remove('visible');

  if (tourIndex >= tourSteps.length - 1) {
    finishTour();
  } else {
    tourIndex++;
    setTimeout(renderTourStep, 120);
  }
}

function finishTour() {
  setTimeout(() => {
    document.getElementById('tour-overlay').classList.remove('visible');
    setTimeout(() => {
      queueMessages(finalTourDialogue, 1400);
    }, 300);
  }, 300);
}

function skipTour() {
  state.tourSkipped = true;
  finishTour();
}

// ═══════════════════════════════════════════════════════
// BRIEFING
// ═══════════════════════════════════════════════════════

function showBriefing() {
  document.getElementById('briefing-overlay').classList.add('visible');
}

function acceptBriefing() {
  const overlay = document.getElementById('briefing-overlay');
  overlay.style.transition = 'opacity 0.35s ease';
  overlay.style.opacity = '0';
  setTimeout(() => {
    overlay.classList.remove('visible');
    overlay.style.opacity = '';
    if (state.tourSkipped) {
      finishTour();
    } else {
      setTimeout(startTour, 300);
    }
  }, 350);
}

// ═══════════════════════════════════════════════════════
// STATE PERSISTENCE
// ═══════════════════════════════════════════════════════

function saveState() {
  localStorage.setItem('tg_state_l2', JSON.stringify({
    chaos: state.chaos,
    xp: state.xp,
    chaosTriggered: state.chaosTriggered,
    initDone: state.initDone,
    planPassed: state.planPassed,
    applyDone: state.applyDone,
    destroyDone: state.destroyDone,
    tourSkipped: state.tourSkipped,
  }));
}

// ═══════════════════════════════════════════════════════
// DEBRIEF
// ═══════════════════════════════════════════════════════

const debriefSteps = [
  {
    eyebrow:  'DEBRIEF · STEP 1 OF 5',
    title:    'Writing a resource <span>from scratch</span>',
    body:     `This level handed you only the <code>terraform { required_providers }</code> block. The provider config tells Terraform which plugin to download. The actual <code>resource</code> block — what you wrote — is what describes infrastructure to create.\n\nIn production, this is normal. You start most projects with an empty editor and a provider doc tab open.`,
    progress: '● ○ ○ ○ ○',
    highlight: 'editor-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 2 OF 5',
    title:    'Why <span>terraform validate</span> exists',
    body:     `Before <code>plan</code> can run, your HCL needs to parse. <code>terraform validate</code> checks syntax and references without contacting any provider.\n\nIt's the fastest feedback loop — useful when you're writing a new resource and you're not sure if you closed every brace.`,
    progress: '● ● ○ ○ ○',
    highlight: 'terminal-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 3 OF 5',
    title:    '<span>Paths create directories</span>',
    body:     `Your <code>filename = "config/app.conf"</code> told Terraform to write inside a subdirectory. The <code>local_file</code> provider creates that <code>config/</code> directory automatically.\n\nThis is the IaC mindset: you describe the desired end state, not the steps. You don't mkdir, then touch, then write. You declare the file and let Terraform figure it out.`,
    progress: '● ● ● ○ ○',
    highlight: 'map-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 4 OF 5',
    title:    '<span>Plan → Apply</span> still applies',
    body:     `Even without buttons enforcing the order, the discipline matters. <code>terraform plan</code> shows you what will change. <code>terraform apply</code> commits it.\n\nIn a real pipeline, plan output is reviewed in a pull request. Apply is the merge. Skip the plan, skip the review.`,
    progress: '● ● ● ● ○',
    highlight: 'terminal-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 5 OF 5',
    title:    'Clean teardown with <span>destroy</span>',
    body:     `<code>terraform destroy</code> removed the resource and updated state. The <code>config/</code> directory went with it.\n\nNo orphaned files. No drift. The next engineer who clones this repo will see exactly what's running — because what's running is exactly what's in code.\n\n<strong>That's infrastructure as code.</strong>`,
    progress: '● ● ● ● ●',
    highlight: null,
    last: true,
  },
];

let debriefIndex = 0;

function startDebrief() {
  debriefIndex = 0;
  document.getElementById('debrief-overlay').classList.add('visible');
  renderDebriefStep();
}

function renderDebriefStep() {
  const step = debriefSteps[debriefIndex];
  const card = document.getElementById('debrief-card');
  const highlight = document.getElementById('debrief-highlight');

  card.classList.remove('visible');

  document.getElementById('debrief-eyebrow').textContent  = step.eyebrow;
  document.getElementById('debrief-title').innerHTML      = step.title;
  document.getElementById('debrief-body').innerHTML       = step.body.replace(/\n/g, '<br>');
  document.getElementById('debrief-progress').textContent = step.progress;
  document.getElementById('debrief-next').textContent     = step.last ? 'FINISH →' : 'NEXT →';
  const backBtn = document.getElementById('debrief-back');
  if (backBtn) backBtn.disabled = debriefIndex === 0;

  if (step.highlight) {
    const target = document.getElementById(step.highlight);
    const r = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left   = (r.left - 3) + 'px';
    highlight.style.top    = (r.top - 3) + 'px';
    highlight.style.width  = (r.width + 6) + 'px';
    highlight.style.height = (r.height + 6) + 'px';
  } else {
    highlight.style.display = 'none';
  }

  card.style.left = (window.innerWidth / 2 - 190) + 'px';
  card.style.top  = (window.innerHeight / 2 - 160) + 'px';

  setTimeout(() => card.classList.add('visible'), 60);
}

function debriefNext() {
  const card = document.getElementById('debrief-card');
  card.classList.remove('visible');

  if (debriefIndex >= debriefSteps.length - 1) {
    setTimeout(() => {
      document.getElementById('debrief-overlay').classList.remove('visible');
      document.getElementById('war-room').classList.add('visible');
    }, 300);
  } else {
    debriefIndex++;
    setTimeout(renderDebriefStep, 200);
  }
}

function debriefBack() {
  if (debriefIndex <= 0) return;
  const card = document.getElementById('debrief-card');
  card.classList.remove('visible');
  debriefIndex--;
  setTimeout(renderDebriefStep, 200);
}

// ═══════════════════════════════════════════════════════
// WAR ROOM
// ═══════════════════════════════════════════════════════

function showWarRoom() {
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  document.getElementById('war-time').textContent =
    mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  document.getElementById('war-chaos-count').textContent = state.chaosEventCount;

  if (state.chaosEventCount > 0) {
    document.getElementById('war-chaos-count').classList.add('red');
    const section = document.getElementById('chaos-event-section');
    section.classList.add('visible');
    const reasonLines = state.chaosReasons.map((r, i) => `${i + 1}. ${r}`).join('\n');
    document.getElementById('chaos-event-text').innerHTML =
      reasonLines.replace(/\n/g, '<br>') + '<br>The CTO has noted this.';
  }

  const summaries = state.chaosTriggered
    ? [
        "The missing app-config artifact was restored after one or more chaos events on the way. Final state was clean, but the path there was not.",
        "Service recovery completed, though the engineer triggered chaos events along the way — review logged for post-mortem."
      ]
    : [
        "The missing config directory and app.conf were restored with a clean plan → apply → destroy cycle. Zero chaos. Textbook.",
        "App service config was rebuilt from scratch via Terraform, executed from the CLI, and torn down without drift."
      ];
  document.getElementById('incident-summary-text').textContent =
    summaries[Math.floor(Math.random() * summaries.length)];

  startDebrief();
}

function showNextMission() {
  const btn = document.querySelectorAll('.war-btn.secondary')[1];
  btn.textContent = '[ COMING SOON ]';
  btn.style.borderColor = 'var(--grey)';
  btn.style.color = 'var(--grey)';
  btn.style.opacity = '0.5';
  btn.style.cursor = 'default';
}

function restartGame() {
  localStorage.removeItem('tg_state_l2');
  location.reload();
}

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════

window.addEventListener('load', () => {
  initDevIdentity();
  initTerminal();

  appendTerminalLine('terraformageddon v1.0.0 — interactive mode\n');
  appendTerminalLine("Type 'help' for available commands.\n\n");

  initSession();

  setTimeout(() => {
    queueMessages([
      { char: 'SYSTEM', text: 'ERROR: app-svc-prod failed to boot — config/app.conf not found.' },
      { char: 'SYSTEM', text: 'Expected: filename = config/app.conf, content = mode=production' },
    ], 1500);
  }, 800);

  setTimeout(showBriefing, 5200);
});
