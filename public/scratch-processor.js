// ─── Scratch Envelope Helpers ────────────────────────────────────────

function clampVal(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function arc(phase, curve) {
  const c = clampVal(phase, 0, 1);
  return Math.sin(Math.pow(c, curve) * Math.PI);
}

function stroke(phase, direction, velocity, gain, curve) {
  return direction * arc(phase, curve) * velocity * gain;
}

function phaseIn(t, start, end) {
  if (end <= start || t < start || t > end) return null;
  return (t - start) / (end - start);
}

function staggeredStroke(phase, direction, tears, velocity, gain) {
  const clamped = clampVal(phase, 0, 0.999999);
  const segCount = Math.max(tears + 1, 1);
  const seg = Math.min(Math.floor(clamped * segCount), segCount - 1);
  const segStart = seg / segCount;
  const local = (clamped - segStart) * segCount;
  const localGain = gain * (0.82 + seg * 0.14);
  const curve = 0.86 + seg * 0.06;
  return stroke(local, direction, velocity, localGain, curve);
}

function transformerMute(phase, burstCount) {
  const c = clampVal(phase, 0, 1);
  const w = 1.0 / burstCount;
  for (let i = 0; i < burstCount; i++) {
    const center = (i + 0.5) * w;
    if (Math.abs(c - center) <= w * 0.2) return false; // open
  }
  return true; // muted
}

function pulseMute(phase, centers, width) {
  const c = clampVal(phase, 0, 1);
  const hw = width / 2;
  for (let i = 0; i < centers.length; i++) {
    if (Math.abs(c - centers[i]) <= hw) return true;
  }
  return false;
}

function flareMute(phase, clickCount) {
  if (clickCount === 1) return pulseMute(phase, [0.46], 0.12);
  if (clickCount === 2) return pulseMute(phase, [0.28, 0.62], 0.1);
  const spacing = 1.0 / (clickCount + 1);
  const centers = [];
  for (let i = 0; i < clickCount; i++) centers.push(spacing * (i + 1));
  return pulseMute(phase, centers, Math.max(0.08, spacing * 0.35));
}

function swingWarp(t, swing) {
  if (swing <= 0) return t;
  const skew = (swing / 100) * 0.34;
  const boundary = 0.5 + skew * 0.5;
  if (t < boundary) return 0.5 * (t / boundary);
  return 0.5 + 0.5 * ((t - boundary) / (1.0 - boundary));
}

// Repeating cut mute: cutCount cuts → (cutCount*2+1) segments, odd = muted
function repeatingCutMute(t, cutCount) {
  const c = clampVal(t, 0, 0.999999);
  const segCount = cutCount * 2 + 1;
  const seg = Math.floor(c * segCount);
  return seg % 2 === 1;
}

// ─── Envelope evaluate ──────────────────────────────────────────────
// Returns { speed, muted } where muted can be null (no mute control)
function evaluateEnvelope(envType, tRaw, velocity, swing) {
  const t = swingWarp(tRaw, swing);
  let p;

  switch (envType) {
    case 'silent':
      return { speed: 0, muted: null };

    case 'forward':
      return { speed: Math.sin(t * Math.PI) * velocity * 2.45, muted: null };

    case 'forwardStop':
      if (t <= 0.38) {
        p = t / 0.38;
        return { speed: Math.sin(p * Math.PI) * velocity * 2.45, muted: null };
      }
      if (t < 0.58) return { speed: 0, muted: null };
      p = (t - 0.58) / 0.42;
      return { speed: Math.sin(p * Math.PI) * velocity * 2.45, muted: null };

    case 'backward':
      return { speed: -Math.sin(t * Math.PI) * velocity * 2.45, muted: null };

    case 'backwardStop':
      if (t <= 0.38) {
        p = t / 0.38;
        return { speed: -Math.sin(p * Math.PI) * velocity * 2.45, muted: null };
      }
      if (t < 0.58) return { speed: 0, muted: null };
      p = (t - 0.58) / 0.42;
      return { speed: -Math.sin(p * Math.PI) * velocity * 2.45, muted: null };

    case 'baby': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: stroke(p, 1, velocity, 3.4, 0.8), muted: null };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 3.15, 0.9), muted: null };
    }

    case 'inBaby': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: stroke(p, -1, velocity, 3.35, 0.8), muted: null };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, 1, velocity, 3.2, 0.88), muted: null };
    }

    case 'babyDouble': {
      const seg = Math.min(Math.floor(t * 4), 3);
      const start = seg * 0.25;
      p = (t - start) / 0.25;
      const dir = seg % 2 === 0 ? 1 : -1;
      const gains = [3.35, 3.0, 3.25, 2.95];
      const curves = [0.78, 0.9, 0.82, 0.95];
      return { speed: stroke(p, dir, velocity, gains[seg], curves[seg]), muted: null };
    }

    case 'transformer': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) {
        return { speed: stroke(p, 1, velocity, 3.0, 0.84), muted: transformerMute(p, 3) };
      }
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 2.9, 0.92), muted: transformerMute(p, 3) };
    }

    case 'chirp': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) {
        return { speed: stroke(p, 1, velocity, 3.6, 0.74), muted: p > 0.22 };
      }
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 3.15, 0.94), muted: p < 0.18 || p > 0.9 };
    }

    case 'chirpDouble': {
      p = phaseIn(t, 0, 0.25);
      if (p !== null) return { speed: stroke(p, 1, velocity, 3.6, 0.74), muted: p > 0.22 };
      p = phaseIn(t, 0.25, 0.5);
      if (p !== null) return { speed: stroke(p, -1, velocity, 3.15, 0.94), muted: p < 0.18 || p > 0.9 };
      p = phaseIn(t, 0.5, 0.75);
      if (p !== null) return { speed: stroke(p, 1, velocity, 3.6, 0.74), muted: p > 0.22 };
      p = phaseIn(t, 0.75, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 3.15, 0.94), muted: p < 0.18 || p > 0.9 };
    }

    case 'flare': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: stroke(p, 1, velocity, 3.25, 0.78), muted: flareMute(p, 1) };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 3.1, 0.9), muted: flareMute(p, 1) };
    }

    case 'slice': {
      p = phaseIn(t, 0, 0.56);
      if (p !== null) {
        return { speed: stroke(p, 1, velocity, 3.25, 0.8), muted: pulseMute(p, [0.48], 0.12) };
      }
      p = phaseIn(t, 0.56, 1.0);
      if (p !== null) return { speed: stroke(p, -1, velocity, 2.15, 0.96), muted: true };
      return { speed: 0, muted: true };
    }

    case 'release': {
      if (t < 0.12) return { speed: 0, muted: true };
      p = phaseIn(t, 0.12, 0.72);
      if (p !== null) return { speed: stroke(p, 1, velocity, 2.9, 0.98), muted: false };
      p = phaseIn(t, 0.72, 1.0);
      if (p !== null) return { speed: stroke(p, -1, velocity, 1.9, 0.98), muted: true };
      return { speed: 0, muted: true };
    }

    case 'tear': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: staggeredStroke(p, 1, 1, velocity, 2.4), muted: null };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: staggeredStroke(p, -1, 1, velocity, 2.2), muted: null };
    }

    case 'tearDouble': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: staggeredStroke(p, 1, 2, velocity, 2.25), muted: null };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: staggeredStroke(p, -1, 2, velocity, 2.05), muted: null };
    }

    case 'orbit': {
      p = phaseIn(t, 0, 0.5);
      if (p !== null) return { speed: stroke(p, 1, velocity, 3.2, 0.78), muted: flareMute(p, 2) };
      p = phaseIn(t, 0.5, 1.0) ?? 0;
      return { speed: stroke(p, -1, velocity, 3.05, 0.92), muted: flareMute(p, 2) };
    }

    case 'scribble': {
      const c = clampVal(t, 0, 1);
      const taper = Math.pow(Math.sin(c * Math.PI), 0.65);
      return { speed: Math.sin(c * Math.PI * 2 * 4.5) * velocity * 2.25 * taper, muted: null };
    }

    default:
      return { speed: 0, muted: null };
  }
}

// ─── Crossfader mute evaluation ─────────────────────────────────────
function evaluateCrossfader(action, t) {
  switch (action) {
    case 'open': return false;
    case 'closed': return true;
    case 'chop': return t > 0.5;
    case 'chopFront': return t < 0.5;
    case 'cut2': return repeatingCutMute(t, 2);
    case 'cut3': return repeatingCutMute(t, 3);
    default: return false;
  }
}

// ─── Main AudioWorklet Processor ────────────────────────────────────

class ScratchWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.samples = null;
    this.length = 0;
    this.bufferSampleRate = sampleRate;
    this.position = 0;
    this.currentSpeed = 0;
    this.transportSpeed = 1;
    this.scratchVelocity = 0;
    this.playing = false;
    this.scratchActive = false;
    this.releaseFriction = 0.99992;
    this.messageCounter = 0;
    this.noiseSeed = 0x12345678;

    // Envelope sequencer state
    this.envType = 'silent';       // current scratch envelope type
    this.envVelocity = 1.0;        // velocity for envelope
    this.envCrossfader = 'open';   // crossfader action
    this.envSwing = 0;             // swing amount
    this.envActive = false;        // is envelope-driven step active
    this.envStartFrame = 0;        // frame when envelope started
    this.envDurationFrames = 0;    // total frames for this step
    this.envIsScratch = false;     // is this a scratch gesture (uses envelope speed)

    // Mute state with anti-click fade
    this.muteGain = 1.0;
    this.muteTarget = 1.0;
    this.muteFadeStep = 1.0 / 72;  // ~72 sample fade

    // Global frame counter for envelope timing
    this.globalFrame = 0;

    this.port.onmessage = (event) => {
      const { data } = event;

      switch (data.type) {
        case 'setBuffer':
          this.samples = data.samples;
          this.length = data.samples.length;
          this.bufferSampleRate = data.sampleRate || sampleRate;
          this.position = 0;
          this.currentSpeed = 0;
          break;
        case 'setTransport':
          this.playing = Boolean(data.playing);
          this.transportSpeed = Number.isFinite(data.speed) ? data.speed : 1;
          break;
        case 'setScratch':
          this.scratchActive = Boolean(data.active);
          this.scratchVelocity = Number.isFinite(data.velocity) ? data.velocity : 0;
          break;
        case 'setPosition':
          if (this.length > 0 && Number.isFinite(data.time)) {
            this.position = clampVal(
              data.time * this.bufferSampleRate,
              0,
              Math.max(this.length - 1, 0)
            );
          }
          break;
        case 'triggerStep': {
          // Start envelope-driven step
          this.envType = data.envelope || 'silent';
          this.envVelocity = data.velocity || 1.0;
          this.envCrossfader = data.crossfader || 'open';
          this.envSwing = data.swing || 0;
          this.envActive = true;
          this.envStartFrame = this.globalFrame;
          this.envDurationFrames = Math.round((data.durationMs / 1000) * sampleRate);
          this.envIsScratch = data.isScratch || false;
          this.playing = true;
          // Jump to cue if specified
          if (Number.isFinite(data.seekTime) && this.length > 0) {
            this.position = clampVal(
              data.seekTime * this.bufferSampleRate,
              0, this.length - 1
            );
            this.currentSpeed = 0;
          }
          break;
        }
        case 'stopEnvelope':
          this.envActive = false;
          this.envType = 'silent';
          break;
        default:
          break;
      }
    };
  }

  safeSample(index) {
    if (!this.samples || this.length === 0) return 0;
    const clamped = clampVal(Math.floor(index), 0, this.length - 1);
    return this.samples[clamped];
  }

  interpolate(position) {
    const intPos = Math.floor(position);
    const frac = position - intPos;
    const y0 = this.safeSample(intPos - 1);
    const y1 = this.safeSample(intPos);
    const y2 = this.safeSample(intPos + 1);
    const y3 = this.safeSample(intPos + 2);

    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    const a3 = y1;

    return ((a0 * frac + a1) * frac + a2) * frac + a3;
  }

  frictionNoise(amount) {
    this.noiseSeed = (1664525 * this.noiseSeed + 1013904223) >>> 0;
    const white = ((this.noiseSeed >>> 8) / 0xffffff) * 2 - 1;
    return white * amount;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];

    if (!this.samples || this.length === 0) {
      left.fill(0);
      right.fill(0);
      return true;
    }

    const sampleStep = this.bufferSampleRate / sampleRate;
    const smoothing = 0.05;

    for (let frame = 0; frame < left.length; frame += 1) {
      let targetSpeed = 0;
      let frameMuted = false;

      // Determine target speed and mute from envelope or manual control
      if (this.envActive) {
        const elapsed = this.globalFrame - this.envStartFrame;
        const t = this.envDurationFrames > 0
          ? clampVal(elapsed / this.envDurationFrames, 0, 1)
          : 1;

        if (elapsed >= this.envDurationFrames) {
          // Step ended — keep playing at transport speed
          this.envActive = false;
          this.envType = 'silent';
          targetSpeed = this.transportSpeed;
        } else {
          const env = evaluateEnvelope(this.envType, t, this.envVelocity, this.envSwing);
          const xfMute = evaluateCrossfader(this.envCrossfader, t);

          if (this.envIsScratch) {
            targetSpeed = env.speed;
          } else {
            targetSpeed = this.transportSpeed;
          }

          // Combine envelope mute and crossfader mute (OR logic)
          if (env.muted !== null) {
            frameMuted = env.muted || xfMute;
          } else {
            frameMuted = xfMute;
          }
        }
      } else if (this.scratchActive) {
        targetSpeed = this.scratchVelocity;
      } else if (this.playing) {
        targetSpeed = this.transportSpeed;
      }

      // Speed smoothing
      if (this.scratchActive) {
        this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.24;
      } else if (this.playing || this.envActive) {
        this.currentSpeed += (targetSpeed - this.currentSpeed) * smoothing;
      } else {
        this.currentSpeed *= this.releaseFriction;
        if (Math.abs(this.currentSpeed) < 0.00008) this.currentSpeed = 0;
      }

      // Mute fade (anti-click)
      this.muteTarget = frameMuted ? 0 : 1;
      if (this.muteGain < this.muteTarget) {
        this.muteGain = Math.min(this.muteGain + this.muteFadeStep, 1.0);
      } else if (this.muteGain > this.muteTarget) {
        this.muteGain = Math.max(this.muteGain - this.muteFadeStep, 0.0);
      }

      // Generate sample
      let sample = 0;
      const isAudible =
        this.playing || this.scratchActive || this.envActive || Math.abs(this.currentSpeed) > 0.0002;

      if (isAudible) {
        sample = this.interpolate(this.position);

        // Friction noise
        if (this.scratchActive) {
          const friction = Math.min(Math.abs(this.currentSpeed) / 3.8, 1);
          sample = sample * (0.96 - friction * 0.18) + this.frictionNoise(friction * 0.05);
        } else if (!this.playing && !this.envActive && Math.abs(this.currentSpeed) > 0.04) {
          const tail = Math.min(Math.abs(this.currentSpeed) / 2.8, 1);
          sample += this.frictionNoise(tail * 0.012);
        }
      }

      // Apply mute gain
      sample *= this.muteGain;

      // Soft clipping
      sample = sample / (1 + Math.abs(sample));

      left[frame] = sample;
      right[frame] = sample;

      this.position += this.currentSpeed * sampleStep;

      // Wrap position
      if (this.playing || this.envActive) {
        if (this.position >= this.length) this.position -= this.length;
        else if (this.position < 0) this.position += this.length;
      } else {
        if (this.position < 0) {
          this.position = 0;
          this.currentSpeed *= 0.25;
        } else if (this.position >= this.length - 1) {
          this.position = this.length - 1;
          this.currentSpeed *= 0.25;
        }
      }

      this.globalFrame++;
    }

    this.messageCounter += 1;

    if (this.messageCounter >= 12) {
      this.port.postMessage({
        type: 'position',
        currentTime: this.position / this.bufferSampleRate,
        speed: this.currentSpeed,
      });
      this.messageCounter = 0;
    }

    return true;
  }
}

registerProcessor('scratch-worklet', ScratchWorkletProcessor);
