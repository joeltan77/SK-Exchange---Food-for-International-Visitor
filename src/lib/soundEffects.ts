/**
 * Non-speech audio and haptic feedback service using the standard Web Audio API
 * and navigator.vibrate. Requires no external audio files.
 */

class SoundEffectsService {
  private audioCtx: AudioContext | null = null;
  private soundEnabled = true;
  private vibrationEnabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedSound = localStorage.getItem('kstreet_sound_feedback');
        if (storedSound !== null) {
          this.soundEnabled = storedSound === 'true';
        }
        const storedVib = localStorage.getItem('kstreet_vibration_feedback');
        if (storedVib !== null) {
          this.vibrationEnabled = storedVib === 'true';
        }
      } catch (e) {
        console.warn('Could not read sound preferences:', e);
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    try {
      localStorage.setItem('kstreet_sound_feedback', String(enabled));
    } catch {}
  }

  public isVibrationEnabled(): boolean {
    return this.vibrationEnabled;
  }

  public setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
    try {
      localStorage.setItem('kstreet_vibration_feedback', String(enabled));
    } catch {}
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.vibrationEnabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }

  /**
   * Ascending gentle chime when microphone starts listening
   */
  public playListeningStart(): void {
    this.vibrate(60);
    if (!this.soundEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  /**
   * Gentle descending tone when microphone stops listening
   */
  public playListeningStop(): void {
    this.vibrate(30);
    if (!this.soundEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.1);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  /**
   * Pleasant double-beep when a command is understood and accepted
   */
  public playCommandAccepted(): void {
    this.vibrate([40, 40, 60]);
    if (!this.soundEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.07);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.07);
      });
    } catch {}
  }

  /**
   * Low warning tone for errors or unclear commands
   */
  public playError(): void {
    this.vibrate([80, 50, 80]);
    if (!this.soundEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(196, now + 0.08);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }

  /**
   * Bright, celebratory chime chord when order is delivered successfully
   */
  public playOrderSent(): void {
    this.vibrate([70, 40, 100, 40, 150]);
    if (!this.soundEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // C5, E5, G5, C6 arpeggio chord
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0.001, now + idx * 0.07);
        gain.gain.linearRampToValueAtTime(0.14, now + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.35);
      });
    } catch {}
  }
}

export const soundEffects = new SoundEffectsService();
