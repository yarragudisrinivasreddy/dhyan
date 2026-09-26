/**
 * Dhyan — content.js
 * Runs only on localhost:5000 / 127.0.0.1:5000.
 * Captures from the dashboard video element, or requests camera if needed.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_FRAME') {
    captureFrame().then(sendResponse);
    return true;
  }
});

async function captureFrame() {
  try {
    const existingVideo = document.getElementById('video') || document.querySelector('video');
    if (existingVideo && existingVideo.srcObject && existingVideo.readyState >= 2) {
      return drawFrame(existingVideo);
    }

    // Ask for camera on the dashboard origin — this is what triggers Chrome's permission prompt
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });

    // Prefer attaching to the dashboard <video> so the UI stays in sync
    if (existingVideo) {
      existingVideo.srcObject = stream;
      await existingVideo.play().catch(() => {});
      await wait(400);
      return drawFrame(existingVideo);
    }

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });
    await video.play();
    await wait(400);
    const frame = drawFrame(video);
    stream.getTracks().forEach((t) => t.stop());
    return frame;
  } catch (err) {
    console.error('[Dhyan content] Webcam capture failed:', err);
    return null;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drawFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  canvas.getContext('2d').drawImage(video, 0, 0, 480, 360);
  return canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
}
