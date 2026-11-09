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
  };

  window.VibePatterns = { order, fns };
})();
