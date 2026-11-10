# Control Panel

Control your PS4/PS5 controller's vibration from a web page, or remote-control a
friend's controller. It's the web version of our Roblox vibration game.

## Features

- **Intensity** from 10% to 100%
- **18 patterns**: Continuous, Pulse, Heartbeat, Wave, Intermittent, Ripple, Throb,
  Beat, Vibrate, Surge, Drill, Shield, Rattle, Explosion, Frostbite, Pulsetrain,
  Simmer, Storm (tap the active one again to turn it off)
- **6 INTENSE patterns** (rough, but follow the intensity buttons):
  Pound, Grind, Frenzy, Shudder, Relentless, Punish
- **6 MAX patterns** (always full power, ignore the intensity buttons):
  Overdrive, Hammer, Earthquake, Build-up, Jackhammer, Rampage
- **Hold to vibrate**: vibrates while you hold it, stops when you let go
- **R2 pressure**: when on, how hard you press R2 sets how hard it vibrates
- **Drag to vibrate**: press the bar and slide left/right, and the strength follows
  your finger or mouse live (left = soft, right = full). Let go and it stops.
- **Remote control**: connect with a code and control a friend's controller.
  You feel it too, and your commands override whatever they have turned on.
- **Phone vibration**: on Android with no controller, the phone vibrates instead
- Live motor meters plus an info line showing what your browser reports
- Works with mouse, touch, or the controller (D-pad to move, Cross to press,
  Triangle or `V` to show/hide the panel)

## How to use

1. Open the site in **Chrome or Edge** (best controller support).
2. Connect your controller and **press any button on it** so the browser notices it.
3. Pick an intensity and a pattern.

### Remote control

1. Both of you open the site.
2. One person types the other's 4-letter **code** and presses **Connect**.
3. Turn **Remote Control ON**, pick your friend, and choose a pattern.
4. Keep the page open and in front, since browsers slow down hidden tabs.

Only the person controlling needs Remote Control ON. The other person just
keeps the page open.

## Where it works

| Setup | Controller vibrates? |
|---|---|
| PC + Chrome or Edge | Yes |
| Android + Chrome | Depends on the phone |
| iPhone (any browser) | Probably not |
| Firefox | Usually no |

On phones you need to **tap the page once** before it's allowed to vibrate.

## Put it online (GitHub Pages)

1. On GitHub, open this repo → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick branch **main** and folder **/ (root)**, then **Save**.
4. After a minute the site is live at
   `https://eroskavv-cpu.github.io/Control-Panel/`.

## Files

- `index.html`: the page
- `style.css`: the look
- `js/patterns.js`: the 18 vibration patterns
- `js/app.js`: vibration, hold, R2, controller navigation and remote control

Remote control sends small messages through two free public relay servers
(EMQX and HiveMQ, using MQTT), so it works between any two networks and needs
no account. If one server is down, the other one still works.
