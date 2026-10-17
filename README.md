# Brock String VR

A browser-based (WebXR) Brock string for vergence practice. It runs in the Meta Quest
browser or any WebXR-capable browser. There's no build step, just static files.

The string works like a real one: the near end stays at your nose, and the far end is
tied to a fixed point 3 m ahead of you, slightly below eye level (like a doorknob).
Press **Grip** to re-tie it in whatever direction you're facing. The far end isn't
attached to your head, so the Quest's timewarp doesn't make it judder or ghost when
you move your head.
Each eye gets its own image, so you get real physiological diplopia: the two-strings "X".

## Running it

WebXR needs a secure context (`https://` or `localhost`).

**Option A: HTTPS over your LAN (easiest)**

```bash
python3 serve.py
```

On the headset, open the `https://<lan-ip>:8443` URL that the script prints. Accept the
self-signed certificate warning once, then press **ENTER VR**. The server listens on all
interfaces, so only run it on a network you trust. Stop it with Ctrl+C.

**Option B: USB + adb (no certificate warning)**

```bash
python3 -m http.server 8080
adb reverse tcp:8080 tcp:8080
```

Then open `http://localhost:8080` in the headset browser.

**Option C: GitHub Pages**

Every push to `main` runs `.github/workflows/pages.yml`, which publishes `index.html` and
`main.js`. To turn it on, set **Settings → Pages → Source** to **GitHub Actions** in the repo.

You also need internet access, because three.js (pinned to v0.170.0) loads from jsDelivr.

## Modes

| # | Mode | What to do |
|---|------|-----------|
| 1 | **Free practice** | Look at each bead and check for the X. Move the beads to wherever you like. |
| 2 | **Bead jumps** | The bright bead changes on a timer (with a tone). Move your fixation to it and re-form the X quickly. |
| 3 | **Smooth tracking** | One bead slides back and forth along the string. Keep the X on it the whole way. |
| 4 | **Near point test** | The bead moves toward your nose. Press when it doubles or the X breaks. Results are saved. |

Bead positions, speeds, intervals and near-point results are stored in the browser's `localStorage`.

## Controls

| Action | Quest controllers | Keyboard (desktop preview) |
|---|---|---|
| Primary action (next bead / pause / start-mark) | Trigger (or pinch with hand tracking) | Space |
| Secondary (reset / random / range / clear) | A or X | R |
| Adjust (bead distance / interval / speed) | Thumbstick up/down | ↑ / ↓ |
| Next mode | B or Y | M, or 1–4 |
| Recenter string + info panel to where you're facing | Grip | – |
| Show/hide info panel | Thumbstick click | H |

## What you should see

- **X at the bead:** both eyes are aimed at the bead. This is correct.
- **X in front of the bead (closer to you):** you're over-converging.
- **X behind the bead:** you're under-converging.
- **Only one string, or a string that fades in and out:** one eye is being suppressed.
- **A V or Λ shape at the near/far bead:** this is normal when you look at the nearest or farthest bead.

## Caveats

- This is a practice tool, not a medical device. Follow your eye-care provider's instructions.
- Headsets have a fixed focal distance (vergence–accommodation conflict), so it feels
  different from a real string, especially up close. Treat near-point numbers as a way
  to track your own progress, not as clinical measurements.
- Stop if you get eye strain, headaches or nausea.
