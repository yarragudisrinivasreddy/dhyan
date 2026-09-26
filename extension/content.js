/**
 * Dhyan — content.js
 * Injected into active tabs. Provides webcam frame capture
 * for the background service worker to use.
 * Privacy: Frames are only sent to localhost:5000.
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
    if (existingVideo && existingVideo.srcObject) {
      return drawFrame(existingVideo);
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;

    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    video.play();

    await new Promise(resolve => setTimeout(resolve, 500));
    const frame = drawFrame(video);

    stream.getTracks().forEach(t => t.stop());
    return frame;

  } catch (err) {
    console.error('[Dhyan content] Webcam capture failed:', err);
    return null;
  }
}

function drawFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  canvas.getContext('2d').drawImage(video, 0, 0, 480, 360);
  return canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
}
