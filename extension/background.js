/**
 * Dhyan — background.js (Service Worker)
 * Captures frames only from the local Dhyan dashboard (localhost:5000).
 * Chrome blocks scripting on chrome:// pages — never use the active tab blindly.
 */

const FLASK_URL = 'http://localhost:5000';
const DASHBOARD_URLS = [
  'http://localhost:5000/',
  'http://127.0.0.1:5000/'
];
const ALARM_NAME = 'dhyan-check';
const DEFAULT_INTERVAL_MINUTES = 10;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    monitoring: false,
    totalChecks: 0,
    lastAnalysis: null
  });
  console.log('[Dhyan] Installed. Ready to monitor.');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_MONITORING') {
    startMonitoring(msg.intervalMinutes || DEFAULT_INTERVAL_MINUTES)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'STOP_MONITORING') {
    stopMonitoring();
    sendResponse({ success: true });
  }

  if (msg.type === 'CHECK_NOW') {
    triggerCheck()
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(
      ['monitoring', 'totalChecks', 'lastAnalysis', 'intervalMinutes'],
      (data) => sendResponse(data)
    );
    return true;
  }

  if (msg.type === 'OPEN_DASHBOARD') {
    ensureDashboardTab()
      .then((tab) => sendResponse({ success: true, tabId: tab.id }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerCheck();
  }
});

async function startMonitoring(intervalMinutes) {
  chrome.storage.local.set({ monitoring: true, intervalMinutes });
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: Math.max(intervalMinutes, 0.5),
    periodInMinutes: Math.max(intervalMinutes, 0.5)
  });

  // Open dashboard so the browser can prompt for camera on a real http page
  await ensureDashboardTab(true);
  showNotification(
    'info',
    'Dashboard opened. Allow camera access on localhost:5000, then click Check Now.'
  );

  // First check after the page has a moment to start the camera
  setTimeout(() => triggerCheck(), 4000);
  console.log(`[Dhyan] Monitoring started. Interval: ${intervalMinutes}min`);
}

function stopMonitoring() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.storage.local.set({ monitoring: false });
  console.log('[Dhyan] Monitoring stopped.');
}

function isDashboardUrl(url = '') {
  return (
    url.startsWith('http://localhost:5000') ||
    url.startsWith('http://127.0.0.1:5000')
  );
}

async function ensureDashboardTab(activate = true) {
  const existing = await chrome.tabs.query({
    url: ['http://localhost:5000/*', 'http://127.0.0.1:5000/*']
  });

  if (existing.length) {
    const tab = existing[0];
    if (activate) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    }
    return tab;
  }

  return chrome.tabs.create({ url: DASHBOARD_URLS[0], active: activate });
}

async function captureFromDashboard() {
  const tab = await ensureDashboardTab(false);
  if (!tab?.id) {
    throw new Error('Could not open Dhyan dashboard.');
  }

  // Prefer content-script message (already injected on localhost)
  try {
    const frame = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_FRAME' });
    if (frame) return frame;
  } catch (_) {
    // Content script may not be ready yet — fall through to executeScript
  }

  // Inject capture helper into the dashboard tab only
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: captureWebcamFrame
  });
  return results?.[0]?.result || null;
}

async function triggerCheck() {
  console.log('[Dhyan] Triggering wellness check...');

  let imageB64 = null;
  try {
    imageB64 = await captureFromDashboard();
  } catch (err) {
    console.error('[Dhyan] Frame capture failed:', err);
    const msg = String(err?.message || err);
    if (msg.includes('chrome://') || msg.includes('Cannot access')) {
      showNotification(
        'error',
        'Open http://localhost:5000 (not chrome:// pages), allow the camera, then try again.'
      );
    } else {
      showNotification(
        'error',
        'Could not capture webcam. Keep the Dhyan dashboard open and allow camera access.'
      );
    }
    return null;
  }

  if (!imageB64) {
    showNotification(
      'error',
      'No camera frame yet. On http://localhost:5000 click Start Agent and allow the camera.'
    );
    // Make sure dashboard is visible so the user can grant permission
    await ensureDashboardTab(true);
    return null;
  }

  try {
    const res = await fetch(`${FLASK_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageB64 })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Analyze failed');

    const analysis = data.analysis;
    const stored = await chrome.storage.local.get(['totalChecks']);
    chrome.storage.local.set({
      totalChecks: (stored.totalChecks || 0) + 1,
      lastAnalysis: { ...analysis, timestamp: new Date().toISOString() }
    });

    showWellnessNotification(analysis);
    return analysis;
  } catch (err) {
    console.error('[Dhyan] Analysis failed:', err);
    showNotification(
      'error',
      'Could not reach Dhyan server. Is Flask running on localhost:5000?'
    );
    return null;
  }
}

function showWellnessNotification(analysis) {
  const level = analysis.fatigue_level || 'low';
  const tip = analysis.tips?.[0] || 'Take a short break.';
  const breakSuggestion = analysis.break_suggestion || '';
  const urgency = level === 'high' ? 'Action needed: ' : '';

  chrome.notifications.create(`dhyan-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Dhyan — ${level.charAt(0).toUpperCase() + level.slice(1)} Fatigue · Posture ${analysis.posture_score}/10`,
    message: `${urgency}${tip}`,
    contextMessage: breakSuggestion,
    priority: level === 'high' ? 2 : 1,
    requireInteraction: level === 'high'
  });
}

function showNotification(type, message) {
  chrome.notifications.create(`dhyan-msg-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Dhyan',
    message,
    priority: type === 'error' ? 1 : 0
  });
}

/** Runs inside the dashboard page context */
function captureWebcamFrame() {
  return new Promise((resolve) => {
    const video = document.getElementById('video') || document.querySelector('video');
    if (!video || !video.srcObject || video.readyState < 2) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    canvas.getContext('2d').drawImage(video, 0, 0, 480, 360);
    resolve(canvas.toDataURL('image/jpeg', 0.65).split(',')[1]);
  });
}
