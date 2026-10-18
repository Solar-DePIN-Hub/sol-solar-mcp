# Demo script

The Devpost cut is 1:31, 1280×888, no music, no voice track, no Amazon logo. The picture is a continuous screen capture in the top 748 pixels, and the captions are a separate band under that picture so they never cover the form or the trace. English captions are burned in and kept in [DEMO_CAPTIONS.srt](DEMO_CAPTIONS.srt), timed to that cut. They are presenter sentences. A short label such as "Night battery check" is fine. The raw tool name stays in the MCP trace, not in the caption. Plain text that names Alexa+ is enough, because the entry is for that track.

The numbers on screen come from the live forecast for Kyiv on 18 October 2026. Do not paste a kilowatt-hour into a later recording if the tool just said a different one.

Upload the captioned file to YouTube or Vimeo. This repository does not contain that URL.

## Setup before you hit record

1. `npm install` and `npm run dev`.
2. Open http://127.0.0.1:8787/ in a clean window.
3. Confirm the form shows Kyiv, 5 kW, tilt 35, facing south, appliance "washing machine", power 0.7, hours 2. Battery 5 kWh, charge 40, house load 0.3 kW. Leave price empty.
4. A second terminal, for the tools list and `npm test`.

## Shot list

Record one continuous browser pass, then one continuous terminal pass. Crossfade between cards and those takes. Keep the mouse cursor visible. The clicked question stays gold until the next click. If the dev server restarts, sign in again before the first question. A restart during the take invalidates the bearer token.

### 0:00–0:05 Title

On-screen text:

Power cuts are ordinary in Ukraine.
Will my battery last the night?

Caption: Power cuts are an ordinary night in Ukraine. Will the battery last until sunrise?

### 0:05–0:14 The roof you typed

Type the battery size, the charge, and the household load. Click Connect, then Allow on the consent page. Click the night-battery question and leave "Looking up the roof…" on screen.

Caption: A five kilowatt roof in Kyiv. Battery size, charge, and household load are typed, not read from a meter. The browser signs in with OAuth, the same shape Alexa+ asks for. Sol checks the forecast before it answers.

### 0:14–0:20 Will the battery last?

The night-battery chip is gold. On this morning the answer was yes until sunrise, and the day's roof was not enough to refill the battery.

Caption: Night battery check. Yes. That charge should last until sunrise, and this dim day does not refill it.

### 0:20–0:26 The washing machine

Click "When should I run the washing machine today?"

Caption: The washing machine waits until tomorrow, from 1 to 3 in the afternoon, when the roof can cover it.

### 0:26–0:32 The day plan

Click "Plan the dishwasher, the washer, and the car." Only the washer fits.

Caption: Day plan. The washer fits that window. The dishwasher and the car charging do not.

### 0:32–0:44 Morning briefing

Click "Good morning. When is the solar window?" The strongest stretch is thin, so the sentence does not say to run heavy loads.

Caption: Morning briefing. The strongest stretch today is 1 to 4 in the afternoon, and it is too thin for heavy loads.

### 0:44–0:49 MCP trace

Scroll to "MCP trace" and open it. Hold on protocol 2025-11-25 and the tool-call lines.

Caption: The trace under the page is the MCP conversation. Protocol 2025-11-25, over Streamable HTTP.

### 0:49–0:57 Today's roof

Scroll back and click "How much will the roof make today and tomorrow?"

Caption: Asked plainly, the roof is about 1.3 kilowatt-hours today, with a brighter day tomorrow.

### 0:58–1:15 The terminal, typed

Crossfade onto a clean prompt. Type `npm run tools` to the end, then let the list print, and hold it about 3 seconds. Clear, type `npm run demo` to the end, then let the sentence print. Clear, type `npm test` to the end, then let the suite print. Hold `# pass 18` and `# fail 0` about 2 seconds. Do not cut while a command is still being typed.

Caption: The official client lists the tools and agrees on protocol 2025-11-25. A live call from that client answers the washing machine in one sentence. Eighteen tests pass, and none of them call the live forecast.

### 1:15–1:31 Close

On-screen text:

Sol Solar
https://github.com/Solar-DePIN-Hub/sol-solar-mcp
Open-Meteo and PVGIS
Vadym Bilobrovets, October 2026

Caption: The project is public on GitHub. Open-Meteo and PVGIS. Built by Vadym Bilobrovets.

## What not to claim on camera

- Do not say the figure is today's measured production.
- Do not say a typed price is the household's tariff.
- Do not say the project reads a battery or a Solar DePin inverter. It does not.
