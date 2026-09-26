/**
 * Dhyan — sounds.js
 * Web Audio API sound engine. Zero dependencies. Works fully offline.
 * All sounds generated programmatically — no audio files needed.
 * Privacy-safe: no external CDN calls.
 */

class DhyanSounds {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
    this._init();
  }

  _init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('[Dhyan Sounds] Web Audio API not available.');
    }
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _tone(frequency, duration, type = 'sine', delay = 0) {
    if (!this.ctx || !this.enabled) return;
    this._resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, this.ctx.currentTime + delay);

    gain.gain.setValueAtTime(0, this.ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + delay + duration);

    osc.start(this.ctx.currentTime + delay);
    osc.stop(this.ctx.currentTime + delay + duration);
  }

  checkStarting() {
    this._tone(440, 0.15, 'sine', 0);
    this._tone(528, 0.15, 'sine', 0.15);
    this._tone(660, 0.25, 'sine', 0.30);
  }

  lowFatigue() {
    this._tone(528, 0.5, 'sine', 0);
    this._tone(660, 0.3, 'sine', 0.2);
  }

  mediumFatigue() {
    this._tone(440, 0.2, 'triangle', 0);
    this._tone(440, 0.2, 'triangle', 0.35);
  }

  highFatigue() {
    for (let i = 0; i < 3; i++) {
      this._tone(660, 0.15, 'sawtooth', i * 0.3);
      this._tone(440, 0.15, 'sawtooth', i * 0.3 + 0.15);
    }
  }

  handoff() {
    this._tone(660, 0.2, 'sine', 0);
    this._tone(528, 0.2, 'sine', 0.25);
    this._tone(330, 0.4, 'sine', 0.50);
  }

  breakReminder() {
    const freqs = [523, 659, 784, 1047];
    freqs.forEach((f, i) => {
      this._tone(f, 0.4, 'sine', i * 0.12);
    });
  }

  speakTip(text) {
    if (!this.enabled || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = this.volume;
    window.speechSynthesis.speak(utterance);
  }

  playForFatigue(level) {
    switch (level) {
      case 'low':    return this.lowFatigue();
      case 'medium': return this.mediumFatigue();
      case 'high':   this.highFatigue(); break;
      default: return;
    }
  }

  setEnabled(val) { this.enabled = val; }
  setVolume(val)  { this.volume = Math.max(0, Math.min(1, val)); }
}

window.DhyanSounds = new DhyanSounds();
