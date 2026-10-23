# Friction log: Sol Solar (Amazon Developer Hackathon 2026)

The full log, with task, steps, expected, actual, severity, workaround, and suggestion for each entry, is in [docs/SUBMISSION.md](docs/SUBMISSION.md#friction-log). Short version:

1. **Alexa+ linking is closed to participants (critical).** The `alexa-ai` CLI, MCP toolkit, and web simulator are partner-only, per the hackathon FAQ. Workaround: a browser MCP client and the OAuth surface the QuickStart lists.
2. **OAuth discovery differs from ordinary resource servers (important).** No `WWW-Authenticate` on `401`, no dynamic client registration, a required `resource` parameter. Easy to "fix" by accident, so it is test-covered.
3. **500 ms budget vs. a cold science API (important).** Cold forecast + PVGIS: 869 ms. Cached: 35 ms.
4. **AWS deploy did not happen (important).** Credit codes were exhausted on 7 October 2026. The AWS account opened during the hackathon went under review before anything was deployed and is now closed. Lambda + DynamoDB code and the SAM template exist and the DynamoDB item shape is unit-tested, but nothing ran on AWS. A sandbox account or credits for participants would have let me run the SAM stack.
5. **PVGIS blocks browser AJAX (low).** The server proxies it.
6. **No public way to see an MCP App on an Alexa+ screen (important, added 23 October).** Amazon's criteria name MCP Apps and cards as creative, but there is no simulator to check how an Echo Show would render a `ui://` resource, what size it gets, or which `hostContext` it sends. I wrote a small host in the browser client to test the card. Suggestion: publish the Alexa+ host's MCP Apps support (display modes, size, theme variables) even before the toolkit opens.
7. **Serverless fallback and MCP sessions (annoying, added 23 October).** Streamable HTTP sessions and the in-memory site store live in one process. On a serverless host a follow-up can land on a fresh instance. The live flow returned `401 invalid_token`. Fixed with a stateless mode: signed OAuth codes, tokens and site ids, and a fresh MCP transport per request.
