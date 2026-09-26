/**
 * Dhyan — agent.js
 * Client-side agent loop controller.
 * Manages sense→decide→act→check phases and communicates with Flask backend.
 */

class DhyanAgent {
  constructor() {
    this.phase = 'idle';
    this.monitoring = false;
    this.nextCheckTimer = null;
    this.nextCheckAt = null;
    this.countdownInterval = null;
    this.settings = {
      soundEnabled: true,
      speakTips: false,
      mobileMode: false,
      perfMode: false,
      volume: 0.6
    };
  }

  setPhase(phase) {
    this.phase = phase;
    const phaseText = document.getElementById('phase-text');
    if (phaseText) phaseText.textContent = phase.toUpperCase();

    const agentPhase = document.getElementById('agent-phase');
    if (agentPhase) {
      agentPhase.classList.toggle('active', this.monitoring && phase !== 'idle');
    }

    const steps = ['sense', 'decide', 'act', 'check'];
    const map = {
      sensing: 'sense',
      deciding: 'decide',
      acting: 'act',
      checking: 'check',
    };
    const active = map[phase] || null;
    const activeIdx = active ? steps.indexOf(active) : -1;
    steps.forEach((step, idx) => {
      const el = document.getElementById(`loop-${step}`);
      if (!el) return;
      el.classList.toggle('active', step === active);
      el.classList.toggle('done', activeIdx > idx);
    });
  }

  async runCycle(videoElement, canvasElement) {
    if (!this.monitoring) return;

    this.setPhase('sensing');
    const scan = document.getElementById('scan-overlay');
    if (scan) scan.classList.add('active');

    const presenceResult = window.PresenceDetector.check(videoElement);
    const presenceBadge = document.getElementById('presence-badge');
    if (presenceBadge) {
      presenceBadge.textContent = presenceResult.present
        ? `Present (${presenceResult.reason})`
        : `Absent (${presenceResult.reason})`;
      presenceBadge.classList.toggle('present', !!presenceResult.present);
      presenceBadge.classList.toggle('absent', !presenceResult.present);
    }

    if (!presenceResult.present) {
      console.log(`[Agent] Skipping — ${presenceResult.reason}`);
      this.setPhase('idle');
      if (scan) scan.classList.remove('active');
      this.scheduleNext();
      if (typeof showToast === 'function') {
        showToast('Skipped', 'No presence detected — saving power.', 'info');
      }
      return;
    }

    const ctx = canvasElement.getContext('2d');
    const w = this.settings.perfMode ? 320 : 480;
    const h = this.settings.perfMode ? 240 : 360;
    canvasElement.width = w;
    canvasElement.height = h;
    // Wait one frame so we don't send an empty/black buffer to Gemma
    if (videoElement.readyState < 2) {
      await new Promise((r) => setTimeout(r, 250));
    }
    ctx.drawImage(videoElement, 0, 0, w, h);
    const imageDataUrl = canvasElement.toDataURL('image/jpeg', 0.65);

    const presenceCheck = await fetch('/presence/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl })
    }).then(r => r.json()).catch(() => ({ present: true }));

    if (!presenceCheck.present) {
      console.log(`[Agent] Server presence skip — ${presenceCheck.reason}`);
      this.setPhase('idle');
      if (scan) scan.classList.remove('active');
      this.scheduleNext();
      if (typeof showToast === 'function') {
        showToast('Skipped', `Presence check failed (${presenceCheck.reason || 'unknown'})`, 'info');
      }
      return;
    }

    this.setPhase('deciding');
    if (this.settings.soundEnabled) window.DhyanSounds.checkStarting();

    let analysis = null;
    try {
      const res = await fetch('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageDataUrl,
          mobile_active: this.settings.mobileMode
        })
      });

      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        throw new Error(`Server returned ${res.status} (non-JSON). Is Flask still starting?`);
      }

      if (!data.success && !data.offline_recovery) {
        throw new Error(data.error || `Analysis failed (${res.status})`);
      }
      if (data.offline_recovery && !data.analysis) {
        this.setPhase('offline_recovery');
        if (typeof showToast === 'function') {
          showToast(
            'Gemma unavailable',
            data.error || 'LM Studio unreachable — start Gemma 4 e4b on port 1234.',
            'warning'
          );
        }
        if (scan) scan.classList.remove('active');
        this.scheduleNext();
        return;
      }
      if (data.offline_recovery) {
        this.setPhase('offline_recovery');
        // In-dashboard only — never OS push for parse/model failures
        console.warn('[Dhyan] Offline recovery:', data.error || 'model unavailable');
      }
      analysis = data.analysis;
      if (!analysis) {
        throw new Error('No analysis payload returned.');
      }
    } catch (err) {
      this.setPhase('offline_recovery');
      if (typeof showToast === 'function') {
        showToast('Check failed', err.message || 'Gemma unreachable.', 'warning');
      }
      if (scan) scan.classList.remove('active');
      this.scheduleNext();
      return;
    }

    this.setPhase('acting');
    if (this.settings.soundEnabled) {
      window.DhyanSounds.playForFatigue(analysis.fatigue_level);
      if (analysis.fatigue_level === 'high' && this.settings.speakTips && analysis.tips?.[0]) {
        window.DhyanSounds.speakTip(analysis.tips[0]);
      }
    }

    if (typeof renderInsight === 'function') renderInsight(analysis);
    if (typeof updateStats === 'function') updateStats();

    const ackBtn = document.getElementById('btn-acknowledge');
    if (ackBtn) ackBtn.classList.remove('hidden');

    this.setPhase('checking');

    const stateRes = await fetch('/agent/state').then(r => r.json()).catch(() => null);
    if (stateRes?.consecutive_high_fatigue >= 3 || stateRes?.handoff_triggered) {
      if (scan) scan.classList.remove('active');
      this.triggerHandoff();
      return;
    }

    if (scan) scan.classList.remove('active');
    this.scheduleNext();
  }

  triggerHandoff() {
    this.setPhase('handoff');
    this.monitoring = false;
    document.getElementById('handoff-card')?.classList.remove('hidden');
    document.getElementById('insight-result')?.classList.add('hidden');
    if (this.settings.soundEnabled) window.DhyanSounds.handoff();
    if (typeof showToast === 'function') {
      showToast('Agent stepping back', '3x high fatigue. Please take a real break.', 'error');
    }
    const btnStart = document.getElementById('btn-start');
    if (btnStart) {
      btnStart.textContent = 'Start Agent';
      btnStart.classList.remove('running');
    }
    document.getElementById('btn-check')?.setAttribute('disabled', 'true');
  }

  scheduleNext() {
    clearTimeout(this.nextCheckTimer);
    clearInterval(this.countdownInterval);

    const interval = parseInt(document.getElementById('interval')?.value || 600000, 10);
    const jitter = interval * 0.1 * (Math.random() * 2 - 1);
    const delay = interval + jitter;
    this.nextCheckAt = Date.now() + delay;

    const nextEl = document.getElementById('next-check');
    this.countdownInterval = setInterval(() => {
      if (!this.nextCheckAt || !nextEl) return;
      const secs = Math.max(0, Math.ceil((this.nextCheckAt - Date.now()) / 1000));
      nextEl.textContent = secs > 0 ? `Next check in ${secs}s` : '';
    }, 1000);

    this.nextCheckTimer = setTimeout(() => {
      const video = document.getElementById('video');
      const canvas = document.getElementById('canvas');
      if (video && canvas) this.runCycle(video, canvas).then(() => {});
    }, delay);
  }

  start() {
    this.monitoring = true;
    this.setPhase('idle');
  }

  stop() {
    this.monitoring = false;
    clearTimeout(this.nextCheckTimer);
    clearInterval(this.countdownInterval);
    this.setPhase('idle');
    this.nextCheckAt = null;
    const nextEl = document.getElementById('next-check');
    if (nextEl) nextEl.textContent = '';
  }
}

window.DhyanAgent = new DhyanAgent();
