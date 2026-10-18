// App settings for this device: sounds and light/dark mode.
import { html, useState } from "../vendor/preact-htm.mjs";
import { go } from "../lib/state.js";
import { Icons } from "../lib/ui.js";
import { soundOn, setSoundOn, play } from "../lib/sound.js";
import { THEME_CHOICES, themeChoice, setThemeChoice } from "../lib/theme.js";

function SoundCard() {
  const [on, setOn] = useState(soundOn());
  const toggle = () => {
    setSoundOn(!on);
    setOn(!on);
    if (!on) play("pop");
  };
  return html`<div class="card row">
    <div style="font-size:1.8rem" aria-hidden="true">${on ? "🔊" : "🔇"}</div>
    <div class="grow">
      <h3>Festive sounds</h3>
      <p class="small muted">${on ? "Festive sounds are on for this device." : "Sounds are off for this device."}</p>
    </div>
    <button class=${"btn small " + (on ? "ghost" : "green")} onClick=${toggle}>${on ? "Turn off" : "Turn on"}</button>
  </div>`;
}

function AppearanceCard() {
  const [choice, setChoice] = useState(themeChoice());
  const pick = (value) => {
    setThemeChoice(value);
    setChoice(value);
  };
  return html`<div class="card stack">
    <div class="row">
      <div style="font-size:1.8rem" aria-hidden="true">🌗</div>
      <div class="grow">
        <h3 id="appearance-label">Theme</h3>
        <p class="small muted">${choice === "system" ? "Matches your phone's light or dark setting." : `Always ${choice}, on this device.`}</p>
      </div>
    </div>
    <div class="segmented" role="radiogroup" aria-labelledby="appearance-label">
      ${THEME_CHOICES.map(([value, label]) => html`<button type="button" role="radio" aria-checked=${choice === value}
        class=${choice === value ? "active" : ""} onClick=${() => pick(value)}>${label}</button>`)}
    </div>
  </div>`;
}

export function AppSettings() {
  return html`<main class="page no-tabs stack-lg">
    <button class="back-link" onClick=${() => (history.length > 1 ? history.back() : go("/"))}>${Icons.back()} Back</button>
    <h1>Settings</h1>
    <section class="stack">
      <div class="section-label">Sounds</div>
      <${SoundCard} />
    </section>
    <section class="stack">
      <div class="section-label">Appearance</div>
      <${AppearanceCard} />
    </section>
    <p class="small muted center">These settings are saved on this device only.</p>
  </main>`;
}
