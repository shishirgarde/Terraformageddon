// ═══════════════════════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════════════════════

const state = {
  phase: 'idle',       // idle | inited | planned | applied | destroyed
  chaos: 0,
  xp: 0,
  planPassed: false,
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
};

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
    const session = await api.createSession('level1');
    state.sessionId = session.session_id;

    if (state.editor && session.starter_code) {
      state.editor.setValue(session.starter_code);
    }

    state.ws = api.connectWebSocket(session.ws_url, {
      onMessage: handleTerraformFrame,
      onClose: () => console.log('[WS] disconnected'),
      onError: (e) => console.error('[WS] error', e),
    });

    // Keepalive ping every 30s
    setInterval(() => api.ping(), 30000);
  } catch (err) {
    console.error('Failed to create session:', err);
    appendTerminalLine(`ERROR: Could not connect to backend — ${err.message}\n`);
    appendTerminalLine('Running in offline mode (validation only).\n');
  }
}

function handleTerraformFrame(frame) {
  if (frame.type === 'output') {
    appendTerminalLine(frame.line);
    return;
  }

  if (frame.type === 'done') {
    state.commandInFlight = false;
    const { command, result } = frame;

    if (command === 'init') {
      if (result.success) {
        state.phase = 'inited';
        setBtn('btn-init', 'done');
        document.querySelector('#btn-init .btn-label').textContent = '✓ INITIALIZED';
        setBtn('btn-plan', 'active');
        addXP(10);
        queueMessages(dialogue.onInit, 1200);
      } else {
        state.phase = 'idle';
        setBtn('btn-init', 'active');
        appendTerminalLine('\n✗ Init failed. Check output above.\n');
      }
    }

    if (command === 'plan') {
      if (result.success) {
        state.phase = 'planned';
        state.planPassed = true;
        setBtn('btn-plan', 'done');
        document.querySelector('#btn-plan .btn-label').textContent = '✓ SIMULATED';
        setBtn('btn-apply', 'active');
        addXP(20);
        mapToPlanned();
        queueMessages(dialogue.onPlanSuccess, 1200);
      } else {
        state.failAttempts++;
        state.phase = 'planned_fail';
        state.chaosTriggered = true;

        // Determine chaos from error summary
        const errors = result.errors || [];
        const summary = errors[0]?.summary || 'Plan failed with invalid configuration.';
        let chaosDelta = errors.length > 0 ? 10 : 5;
        if (state.failAttempts === 2) chaosDelta = Math.round(chaosDelta * 1.5);
        if (state.failAttempts >= 3)  chaosDelta = Math.round(chaosDelta * 2);

        setChaos(state.chaos + chaosDelta, summary);
        appendTerminalLine(`\n✗ Plan failed. Fix your configuration and re-run SIMULATE FIX.\n`);
        queueMessages(dialogue.onPlanFail, 1200);
      }
    }

    if (command === 'apply') {
      if (result.success && result.mission_success) {
        state.phase = 'applied';
        setBtn('btn-apply', 'done');
        document.querySelector('#btn-apply .btn-label').textContent = '✓ EXECUTED';
        document.getElementById('btn-destroy').style.display = 'inline-block';
        mapToApplied();
        addXP(50);
        queueMessages(dialogue.onApply, 1200);
      } else if (result.success && !result.mission_success) {
        // Apply succeeded but wrong resource attributes
        appendTerminalLine('\n⚠ Apply succeeded but mission conditions not met. Check filename and content.\n');
        setBtn('btn-apply', 'active');
      } else {
        appendTerminalLine('\n✗ Apply failed. Check output above.\n');
        setBtn('btn-apply', 'active');
      }
    }

    if (command === 'destroy') {
      state.phase = 'destroyed';
      setChaos(0);
      mapToDestroyed();
      addXP(50);
      queueMessages(dialogue.onDestroy, 1200);
      setTimeout(showWarRoom, 3500);
    }
  }
}

// ═══════════════════════════════════════════════════════
// NPC DIALOGUE
// ═══════════════════════════════════════════════════════

const dialogue = {
  onInit: [
    { char: 'INTERN', text: "wait... it actually downloaded a provider for a text file??" },
    { char: 'SYSTEM', text: "Provider ready. The universe is watching." },
  ],
  onPlanSuccess: [
    { char: 'CTO', text: "You planned before applying. I'm almost proud. Don't ruin it." },
  ],
  onPlanFail: [
    { char: 'CTO', text: "That's not it. The logs exist for a reason. Try reading them." },
    { char: 'INTERN', text: "the error literally tells you what it wants. like word for word" },
  ],
  onChaos: [
    { char: 'CTO',    text: "You applied without a plan. In production. Let that sink in." },
    { char: 'INTERN', text: "bro..." },
    { char: 'CTO',    text: "Chaos logged. This goes in the post-mortem. With your name on it." },
  ],
  onApply: [
    { char: 'SYSTEM', text: "✓ signal.txt created. SYSTEM ONLINE." },
    { char: 'CTO',    text: "System restored. Now destroy it cleanly. Infrastructure is not a souvenir." },
    { char: 'INTERN', text: "wait we're deleting it?? we just fixed it??" },
    { char: 'CTO',    text: "Terraform doesn't do keepsakes. Destroy it and move on." },
  ],
  onDestroy: [
    { char: 'SYSTEM', text: "✓ local_file.signal destroyed." },
    { char: 'CTO',    text: "Clean. No drift. No orphaned resources. This is the baseline, not the achievement." },
    { char: 'INTERN', text: "okay that was actually kind of terrifying. in a good way" },
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

  // Add typing indicator into the panel
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

  // Remove typing indicator then fire callback
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
// TERMINAL
// ═══════════════════════════════════════════════════════

function appendTerminalLine(line) {
  const out = document.getElementById('terminal-output');
  const cursor = document.getElementById('terminal-cursor');
  out.insertBefore(document.createTextNode(line), cursor);
  out.scrollTop = out.scrollHeight;
}

let termQueue = Promise.resolve();

// Kept for NPC/flavor text only — real terraform output uses appendTerminalLine
function streamTerminal(text, speed = 8) {
  return new Promise(resolve => {
    termQueue = termQueue.then(() => new Promise(r => {
      const out = document.getElementById('terminal-output');
      const cursor = document.getElementById('terminal-cursor');
      let i = 0;
      const chars = text.split('');
      const tick = setInterval(() => {
        if (i >= chars.length) {
          clearInterval(tick);
          out.insertBefore(document.createTextNode('\n'), cursor);
          out.scrollTop = out.scrollHeight;
          setTimeout(() => { resolve(); r(); }, 200);
          return;
        }
        out.insertBefore(document.createTextNode(chars[i]), cursor);
        out.scrollTop = out.scrollHeight;
        i++;
      }, speed);
    }));
  });
}

function clearTerminal() {
  const out = document.getElementById('terminal-output');
  while (out.firstChild && out.firstChild !== document.getElementById('terminal-cursor')) {
    out.removeChild(out.firstChild);
  }
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
  if (amount < 0) {
    flashXP(`${amount} XP — Intel purchased`);
  }
  saveState();
}

function flashXP(msg) {
  const el = document.getElementById('xp-flash');
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 2500);
}

// ═══════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════

function mapToPlanned() {
  // Change line to solid grey
  const line = document.getElementById('dep-line');
  line.setAttribute('stroke-dasharray', 'none');
}

function mapToApplied() {
  const rect = document.getElementById('signal-rect');
  const label = document.getElementById('signal-label');
  const status = document.getElementById('signal-status');
  const line = document.getElementById('dep-line');
  const dot = document.getElementById('map-dot');

  // Transition signal node ghost → solid green
  rect.setAttribute('fill', 'rgba(0,255,159,0.06)');
  rect.setAttribute('stroke', '#00ff9f');
  rect.setAttribute('stroke-dasharray', 'none');
  rect.setAttribute('filter', 'url(#glow-green)');
  label.setAttribute('fill', '#00ff9f');
  status.textContent = '✓';
  status.setAttribute('fill', '#00ff9f');

  // Line → solid green
  line.setAttribute('stroke', '#00ff9f');
  line.setAttribute('stroke-dasharray', 'none');
  line.setAttribute('marker-end', 'url(#arrowhead-green)');

  dot.classList.add('green');

  document.getElementById('map-status').innerHTML =
    '<span class="ok">SIGNAL RESTORED</span> — system online';
}

function mapToDestroyed() {
  const signal = document.getElementById('node-signal');
  const line = document.getElementById('dep-line');

  signal.style.transition = 'opacity 1s ease';
  signal.style.opacity = '0';
  line.style.transition = 'opacity 0.8s ease';
  line.style.opacity = '0';

  setTimeout(() => {
    document.getElementById('map-status').innerHTML =
      '<span class="ok">DECOMMISSION COMPLETE</span> — infrastructure clean';
  }, 1000);
}

// ═══════════════════════════════════════════════════════
// BUTTONS
// ═══════════════════════════════════════════════════════

function setBtn(id, state) {
  const btn = document.getElementById(id);
  btn.classList.remove('active', 'locked', 'done', 'danger');
  btn.classList.add(state);
}

// ═══════════════════════════════════════════════════════
// GAME ACTIONS
// ═══════════════════════════════════════════════════════

async function handleInit() {
  if (state.phase !== 'idle' || state.commandInFlight) return;

  if (!state.sessionId) {
    appendTerminalLine('ERROR: No backend session. Refresh the page.\n');
    return;
  }

  state.commandInFlight = true;
  state.phase = 'initializing';
  setBtn('btn-init', 'locked');
  clearTerminal();
  appendTerminalLine('▶ INITIALIZING...\n');

  api.sendRun('init');
  saveState();
}

async function handlePlan() {
  if ((state.phase !== 'inited' && state.phase !== 'planned_fail') || state.commandInFlight) return;
  if (!document.getElementById('btn-plan').classList.contains('active')) return;
  if (!state.sessionId) return;

  const hcl = state.editor ? state.editor.getValue() : '';
  state.commandInFlight = true;
  clearTerminal();
  appendTerminalLine('▶ SIMULATING FIX...\n');

  api.sendRun('plan', hcl);
  saveState();
}

async function handleApply() {
  if (!document.getElementById('btn-apply').classList.contains('active') || state.commandInFlight) return;
  if (!state.sessionId) return;

  if (!state.planPassed) {
    // CHAOS EVENT — apply without plan
    state.chaosTriggered = true;
    setChaos(state.chaos + 25, 'Executed terraform apply without running terraform plan first.');
    clearTerminal();
    appendTerminalLine('▶ EXECUTING FIX...\n');
    appendTerminalLine('WARNING: No plan found in state.\n');
    appendTerminalLine('─────────────────────────────────\n');
    appendTerminalLine('ERROR: Attempted apply without simulation.\n');
    appendTerminalLine('This action has been logged to the incident tracker.\n');
    appendTerminalLine('\nCHAOS SCORE: +25\n');
    appendTerminalLine('─────────────────────────────────\n');
    appendTerminalLine('✗ Apply aborted. Run SIMULATE FIX first.\n');
    queueMessages(dialogue.onChaos, 1200);
    return;
  }

  const hcl = state.editor ? state.editor.getValue() : '';
  state.commandInFlight = true;
  clearTerminal();
  appendTerminalLine('▶ EXECUTING FIX...\n');
  setBtn('btn-apply', 'locked');

  api.sendRun('apply', hcl);
  saveState();
}

function handleDestroyClick() {
  const confirm = document.getElementById('decommission-confirm');
  confirm.classList.toggle('visible');
}

async function confirmDestroy() {
  if (state.commandInFlight) return;
  document.getElementById('decommission-confirm').classList.remove('visible');
  document.getElementById('btn-destroy').style.display = 'none';

  state.commandInFlight = true;
  clearTerminal();
  appendTerminalLine('▶ DECOMMISSIONING...\n');

  api.sendRun('destroy');
  saveState();
}

function cancelDestroy() {
  document.getElementById('decommission-confirm').classList.remove('visible');
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
    // Build dynamic reason list
    const reasonLines = state.chaosReasons
      .map((r, i) => `${i + 1}. ${r}`)
      .join('\n');
    document.getElementById('chaos-event-text').innerHTML =
      reasonLines.replace(/\n/g, '<br>') + '<br>The CTO has noted this.';
  }

  // Simulated incident summary (no Claude API for now)
  const summaries = state.chaosTriggered
    ? [
        "The signal artifact was successfully restored after an unauthorized apply attempt triggered a chaos event, requiring manual intervention to stabilize the deployment pipeline.",
        "Infrastructure was brought back online despite an unplanned execution attempt; the signal file was recreated and cleanly decommissioned following incident review."
      ]
    : [
        "The missing signal artifact was identified, recreated via a properly planned Terraform apply, and subsequently decommissioned in a clean, zero-chaos operation.",
        "Signal file restoration was completed without incident — the engineer simulated the change before execution and decommissioned the resource on schedule."
      ];

  const summary = summaries[Math.floor(Math.random() * summaries.length)];
  document.getElementById('incident-summary-text').textContent = summary;

  // Debrief first — war room card appears when debrief finishes
  startDebrief();
}

function showNextMission() {
  const btn = document.querySelector('.war-btn.secondary');
  btn.textContent = '[ COMING SOON ]';
  btn.style.borderColor = 'var(--grey)';
  btn.style.color = 'var(--grey)';
  btn.style.opacity = '0.5';
  btn.style.cursor = 'default';
}

function restartGame() {
  localStorage.removeItem('tg_state');
  location.reload();
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
# The signal artifact has gone missing from production.
# Recreate it using a local_file resource.
#
# Required:
#   filename = "signal.txt"
#   content  = "SYSTEM ONLINE"

resource "local_file" "signal" {
  filename = ""
  content  = ""
}
`;

function initMonaco() {
  // Register Terraform language
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

  // Resize observer
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
    text:   'This is where your team talks. The CTO gives orders, the Intern causes chaos, and SYSTEM alerts flag what\'s broken. Pay close attention — the clues you need to fix things are buried in here.',
    progress: '● ○ ○ ○',
    target: 'npc-panel',
    cardPos: 'right',
  },
  {
    label:  'ORIENTATION · STEP 2 OF 4',
    title:  'The Terraform Editor',
    text:   'This is where you write infrastructure code. Fill in the missing values, then run the buttons below in order: Initialize → Simulate → Execute. Never execute without simulating first.',
    progress: '● ● ○ ○',
    target: 'editor-panel',
    cardPos: 'right',
  },
  {
    label:  'ORIENTATION · STEP 3 OF 4',
    title:  'Infrastructure Map',
    text:   'This shows what exists in the system right now. That ghost node is the missing signal file. Once you restore it, it comes online here. Think of it as your live view of the damage — and your progress.',
    progress: '● ● ● ○',
    target: 'map-panel',
    cardPos: 'left',
  },
  {
    label:  'ORIENTATION · STEP 4 OF 4',
    title:  'Terminal — Read Only',
    text:   'This is not an input. The blinking cursor is just for show. The terminal prints what Terraform is doing in real time — provider downloads, plan output, apply results. You watch here, you act in the editor above.',
    progress: '● ● ● ●',
    target: 'terminal-panel',
    cardPos: 'top',
    last: true,
  },
];

const finalTourDialogue = [
  { char: 'CTO',    text: 'Signal file is missing. You have 10 minutes before I start assigning blame.' },
  { char: 'INTERN', text: "it's just a text file. how hard can it be" },
  { char: 'CTO',    text: "Famous last words. I've seen careers end over a missing semicolon." },
];

let tourIndex = 0;

function startTour() {
  tourIndex = 0;
  document.getElementById('tour-overlay').classList.add('visible');
  renderTourStep();
}

function renderTourStep() {
  const step = tourSteps[tourIndex];
  const overlay = document.getElementById('tour-overlay');
  const spotlight = document.getElementById('tour-spotlight');
  const card = document.getElementById('tour-card');
  const target = document.getElementById(step.target);

  // Update card text
  document.getElementById('tour-step-label').textContent = step.label;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-progress').textContent = step.progress;
  document.getElementById('tour-next').textContent = step.last ? 'START MISSION →' : 'NEXT →';

  // Position spotlight over target panel
  const rect = target.getBoundingClientRect();
  const pad = 4;
  spotlight.style.left   = (rect.left - pad) + 'px';
  spotlight.style.top    = (rect.top - pad) + 'px';
  spotlight.style.width  = (rect.width + pad * 2) + 'px';
  spotlight.style.height = (rect.height + pad * 2) + 'px';

  // Position tooltip card
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
      // top — card floats above the panel, centered
      cardLeft = rect.left + (rect.width / 2) - (cardW / 2);
      cardTop  = rect.top - 200;
    }

    // Clamp to viewport
    cardLeft = Math.max(8, Math.min(cardLeft, window.innerWidth - cardW - 8));
    cardTop  = Math.max(56, Math.min(cardTop, window.innerHeight - 260));

    card.style.left = cardLeft + 'px';
    card.style.top  = cardTop + 'px';

    // Adjust arrow direction based on position
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
    // Small breath before tour starts
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
  localStorage.setItem('tg_state', JSON.stringify({
    phase: state.phase,
    chaos: state.chaos,
    xp: state.xp,
    chaosTriggered: state.chaosTriggered,
    planPassed: state.planPassed,
    tourSkipped: state.tourSkipped,
  }));
}

// ═══════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════
// DEBRIEF TOUR
// ═══════════════════════════════════════════════════════

const debriefSteps = [
  {
    eyebrow:  'DEBRIEF · STEP 1 OF 5',
    title:    'What is a <span>resource</span>?',
    body:     `The block you wrote — <code>resource "local_file" "signal"</code> — is a <strong>Terraform resource declaration</strong>.\n\nIt tells Terraform: "make this thing exist." In this case, a file on disk. In real infrastructure, it could be a server, a database, a DNS record — anything your cloud provider can create.`,
    progress: '● ○ ○ ○ ○',
    highlight: 'editor-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 2 OF 5',
    title:    'The <span>filename</span> and <span>content</span> arguments',
    body:     `Inside the resource block, <code>filename</code> and <code>content</code> are <strong>arguments</strong> — the specific settings for that resource.\n\n<code>filename = "signal.txt"</code> told Terraform what to call the file.\n<code>content = "SYSTEM ONLINE"</code> told Terraform what to write inside it.\n\nEvery resource type has its own set of arguments. You look them up in the provider docs.`,
    progress: '● ● ○ ○ ○',
    highlight: 'editor-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 3 OF 5',
    title:    'Why did you <span>simulate</span> first?',
    body:     `<code>terraform plan</code> is a dry run. Terraform figures out what it <em>would</em> do — without touching anything real.\n\nYou saw it in the terminal: <code>Plan: 1 to add, 0 to change, 0 to destroy.</code>\n\nIn production, applying without planning first is how you accidentally delete databases. The CTO was serious.`,
    progress: '● ● ● ○ ○',
    highlight: 'terminal-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 4 OF 5',
    title:    'What did <span>apply</span> actually do?',
    body:     `<code>terraform apply</code> executed the plan. Terraform created <code>signal.txt</code> with the content you specified — and recorded it in <strong>state</strong>.\n\nTerraform state is how it tracks what exists. That's why the infrastructure map updated: Terraform told the system "this resource now exists."`,
    progress: '● ● ● ● ○',
    highlight: 'map-panel',
  },
  {
    eyebrow:  'DEBRIEF · STEP 5 OF 5',
    title:    'Why <span>destroy</span> at the end?',
    body:     `<code>terraform destroy</code> removed the resource cleanly — and updated state to match. No orphaned files, no drift.\n\nThis is the discipline Terraform enforces: you don't just delete things manually. You declare what should exist, and let Terraform reconcile reality to match your code.\n\n<strong>That's infrastructure as code.</strong>`,
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
  if (backBtn) {
    backBtn.disabled = debriefIndex === 0;
  }

  // Position highlight box
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

  // Position card — center of screen, slightly above middle
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
      // Now show the war room card
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
// BOOT
// ═══════════════════════════════════════════════════════

window.addEventListener('load', () => {
  // Initial terminal prompt
  const out = document.getElementById('terminal-output');
  const cursor = document.getElementById('terminal-cursor');
  out.insertBefore(document.createTextNode('terraformageddon v1.0.0 — ready\n$ '), cursor);

  // Connect to backend and set up session (non-blocking — game continues if it fails)
  initSession();

  // Step 1: First two SYSTEM messages stream in as toasts (sets the scene)
  setTimeout(() => {
    queueMessages([
      { char: 'SYSTEM', text: 'ERROR: status artifact not found at expected path.' },
      { char: 'SYSTEM', text: 'Expected: signal.txt — Content: SYSTEM ONLINE' },
    ], 1500);
  }, 800);

  // Step 2: After those two messages settle, show the briefing modal
  // 800 boot delay + 2 messages × 1500 gap + typing ~800ms each = ~5400ms
  setTimeout(showBriefing, 5200);
});
// Landing page helper: swaps placeholders for real images when assets load
(function landingImageLoader() {
  const images = document.querySelectorAll('.char-slot img');
  if (!images.length) return;

  const showImage = img => {
    if (img.naturalWidth > 0) {
      img.style.display = 'block';
      const placeholder = img.closest('.char-slot')?.querySelector('.placeholder');
      if (placeholder) placeholder.style.display = 'none';
    }
  };

  images.forEach(img => {
    img.addEventListener('load', () => showImage(img));
    showImage(img);
  });
})();
function initScrollTop() {
  if (!document.body.classList.contains('landing')) return;
  const btn = document.getElementById('scroll-top');
  if (!btn) return;
  const toggle = () => btn.classList.toggle('visible', window.scrollY > 260);
  toggle();
  window.addEventListener('scroll', () => toggle());
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}
initScrollTop();
