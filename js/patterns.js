// Vibration patterns (same as the Roblox game).
// Each pattern takes time in seconds and returns [strong, weak] from 0 to 1.
// Strong motor = deep rumble, weak motor = fast buzz.
(function () {
  "use strict";

  const TAU = Math.PI * 2;

  // square wave: 1 for the first `duty` part of each period, else 0
  const sq = (t, period, duty) => ((t % period) < period * duty ? 1 : 0);

  // random number 0-1 that is always the same for the same seed
  function hash01(n) {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  // random value that changes `rate` times per second
  const rnd = (t, rate, seed) => hash01(Math.floor(t * rate) * 7919 + seed * 104729);

  const order = [
    "Continuous", "Pulse", "Heartbeat", "Wave",
    "Intermittent", "Ripple", "Throb", "Beat",
    "Vibrate", "Surge", "Drill", "Shield",
    "Rattle", "Explosion", "Frostbite", "Pulsetrain",
    "Simmer", "Storm",
  ];

  const fns = {
    Continuous: () => [1, 1],

    Pulse: (t) => {
      const v = sq(t, 0.5, 0.5);
      return [v, v];
    },

    Heartbeat: (t) => {
      const p = t % 1.1;
      let v = 0;
      if (p < 0.12) v = 1;
      else if (p > 0.22 && p < 0.32) v = 0.7;
      return [v, v * 0.4];
    },

    Wave: (t) => {
      const v = (Math.sin(t * Math.PI) + 1) / 2;
      return [v, v * 0.6];
    },

    Intermittent: (t) => {
      const v = sq(t, 0.9, 0.2);
      return [v, v];
    },

    Ripple: (t) => {
      const p = t % 1.4;
      const v = Math.exp(-p * 3) * (0.5 + 0.5 * Math.abs(Math.sin(p * 25)));
      return [v, v];
    },

    Throb: (t) => {
      const v = ((Math.sin(t * TAU * 1.2) + 1) / 2) ** 2;
      return [v, v * 0.2];
    },

    Beat: (t) => {
      const v = (t % 0.6) < 0.08 ? 1 : 0;
      return [v, v * 0.5];
    },

    Vibrate: () => [0.25, 1],

    Surge: (t) => {
      const v = Math.min((t % 2.5) / 2, 1);
      return [v ** 1.5, v];
    },

    Drill: (t) => [0.5, sq(t, 0.06, 0.5)],

    Shield: (t) => [(t % 1.6) < 0.15 ? 1 : 0.35, 0.3],

    Rattle: (t) => [rnd(t, 20, 1), rnd(t, 20, 2)],

    Explosion: (t) => {
      const p = t % 3;
      const v = p < 0.08 ? 1 : Math.exp(-p * 1.8);
      return [v, p < 0.5 ? v : v * 0.4];
    },

    Frostbite: (t) => {
      const weak = 0.15 + (rnd(t, 8, 3) > 0.7 ? 0.85 : 0);
      const strong = 0.05 + (rnd(t, 8, 4) > 0.9 ? 0.5 : 0);
      return [strong, weak];
    },

    Pulsetrain: (t) => {
      const p = t % 1.3;
      const v = p < 0.6 ? sq(p, 0.2, 0.5) : 0;
      return [v, v];
    },

    Simmer: (t) => [0.2 + 0.15 * rnd(t, 6, 4), 0.25 + 0.15 * rnd(t, 6, 5)],

    Storm: (t) => {
      const win = Math.floor(t / 2.2);
      const p = t - win * 2.2;
      const thunder = hash01(win * 31 + 7) > 0.45 && p < 0.5;
      if (thunder) return [1, 1];
      return [0.25 + 0.45 * rnd(t, 12, 6), rnd(t, 12, 9) * 0.6];
    },

    // ---- MAX patterns: always full power, built to feel as strong as possible.
    // Steady buzzing starts to feel weaker after a few seconds, so these use
    // contrast (dips, gaps, surges, build-ups) to keep every hit feeling hard.

    // full power with tiny dips twice a second so it never fades into the background
    Overdrive: (t) => ((t % 0.5) < 0.045 ? [0.55, 0.4] : [1, 1]),

    // hard 100% hits with short gaps: the gaps make each hit feel heavier
    Hammer: (t) => {
      const v = (t % 0.42) < 0.2 ? 1 : 0;
      return [v, v];
    },

    // deep motor always at full, buzz motor surging on top with random jolts
    Earthquake: (t) => {
      const surge = (Math.sin(t * TAU * 1.4) + 1) / 2;
      const jolt = rnd(t, 10, 11) > 0.85 ? 1 : 0;
      return [1, Math.max(0.35 + 0.65 * surge, jolt)];
    },

    // climbs from soft to max, slams at full, short pause, repeat
    "Build-up": (t) => {
      const p = t % 5.2;
      if (p < 3.6) {
        const r = p / 3.6;
        return [r * r, r];
      }
      if (p < 4.8) return [1, 1];
      return [0, 0];
    },

    // rough and mechanical: deep motor pounding fast, buzz motor chattering hard
    Jackhammer: (t) => {
      const pound = (t % 0.11) < 0.07 ? 1 : 0.45;
      const chatter = (t % 0.04) < 0.02 ? 1 : 0.5;
      return [pound, chatter];
    },

    // rough and chaotic: random full-power slams over a gritty, uneven buzz
    Rampage: (t) => {
      const slam = rnd(t, 9, 21) > 0.35 ? 1 : 0.3;
      const grit = 0.6 + 0.4 * rnd(t, 30, 22);
      return [slam, Math.max(grit, slam * 0.9)];
    },

    // ---- INTENSE patterns: rough and harsh, but they follow the intensity
    // buttons, so 100% is brutal and lower settings stay rough but softer.

    // fast, heavy thumps with a harsh buzz on every hit
    Pound: (t) => {
      const hit = (t % 0.25) < 0.15;
      return hit ? [1, 0.9] : [0.25, 0.15];
    },

    // deep motor grinding high nonstop, buzz motor rough and uneven on top
    Grind: (t) => [0.85 + 0.15 * rnd(t, 15, 31), 0.5 + 0.5 * rnd(t, 25, 32)],

    // hits speed up from 2 to 10 a second over 8s, then 2s of full blast
    Frenzy: (t) => {
      const p = t % 10;
      if (p >= 8) return [1, 1];
      const rate = 2 + p; // hits per second, climbing
      const phase = (p * rate) % 1;
      const v = phase < 0.55 ? 1 : 0.1;
      return [v, v];
    },

    // full power that violently cuts out and slams back at random
    Shudder: (t) => {
      const cut = rnd(t, 22, 41) > 0.7;
      return cut ? [0.15, 0] : [1, 0.6 + 0.4 * rnd(t, 22, 42)];
    },

    // rough jackhammer texture that steps up every 5s until it's at full, then holds
    Relentless: (t) => {
      const p = t % 50;
      const level = p < 40 ? 0.3 + 0.7 * (Math.floor(p / 5) / 7) : 1;
      const texture = (t % 0.12) < 0.08 ? 1 : 0.55;
      return [Math.min(1, level * texture), Math.min(1, level * (0.6 + 0.4 * rnd(t, 25, 51)))];
    },

    // rough grind building over 15s into 5s of nonstop full-power slamming
    Punish: (t) => {
      const p = t % 20;
      if (p >= 15) {
        const v = (t % 0.2) < 0.14 ? 1 : 0.7;
        return [v, 1];
      }
      const r = p / 15;
      const level = 0.3 + 0.7 * r * r;
      return [level * (0.8 + 0.2 * rnd(t, 18, 61)), level * (0.5 + 0.5 * rnd(t, 24, 62))];
    },
  };

  const maxOrder = ["Overdrive", "Hammer", "Earthquake", "Build-up", "Jackhammer", "Rampage"];
  const intenseOrder = ["Pound", "Grind", "Frenzy", "Shudder", "Relentless", "Punish"];

  window.VibePatterns = { order, maxOrder, intenseOrder, fns };
})();
