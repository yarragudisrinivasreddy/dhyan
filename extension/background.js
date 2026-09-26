/**
 * Dhyan — background.js (Service Worker)
 * Manages periodic wellness checks via Chrome Alarms API.
 * Sends OS-level Chrome notifications — visible even when browser is minimized.
 * Privacy: All image data sent only to localhost:5000.
 */

const FLASK_URL = 'http://localhost:5000';
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
    startMonitoring(msg.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
    sendResponse({ success: true });
  }

  if (msg.type === 'STOP_MONITORING') {
    stopMonitoring();
    sendResponse({ success: true });
  }

  if (msg.type === 'CHECK_NOW') {
    triggerCheck().then(result => sendResponse({ success: true, result }));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['monitoring', 'totalChecks', 'lastAnalysis', 'intervalMinutes'], data => {
      sendResponse(data);
    });
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerCheck();
  }
});

function startMonitoring(intervalMinutes) {
  chrome.storage.local.set({ monitoring: true, intervalMinutes });
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes
  });
  console.log(`[Dhyan] Monitoring started. Interval: ${intervalMinutes}min`);
}

function stopMonitoring() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.storage.local.set({ monitoring: false });
  console.log('[Dhyan] Monitoring stopped.');
}

async function triggerCheck() {
  console.log('[Dhyan] Triggering wellness check...');

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;

  let imageB64 = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: captureWebcamFrame
    });
    imageB64 = results?.[0]?.result;
  } catch (err) {
    console.error('[Dhyan] Frame capture failed:', err);
    showNotification('error', 'Could not capture webcam. Is the tab allowing camera access?');
    return;
  }

  if (!imageB64) {
    showNotification('error', 'Webcam not available on this page. Open localhost:5000 for full monitoring.');
    return;
  }

  try {
    const res = await fetch(`${FLASK_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageB64 })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

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
    showNotification('error', 'Could not reach Dhyan server. Is Flask running on localhost:5000?');
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
  chrome.notifications.create(`dhyan-err-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Dhyan',
    message,
    priority: 0
  });
}

function captureWebcamFrame() {
  return new Promise((resolve) => {
    const video = document.getElementById('video') || document.querySelector('video');
    if (!video || !video.srcObject) {
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
