# AWS deploy notes

This is the AWS Builder path for Sol Solar. It was not deployed. The hackathon resources page said on 7 October 2026 that promotional credit codes were exhausted. The machine that built this repository had no AWS credentials. Nothing below is a claim that a stack is running.

## What the code actually calls

`src/lambda.ts` exports `handler`. It wraps the same Express app as the local server with `serverless-http`, so a Lambda function URL or an HTTP API can serve `/mcp`, the OAuth routes, and the voice page.

`src/dynamoStore.ts` uses `@aws-sdk/client-dynamodb`. `PutItem`, `GetItem`, and `DeleteItem` store:

- forecast and PVGIS cache entries
- OAuth authorization codes
- access tokens

Each item has a numeric `ttl` attribute, epoch seconds. The template turns TTL on for that attribute. Reads also ignore an item whose `ttl` is already past, because DynamoDB TTL deletion is not immediate.

Set `TOKEN_STORE=dynamodb` and `DYNAMODB_TABLE` to switch off the in-memory store. If the table name is missing, the process refuses to start.

## SAM

From the repository root, after `npm run build` and `npm ci`:

```bash
sam build --template-file infra/template.yaml
sam deploy --guided --template-file infra/template.yaml
```

The template creates:

- an on-demand DynamoDB table with hash key `pk` and TTL on `ttl`
- a Node.js 22 ARM Lambda named `sol-solar-mcp`, handler `dist/lambda.handler`, with `DynamoDBCrudPolicy` on that table
- a function URL with `AuthType: NONE`, because the app does its own OAuth

First deploy with `PublicBaseUrl` empty only to learn the function URL. Copy that URL, remove the trailing slash, and deploy again with `PublicBaseUrl` set to it. OAuth metadata and the `resource` value are `${PUBLIC_BASE_URL}/mcp`. Alexa+ will not link if that value does not match the URL it calls.

`NODE_ENV=production` in the template does not add localhost redirect URIs. Add Amazon's client id with `OAUTH_CLIENT_IDS` and its redirect URI with `OAUTH_REDIRECT_URIS` when those values exist. They are not published for hackathon participants.

## App Runner

App Runner can run the Dockerfile. Build and push the image to ECR, then create a service on port 8787. Set `PUBLIC_BASE_URL` to the service's HTTPS origin, and `HOST=0.0.0.0`. No App Runner service was created for this submission.

```bash
docker build -t sol-solar-mcp .
# Retag and push to your ECR repository, then:
aws apprunner create-service --service-name sol-solar-mcp --source-configuration file://your-source.json
```

Replace the source file with the image identifier from your own account. There is no checked-in account id, on purpose.
