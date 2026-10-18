# Devpost submission draft

Paste the sections below into the Amazon Developer Hackathon 2026 form. The project was built in October 2026. The repository did not exist before 17 October 2026.

## Paste these fields

- **Project name:** Sol Solar
- **Tagline:** Ask if the battery lasts the night, or when to run the washing machine. A spoken answer from today's solar forecast.
- **Built with:** Node.js, TypeScript, Model Context Protocol, Express, Zod, Open-Meteo, PVGIS, Docker, AWS Lambda, Amazon DynamoDB
- **Repository URL:** https://github.com/Solar-DePIN-Hub/sol-solar-mcp
- **Primary track:** Alexa+
- **Mini-challenges:** Open Source, AWS Builder
- **Author:** Vadym Bilobrovets, solo, Ukraine
- **GitHub username:** `Solar-DePIN-Hub` (the account that owns this repository). Personal profile: https://github.com/mcBanCh

The tagline is 116 characters.

## Inspiration

I build solar infrastructure in Ukraine under Solar DePin, and a voice assistant, Solarchik. The question is the same at a house and at a small solar node: when is the power actually there? "When should I run the washing machine?" is the version a person will say out loud. I wanted Alexa+ to answer that in a sentence, from public weather and solar data, on a server I can host myself. No API key. No invented kilowatt-hours.

## What it does

Sol Solar is a self-hosted MCP server. You tell it a place and an array size. It answers, in speech:

- what the roof is expected to make today and tomorrow
- when to run one appliance, given the power and duration you type
- a plan for several appliances that never asks one hour for more power than the roof is forecast to make
- whether a battery you describe will last until sunrise, and whether tomorrow's sun can refill it
- a morning briefing that names the strongest stretch, and says when that stretch is too thin for heavy loads
- how many grid kilowatt-hours a shift avoids compared with 7 PM
- a money figure only if you also type a price

On 18 October 2026 a 5 kW array in Kyiv, tilted 35 degrees and facing south, got this answer for a washing machine assumed at 0.7 kW for 2 hours:

> Wait until tomorrow. Run the washing machine from 1 PM to 3 PM. That washing machine, running for 2 hours at 0.7 kilowatts, is about 1.4 kilowatt-hours. The roof should cover it in that window. Today the array is expected to make about 1.3 kilowatt-hours, so waiting is the better solar plan. A typical October day for this array is about 12.8 kilowatt-hours in the PVGIS record, so the forecast days are dim.

The dim forecast is the point. A wrapper that always says "midday" would have been wrong that day. The server compared the live forecast with PVGIS and said the days were dim.

Just after 4 AM that morning, the same array was asked about a typed 5 kWh battery at 40 percent, with a typed 0.3 kW household load. The charge covers the hours left until the 7:25 AM sunrise. The day's 1.3 kWh forecast does not refill the battery. A day plan for a 1 kW dishwasher, the washer, and 1.4 kW car charging can place only the washer, tomorrow from 1 PM to 3 PM. The other two would ask an hour for more than the forecast shows. None of those inputs were read from a meter or a battery.

The web page at `/` is the voice client. It speaks the tool text. It does not call a language model.

## How I built it

- TypeScript, Node.js 22, Express, Zod, and `@modelcontextprotocol/sdk` 1.32.1.
- `McpServer` and `StreamableHTTPServerTransport` serve `POST`, `GET`, and `DELETE` on `/mcp`. The client negotiates protocol `2025-11-25`.
- Tests and `npm run demo` use `Client` and `StreamableHTTPClientTransport` from the same SDK.
- OAuth 2.1 authorization code with PKCE S256, Protected Resource Metadata, and authorization-server metadata, matching the Alexa+ MCP QuickStart. Unauthenticated `/mcp` returns `401` with no `WWW-Authenticate` header. Tokens in the query string are rejected.
- Open-Meteo for geocoding and tilted-irradiance forecasts. PVGIS 5.3 `PVcalc` for the typical year. Both are called only from the server. PVGIS blocks browser AJAX.
- A small yield model, documented in the README, with system losses aligned to PVGIS's default 14%. Usable solar in an hour is capped at the appliance's power.
- The site is remembered on the MCP session and returned as `site_id`.
- Dockerfile for a container. `infra/template.yaml` is an AWS SAM stack: Lambda function URL plus DynamoDB for the cache and tokens. That stack was not deployed. The AWS Builder section below says exactly what was and was not run.

## Challenges

The Alexa+ add-on CLI, toolkit, and web simulator are partner-only. The hackathon FAQ says participants cannot apply for them. I could not complete account linking or record a session inside Amazon's simulator. The demo is a real MCP client instead, which the FAQ accepts.

Alexa+ also wants a round trip under 500 ms, and it wants OAuth behavior that differs from a typical resource server: no `WWW-Authenticate` on `401`, no dynamic client registration, and a required `resource` parameter. A cold forecast plus PVGIS took 869 ms in the 18 October demo. A cached forecast took 35 ms.

Open-Meteo's free API is non-commercial. That fits a hackathon and home automation, and it is the wrong licence for a paid product. I documented the boundary instead of hiding it.

## Accomplishments

- Five tools with spoken answers, input validation, and tests.
- A live answer for Kyiv that uses both a forecast and a typical year, and that recommends waiting when today is too dark.
- Session memory, so a follow-up does not have to repeat the city.
- An OAuth surface that matches the published Alexa+ checklist, exercised by the tests.
- An open-source MIT repository created during the hackathon window.

## What's next

- Replace the typed appliance power with a measurement when a household wants to connect an inverter or a smart plug. This submission does not pretend to have that feed.
- Keep the spoken contract: the tool text stays the sentence Alexa says, so a model cannot invent a kilowatt-hour.
- Deploy the SAM stack once an AWS account is available, and set `PUBLIC_BASE_URL` to the function URL.
- Register Amazon's OAuth client id when the partner tools are available to independent developers.

## Judging criteria

**Tech implementation.** The required technology is imported and called. The server is MCP specification 2025-11-25 over Streamable HTTP, with the auth metadata the QuickStart lists. Tools validate inputs, fail in a sentence when a service is down, and are covered by tests plus a live Kyiv call.

**Design.** The interaction is one household question and one spoken answer. The page leads with that sentence. The chart is support, not the product. Power, duration, and price are labeled as things you type.

**Potential impact.** Anyone with a roof, a balcony array, or a small solar node can ask the question for their own place. There is no key to sign up for. The same answer is useful for shifting a wash, planning several loads, or checking a battery against the night, which is an ordinary question where outages are ordinary. It is not limited to one city. It is an estimate, and it says so, which is what makes it safe to put on a speaker.

**Quality of the idea.** A single API wrapper would have returned irradiance. This one keeps the home in the session, chooses between today and tomorrow, refuses to count surplus solar the appliance cannot use, refuses to stack two appliances into an hour the roof cannot cover, and puts a typical year next to a dark forecast so the answer has a baseline. On a dim morning it will say the battery reaches sunrise and still say the sun will not refill it. The words are produced by the tool, on purpose, so the voice client cannot hallucinate the energy.

## Product feedback

### Which developer tools, APIs, and SDKs did you use, and for what?

- `@modelcontextprotocol/sdk` 1.32.1: the server, the demo client, and the tests. Streamable HTTP, tool registration, and the protocol negotiation that landed on `2025-11-25`.
- MCP specification 2025-11-25, including the origin check guidance for Streamable HTTP.
- Alexa+ MCP QuickStart: the auth checklist and the add-on onboarding steps. I implemented the checklist. I could not run the CLI.
- Open-Meteo forecast and geocoding APIs: irradiance, temperature, sunrise and sunset, and place resolution.
- PVGIS 5.3 `PVcalc`: typical-year yield and, when tilt is omitted, a suggested fixed tilt.
- Express and Zod: HTTP, validation, and the tool schemas.
- Docker: the container image.
- AWS SAM, the Lambda Node.js 22 runtime via `serverless-http`, and `@aws-sdk/client-dynamodb`: a deploy path and a cache/token store. Not executed against a live account. See AWS Builder below.
- Node.js 22 test runner.

### What worked well?

The TypeScript SDK made Streamable HTTP concrete. One transport handles `POST`, `GET`, and `DELETE`, and the official client negotiated `2025-11-25` without a custom framing layer. Tool descriptions and Zod schemas were enough to keep the demo client and the tests on the same contract. Open-Meteo answered without a key, and the tilted-irradiance parameters (`tilt`, `azimuth`, `global_tilted_irradiance`) are documented clearly. PVGIS returned a monthly series with the database name and the year range in the same payload, which the spoken answer cites. The QuickStart's auth checklist is specific enough to implement and to test: `S256` is present, the `401` has no `WWW-Authenticate` header, and a query-string token is rejected.

### What needs work?

The Alexa+ onboarding path assumes tools hackathon participants cannot use. The QuickStart sends you to `alexa-ai`, and the FAQ says that CLI is partner-only with no application process. A builder cannot discover the OAuth client id Amazon will send, because dynamic client registration is unsupported and the manual registration step is behind that CLI.

The 500 ms budget is tight for a tool that must call a weather service. Caching gets under the budget on a repeat question. The first question in a new place does not.

`401` without `WWW-Authenticate` conflicts with what many OAuth clients expect. It is implementable, and it is easy to get wrong because it is the opposite of the usual hint.

PVGIS rejecting browser calls is fine, but it is easy to miss until a front end fails.

### How was onboarding, from zero to a first result?

Reading the MCP spec and standing up a Streamable HTTP tool took a normal afternoon. The first live Kyiv sentence came back on the first successful Open-Meteo and PVGIS calls. Onboarding to Alexa+ itself stopped at the QuickStart's CLI step. There was no account to configure.

### Would you build with these again?

Yes for MCP, Open-Meteo, and PVGIS. The protocol is a good fit for a voice tool that must not invent numbers, and the two science APIs are usable without a key if you respect their licences. Yes for Alexa+ once an independent developer can link a server without a partner invitation. I would not ship a commercial product on the free Open-Meteo tier. Their terms say not to.

### AWS Builder

Services in the project: AWS Lambda (function URL, Node.js 22, ARM) and Amazon DynamoDB (on-demand table, TTL on `ttl`, used for forecast cache, PVGIS cache, authorization codes, and access tokens). The handler is `src/lambda.ts`, which wraps the same Express app with `serverless-http`. The DynamoDB client is `src/dynamoStore.ts`. The SAM template is `infra/template.yaml`. A unit test writes a TTL item through a fake client that receives the real `PutItemCommand`.

What was not done: no `sam deploy`, no App Runner service, no call to a live AWS API. The hackathon resources page said on 7 October 2026 that AWS promotional credit codes were exhausted. This environment had no AWS credentials. App Runner is documented as a container deploy of the same Dockerfile, not as a running service.

Kiro was not used.

## Open Source mini-challenge

- Contribution URL: https://github.com/Solar-DePIN-Hub/sol-solar-mcp
- Project repository URL: https://github.com/Solar-DePIN-Hub/sol-solar-mcp
- GitHub username: `Solar-DePIN-Hub`
- Author profile: https://github.com/mcBanCh

What I did: created this repository on 17 October 2026 and wrote the server, the voice client, the tests, and the MIT licence during the hackathon window. The licence file is `LICENSE`.

How it works: a Streamable HTTP MCP server with five solar tools, described in the README.

Why it matters: a household or a small solar node can ask when to use the roof, in speech, without an API key and without a closed voice platform. The licence lets someone else host it.

## Feature requests

1. **Public access to the Alexa+ add-on CLI and web simulator for hackathon participants.** Critical. Without it, nobody in this hackathon can show the tool on Alexa+ itself. The FAQ already tells us to simulate. A simulator run by Amazon would let you judge the real linking flow.
2. **A documented static OAuth client id, or dynamic client registration.** Critical. The QuickStart requires a pre-registered client and also says dynamic registration is unsupported. There is no public place to learn the client id Alexa will send.
3. **A latency budget that allows a cold third-party call, or a documented edge-cache pattern.** Important. Science APIs are not 500 ms on a cold start from every region. The repeat call is fast. The first one is the one a new user hears.

## Friction log

### 1. Cannot link the server to Alexa+

- Task: follow the Alexa+ MCP QuickStart from an empty machine to a development-stage add-on.
- Steps: read the QuickStart, then the hackathon FAQ and resources page.
- Expected: install `alexa-ai`, run `alexa-ai configure`, scaffold with `alexa-ai new mcp`, and test in the web simulator.
- Actual: the FAQ states that the CLI, MCP toolkit, and web simulator are in preview for select partners, and that hackathon participants cannot apply. I did not get a login.
- Severity: critical.
- Workaround: a local MCP client that sends `initialize`, `tools/list`, and `tools/call` over Streamable HTTP, plus the OAuth endpoints the QuickStart requires so the server is ready when linking exists.
- Suggestion: give hackathon accounts a sandbox `alexa-ai` login that can deploy to a development stage, even if certification stays closed.

### 2. OAuth discovery disagrees with ordinary resource servers

- Task: implement the QuickStart discovery rules.
- Steps: return `401` for a missing bearer token, publish RFC 9728 metadata, publish authorization-server metadata with `S256`, require PKCE and the `resource` parameter.
- Expected: a `401` would include `WWW-Authenticate`, because that is how most clients find the metadata URL.
- Actual: the QuickStart says not to send `WWW-Authenticate`, and says dynamic client registration is unsupported. Both are test-covered here. They are easy to "fix" by accident.
- Severity: important.
- Workaround: follow the QuickStart literally, and test that the header is absent.
- Suggestion: publish one example `401` response and one example metadata document, including the client-id registration step for developers who cannot use the CLI.

### 3. The 500 ms budget and a cold weather call

- Task: answer "when should I run the washing machine?" for Kyiv from a cold process.
- Steps: `npm run demo` on 18 October 2026.
- Expected: a round trip under 500 ms, as the QuickStart requires.
- Actual: `remember_solar_site` took 481 ms. The cold `best_time_for_appliance` took 869 ms. After the cache filled, `forecast_pv_production` took 35 ms and a repeat took 38 ms.
- Severity: important.
- Workaround: in-memory cache, 30 minutes for forecasts and 7 days for PVGIS, with forecast and PVGIS fetched in parallel. Optional DynamoDB for the same cache across Lambda cold starts.
- Suggestion: count the budget from cache-warm traffic, or publish a timeout and a stale-while-revalidate pattern for tools whose data comes from outside Amazon.

### 4. AWS credits were already gone

- Task: deploy the Lambda and DynamoDB path for the AWS Builder mini-challenge.
- Steps: read the resources page, then implement the handler, the DynamoDB store, and the SAM template.
- Expected: promotional credits were offered to registered participants.
- Actual: the resources page says that as of 7 October 2026 the credit codes were exhausted and requests were closed. This environment had no AWS credentials, so the stack was not deployed.
- Severity: annoying.
- Workaround: code, template, and a unit test of the DynamoDB item shape. Documented as not deployed.
- Suggestion: keep a small credit pool for the last two weeks, or judge the mini-challenge on a deploy log only when credits exist.

### 5. PVGIS cannot be called from the browser

- Task: show a typical-year number next to the forecast.
- Steps: read the PVGIS non-interactive API page and call `PVcalc` from the server.
- Expected: a browser chart could call PVGIS directly.
- Actual: the JRC page says AJAX access is not allowed and asks developers not to request a CORS change.
- Severity: low.
- Workaround: the MCP server calls PVGIS. The browser only talks to `/mcp`.
- Suggestion: none for JRC. For the hackathon docs, one sentence that some science APIs must be proxied would save a failed front end.
