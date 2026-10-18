# AWS deploy notes

These steps are a deploy path for the AWS Builder mini-challenge. **They were not executed.** The hackathon build environment had no AWS credentials. Devpost's 7 October 2026 update says the $150 promotional-credit form is closed and codes are exhausted. Nothing in this repository calls a live AWS API.

The running server is a normal Node.js HTTP process. Two hosts fit it:

## App Runner

App Runner runs the default `Dockerfile` as a service. The container already listens on `0.0.0.0:3000` and serves `GET /health`.

```bash
aws ecr create-repository --repository-name sol-solar-mcp
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com
docker build -t sol-solar-mcp .
docker tag sol-solar-mcp:latest ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com/sol-solar-mcp:latest
docker push ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com/sol-solar-mcp:latest
```

Create an App Runner service from that image. Set the port to `3000`, the health check path to `/health`, and the environment variable `HOST=0.0.0.0`. Set `ALLOWED_HOSTS` to the App Runner hostname once you know it, so DNS-rebinding protection stays on. Tear the service down after judging. Judging is 9–20 November 2026, so it does not need to run continuously before then.

`eu-central-1` is a reasonable region for a Kyiv demo because Open-Meteo and PVGIS answer from Europe. It is not required.

## Lambda with the Lambda Web Adapter

`Dockerfile.lambda` copies the [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) into `/opt/extensions` and leaves the same Node process on port 3000. JSON response mode matters here: API Gateway and Function URLs buffer a normal HTTP response, and this server does not hold an SSE stream open.

```bash
docker build -f Dockerfile.lambda -t sol-solar-mcp:lambda .
```

Push that image to ECR and create a container-image Lambda. Suggested settings, not measured on AWS:

- Memory 512 MB
- Timeout 30 seconds, because PVGIS sometimes takes longer than a default 3-second timeout
- Function URL with auth `NONE` only for a demo, or `AWS_IAM` if you do not want a public URL
- Environment: `HOST=0.0.0.0`, `PORT=3000`

A cold start plus a PVGIS call will miss Alexa+'s 500 ms production budget. The in-process cache only helps after the first request on that execution environment. Lambda is still a cheap way to keep an endpoint available during judging, which is the reason the hackathon FAQ suggests it.

## What is not in this repo

No CloudFormation, CDK, Terraform, Bedrock, AgentCore, Strands, SageMaker, or Kiro project is included. Those would be fiction without an account to run them. The mini-challenge asks for AWS services that the project actually uses. Deploying the container above is the integration that would satisfy it. Until that deploy happens, the AWS Builder mini-challenge is **not** met.
