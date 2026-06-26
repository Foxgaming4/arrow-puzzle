/* ===================================================================
   audio.js — Procedural sound engine (Web Audio API).

   Every sound is synthesised at runtime, so there are zero asset files
   to preload and the whole game stays tiny. Sounds are intentionally
   soft and "UI premium": short envelopes, gentle filters.

   Public API:
     AP.audio.unlock()            – resume context on first user gesture
     AP.audio.play(name)          – tap|remove|invalid|victory|button|shuffle|popup
     AP.audio.setSound(on)        – enable/disable SFX
     AP.audio.setMusic(on)        – enable/disable ambient music
   =================================================================== */
(function (AP) {
  "use strict";

  let ctx = null;
  let master = null;   // master output
  let sfxGain = null;  // SFX bus
  let musicGain = null;// music bus
  let soundOn = true;
  let musicOn = false;
  let musicTimer = null;

  /** Lazily create the AudioContext (must follow a user gesture on mobile). */
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = soundOn ? 1 : 0;
    sfxGain.connect(master);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0; // fades in when music turns on
    musicGain.connect(master);
    return ctx;
  }

  function unlock() {
    ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  /* ---------- low-level voice helpers ---------- */

  // A single enveloped oscillator tone.
  function tone({ freq = 440, type = "sine", t0 = 0, dur = 0.15, gain = 0.3, glideTo = null, bus = sfxGain }) {
    if (!ctx) return;
    const now = ctx.currentTime + t0;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, now + dur);

    // Scale SFX volume (increase by 1.8x when bus is sfxGain)
    const finalGain = (bus === sfxGain) ? Math.min(1.0, gain * 1.8) : gain;

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(finalGain, now + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(bus);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  // A burst of filtered noise (for swooshes / thuds).
  function noise({ t0 = 0, dur = 0.2, gain = 0.2, type = "bandpass", freq = 1200, q = 1, sweepTo = null, bus = sfxGain }) {
    if (!ctx) return;
    const now = ctx.currentTime + t0;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);

    // Scale SFX volume (increase by 1.8x when bus is sfxGain)
    const finalGain = (bus === sfxGain) ? Math.min(1.0, gain * 1.8) : gain;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(finalGain, now + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt).connect(g).connect(bus);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  /* ---------- named sound effects ---------- */
  const SFX = {
    // Soft wooden click for a tap.
    tap() { tone({ freq: 520, type: "triangle", dur: 0.07, gain: 0.18 }); tone({ freq: 880, type: "sine", dur: 0.05, gain: 0.07 }); },
    // Satisfying upward "pop" when an arrow leaves.
    remove() { tone({ freq: 420, glideTo: 920, type: "sine", dur: 0.16, gain: 0.26 }); noise({ dur: 0.08, gain: 0.05, type: "highpass", freq: 2000 }); },
    // Muted thud for a blocked tap.
    invalid() { tone({ freq: 150, glideTo: 90, type: "sine", dur: 0.16, gain: 0.22 }); noise({ dur: 0.09, gain: 0.06, type: "lowpass", freq: 300 }); },
    // Minimal UI click.
    button() { tone({ freq: 660, type: "sine", dur: 0.05, gain: 0.12 }); },
    // Smooth swoosh for shuffle.
    shuffle() { noise({ dur: 0.34, gain: 0.16, type: "bandpass", freq: 500, q: 0.7, sweepTo: 2600 }); },
    // Soft whoosh for popups.
    popup() { noise({ dur: 0.26, gain: 0.1, type: "lowpass", freq: 500, sweepTo: 1800 }); },
    // Short cheerful jingle on victory.
    victory() {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => tone({ freq: f, type: "triangle", t0: i * 0.1, dur: 0.34, gain: 0.2 }));
      tone({ freq: 392, type: "sine", t0: 0, dur: 0.5, gain: 0.08 });
    },
    coin() {
      tone({ freq: 987.77, type: "sine", dur: 0.08, gain: 0.12 });
      tone({ freq: 1318.51, type: "sine", t0: 0.04, dur: 0.12, gain: 0.08 });
    },
    countup() {
      tone({ freq: 880, type: "triangle", dur: 0.03, gain: 0.04 });
    },
    victoryLarge() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((f, i) => tone({ freq: f, type: "sine", t0: i * 0.06, dur: 0.5, gain: 0.1 }));
    },
    perfectClear() {
      const notes = [587.33, 739.99, 880, 1174.66, 1479.98];
      notes.forEach((f, i) => tone({ freq: f, type: "sine", t0: i * 0.04, dur: 0.6, gain: 0.08 }));
    },
    milestone() {
      tone({ freq: 659.25, type: "sine", dur: 0.16, gain: 0.12 });
      tone({ freq: 830.61, type: "sine", t0: 0.04, dur: 0.20, gain: 0.10 });
    },
  };

  function play(name) {
    // Trigger haptic feedback (independent of soundOn settings)
    try {
      haptic(name);
    } catch (e) {}

    if (!soundOn) return;
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const fn = SFX[name];
    if (fn) try { fn(); } catch (e) { /* never let audio break gameplay */ }
  }

  // Soft UI toggle blip — higher pitch when turning something on, lower when off.
  function toggle(on) {
    if (!soundOn) return;
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    try {
      tone({ freq: on ? 700 : 470, type: "sine", dur: 0.08, gain: 0.14 });
      tone({ freq: on ? 940 : 600, type: "sine", t0: 0.045, dur: 0.07, gain: 0.07 });
    } catch (e) {}
  }

  /* ---------- ambient music (gentle generative pad) ---------- */
  // A slow, randomised pentatonic drift — calm background texture.
  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C major pentatonic-ish
  function musicStep() {
    if (!ctx || !musicOn) return;
    const f = SCALE[Math.floor(Math.random() * SCALE.length)] / 2; // lower octave
    tone({ freq: f, type: "sine", dur: 2.6, gain: 0.5, bus: musicGain });
    if (Math.random() < 0.5) tone({ freq: f * 1.5, type: "sine", t0: 0.4, dur: 2.0, gain: 0.3, bus: musicGain });
  }
  function startMusic() {
    ensure();
    if (!ctx || musicTimer) return;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
    musicStep();
    musicTimer = setInterval(musicStep, 2400);
  }
  function stopMusic() {
    if (ctx && musicGain) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    }
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function setSound(on) {
    soundOn = !!on;
    if (sfxGain) sfxGain.gain.value = soundOn ? 1 : 0;
  }
  function setMusic(on) {
    musicOn = !!on;
    if (musicOn) startMusic(); else stopMusic();
  }

  // Premium Haptic feedback mapping
  function haptic(type) {
    if (!navigator.vibrate) return;
    switch (type) {
      case "tap":
        navigator.vibrate(15);
        break;
      case "button":
      case "coin":
      case "countup":
      case "shuffle":
      case "light":
        navigator.vibrate(20);
        break;
      case "popup":
      case "medium":
        navigator.vibrate(35);
        break;
      case "remove":
      case "success":
        // Arrow slides out successfully: smooth fade vibration
        navigator.vibrate([25, 30, 15]);
        break;
      case "invalid":
      case "error":
        // Blocked / invalid arrow tap: deep recoil bump
        navigator.vibrate([60, 40, 60]);
        break;
      case "milestone":
        // Milestone reached (25%, 50%, 75%): nice rhythmic triple-pulse
        navigator.vibrate([40, 40, 40]);
        break;
      case "victory":
      case "victoryLarge":
      case "perfectClear":
        // Level completion celebration: long energetic sweep
        navigator.vibrate([80, 50, 80, 50, 150]);
        break;
      case "gameover":
        // Game over: heavy thuds
        navigator.vibrate([150, 80, 150]);
        break;
    }
  }

  AP.haptic = haptic;
  AP.audio = { unlock, play, toggle, setSound, setMusic, isSoundOn: () => soundOn };
})(window.AP = window.AP || {});
