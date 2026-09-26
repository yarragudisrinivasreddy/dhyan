/**
 * Dhyan — popup.js
 * Controls the extension popup UI. Communicates with background.js
 * via chrome.runtime.sendMessage for all monitoring operations.
 */

const btnToggle = document.getElementById('btn-toggle');
const btnCheck = document.getElementById('btn-check');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const intervalSelect = document.getElementById('interval');
const analyzingMsg = document.getElementById('analyzing-msg');
const lastResult = document.getElementById('last-result');
const nextCheckEl = document.getElementById('next-check');

let isMonitoring = false;
let countdownInterval = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('open-app').href = 'http://localhost:5000';
  loadStatus();
});

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (data) => {
    if (!data) return;
    isMonitoring = data.monitoring || false;
    updateUI();

    if (data.intervalMinutes) {
      intervalSelect.value = data.intervalMinutes;
    }

    // Stats
    document.getElementById('stat-checks').textContent = data.totalChecks || 0;

    if (data.lastAnalysis) {
      renderLastResult(data.lastAnalysis);
    }
  });
}

// ─── Controls ─────────────────────────────────────────────────────────────────

btnToggle.addEventListener('click', () => {
  if (!isMonitoring) {
    const mins = parseInt(intervalSelect.value, 10);
    setAnalyzing(true);
    chrome.runtime.sendMessage(
      { type: 'START_MONITORING', intervalMinutes: mins },
      (res) => {
        setAnalyzing(false);
        if (chrome.runtime.lastError) {
          statusText.textContent = chrome.runtime.lastError.message;
          return;
        }
        isMonitoring = true;
        updateUI();
        startCountdown(mins * 60);
        if (!res?.success) {
          statusText.textContent = res?.error || 'Could not start — open localhost:5000';
        }
      }
    );
  } else {
    chrome.runtime.sendMessage({ type: 'STOP_MONITORING' }, () => {
      isMonitoring = false;
      clearInterval(countdownInterval);
      nextCheckEl.textContent = '';
      updateUI();
    });
  }
});

btnCheck.addEventListener('click', () => {
  setAnalyzing(true);
  chrome.runtime.sendMessage({ type: 'CHECK_NOW' }, (res) => {
    setAnalyzing(false);
    if (chrome.runtime.lastError) {
      statusText.textContent = chrome.runtime.lastError.message;
      return;
    }
    if (res?.result) {
      renderLastResult(res.result);
      loadStatus();
    } else if (res?.error) {
      statusText.textContent = 'Check failed — allow camera on localhost:5000';
    } else {
      statusText.textContent = 'No frame — open dashboard, Start Agent, allow camera';
    }
  });
});

// ─── UI ───────────────────────────────────────────────────────────────────────

function updateUI() {
  if (isMonitoring) {
    btnToggle.textContent = 'Stop Monitoring';
    btnToggle.classList.add('stop');
    btnCheck.disabled = false;
    statusDot.classList.add('active');
    statusText.textContent = `Monitoring every ${intervalSelect.value} min via Gemma 4`;
  } else {
    btnToggle.textContent = 'Start Monitoring';
    btnToggle.classList.remove('stop');
    btnCheck.disabled = true;
    statusDot.classList.remove('active');
    statusText.textContent = 'Idle — click Start to begin monitoring';
  }
}

function setAnalyzing(state) {
  analyzingMsg.classList.toggle('visible', state);
  btnCheck.disabled = state;
  btnToggle.disabled = state;
}

function fatigueLabel(level) {
  const key = String(level || 'low').toLowerCase();
  if (key === 'high') return 'High fatigue';
  if (key === 'medium' || key === 'med') return 'Mild fatigue';
  return 'No fatigue';
}

function renderLastResult(analysis) {
  lastResult.classList.add('visible');

  const level = analysis.fatigue_level || 'low';
  const chip = document.getElementById('fatigue-chip');
  chip.textContent = fatigueLabel(level);
  chip.className = `fatigue-chip ${level}`;

  document.getElementById('posture-label').textContent = `Posture: ${analysis.posture_score || '?'}/10`;
  document.getElementById('tip-box').textContent = analysis.tips?.[0] || 'Stay hydrated and take breaks.';

  // Update stat badges
  document.getElementById('stat-posture').textContent = analysis.posture_score || '—';
  const fatigueLetter = { low: 'OK', medium: 'MILD', high: 'HIGH' };
  document.getElementById('stat-fatigue').textContent = fatigueLetter[level] || '—';
}

function startCountdown(totalSeconds) {
  clearInterval(countdownInterval);
  let remaining = totalSeconds;

  function tick() {
    if (!isMonitoring) { nextCheckEl.textContent = ''; return; }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    nextCheckEl.textContent = `Next check in ${m}m ${String(s).padStart(2, '0')}s`;
    if (remaining <= 0) {
      remaining = totalSeconds; // reset after each cycle
    }
    remaining--;
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}
