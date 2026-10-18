# Demo script

Target length: about 2 minutes 20 seconds. Hard stop before 3 minutes. No voice. No music. No logos. English captions only. The caption track is `docs/demo-captions.srt`.

Record the page served by this repo (`npm run dev`, then open `http://127.0.0.1:3000/`). Leave the defaults: place **Kyiv**, array **5 kW**, appliance **washing machine**, **2000 W**, **2 hours**. For the savings shot, type price **1** and currency **UAH**. Say on screen that 1.00 is a price you typed, not a tariff the server looked up.

The numbers change with the weather. Speak whatever the live page returns. Do not paste the 17 October capture over a different day.

## Shot list

| Time | On screen | Caption |
| --- | --- | --- |
| 0:00–0:08 | Title. Browser is already on Sol Solar. The status pill is visible. | Sol Solar. A self-hosted MCP server for a home array or a small solar node. Amazon Developer Hackathon 2026, Alexa+ track. |
| 0:08–0:18 | Hold on the status pill: protocol 2025-11-25 and five tools. Scroll the "Last MCP exchange" so `initialize` or the tool names are visible. | This page is an MCP client. It speaks Streamable HTTP to the server in this repo. Spec 2025-11-25. The official Alexa+ simulator is not available to hackathon participants. |
| 0:18–0:48 | Click **Today and tomorrow**. Wait until both bubbles finish. Leave the summary on screen. | Kyiv, 5 kilowatts, tilt left at the default. The forecast is an Open-Meteo estimate, not a meter reading. A cloudy day can be far below a typical October day. |
| 0:48–1:15 | Click **Best hours to run it**. Wait for the washing-machine answer. | A 2,000 watt load for 2 hours. The server ranks the remaining hours and says what share of that load the array covers. It does not turn anything on. |
| 1:15–1:35 | Type `1` in **Your price per kWh**. Currency stays `UAH`. Click **Value that energy**. | The price is typed by the caller. One hryvnia here is a placeholder so the arithmetic is obvious. The server does not look up a tariff, and the result is not a bill. |
| 1:35–2:05 | Click **Typical year**. Wait for the PVGIS summary. | PVGIS 5.3 typical year for the same array. Climate, not this week's forecast. Open-Meteo data is CC BY 4.0. PVGIS figures are free to reuse under the JRC terms. |
| 2:05–2:20 | Open one "Tool response" disclosure, or leave the protocol panel showing `tools/call`. End on the attribution footer. | Built in October 2026 by Vadym Bilobrovets. Account linking to Alexa+ needs the partner CLI, which participants cannot access. The server itself is what the track asked to see. |

## What not to show

- Amazon, Alexa, or Devpost logos.
- A tariff presented as Ukraine's actual rate.
- Any number that is not on the page at record time.
- Setup, `npm install`, or a failing call. Start recording when the status pill already says connected.

## Recording already captured

On 17 October 2026 the same flow was run in a browser against this server. The screen recording is 53 seconds. Tilt was left blank, so the server used its latitude default (50.5° for Kyiv), not the 35° sample in the README. Readable results in that take: about 1.24 kWh still on 18 October, 3.71 kWh on 19 October, washing-machine window 12:00–14:00, 4.94 UAH at a typed price of 1.00 UAH per kWh, and a PVGIS typical year of about 5478 kWh. Captions timed to that recording are `docs/recording-captions.srt`.

The shot list above is the longer YouTube cut, with holds so a sentence can be read. Its captions are `docs/demo-captions.srt`.

## After you export

Upload the video to YouTube or Vimeo, public, with the `.srt` file as captions. Judges are not required to watch past three minutes. The form still needs that public URL. This repository cannot create the YouTube upload.
