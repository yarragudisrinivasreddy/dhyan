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
const observationsCard = document.getElementById('observations-card');
const tipsList = document.getElementById('tips-list');
const breakText = document.getElementById('break-text');
const affirmationEl = document.getElementById('affirmation');
const urgencyBadge = document.getElementById('urgency-badge');

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

function renderInsight(analysis) {
  insightEmpty.classList.add('hidden');
  insightResult.classList.remove('hidden');
  document.getElementById('handoff-card')?.classList.add('hidden');

  insightResult.style.animation = 'none';
  requestAnimationFrame(() => { insightResult.style.animation = ''; });

  const level = analysis.fatigue_level || 'low';
  fatigueChip.textContent = level.charAt(0).toUpperCase() + level.slice(1) + ' Fatigue';
  fatigueChip.className = `fatigue-chip ${level}`;

  const score = analysis.posture_score || 5;
  const circ = 150.8;
  ringFill.style.strokeDashoffset = circ - (score / 10) * circ;
  postureVal.textContent = score;

  const obs = analysis.observations || [];
  observationsCard.innerHTML = obs.map(o => `<div>${o}</div>`).join('');

  tipsList.innerHTML = (analysis.tips || []).map(tip => `<li>${tip}</li>`).join('');
  breakText.textContent = analysis.break_suggestion || 'Take a 5-minute walk.';
  affirmationEl.textContent = analysis.affirmation || 'You are doing great.';
  urgencyBadge.textContent = analysis.urgency || '';
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

function setStatus(text) {
  statusBadge.textContent = text;
}

function showToast(title, body, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  container.appendChild(toast);

  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (_) { /* ignore */ }
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
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
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const ok = await startCamera();
    if (!ok) return;
    syncSettingsFromUI();
    agent.start();
    btnStart.textContent = 'Stop Agent';
    btnStart.classList.add('stop');
    btnCheck.disabled = false;
    setStatus('Monitoring');
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
    btnStart.classList.remove('stop');
    btnCheck.disabled = true;
    setStatus('Idle');
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
  showToast('Session Cleared', 'All local data has been reset.', 'success');
});

btnSettings.addEventListener('click', () => {
  settingsDrawer.classList.toggle('hidden');
});
btnCloseSettings.addEventListener('click', () => {
  settingsDrawer.classList.add('hidden');
});

['sound-enabled', 'speak-tips', 'mobile-mode', 'perf-mode', 'sound-volume'].forEach(id => {
  document.getElementById(id).addEventListener('change', syncSettingsFromUI);
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
  btnStart.classList.add('stop');
  btnCheck.disabled = false;
  setStatus('Monitoring');
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
  document.getElementById('mobile-pickups').textContent =
    `${data.events_today} pickups today`;
});

window.renderInsight = renderInsight;
window.updateStats = updateStats;
window.showToast = showToast;

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
