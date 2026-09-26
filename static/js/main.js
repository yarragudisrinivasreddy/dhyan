/**
 * Dhyan — main.js
 * Camera, settings, UI wiring for the agent loop.
 * Privacy: frames stay on localhost only.
 */

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const btnStart = document.getElementById('btn-start');
const btnCheck = document.getElementById('btn-check');
const btnClear = document.getElementById('btn-clear');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnAcknowledge = document.getElementById('btn-acknowledge');
const btnResume = document.getElementById('btn-resume');
const btnMobilePickup = document.getElementById('btn-mobile-pickup');
const settingsDrawer = document.getElementById('settings-drawer');
const statusBadge = document.getElementById('status-badge');

const insightEmpty = document.getElementById('insight-empty');
const insightResult = document.getElementById('insight-result');
const fatigueChip = document.getElementById('fatigue-chip');
const ringFill = document.getElementById('ring-fill');
const postureVal = document.getElementById('posture-val');
const observationsCard = document.getElementById('observations');
const tipsList = document.getElementById('tips-list');
const breakText = document.getElementById('break-text');
const affirmationEl = document.getElementById('affirmation');
const urgencyBadge = document.getElementById('urgency-badge');
const checkTimeEl = document.getElementById('check-time');
const breakBlock = document.getElementById('break-block');
const agentPhaseEl = document.getElementById('agent-phase');
const phaseTextEl = document.getElementById('phase-text');

let stream = null;
let sessionTimer = null;
let sessionSeconds = 0;
let statsPollTimer = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = stream;
    return true;
  } catch (err) {
    showToast('Camera Error', 'Could not access webcam. Please allow camera permissions.', 'error');
    return false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }
}

function postureCategoryFromAnalysis(analysis) {
  const raw = String(analysis.posture_category || analysis.posture_class || '').toLowerCase();
  if (raw.includes('ideal') || raw.includes('good') || raw === 'upright') return 'ideal';
  if (raw.includes('forward') || raw.includes('lean')) return 'forward';
  if (raw.includes('slouch') || raw.includes('hunch') || raw.includes('round')) return 'slouch';

  const score = Number(analysis.posture_score);
  if (!Number.isFinite(score)) return null;
  if (score >= 8) return 'ideal';
  if (score >= 5) return 'forward';
  return 'slouch';
}

function highlightPostureGuide(category) {
  document.querySelectorAll('.posture-item[data-posture]').forEach((el) => {
    const match = category && el.dataset.posture === category;
    el.classList.toggle('active', !!match);
    el.setAttribute('aria-current', match ? 'true' : 'false');
  });
}

function renderInsight(analysis) {
  insightEmpty.classList.add('hidden');
  insightResult.classList.remove('hidden');
  document.getElementById('handoff-card')?.classList.add('hidden');

  insightResult.style.animation = 'none';
  requestAnimationFrame(() => { insightResult.style.animation = ''; });

  const level = analysis.fatigue_level || 'low';
  fatigueChip.textContent = level.charAt(0).toUpperCase() + level.slice(1) + ' Fatigue';
  fatigueChip.className = `fatigue-pill ${level}`;

  const score = analysis.posture_score || 5;
  const circ = 138.2;
  ringFill.style.strokeDashoffset = circ - (score / 10) * circ;
  postureVal.textContent = score;

  highlightPostureGuide(postureCategoryFromAnalysis(analysis));

  const obs = analysis.observations || [];
  observationsCard.innerHTML = obs.map(o => `<div>${o}</div>`).join('');

  tipsList.innerHTML = (analysis.tips || []).map(tip => `<li>${tip}</li>`).join('');
  breakText.textContent = analysis.break_suggestion || 'Take a 5-minute walk.';
  affirmationEl.textContent = analysis.affirmation || 'You are doing great.';
  urgencyBadge.textContent = analysis.urgency || '';
  if (checkTimeEl) checkTimeEl.textContent = new Date().toLocaleTimeString();
  if (breakBlock) breakBlock.classList.toggle('urgent', level === 'high');
}

async function updateStats() {
  try {
    const res = await fetch('/stats');
    const data = await res.json();
    document.getElementById('stat-checks').textContent = data.total_checks;
    document.getElementById('stat-posture').textContent = data.avg_posture_score ?? '—';
    document.getElementById('stat-skipped').textContent = data.skipped_checks ?? 0;

    const dist = data.fatigue_distribution || {};
    const total = data.total_checks || 1;
    document.getElementById('tbar-low').style.height = `${((dist.low || 0) / total) * 100}%`;
    document.getElementById('tbar-med').style.height = `${((dist.medium || 0) / total) * 100}%`;
    document.getElementById('tbar-high').style.height = `${((dist.high || 0) / total) * 100}%`;
  } catch (_) { /* non-critical */ }
}

function startSessionTimer() {
  sessionSeconds = 0;
  sessionTimer = setInterval(() => {
    sessionSeconds++;
    const mins = Math.floor(sessionSeconds / 60);
    document.getElementById('stat-session').textContent = mins > 0 ? `${mins}m` : `${sessionSeconds}s`;
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(sessionTimer);
}

function setStatus(text, analyzing = false) {
  statusBadge.textContent = text;
  statusBadge.classList.toggle('analyzing', !!analyzing);
}

function showToast(title, body, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

/** OS push for successful wellness insights only — never for errors / offline recovery. */
async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch (_) {
    return false;
  }
}

function showWellnessPush(analysis) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!analysis) return;

  const level = analysis.fatigue_level || 'low';
  const tip = (analysis.tips && analysis.tips[0]) || analysis.break_suggestion || 'Take a short break.';
  const title = `Dhyan — ${level.charAt(0).toUpperCase() + level.slice(1)} Fatigue · Posture ${analysis.posture_score ?? '—'}/10`;
  try {
    new Notification(title, {
      body: tip,
      tag: 'dhyan-wellness',
      renotify: true
    });
  } catch (_) { /* ignore */ }
}

function syncSettingsFromUI() {
  const agent = window.DhyanAgent;
  agent.settings.soundEnabled = document.getElementById('sound-enabled').checked;
  agent.settings.speakTips = document.getElementById('speak-tips').checked;
  agent.settings.mobileMode = document.getElementById('mobile-mode').checked;
  agent.settings.perfMode = document.getElementById('perf-mode').checked;
  agent.settings.volume = parseFloat(document.getElementById('sound-volume').value);

  window.DhyanSounds.setEnabled(agent.settings.soundEnabled);
  window.DhyanSounds.setVolume(agent.settings.volume);

  const mobileCard = document.getElementById('mobile-card');
  if (agent.settings.mobileMode) {
    mobileCard.classList.remove('hidden');
    fetch('/mobile/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
  } else {
    mobileCard.classList.add('hidden');
    fetch('/mobile/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
  }
}

btnStart.addEventListener('click', async () => {
  const agent = window.DhyanAgent;
  if (!agent.monitoring) {
    await ensureNotificationPermission();
    const ok = await startCamera();
    if (!ok) return;
    syncSettingsFromUI();
    agent.start();
    btnStart.textContent = 'Stop Agent';
    btnStart.classList.add('running');
    btnCheck.disabled = false;
    setStatus('Monitoring', false);
    agentPhaseEl?.classList.add('active');
    if (phaseTextEl) phaseTextEl.textContent = 'IDLE';
    startSessionTimer();
    statsPollTimer = setInterval(updateStats, 30000);
    showToast('Dhyan Active', 'Wellness agent started.', 'success');
    setTimeout(() => {
      if (agent.monitoring) agent.runCycle(video, canvas);
    }, 2000);
  } else {
    agent.stop();
    stopCamera();
    stopSessionTimer();
    clearInterval(statsPollTimer);
    btnStart.textContent = 'Start Agent';
    btnStart.classList.remove('running');
    btnCheck.disabled = true;
    setStatus('Idle', false);
    agentPhaseEl?.classList.remove('active');
    if (phaseTextEl) phaseTextEl.textContent = 'IDLE';
  }
});

btnCheck.addEventListener('click', () => {
  if (window.DhyanAgent.monitoring) {
    window.DhyanAgent.runCycle(video, canvas);
  }
});

btnClear.addEventListener('click', async () => {
  await fetch('/clear', { method: 'POST' });
  document.getElementById('stat-checks').textContent = '0';
  document.getElementById('stat-posture').textContent = '—';
  document.getElementById('stat-skipped').textContent = '0';
  document.getElementById('stat-session').textContent = '0m';
  ['tbar-low', 'tbar-med', 'tbar-high'].forEach(id => {
    document.getElementById(id).style.height = '0%';
  });
  insightEmpty.classList.remove('hidden');
  insightResult.classList.add('hidden');
  document.getElementById('handoff-card')?.classList.add('hidden');
  highlightPostureGuide(null);
  showToast('Session Cleared', 'All local data has been reset.', 'success');
});

btnSettings.addEventListener('click', () => {
  settingsDrawer.classList.toggle('hidden');
  const isOpen = !settingsDrawer.classList.contains('hidden');
  btnSettings.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});
btnCloseSettings.addEventListener('click', () => {
  settingsDrawer.classList.add('hidden');
  btnSettings.setAttribute('aria-expanded', 'false');
});

['sound-enabled', 'speak-tips', 'mobile-mode', 'perf-mode', 'sound-volume'].forEach(id => {
  document.getElementById(id).addEventListener('change', syncSettingsFromUI);
});

document.getElementById('btn-force-high')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/demo/force-high', { method: 'POST' });
    const data = await res.json();
    if (!data.success || !data.analysis) {
      showToast('Demo failed', data.error || 'Could not inject HIGH.', 'warning');
      return;
    }
    if (typeof renderInsight === 'function') renderInsight(data.analysis);
    if (typeof updateStats === 'function') updateStats();
    if (typeof showWellnessPush === 'function') showWellnessPush(data.analysis);
    if (window.DhyanSounds?.playForFatigue) {
      window.DhyanSounds.playForFatigue('high');
    }
    const streak = data.consecutive_high_fatigue || 0;
    showToast('HIGH injected', `${streak}/3 consecutive — ${3 - streak} more to handoff`, 'warning');
    if (data.handoff || streak >= 3) {
      window.DhyanAgent?.triggerHandoff?.();
    } else {
      window.DhyanAgent?.setPhase?.('checking');
      document.getElementById('btn-acknowledge')?.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Demo failed', err.message || 'Request error', 'warning');
  }
});

btnAcknowledge?.addEventListener('click', async () => {
  await fetch('/agent/acknowledge', { method: 'POST' });
  btnAcknowledge.classList.add('hidden');
  window.DhyanAgent.setPhase('idle');
  showToast('Acknowledged', 'Break noted. Take care of yourself.', 'success');
});

btnResume?.addEventListener('click', async () => {
  await fetch('/agent/handoff/reset', { method: 'POST' });
  document.getElementById('handoff-card')?.classList.add('hidden');
  insightEmpty.classList.remove('hidden');
  const ok = await startCamera();
  if (!ok) return;
  window.DhyanAgent.start();
  btnStart.textContent = 'Stop Agent';
  btnStart.classList.add('running');
  btnCheck.disabled = false;
  setStatus('Monitoring', false);
  agentPhaseEl?.classList.add('active');
  showToast('Agent Resumed', 'Welcome back. Monitoring continues.', 'success');
  setTimeout(() => {
    if (window.DhyanAgent.monitoring) window.DhyanAgent.runCycle(video, canvas);
  }, 1500);
});

btnMobilePickup?.addEventListener('click', async () => {
  const res = await fetch('/mobile/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'pickup', enabled: true })
  });
  const data = await res.json();
  document.getElementById('mobile-count').textContent = data.events_today ?? 0;
});

window.renderInsight = renderInsight;
window.updateStats = updateStats;
window.showToast = showToast;
window.showWellnessPush = showWellnessPush;
window.ensureNotificationPermission = ensureNotificationPermission;
