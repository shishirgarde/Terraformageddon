# Terraformageddon

A browser-based, gamified Terraform learning game. Players are dropped into live (simulated) production incidents and must write real Terraform HCL to fix them — under pressure, with a paranoid CTO watching every keystroke.

No setup. No install. Runs entirely in the browser.

**Live:** https://shishirgarde.github.io/Terraformageddon/

---

## Concept

Most Terraform tutorials start with a blank editor and a slideshow. Terraformageddon starts with a P0 incident. Something is broken, the clock is ticking, and your team is panicking. You write Terraform config, simulate the fix, apply it, and decommission cleanly — or watch the chaos meter climb.

After each mission, a 5-step debrief explains the concepts you just used in a real infrastructure context.

---

## Project Structure

```
index.html        Landing/marketing page
level1.html       Playable game level (Level 1)
js/app.js         All game logic
css/style.css     All styling
images/           Character and scene artwork
```

---

## How It Works

### Game Flow (Level 1)

1. **Briefing** — A modal presents the incident details and mission parameters.
2. **Orientation tour** — A 4-step spotlight walkthrough highlights each UI panel.
3. **Initialize** — Simulates `terraform init`, downloads the provider, unlocks the Plan button.
4. **Simulate Fix** — Validates the editor contents against expected HCL and simulates `terraform plan`. Specific error messages and chaos penalties scale based on the type of mistake (empty field, wrong value, missing resource block).
5. **Execute Fix** — Runs `terraform apply`. Applying without a passing plan first triggers a chaos event (+25 chaos).
6. **Decommission** — Runs `terraform destroy` cleanly, resets chaos to 0.
7. **Debrief** — A 5-step educational walkthrough explains resource blocks, arguments, plan vs. apply, Terraform state, and why destroy matters.
8. **War Room** — Post-incident scorecard showing chaos events, time taken, XP earned, and an incident summary.

### State Machine

`idle → init → planned → applied → destroyed`

### Chaos System

Every mistake increments the chaos bar (0–100). Tracked events are recorded and displayed in the war room debrief. Repeated failed plan attempts compound the chaos penalty.

---

## UI Layout (Level 1)

The game screen is a fixed 3-column CSS Grid with a top HUD bar:

| Area | Content |
|---|---|
| HUD | Chaos bar, XP counter, reputation badge |
| Left panel | NPC War Room chat (CTO, Intern, SYSTEM) |
| Center panel | Monaco editor (`main.tf`) + action buttons |
| Right panel | Live SVG infrastructure map |
| Bottom panel | Read-only terminal output (character-by-character stream) |

---

## Technical Details

- **No frameworks** — vanilla JS and vanilla CSS throughout.
- **Monaco Editor** (same engine as VS Code) loaded from CDN, with a custom dark `terraformageddon` theme and a registered Terraform HCL language tokenizer.
- **NPC messaging** — promise-queued with animated typing indicators before each message appears.
- **Terminal output** — character-by-character streaming via a promise queue to simulate live CLI output.
- **Validator** — regex-based, detects 7 distinct error cases and generates targeted error messages and CTO dialogue per failure type.
- **State persistence** — key game state saved to `localStorage` so progress survives a page refresh.
- **Fonts** — JetBrains Mono (terminal/code), Bangers (display/comic headings), Syne (UI body).

---

## Mission Board

| Level | Status | Incident | Concepts |
|---|---|---|---|
| 01 — Signal Missing | **Active** | P0 · Production Degraded | `local_file`, resource blocks, plan → apply, destroy |
| 02 — Ghost Variable | Coming Soon | P1 · Config Drift | variables, outputs, tfvars |
| 03 — State of Emergency | Locked | P0 · State Corruption | terraform state, import, refresh |
| 04 — The Broken Module | Locked | P0 · Module Failure | modules, workspaces, depends_on |

---

## Images

Character and scene artwork goes in the `images/` folder as `.webp` files. Placeholder boxes are shown when images are absent and automatically hidden when the corresponding image loads. See the hidden `#prompts` section at the bottom of `index.html` for AI image generation prompts for each asset.

| File | Used in |
|---|---|
| `cto.webp` | Landing hero, Level 1 NPC avatar |
| `intern.webp` | Landing feature section |
| `chaos.webp` | Landing chaos section |
| `debrief.webp` | Landing debrief section |
| `avatar-cto.png` | NPC chat bubble avatar |
| `avatar-intern.png` | NPC chat bubble avatar |
| `avatar-system.png` | NPC chat bubble avatar |
| `editor.webp` | Landing "Write Real HCL" section |
