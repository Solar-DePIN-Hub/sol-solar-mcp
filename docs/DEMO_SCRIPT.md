# Demo script

The Devpost cut is 2:02, 1280×720, no music, no voice track, no Amazon logo. English captions are burned in and kept in [DEMO_CAPTIONS.srt](DEMO_CAPTIONS.srt), timed to that cut. Plain text that names Alexa+ is enough, because the entry is for that track.

The numbers on screen come from the live forecast for Kyiv on 18 October 2026. Do not paste a kilowatt-hour into a later recording if the tool just said a different one.

Upload the captioned file to YouTube or Vimeo. This repository does not contain that URL.

## Setup before you hit record

1. `npm install` and `npm run dev`.
2. Open http://127.0.0.1:8787/ in a clean window.
3. Confirm the form shows Kyiv, 5 kW, tilt 35, facing south, appliance "washing machine", power 0.7, hours 2. Battery 5 kWh, charge 40, house load 0.3 kW. Leave price empty.
4. A second terminal, for the tools list and `npm test`.

## Shot list

### 0:00–0:08 Title

On-screen text:

Sol Solar — a solar-aware MCP server for Alexa+

Caption: Sol Solar answers a household before sunrise. Will the battery last the night?

### 0:08–0:16 The roof you typed

Show the form, including the line that says battery size, charge, household load, and price are assumptions you type.

Caption: Kyiv, a 5 kilowatt array, tilt 35, facing south. Battery size, charge, and house load are typed. Nothing is read from a meter.

### 0:16–0:33 Will the battery last?

Click "Will my battery last through tonight?" Leave the spoken sentence on screen. On this morning the answer was yes until sunrise, and the day's roof was not enough to refill the battery.

Caption: battery_through_the_night. The battery should last until sunrise. The forecast sun is not enough to refill it. Today is about 1.3 kilowatt-hours.

### 0:33–0:47 The washing machine

Click "When should I run the washing machine today?"

Caption: best_time_for_appliance. Wait until tomorrow. Run the washing machine from 1 PM to 3 PM. That 0.7 kilowatt wash is about 1.4 kilowatt-hours.

### 0:47–1:01 The day plan

Click "Plan the dishwasher, the washer, and the car." Only the washer fits. The dishwasher and the car charging would ask an hour for more than the forecast shows.

Caption: plan_the_solar_day. The washer fits tomorrow. The dishwasher and the car charging do not. An hour is shared only when the roof can cover both.

### 1:01–1:15 Morning briefing

Click "Good morning. When is the solar window?" The strongest stretch is thin, so the sentence does not say to run heavy loads.

Caption: daily_solar_briefing. The strongest stretch today is 1 PM to 4 PM, about 0.6 kilowatt-hours. That is a thin window for heavy loads.

### 1:15–1:26 MCP trace

Open "MCP trace" and hold on `initialize` with protocol 2025-11-25 and the `tools/call` lines.

Caption: The browser is an MCP client. initialize negotiates protocol 2025-11-25 over Streamable HTTP. The sentence is the tool's text.

### 1:26–1:38 Tools

In the terminal, run `npm run tools`. Hold on Protocol 2025-11-25 and the seven tool names.

Caption: tools/list from the official MCP client. Protocol 2025-11-25. Seven tools, including the night-battery check and the day plan.

### 1:38–1:52 Tests

Run `npm test`. Hold on `# pass 18` and `# fail 0`.

Caption: npm test. 18 tests pass and 0 fail. The suite stays offline. It does not call the live forecast.

### 1:52–2:02 Close

On-screen text:

Self-hosted MCP server
Open-Meteo and PVGIS
October 2026 · Vadym Bilobrovets
Alexa+ linking needs the partner preview.
This demo is the MCP client the FAQ accepts.

## What not to claim on camera

- Do not say the figure is today's measured production.
- Do not say a typed price is the household's tariff.
- Do not say the project reads a battery or a Solar DePin inverter. It does not.
