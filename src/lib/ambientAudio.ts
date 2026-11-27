export type AmbientChannelId = "rain" | "vinyl" | "brown" | "fire";

export type AmbientLevels = Record<AmbientChannelId, number>;

export const DEFAULT_AMBIENT_LEVELS: AmbientLevels = {
  rain: 0,
  vinyl: 0,
  brown: 0,
  fire: 0,
};

interface ChannelNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

class ProceduralAmbientEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private channels = new Map<AmbientChannelId, ChannelNodes>();
  private levels: AmbientLevels = { ...DEFAULT_AMBIENT_LEVELS };

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext, id: AmbientChannelId): AudioBuffer {
    const durationSec = id === "vinyl" || id === "fire" ? 6 : 4;
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      if (id === "brown") {
        let lastOut = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 3.2;
        }
      } else if (id === "rain") {
        // Pink-ish rain texture with soft droplet micro-variations
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
          b6 = white * 0.115926;
          const drop = Math.random() < 0.00045 ? (Math.random() * 2 - 1) * 0.25 : 0;
          data[i] = Math.max(-1, Math.min(1, pink + drop));
        }
      } else if (id === "vinyl") {
        // Subtle warm hiss + crisp lo-fi crackle impulses
        let lp = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          lp = lp * 0.86 + white * 0.14;
          let crackle = 0;
          const r = Math.random();
          if (r < 0.00018) crackle = (Math.random() * 2 - 1) * 0.85;
          else if (r < 0.0012) crackle = (Math.random() * 2 - 1) * 0.22;
          data[i] = Math.max(-1, Math.min(1, lp * 0.12 + crackle));
        }
      } else {
        // Cozy fireplace: deep hearth rumble + warm wooden crackles
        let rumble = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          rumble = (rumble + 0.012 * white) / 1.012;
          let pop = 0;
          if (Math.random() < 0.00028) {
            pop = (Math.random() * 2 - 1) * 0.72;
          }
          data[i] = Math.max(-1, Math.min(1, rumble * 3.8 + pop));
        }
      }
    }
    return buffer;
  }

  private startChannel(ctx: AudioContext, id: AmbientChannelId): ChannelNodes {
    const source = ctx.createBufferSource();
    source.buffer = this.createNoiseBuffer(ctx, id);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    if (id === "rain") {
      filter.type = "bandpass";
      filter.frequency.value = 1150;
      filter.Q.value = 0.55;
    } else if (id === "brown") {
      filter.type = "lowpass";
      filter.frequency.value = 340;
    } else if (id === "vinyl") {
      filter.type = "highpass";
      filter.frequency.value = 900;
    } else {
      filter.type = "lowpass";
      filter.frequency.value = 780;
    }

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    source.start();

    const nodes = { source, gain };
    this.channels.set(id, nodes);
    return nodes;
  }

  setChannelLevel(id: AmbientChannelId, level: number) {
    const clamped = Math.max(0, Math.min(1, level));
    this.levels[id] = clamped;

    if (clamped <= 0.005) {
      const existing = this.channels.get(id);
      if (existing && this.ctx) {
        const now = this.ctx.currentTime;
        existing.gain.gain.cancelScheduledValues(now);
        existing.gain.gain.setTargetAtTime(0.0001, now, 0.08);
        window.setTimeout(() => {
          if (this.levels[id] <= 0.005) {
            try {
              existing.source.stop();
              existing.source.disconnect();
            } catch {
              // Already stopped
            }
            this.channels.delete(id);
          }
        }, 320);
      }
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;
    const nodes = this.channels.get(id) ?? this.startChannel(ctx, id);
    const maxScale = id === "vinyl" ? 0.35 : id === "brown" ? 0.42 : 0.48;
    const targetGain = clamped * clamped * maxScale;
    const now = ctx.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setTargetAtTime(Math.max(0.0001, targetGain), now, 0.08);
  }

  stopAll(fadeMs = 500) {
    const ids: AmbientChannelId[] = ["rain", "vinyl", "brown", "fire"];
    if (!this.ctx || !this.masterGain) {
      for (const id of ids) this.levels[id] = 0;
      return;
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.0001, now, Math.max(0.05, fadeMs / 3500));

    window.setTimeout(() => {
      for (const [id, nodes] of this.channels.entries()) {
        try {
          nodes.source.stop();
          nodes.source.disconnect();
        } catch {
          // Ignore
        }
        this.channels.delete(id);
        this.levels[id] = 0;
      }
      if (this.ctx && this.masterGain) {
        this.masterGain.gain.setValueAtTime(1, this.ctx.currentTime);
      }
    }, fadeMs + 80);
  }

  /** Plays a soft, warm Apple-like zen chime (used by Musical Pomodoro transitions) */
  playZenChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [528, 792]; // Warm fifth harmonic
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(idx === 0 ? 0.14 : 0.08, now + idx * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 1.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 1.7);
    });
  }
}

export const ambientAudio = new ProceduralAmbientEngine();
