// Control Panel: controller vibration + remote control.
// Press V (keyboard) or Triangle / Y (controller) to show or hide the panel.
(function () {
  "use strict";

  const P = window.VibePatterns;
  const $ = (id) => document.getElementById(id);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const nowSec = () => performance.now() / 1000;

  const TICK_MS = 50; // how often vibration is re-sent (20 times a second)

  // -------------------------------------------------------------------
  // Rumble engine: several "channels" can play at once (your own pattern
  // plus anyone remote-controlling you). The strongest one wins.
  // -------------------------------------------------------------------
  const channels = new Map(); // key -> { name, fn, intensity, start }

  function setChannel(key, name, intensity) {
    if (!name) {
      channels.delete(key);
      return;
    }
    const old = channels.get(key);
    channels.set(key, {
      name,
      fn: P.fns[name],
      intensity,
      start: old && old.name === name ? old.start : nowSec(),
    });
  }

  function getPads() {
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter(Boolean);
  }

  // desktop Chrome also has navigator.vibrate, so only count touch devices
  const canVibratePhone = "vibrate" in navigator && navigator.maxTouchPoints > 0;
  // phones only allow vibration after you've tapped the page once
  const phoneUnlocked = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
  let wasVibrating = false;
  let sendingTo = "NOTHING";
  let output = { strong: 0, weak: 0 };

  function mix() {
    const t = nowSec();

    // If someone is remote-controlling us, our own settings are ignored
    let beingControlled = false;
    for (const key of channels.keys()) {
      if (key.startsWith("remote:")) {
        beingControlled = true;
        break;
      }
    }

    let strong = 0;
    let weak = 0;
    for (const [key, ch] of channels) {
      if (beingControlled && !key.startsWith("remote:")) continue;
      const [s, w] = ch.fn(t - ch.start);
      strong = Math.max(strong, s * ch.intensity);
      weak = Math.max(weak, w * ch.intensity);
    }
    return { strong: clamp01(strong), weak: clamp01(weak) };
  }

  function drive(pads) {
    output = mix();
    const { strong, weak } = output;
    const active = strong > 0.01 || weak > 0.01;

    const rumblePads = pads.filter((p) => p.vibrationActuator);
    for (const pad of rumblePads) {
      const act = pad.vibrationActuator;
      try {
        if (active) {
          // short effect, re-sent every tick, so changes feel instant
          const r = act.playEffect("dual-rumble", {
            startDelay: 0,
            duration: TICK_MS * 2.5,
            strongMagnitude: strong,
            weakMagnitude: weak,
          });
          if (r && r.catch) r.catch(() => {});
        } else if (wasVibrating && act.reset) {
          const r = act.reset();
          if (r && r.catch) r.catch(() => {});
        }
      } catch (e) {
        /* this controller can't do it, ignore */
      }
    }

    // No controller: vibrate the phone instead (Android only, on/off)
    const phoneMode = pads.length === 0 && canVibratePhone;
    if (phoneMode && phoneUnlocked()) {
      const v = Math.max(strong, weak);
      try {
        if (v > 0.02) navigator.vibrate(Math.max(10, Math.round(TICK_MS * 1.2 * v)));
        else if (wasVibrating) navigator.vibrate(0);
      } catch (e) {
        /* needs a tap on the page first */
      }
    }

    sendingTo = rumblePads.length ? "CONTROLLER" : phoneMode ? "PHONE" : "NOTHING";
    wasVibrating = active;

    $("strongBar").style.width = (strong * 100).toFixed(0) + "%";
    $("weakBar").style.width = (weak * 100).toFixed(0) + "%";
  }

  function stopAllHardware() {
    for (const pad of getPads()) {
      try {
        const r = pad.vibrationActuator && pad.vibrationActuator.reset && pad.vibrationActuator.reset();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {}
    }
    try {
      if (canVibratePhone) navigator.vibrate(0);
    } catch (e) {}
  }

  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------
  const state = {
    intensity: 0.5,
    pattern: null,
    holding: false,
    holdSource: null, // "pointer" | "key" | "pad"
    pressure: false, // R2 PRESSURE toggle
    trigger: 0, // how hard R2 is pressed (0-1, 5% steps)
    dragging: false, // finger/mouse is on the drag bar
    drag: 0, // drag bar position (0-1, 2% steps)
    remoteOn: false,
    target: null, // friend's peer id we control
    sentTo: null, // peer id we last sent a "play" to
  };

  // Live inputs (drag bar, R2 pressure) beat the hold button,
  // which beats the selected pattern. Drag + R2 at once: the stronger wins.
  function effective() {
    const live = Math.max(state.pressure ? state.trigger : 0, state.dragging ? state.drag : 0);
    if (live > 0) return { pattern: "Continuous", intensity: live };
    if (state.holding) return { pattern: "Continuous", intensity: state.intensity };
    // MAX patterns always play at full power
    if (state.pattern && P.maxOrder.includes(state.pattern)) return { pattern: state.pattern, intensity: 1 };
    return { pattern: state.pattern, intensity: state.intensity };
  }

  // -------------------------------------------------------------------
  // Remote control: messages go through free public relay servers
  // (MQTT over secure WebSocket), so it works between any two networks.
  // Two servers are used at once: if one is down, the other still works.
  // -------------------------------------------------------------------
  const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
  const NS = "vibe-ctrl-panel-7f3k9q"; // topic prefix for this app
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
  const PING_MS = 3000; // "I'm still here" message to friends
  const FRIEND_TIMEOUT_MS = 12000; // friend gone if silent this long
  const REMOTE_EXPIRE_MS = 3500; // incoming vibration stops if not refreshed

  const friends = new Map(); // code -> { name, lastSeen }
  const relays = []; // { client, connected }
  const seenIds = new Set();
  const seenOrder = [];
  let msgCounter = 0;
  let pendingConnect = null;
  let connectTimer = null;

  function randomCode() {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join("");
  }
  const myCode = randomCode();
  const inbox = (code) => NS + "/inbox/" + code;

  function relaysOnline() {
    return relays.filter((r) => r.connected).length;
  }
  function remoteState() {
    if (!window.mqtt) return "OFFLINE";
    const n = relaysOnline();
    return n ? "ONLINE (" + n + "/" + relays.length + " SERVERS)" : "CONNECTING";
  }

  // send a message to a friend's inbox on every relay server
  function sendTo(code, msg, reliable) {
    const payload = JSON.stringify(Object.assign({}, msg, { from: myCode, id: myCode + "-" + ++msgCounter }));
    for (const r of relays) {
      if (!r.connected) continue;
      try {
        r.client.publish(inbox(code), payload, { qos: reliable ? 1 : 0 });
      } catch (e) {}
    }
  }

  function myName() {
    return ($("nameInput").value.trim() || "PLAYER " + myCode).toUpperCase().slice(0, 16);
  }

  function stopRemote() {
    if (state.sentTo) {
      sendTo(state.sentTo, { t: "stop" }, true);
      state.sentTo = null;
    }
  }

  function apply() {
    const { pattern, intensity } = effective();

    // you always feel your own pattern
    setChannel("self", pattern, intensity);

    const f = state.target && friends.get(state.target);
    if (pattern && state.remoteOn && f) {
      if (state.sentTo && state.sentTo !== state.target) stopRemote();
      sendTo(state.target, { t: "play", pattern, intensity });
      state.sentTo = state.target;
    } else {
      stopRemote();
    }
    render();
  }

  function setConnectMsg(text) {
    $("connectMsg").textContent = text;
  }

  function addFriend(code, name) {
    const f = friends.get(code) || { name: "PLAYER " + code, lastSeen: 0 };
    if (name) f.name = name;
    f.lastSeen = Date.now();
    friends.set(code, f);
    render();
  }

  function dropFriend(code) {
    if (!friends.has(code)) return;
    friends.delete(code);
    setChannel("remote:" + code, null);
    if (state.target === code) state.target = null;
    if (state.sentTo === code) state.sentTo = null;
    render();
  }

  function onMessage(topic, payload) {
    let d;
    try {
      d = JSON.parse(payload.toString());
    } catch (e) {
      return;
    }
    if (!d || typeof d !== "object" || typeof d.from !== "string") return;
    const code = d.from;
    if (code === myCode || !/^[A-Z0-9]{4}$/.test(code)) return;

    // the same message arrives once per relay server: only handle it once
    if (typeof d.id === "string") {
      if (seenIds.has(d.id)) return;
      seenIds.add(d.id);
      seenOrder.push(d.id);
      if (seenOrder.length > 400) seenIds.delete(seenOrder.shift());
    }

    const name = typeof d.name === "string" ? d.name.toUpperCase().slice(0, 16).trim() : "";

    if (d.t === "hello") {
      // someone typed our code: add them and answer
      addFriend(code, name);
      sendTo(code, { t: "welcome", name: myName() }, true);
      return;
    }
    if (d.t === "welcome") {
      addFriend(code, name);
      if (pendingConnect === code) {
        pendingConnect = null;
        clearInterval(connectTimer);
        setConnectMsg("Connected!");
        setTimeout(() => {
          if ($("connectMsg").textContent === "Connected!") setConnectMsg("");
        }, 2000);
      }
      return;
    }
    if (d.t === "bye") {
      dropFriend(code);
      return;
    }

    const f = friends.get(code);
    if (!f) return; // ignore anyone we're not connected to
    f.lastSeen = Date.now();

    if (d.t === "play" && typeof d.pattern === "string" && P.fns[d.pattern]) {
      setChannel("remote:" + code, d.pattern, clamp01(Number(d.intensity) || 0));
      channels.get("remote:" + code).seen = Date.now();
    } else if (d.t === "stop") {
      setChannel("remote:" + code, null);
    }
  }

  function startRelay() {
    $("myCode").textContent = myCode;
    if (!window.mqtt) {
      setConnectMsg("Remote control couldn't load. Check your internet and refresh.");
      render();
      return;
    }
    for (const url of BROKERS) {
      const r = { client: null, connected: false };
      try {
        r.client = window.mqtt.connect(url, {
          clientId: "vibe_" + myCode + "_" + Math.random().toString(36).slice(2, 8),
          keepalive: 20,
          reconnectPeriod: 2000,
          connectTimeout: 8000,
          clean: true,
        });
      } catch (e) {
        continue;
      }
      r.client.on("connect", () => {
        r.connected = true;
        r.client.subscribe(inbox(myCode), { qos: 1 });
        render();
      });
      r.client.on("close", () => {
        r.connected = false;
        render();
      });
      r.client.on("offline", () => {
        r.connected = false;
      });
      r.client.on("error", () => {});
      r.client.on("message", onMessage);
      relays.push(r);
    }
  }

  // every second: keep friends updated, drop silent ones, expire stale vibration
  let lastPing = 0;
  setInterval(() => {
    const now = Date.now();

    if (now - lastPing >= PING_MS) {
      lastPing = now;
      for (const code of friends.keys()) sendTo(code, { t: "ping" });
    }

    // re-send what we're playing so a lost message can't leave it stuck
    if (state.sentTo && friends.has(state.sentTo)) {
      const { pattern, intensity } = effective();
      if (pattern) sendTo(state.sentTo, { t: "play", pattern, intensity });
    }

    for (const [code, f] of friends) {
      if (now - f.lastSeen > FRIEND_TIMEOUT_MS) dropFriend(code);
    }

    // if the controller vanished mid-vibration, stop it here
    for (const [key, ch] of channels) {
      if (key.startsWith("remote:") && ch.seen && now - ch.seen > REMOTE_EXPIRE_MS) channels.delete(key);
    }
  }, 1000);

  function connectTo(raw) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 4) {
      setConnectMsg("Codes are 4 letters/numbers.");
      return;
    }
    if (code === myCode) {
      setConnectMsg("That's your own code. Enter your friend's.");
      return;
    }
    if (!relaysOnline()) {
      setConnectMsg("Still connecting to the server, try again in a second.");
      return;
    }
    if (friends.has(code)) {
      setConnectMsg("Already connected to that friend.");
      return;
    }

    pendingConnect = code;
    setConnectMsg("Connecting…");
    clearInterval(connectTimer);
    let tries = 0;
    const attempt = () => {
      if (pendingConnect !== code) {
        clearInterval(connectTimer);
        return;
      }
      if (++tries > 6) {
        clearInterval(connectTimer);
        pendingConnect = null;
        setConnectMsg("No answer from " + code + ". Check the code and make sure your friend has the page open.");
        return;
      }
      sendTo(code, { t: "hello", name: myName() }, true);
    };
    attempt();
    connectTimer = setInterval(attempt, 1500);
  }

  // -------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------
  const intensityButtons = new Map();
  const patternButtons = new Map();
  let friendsSignature = "";

  function makeButton(text, parent) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    parent.appendChild(b);
    return b;
  }

  for (let i = 1; i <= 10; i++) {
    const value = i / 10;
    const b = makeButton(i * 10 + "%", $("intensityGrid"));
    intensityButtons.set(value, b);
    b.addEventListener("click", () => {
      state.intensity = value;
      apply();
    });
  }

  const allPatterns = P.order
    .map((n) => [n, "patternGrid"])
    .concat(P.intenseOrder.map((n) => [n, "intenseGrid"]))
    .concat(P.maxOrder.map((n) => [n, "maxGrid"]));
  for (const [name, grid] of allPatterns) {
    const b = makeButton(name, $(grid));
    patternButtons.set(name, b);
    b.addEventListener("click", () => {
      // tapping the active pattern again turns it off
      state.pattern = state.pattern === name ? null : name;
      apply();
    });
  }

  function renderFriends() {
    const box = $("friends");
    box.hidden = !state.remoteOn;
    const sig = [...friends].map(([id, f]) => id + ":" + f.name).join("|");
    if (sig !== friendsSignature) {
      friendsSignature = sig;
      box.textContent = "";
      if (friends.size === 0) {
        const p = document.createElement("div");
        p.className = "empty";
        p.textContent = "NO FRIENDS CONNECTED YET";
        box.appendChild(p);
      }
      for (const [id, f] of friends) {
        const b = makeButton(f.name, box);
        b.dataset.peer = id;
        b.title = f.name;
        b.addEventListener("click", () => {
          state.target = state.target === id ? null : id;
          apply();
        });
      }
    }
    for (const b of box.querySelectorAll("button")) {
      b.classList.toggle("sel", b.dataset.peer === state.target);
    }
  }

  function render() {
    for (const [value, b] of intensityButtons) {
      b.classList.toggle("sel", Math.abs(value - state.intensity) < 0.001);
    }
    for (const [name, b] of patternButtons) b.classList.toggle("sel", name === state.pattern);

    // hold button + R2
    const triggerOn = state.pressure && state.trigger > 0;
    const fill = triggerOn ? state.trigger : state.holding ? 1 : 0;
    $("holdFill").style.width = fill * 100 + "%";
    $("holdText").textContent = triggerOn
      ? "R2 PRESSURE: " + Math.round(state.trigger * 100) + "%"
      : state.holding
        ? "VIBRATING..."
        : state.pressure
          ? "PRESS R2 OR HOLD HERE"
          : "HOLD TO VIBRATE";
    const pb = $("pressureBtn");
    pb.innerHTML = "R2 PRESSURE<br>" + (state.pressure ? "ON" : "OFF");
    pb.classList.toggle("on", state.pressure);

    // drag bar
    const dragPct = Math.round(state.drag * 100);
    $("dragBar").classList.toggle("active", state.dragging);
    $("dragFill").style.width = (state.dragging ? dragPct : 0) + "%";
    $("dragThumb").style.left = dragPct + "%";
    $("dragText").innerHTML = state.dragging ? "DRAGGING: " + dragPct + "%" : "DRAG TO VIBRATE &nbsp;←→";

    // remote
    const rb = $("remoteBtn");
    rb.textContent = state.remoteOn ? "ON" : "OFF";
    rb.classList.toggle("on", state.remoteOn);

    const target = state.target && friends.get(state.target);
    let hint;
    if (!state.remoteOn) hint = "Turn on to control a friend's controller. Only you see this.";
    else if (friends.size === 0) hint = "Connect to a friend first: send them your code, or type theirs below.";
    else if (!target) hint = "Pick whose controller you want to control:";
    else hint = "Controlling " + target.name + "'s controller. You feel it too.";
    $("hint").textContent = hint;

    renderFriends();
  }

  // ---- Hold to vibrate ----
  function setHold(on, source) {
    if (on && state.holding) return;
    if (!on && (!state.holding || (source && state.holdSource !== source))) return;
    state.holding = on;
    state.holdSource = on ? source : null;
    apply();
  }

  const holdBtn = $("holdBtn");
  holdBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setHold(true, "pointer");
  });
  // release anywhere stops it (even if the finger slid off the button)
  window.addEventListener("pointerup", () => setHold(false, "pointer"));
  window.addEventListener("pointercancel", () => setHold(false, "pointer"));
  window.addEventListener("blur", () => {
    setHold(false, "pointer");
    setHold(false, "key");
  });
  holdBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  holdBtn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      setHold(true, "key");
    }
  });
  holdBtn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") setHold(false, "key");
  });
  holdBtn.addEventListener("click", (e) => e.preventDefault());

  // ---- Live inputs (R2 + drag bar) ----
  // You feel changes instantly; your friend gets them at most 15 times a
  // second so remote control stays smooth.
  const LIVE_SEND_MS = 1000 / 15;
  let lastLiveApply = 0;
  let liveQueued = false;

  function liveChanged() {
    const { pattern, intensity } = effective();
    setChannel("self", pattern, intensity); // local: right away
    render();

    const waited = performance.now() - lastLiveApply;
    if (waited >= LIVE_SEND_MS) {
      lastLiveApply = performance.now();
      apply();
    } else if (!liveQueued) {
      liveQueued = true;
      setTimeout(() => {
        liveQueued = false;
        lastLiveApply = performance.now();
        apply(); // uses the latest values
      }, LIVE_SEND_MS - waited);
    }
  }

  // ---- R2 pressure ----
  function setTrigger(value) {
    let stepped = Math.round(value * 20) / 20; // 5% steps
    if (stepped < 0.05) stepped = 0; // small deadzone so a resting finger doesn't buzz
    if (stepped === state.trigger) return;
    state.trigger = stepped;
    liveChanged();
  }

  // ---- Drag to vibrate ----
  const dragBar = $("dragBar");
  let dragPointer = null;

  function dragTo(clientX) {
    const r = dragBar.getBoundingClientRect();
    let v = Math.round(clamp01((clientX - r.left) / r.width) * 50) / 50; // 2% steps
    if (v < 0.02) v = 0;
    if (v === state.drag && state.dragging) return;
    state.drag = v;
    state.dragging = true;
    liveChanged();
  }

  function endDrag() {
    if (dragPointer === null) return;
    dragPointer = null;
    state.dragging = false;
    state.drag = 0;
    apply(); // stop right away, no waiting
  }

  dragBar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragPointer = e.pointerId;
    try {
      dragBar.setPointerCapture(e.pointerId);
    } catch (err) {}
    dragTo(e.clientX);
  });
  dragBar.addEventListener("pointermove", (e) => {
    if (e.pointerId === dragPointer) dragTo(e.clientX);
  });
  dragBar.addEventListener("pointerup", endDrag);
  dragBar.addEventListener("pointercancel", endDrag);
  dragBar.addEventListener("lostpointercapture", endDrag);
  dragBar.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("blur", endDrag);

  $("pressureBtn").addEventListener("click", () => {
    state.pressure = !state.pressure;
    if (!state.pressure) state.trigger = 0;
    apply();
  });

  // ---- Stop / remote / connect ----
  $("stopBtn").addEventListener("click", () => {
    state.pattern = null;
    state.holding = false;
    state.holdSource = null;
    dragPointer = null;
    state.dragging = false;
    state.drag = 0;
    apply();
    if (!channels.size) stopAllHardware();
  });

  $("remoteBtn").addEventListener("click", () => {
    state.remoteOn = !state.remoteOn;
    apply();
  });

  $("connectBtn").addEventListener("click", () => connectTo($("friendCode").value));
  $("friendCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectTo($("friendCode").value);
  });

  $("copyBtn").addEventListener("click", async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      $("copyBtn").textContent = "COPIED";
    } catch (e) {
      $("copyBtn").textContent = myCode;
    }
    setTimeout(() => ($("copyBtn").textContent = "COPY"), 1500);
  });

  // remember your name on this device
  try {
    $("nameInput").value = localStorage.getItem("vibeName") || "";
  } catch (e) {}
  $("nameInput").addEventListener("change", () => {
    try {
      localStorage.setItem("vibeName", $("nameInput").value.trim());
    } catch (e) {}
    for (const code of friends.keys()) sendTo(code, { t: "welcome", name: myName() }, true);
  });

  // ---- Open / close ----
  const panel = $("panel");
  function setOpen(open, fromPad) {
    panel.hidden = !open;
    $("openBtn").hidden = open;
    if (!open) {
      setHold(false, state.holdSource);
      clearPadFocus();
    } else if (fromPad) {
      focusWithPad(patternButtons.get(P.order[0]));
    }
  }
  $("closeBtn").addEventListener("click", () => setOpen(false));
  $("openBtn").addEventListener("click", () => setOpen(true));
  window.addEventListener("keydown", (e) => {
    const typing = e.target && e.target.tagName === "INPUT";
    if (!typing && (e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setOpen(panel.hidden);
    }
  });

  // -------------------------------------------------------------------
  // Controller: Triangle toggles the panel, D-pad moves around,
  // Cross presses, R2 drives pressure mode
  // -------------------------------------------------------------------
  let padFocused = null;

  function clearPadFocus() {
    if (padFocused) padFocused.classList.remove("gp-focus");
    padFocused = null;
  }
  function focusWithPad(el) {
    if (!el) return;
    clearPadFocus();
    padFocused = el;
    el.classList.add("gp-focus");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }
  window.addEventListener("pointerdown", clearPadFocus);

  function moveFocus(dir) {
    const items = [...panel.querySelectorAll("button, input")].filter((el) => el.offsetParent !== null);
    const cur = padFocused && items.includes(padFocused) ? padFocused : null;
    if (!cur) {
      focusWithPad(patternButtons.get(P.order[0]));
      return;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      let main;
      let cross;
      if (dir === "up") [main, cross] = [-dy, dx];
      else if (dir === "down") [main, cross] = [dy, dx];
      else if (dir === "left") [main, cross] = [-dx, dy];
      else [main, cross] = [dx, dy];
      if (main <= 2) continue;
      const score = main + Math.abs(cross) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) focusWithPad(best);
  }

  const prevButtons = new Map(); // pad index -> pressed[]

  function pollPads(pads) {
    let r2 = 0;
    for (const pad of pads) {
      const prev = prevButtons.get(pad.index) || [];
      const cur = pad.buttons.map((b) => b.pressed);
      const down = (i) => cur[i] && !prev[i];
      const up = (i) => !cur[i] && prev[i];

      if (down(3)) setOpen(panel.hidden, true); // Triangle / Y

      if (!panel.hidden) {
        if (down(12)) moveFocus("up");
        if (down(13)) moveFocus("down");
        if (down(14)) moveFocus("left");
        if (down(15)) moveFocus("right");
        if (down(0) && padFocused) {
          // Cross / A
          if (padFocused === holdBtn) setHold(true, "pad");
          else if (padFocused.tagName === "INPUT") padFocused.focus();
          else padFocused.click();
        }
      }
      if (up(0)) setHold(false, "pad");

      if (pad.buttons[7]) r2 = Math.max(r2, pad.buttons[7].value || 0);
      prevButtons.set(pad.index, cur);
    }
    if (state.pressure) setTrigger(r2);
  }

  // -------------------------------------------------------------------
  // Status + info lines
  // -------------------------------------------------------------------
  function updateStatus(pads) {
    const st = $("status");
    const rumble = pads.filter((p) => p.vibrationActuator);
    if (pads.length === 0) {
      if (canVibratePhone && !phoneUnlocked()) {
        st.textContent = "TAP ANYWHERE ON THE PAGE ONCE TO ALLOW PHONE VIBRATION";
        st.className = "status bad";
      } else if (canVibratePhone) {
        st.textContent = "PHONE VIBRATION ON - MAKE SURE VIBRATION IS ON IN YOUR PHONE SETTINGS";
        st.className = "status ok";
      } else {
        st.textContent = "NO CONTROLLER DETECTED - CONNECT IT AND PRESS ANY BUTTON ON IT";
        st.className = "status";
      }
    } else if (rumble.length) {
      st.textContent = "CONTROLLER CONNECTED - VIBRATION READY";
      st.className = "status ok";
    } else {
      st.textContent = "CONTROLLER FOUND, BUT THIS BROWSER CAN'T VIBRATE IT - TRY CHROME OR EDGE";
      st.className = "status bad";
    }

    const lines = [
      "INFO - CONTROLLERS FOUND: " + pads.length + " | PHONE VIBRATION: " + (canVibratePhone ? "YES" : "NO"),
    ];
    pads.forEach((pad, i) => {
      const act = pad.vibrationActuator;
      let effects = "NONE";
      if (act) effects = (act.effects && act.effects.length ? act.effects : [act.type || "dual-rumble"]).join(", ");
      const id = pad.id.replace(/\s*\(.*$/, "").slice(0, 28) || "GAMEPAD";
      lines.push("GAMEPAD " + (i + 1) + " (" + id + "): VIBRATION " + (act ? "YES" : "NO") + " | EFFECTS: " + effects);
    });
    lines.push("SENDING VIBRATION TO: " + sendingTo);
    lines.push(
      "REMOTE: " + remoteState() + " | CODE " + myCode +
        " | FRIENDS CONNECTED: " + friends.size
    );
    $("info").textContent = lines.join("\n").toUpperCase();
  }

  // -------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------
  let lastStatus = 0;
  setInterval(() => {
    const pads = getPads();
    pollPads(pads);
    drive(pads);
    if (performance.now() - lastStatus > 500) {
      lastStatus = performance.now();
      updateStatus(pads);
    }
  }, TICK_MS);

  window.addEventListener("gamepadconnected", () => updateStatus(getPads()));
  window.addEventListener("gamepaddisconnected", () => {
    prevButtons.clear();
    updateStatus(getPads());
  });
  window.addEventListener("pagehide", stopAllHardware);

  render();
  updateStatus(getPads());
  // tell friends we're leaving so they stop right away
  window.addEventListener("pagehide", () => {
    stopRemote();
    for (const code of friends.keys()) sendTo(code, { t: "bye" });
  });

  startRelay();
})();
