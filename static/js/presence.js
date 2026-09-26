/**
 * Dhyan — presence.js
 * Client-side intelligent presence detection.
 * Compares frames before sending to backend — saves battery + Gemma calls.
 */

class PresenceDetector {
  constructor() {
    this.prevFrameData = null;
    this.MOTION_THRESHOLD = 15;
    this.BRIGHTNESS_THRESHOLD = 20;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 120;
    this.ctx = this.canvas.getContext('2d');
  }

  check(videoElement) {
    try {
      this.ctx.drawImage(videoElement, 0, 0, 160, 120);
      const imageData = this.ctx.getImageData(0, 0, 160, 120);
      const pixels = imageData.data;

      let totalBrightness = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        totalBrightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      }
      const avgBrightness = totalBrightness / (pixels.length / 4);

      if (avgBrightness < this.BRIGHTNESS_THRESHOLD) {
        return { present: false, reason: 'dark_frame', confidence: 0 };
      }

      if (this.prevFrameData) {
        let totalDiff = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          totalDiff += Math.abs(pixels[i] - this.prevFrameData[i]);
        }
        const avgDiff = totalDiff / (pixels.length / 4);

        if (avgDiff < this.MOTION_THRESHOLD) {
          this.prevFrameData = pixels.slice();
          return {
            present: true,
            reason: 'low_motion_but_bright',
            confidence: 0.6
          };
        }

        this.prevFrameData = pixels.slice();
        return { present: true, reason: 'motion_detected', confidence: 0.95 };
      }

      this.prevFrameData = pixels.slice();
      return { present: true, reason: 'first_frame', confidence: 0.8 };

    } catch (err) {
      console.warn('[Presence] Detection error:', err);
      return { present: true, reason: 'detection_error_allow', confidence: 0.5 };
    }
  }

  reset() {
    this.prevFrameData = null;
  }
}

window.PresenceDetector = new PresenceDetector();
