# Demo script

Target length: about 2 minutes 30 seconds. Hard limit: 3 minutes. Judges are not asked to watch past that.

Record the screen with English captions. Do not record a voice track. Do not use music. Do not show the Amazon logo or other brand artwork. Plain text that names Alexa+ is enough, because the entry is for that track. The captions below are also in [DEMO_CAPTIONS.srt](DEMO_CAPTIONS.srt).

The numbers on screen come from the live forecast. Do not paste a kilowatt-hour into the video if the tool just said a different one. The sample in the README was captured on 18 October 2026 and will not match a later day.

A local screen recording of the browser half was captured that day: connect, the washing-machine question, a typed price of 6 UAH, and the MCP trace showing protocol 2025-11-25. That file is not the Devpost video. Upload a captioned cut, under 3 minutes, to YouTube or Vimeo. No music. No Amazon logo.

## Setup before you hit record

1. `npm install` and `npm run dev`.
2. Open http://127.0.0.1:8787/ in a clean window.
3. Confirm the form shows Kyiv, 5 kW, tilt 35, facing south, appliance "washing machine", power 0.7, hours 2. Leave price empty for the first question.
4. Optional second terminal, not yet running: `npm run demo`.

## Shot list

### 0:00–0:10 Title

On-screen text, large:

Sol Solar — a solar-aware MCP server for Alexa+

Caption: Sol Solar answers one household question. Will the battery last the night, and when should I run the washing machine?

The final captions are burned into the demo video and kept in [DEMO_CAPTIONS.srt](DEMO_CAPTIONS.srt). Time the cues to the cut you upload. The outage question opens the browser section, because that is the sentence a dim morning in Kyiv actually produced.

### 0:12–0:28 The roof you typed

Show the form. Point, with the cursor, at place, array size, tilt, and the line that says power and price are assumptions you type.

Caption: This roof is a 5 kilowatt array in Kyiv, tilted 35 degrees and facing south. The wash is an assumption: 0.7 kilowatts for 2 hours. Nothing here is read from a meter.

### 0:28–0:42 Connect

Click "Connect this browser". On the consent page, click Allow. Back on the main page, open "MCP trace" long enough to see OAuth PKCE and `initialize` with protocol 2025-11-25.

Caption: The browser connects with OAuth PKCE, then speaks MCP over Streamable HTTP. The negotiated protocol is 2025-11-25.

### 0:42–1:25 The question

Click "When should I run the washing machine today?" Wait until the spoken sentence and the chart appear. Leave the sentence on screen. Do not scroll it away. If the chart highlights a window, rest the cursor there.

Caption: The page calls the tool best_time_for_appliance. The sentence on screen is the tool's text. A language model is not writing the kilowatt-hours. Today is compared with tomorrow, and with a typical day from PVGIS.

### 1:25–1:45 A price you typed

Type `6` in price and `UAH` in currency. Click "What do I save against a 7 PM start?"

Caption: Money appears only after a price is typed. Six hryvnia per kilowatt-hour is an example for this demo. It is not a tariff lookup, and it is not a bill.

### 1:45–2:10 The same call from the terminal

Switch to the terminal. Run `npm run demo`. Hold on the lines `Protocol: 2025-11-25` and the spoken washing-machine answer.

Caption: The same server, called by the official MCP client. Protocol 2025-11-25. Streamable HTTP. The sentence matches the page.

### 2:10–2:30 Close

On-screen text:

Self-hosted MCP server
Open-Meteo and PVGIS
Built October 2026 by Vadym Bilobrovets
Alexa+ account linking needs the partner preview. This demo is the MCP client the hackathon FAQ asks for.

Caption: Sol Solar is a self-hosted MCP server. It uses Open-Meteo and PVGIS. Built in October 2026 by Vadym Bilobrovets. Linking it to Alexa+ needs the partner preview, so this video shows the MCP client the hackathon FAQ accepts.

## What not to claim on camera

- Do not say the figure is today's measured production.
- Do not say 6 UAH is the household's tariff.
- Do not say the project reads a Solar DePin inverter. It does not.
