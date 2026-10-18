# Devpost submission draft

Paste the sections below into the hackathon form. Facts here were checked against the running server, the captured sample in `docs/samples/kyiv-5kw.json`, and the hackathon pages as fetched on 17 October 2026.

## Project name

Sol Solar

## Tagline

A self-hosted MCP server that answers home solar questions: today's production, the better hours for a heavy appliance, and a plain savings estimate.

## Tracks

- Primary track: **Alexa+**
- Mini-challenge: **Open Source** (this repository, MIT, created during the hackathon window)
- Mini-challenge: **AWS Builder is not claimed.** A Lambda Web Adapter image and App Runner notes are in `docs/AWS.md`. They were not deployed. No AWS API is called. See the product-feedback section.

## Inspiration

I build around solar. Solarchik is the assistant I have been making for Solar DePin, and the questions people actually ask are small and repetitive: what will the roof make today, when should the washing machine run, is the energy worth anything. A voice assistant is a natural place for those questions, and the Alexa+ track asks for them as tools on a self-hosted MCP server rather than as a skill with a private schema.

I wanted the data path to stay boring and checkable. No API key, no scraped portal, no invented tariff. Open-Meteo for the forecast, PVGIS for the typical year, and a short local model whose assumptions are in the tool result.

## What it does

Sol Solar is a Node.js MCP server, spec 2025-11-25, Streamable HTTP, with five read-only tools:

1. `resolve_location` turns a place name into coordinates.
2. `forecast_pv_production` estimates remaining production today and all of tomorrow for a nameplate kilowatt size, tilt, and azimuth.
3. `best_appliance_hours` ranks contiguous hours for a load you describe and says what fraction of that load the array covers. It does not control any device.
4. `estimate_savings` multiplies kilowatt-hours by a price the caller types. It refuses to invent one.
5. `typical_monthly_yield` returns PVGIS 5.3 climatology for a typical year.

A page on the same server is an MCP client. It sends `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`. The hackathon FAQ says that kind of client is a valid Alexa+ demo, because the official simulator is partner-only.

Captured at 2026-10-17T23:39:52Z for Kyiv (50.45466°N, 30.5238°E), 5 kW, tilt 35°, facing south: the cloudy forecast was **1.31 kWh** still to come on 18 October and **3.77 kWh** on 19 October. PVGIS, for the same array, estimates about **5570 kWh** in a typical year (SARAH3 / ERA5, 2005–2023), and a typical October day of **12.78 kWh**. The forecast is allowed to be much lower than the typical day. That is the point of using a weather model.

## How I built it

TypeScript on Node.js 22, `@modelcontextprotocol/sdk` 1.32.1, Express through the SDK's `createMcpExpressApp`, Zod schemas on every tool. The transport is `StreamableHTTPServerTransport` in stateless mode with `enableJsonResponse: true`, which the spec permits as `Content-Type: application/json`. `GET /mcp` returns 405, which the spec permits when the server does not offer a standalone SSE stream. The official client treats 405 that way, and the tests use that client.

The hourly model is local and documented: Open-Meteo tilted irradiance, a NOCT-45°C cell-temperature approximation, −0.4%/°C, and a separate 14% system loss. PVGIS is called only for the typical-year tool, and its numbers are passed through rather than recomputed.

Tests cover the math, the HTTP handshake, an origin rejection, all five tools against fixtures, and live Kyiv calls. `npm run example` writes the sample file so the README numbers can be checked.

## Challenges

- The Alexa+ quickstart tells you to install `alexa-ai` and deploy an add-on. The hackathon FAQ, fetched the same week, says participants cannot get that CLI, the MCP Toolkit, or the web simulator. I built to the open MCP spec and demoed with my own client instead of pretending the console existed.
- Alexa+ wants OAuth 2.1 with PKCE, a 401 that must not include `WWW-Authenticate`, and no dynamic client registration. Turning that on locally would lock out MCP Inspector and the demo page, and there is no partner account to finish linking. Auth is documented as a gap.
- The production latency budget is 500 ms. A forecast from this environment came back in about 400 ms. PVGIS is often slower. I cache, and I do not claim the budget is met.
- Open-Meteo timestamps the preceding-hour irradiance at the end of the hour. Labeling 12:00 as "noon" would shift every recommendation by an hour. The tools speak in intervals (`12:00–13:00`).
- PVGIS does not allow browser calls. The server has to proxy it. That is also why the typical-year tool exists instead of a chart that calls JRC from the page.
- The forecast and the typical year are different models on purpose. Putting them in one blended number would look tidier and be less honest.

## Accomplishments

- A server a judge can clone, test, and call, with real Kyiv data and no API key.
- Five tools with input validation, spoken summaries, and the assumptions sitting in the JSON.
- A simulator page that is an actual MCP client, plus a Dockerfile.
- An open-source MIT repository created for the hackathon, with attribution for Open-Meteo (CC BY 4.0) and PVGIS.

## What I learned

The MCP TypeScript SDK already implements the transport Alexa+ asks for, including a JSON response mode and a 405 on `GET` that clients understand. The hard part of this track is not the protocol. It is that the onboarding path in the product docs is closed to the people the hackathon invited, and that a useful solar answer depends on saying what the number is not.

## What's next

- An OAuth 2.1 resource server that matches the published checklist, once there is a console to test it against.
- A public HTTPS deploy, with the in-memory cache moved somewhere that survives more than one process.
- Ukrainian speech in the summaries. The tools already accept a Cyrillic place name through the geocoder.
- A meter or inverter reading, if a household wants the forecast compared with what the roof actually did. Not part of this entry.

## Built during the hackathon

The project was created during the submission window (31 August 2026 through 23 October 2026). It did not exist before the hackathon. Author: Vadym Bilobrovets, solo, Ukraine.

## Open Source mini-challenge fields

- Contribution URL / project URL: https://github.com/Solar-DePIN-Hub/sol-solar-mcp
- GitHub username: `mcBanCh` (the author of the initial commit; noreply id `160739168+mcBanCh`). Repository owner: `Solar-DePIN-Hub`.
- What I did: a new MIT-licensed MCP server, tests, a browser MCP client, and deploy notes, written in October 2026.
- How it works: Streamable HTTP tools call Open-Meteo and PVGIS and return estimates a voice assistant can speak.
- Why it matters: someone with a small array can ask what today looks like without handing a vendor an account, and another developer can run the same server.
- The rules also describe the open-source work as "alongside" the primary submission. This repository is both. I did not open a separate pull request against an unrelated project.

## Product feedback

Required answers, one per tool I actually used.

### Model Context Protocol TypeScript SDK 1.32.1, and the 2025-11-25 spec

- Used for: the server (`McpServer`, `StreamableHTTPServerTransport`, `createMcpExpressApp`) and the tests (`Client`, `StreamableHTTPClientTransport`).
- Worked well: stateless Streamable HTTP, JSON responses, Zod tool schemas, and a client that accepts `405` on `GET`. Protocol negotiation returned `2025-11-25` in tests. The spec is clear that `Origin` must be checked and that JSON or SSE are both legal responses.
- Needs work: the useful examples live deep in the package (`dist/esm/examples`) more than on a single "copy this stateless server" page. Host-header protection and origin protection are easy to confuse, and the SDK warns if you bind `0.0.0.0` without an allow list, which is correct but surprising the first time a container health check fails.
- Onboarding: `npm install` and the stateless example were enough to get `initialize` working the same day. That part is in good shape.
- Build again: **Yes.** The open protocol is the part of this track I could actually finish.

### Open-Meteo forecast and geocoding APIs

- Used for: place lookup, hourly global tilted irradiance, and 2 m temperature. No API key.
- Worked well: one HTTPS call, tilt and azimuth as query parameters, timezone `auto`, and a documented preceding-hour mean that is the right quantity for energy. Geocoding returned Kyiv, Kyiv City, Ukraine as the first hit, with a smaller same-named village available as an alternative. Licence page is unambiguous CC BY 4.0.
- Needs work: the docs page mixes a CC BY statement with a non-commercial / commercial / self-hosted selector, so a builder still has to read the terms before shipping a product. Nulls and the "timestamp is the end of the hour" rule are easy to misuse. I would like a one-line example that converts the series to kWh for a fixed array.
- Onboarding: a curl against the docs URL worked immediately.
- Build again: **Yes.**

### PVGIS 5.3 non-interactive PVcalc

- Used for: typical-year monthly and yearly energy, passed through with the database name and year range.
- Worked well: no key, JSON output, and the same azimuth convention as Open-Meteo (0° = south). For the Kyiv 5 kW case it returned a traceable SARAH3 / ERA5 result for 2005–2023. JRC states that use of the information is free.
- Needs work: the service rejects browser calls, the error bodies are easy to miss, and a cold call is often too slow for a 500 ms voice budget. The parameter list is precise and dense. Coverage is not global in the way a marketing page implies; locations outside the radiation databases fail, and the tool has to say so.
- Onboarding: the API page is complete. The first successful call was straightforward once it was made from a server rather than a browser.
- Build again: **Yes**, for climatology. Not as the source of "what about this afternoon."

### Alexa+ MCP Toolkit, Alexa AI CLI, and the official web simulator

- Used for: nothing. I could not.
- The quickstart at `developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html` walks through `alexa-ai configure`, `alexa-ai new mcp`, and `alexa-ai deploy`. The hackathon FAQ says those tools are select-partner preview and participants cannot apply. Individual setup pages still read as if you can start today. That contradiction cost a reading pass.
- Needs work: open the simulator to people submitting to this hackathon, or say on the quickstart itself that the console is closed. A sample OAuth server that returns 401 without `WWW-Authenticate`, publishes the two well-known documents, and speaks PKCE S256 would match the checklist you already published. Dynamic client registration being unsupported should sit next to a static-client example, not only in a "not supported yet" list.
- Onboarding: I did not reach hello-world on Alexa+. I reached hello-world on the open MCP spec.
- Build again: **Yes for MCP. Not for the gated add-on flow, until a participant can complete it.** I would build another MCP server tomorrow. I would not start another Alexa+ add-on until the console path is real for someone in this hackathon.

### AWS

- Services used: **none at runtime.**
- `Dockerfile` is a normal container. `Dockerfile.lambda` adds the public Lambda Web Adapter image so the same process can sit behind a Function URL. `docs/AWS.md` records App Runner commands I did not run.
- I am not entering the AWS Builder mini-challenge on the strength of an unused Dockerfile. The October 7 update said promotional credits are exhausted, and this environment had no AWS account to deploy into.
- If I deploy before the deadline, the feedback to add is: which region, the health-check result, and the cold-start time against the 500 ms budget.

### Would I build with these again, together

**Yes** for the MCP SDK, Open-Meteo, and PVGIS. **No** for the closed Alexa+ onboarding, until it can be completed without a private partner invite.

## Feature requests

1. **Critical.** Give hackathon participants the Alexa+ web simulator and a way to attach a self-hosted MCP URL. The FAQ already tells us to simulate. The product docs still send us to a CLI we cannot install.
2. **Important.** Publish a minimal OAuth 2.1 resource-server example that matches the current checklist, including the forbidden `WWW-Authenticate` header and the absence of dynamic client registration.
3. **Nice-to-have.** Document an accepted cache pattern for tools whose upstream APIs cannot promise 500 ms, so a weather or solar add-on is not structurally ineligible.

## Friction log

### 1. Follow the Alexa+ MCP quickstart through to a testable add-on

- Task: connect this server to Alexa+ the way the quickstart describes.
- Steps: read the quickstart, then the hackathon Resources page, Rules, and FAQ.
- Expected: an installable CLI and a simulator, since the quickstart's first command is `alexa-ai configure`.
- Actual: the FAQ says the CLI, toolkit, and simulator are partner-only and there is no application path. The quickstart page does not say that.
- Severity: **High.** It blocks the integration the track is named after.
- Workaround: a page on this server that is itself an MCP client, which the FAQ accepts.
- Suggestion: one sentence on the quickstart, and a simulator flag for hackathon accounts.

### 2. Meet the 500 ms round trip with a public solar API

- Task: keep a tool call under the latency number in the quickstart.
- Steps: call Open-Meteo and PVGIS from the server, time a live `tools/call`.
- Expected: a documented budget that a weather upstream can meet, or an exception for cached tools.
- Actual: one forecast completed in about 400 ms from this environment. PVGIS is regularly slower, and nothing about a cold Lambda start fits in 500 ms. I added a short memory cache. I do not claim the requirement is met.
- Severity: **Medium.** The server is useful, and it would fail a production checklist on some calls.
- Workaround: cache, and keep PVGIS on its own tool so a "what about today" question does not wait for climatology.
- Suggestion: publish the budget next to a note about cached third-party data, or measure only the MCP handler once the upstream body is cached.

### 3. Reconcile DNS-rebinding rules with local clients

- Task: pass the spec's origin check without breaking curl, MCP Inspector, and the demo page.
- Steps: read the transport security section and the SDK's `createMcpExpressApp` behavior.
- Expected: one middleware story.
- Actual: missing `Origin` must be allowed for non-browser clients, localhost origins must be allowed for the demo page and Inspector, and any other origin must be 403. Binding `0.0.0.0` disables the SDK's automatic host check unless `ALLOWED_HOSTS` is set. A container health check and a browser client fail in different ways.
- Severity: **Low.** Solved in this server, easy to get wrong.
- Workaround: allow missing origins and localhost, require `ALLOWED_HOSTS` when you expose the process, document both.
- Suggestion: a single "local demo" preset in the SDK docs that states the headers curl, Inspector, and a same-origin page each send.
