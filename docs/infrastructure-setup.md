# Infrastructure Setup: Content Curation Pipeline

Manual steps required before the curation pipeline can run end-to-end. Do these in order.

---

## 1. Supabase — Enable pgvector

pgvector ships with Supabase but must be activated per project.

1. Open your Supabase project → **SQL Editor**
2. Run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Verify:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```
   Should return one row.

> **Local dev:** The Aspire Docker PostgreSQL image does not include pgvector by default. Change the image in `src/Quizymode.Api.AppHost/` from `postgres:latest` to `pgvector/pgvector:pg17`. Then run `dotnet run` in AppHost to rebuild the container.

---

## 2. AWS S3 — Study Guide Bucket

### Create the bucket

```bash
aws s3api create-bucket \
  --bucket quizymode-study-guides-prod \
  --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1
```

For staging: repeat with `quizymode-study-guides-staging`.

### Block all public access

```bash
aws s3api put-public-access-block \
  --bucket quizymode-study-guides-prod \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### CORS — allow presigned PUT uploads from the browser

Create `s3-cors.json`:
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-production-domain.com"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["Content-Type", "Content-Length"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

Replace `your-production-domain.com` with your actual frontend origin. For staging, add that origin to `AllowedOrigins` as a second entry.

```bash
aws s3api put-bucket-cors \
  --bucket quizymode-study-guides-prod \
  --cors-configuration file://s3-cors.json
```

### Lifecycle rule — auto-delete raw files after 1 day

Create `s3-lifecycle.json`:
```json
{
  "Rules": [
    {
      "ID": "delete-processed-guides",
      "Status": "Enabled",
      "Filter": { "Prefix": "study-guides/" },
      "Expiration": { "Days": 1 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket quizymode-study-guides-prod \
  --lifecycle-configuration file://s3-lifecycle.json
```

---

## 3. AWS SQS — Content Request Queue

### Create the queue

```bash
aws sqs create-queue \
  --queue-name quizymode-content-requests-prod \
  --attributes '{
    "VisibilityTimeout": "360",
    "MessageRetentionPeriod": "345600",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'
```

Settings explained:
- `VisibilityTimeout`: 360 seconds (6 × 60s Lambda timeout — prevents duplicate processing)
- `MessageRetentionPeriod`: 4 days (345,600 seconds)
- `ReceiveMessageWaitTimeSeconds`: 20 (long polling — cheaper than short polling)

Note the **Queue URL** from the response — you will need it for environment variables.

### Create a dead-letter queue for failed messages

```bash
aws sqs create-queue \
  --queue-name quizymode-content-requests-prod-dlq

aws sqs set-queue-attributes \
  --queue-url <MAIN_QUEUE_URL> \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"<DLQ_ARN>\",\"maxReceiveCount\":\"3\"}"
  }'
```

Replace `<MAIN_QUEUE_URL>` and `<DLQ_ARN>` with actual values from the previous commands.

---

## 4. AWS IAM — Roles and Policies

### Policy: API service can send to SQS and generate S3 presigned URLs

Create `api-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:GetQueueAttributes"],
      "Resource": "<SQS_QUEUE_ARN>"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::quizymode-study-guides-prod/study-guides/*"
    }
  ]
}
```

```bash
aws iam create-policy \
  --policy-name QuizymodeApiPolicy \
  --policy-document file://api-policy.json
```

Attach this policy to the IAM user or role your API runs as (the existing deployment role used in `deploy.yml` is a good candidate if the API runs on AWS infrastructure).

If running the API on a non-AWS host (e.g., Railway, Render), create an IAM user instead:

```bash
aws iam create-user --user-name quizymode-api-prod
aws iam attach-user-policy \
  --user-name quizymode-api-prod \
  --policy-arn <POLICY_ARN>
aws iam create-access-key --user-name quizymode-api-prod
```

Store the access key and secret — you will not see the secret again.

### Policy: Lambda worker can read SQS, read/delete S3, write to RDS/Supabase, write logs

Create `lambda-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": "<SQS_QUEUE_ARN>"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::quizymode-study-guides-prod/study-guides/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStreams",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/quizymode/*"
    }
  ]
}
```

```bash
aws iam create-role \
  --role-name QuizymodeWorkerLambdaRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam create-policy \
  --policy-name QuizymodeWorkerPolicy \
  --policy-document file://lambda-policy.json

aws iam attach-role-policy \
  --role-name QuizymodeWorkerLambdaRole \
  --policy-arn <POLICY_ARN>
```

---

## 5. AWS SSM Parameter Store — Secrets

Store secrets in SSM rather than environment variables so they are not visible in the Lambda console.

```bash
# Deepseek API key
aws ssm put-parameter \
  --name "/quizymode/prod/deepseek-api-key" \
  --value "sk-..." \
  --type "SecureString"

# Database connection string (Supabase production)
aws ssm put-parameter \
  --name "/quizymode/prod/db-connection-string" \
  --value "Host=...;Database=...;Username=...;Password=..." \
  --type "SecureString"
```

The Lambda worker reads these at startup using `Amazon.SimpleSystemsManagement`.

---

## 6. AWS Lambda — Worker Function

### Deploy the worker

After building `src/Quizymode.Worker/`:

```bash
cd src/Quizymode.Worker
dotnet lambda deploy-function quizymode-worker-prod \
  --function-role QuizymodeWorkerLambdaRole \
  --function-runtime dotnet10 \
  --function-memory-size 512 \
  --function-timeout 300 \
  --region eu-west-1
```

If you do not have the Lambda deploy tool:
```bash
dotnet tool install -g Amazon.Lambda.Tools
```

### Set Lambda environment variables (non-secret config)

```bash
aws lambda update-function-configuration \
  --function-name quizymode-worker-prod \
  --environment 'Variables={
    AWS_REGION_NAME=eu-west-1,
    S3_BUCKET=quizymode-study-guides-prod,
    SSM_PREFIX=/quizymode/prod,
    DEEPSEEK_BASE_URL=https://api.deepseek.com,
    EMBEDDING_MODEL=deepseek-embedding,
    GENERATION_MODEL=deepseek-chat,
    MAX_LAMBDA_CONCURRENCY=5
  }'
```

### Add SQS trigger

```bash
aws lambda create-event-source-mapping \
  --function-name quizymode-worker-prod \
  --event-source-arn <SQS_QUEUE_ARN> \
  --batch-size 5 \
  --maximum-batching-window-in-seconds 30
```

`batch-size 5` means up to 5 content requests are processed per Lambda invocation. `maximum-batching-window-in-seconds 30` waits up to 30 seconds to fill the batch before invoking — reduces cold starts when traffic is low.

### Set reserved concurrency (cost control)

```bash
aws lambda put-function-concurrency \
  --function-name quizymode-worker-prod \
  --reserved-concurrent-executions 5
```

This caps concurrent Lambda invocations at 5. At 300s timeout and 5 concurrent = max 1 invocation per minute per slot. Adjust upward only if the queue backlog grows.

---

## 7. API Environment Variables

Add these to your API hosting environment (production secrets / Railway / Render / whatever you use):

```
Aws__Region=eu-west-1
Aws__SqsQueueUrl=https://sqs.eu-west-1.amazonaws.com/<account>/<queue-name>
Aws__StudyGuideBucket=quizymode-study-guides-prod
Aws__AccessKeyId=<from IAM user if not using role>
Aws__SecretAccessKey=<from IAM user if not using role>
```

For **local development**, omit `Aws__SqsQueueUrl` entirely. The `IContentRequestQueue` implementation returns without error when the URL is missing, so the API starts and all endpoints work except actual job dispatch.

---

## 8. LLM Vendor Accounts (study-guide generation, #464)

DeepSeek is no longer used. The API calls these OpenAI-compatible vendors in route order (AC 5.12, AC 6.6.12) and skips any vendor without a key. Set keys as Lightsail container env vars (`APP_{Vendor}__ApiKey`, see `docs/infra/GITHUB_ACTIONS_DEPLOY.md`) or locally as user secrets / env vars (`{Vendor}:ApiKey` or `{VENDOR}_API_KEY`). Never commit or paste keys.

| Vendor | Console | Free tier | Default model |
|---|---|---|---|
| Gemini | [aistudio.google.com](https://aistudio.google.com) | Flash / Flash-Lite free tier (Google may use free-tier prompts) | `gemini-3.5-flash-lite` |
| Groq | [console.groq.com](https://console.groq.com) | Free, no card; ~1K requests/day, 8K tokens/min | `openai/gpt-oss-120b` |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai) | Free trial tier, ~1M tokens/day | `gpt-oss-120b` |
| OpenRouter | [openrouter.ai](https://openrouter.ai) | `:free` models, 50 requests/day (1,000/day after $10 of credits) | `google/gemma-4-31b-it:free` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | Paid | `gpt-5-nano` |

OpenRouter: in **Settings → Privacy**, keep "allow providers that may train on inputs" and "publish prompts" off.

---

## 9. Local Development Without AWS

To run the full pipeline locally without AWS:

1. Use `pgvector/pgvector:pg17` Docker image (see step 1)
2. Set `Aws__SqsQueueUrl` to empty — API skips enqueue silently
3. Invoke the Lambda handler directly via a test harness or by temporarily wiring `IContentRequestQueue` to call the pipeline in-process on a background thread
4. Or use [LocalStack](https://localstack.cloud) to emulate SQS and S3 locally:

```bash
# Install
pip install localstack
localstack start -d

# Create local SQS queue
awslocal sqs create-queue --queue-name quizymode-content-requests-local

# Create local S3 bucket
awslocal s3 mb s3://quizymode-study-guides-local
```

Set `Aws__SqsQueueUrl` to the LocalStack SQS endpoint (`http://localhost:4566/000000000000/quizymode-content-requests-local`) and set `AWS_ENDPOINT_URL=http://localhost:4566` for the Lambda when testing locally.

---

## Summary Checklist

- [ ] pgvector extension enabled in Supabase
- [ ] Local Aspire Postgres image changed to `pgvector/pgvector:pg17`
- [ ] S3 bucket created with public access blocked
- [ ] S3 CORS configured for your frontend origin
- [ ] S3 lifecycle rule set (1-day expiry on `study-guides/`)
- [ ] SQS queue created with correct visibility timeout and DLQ
- [ ] IAM API policy created and attached to API service principal
- [ ] IAM Lambda role created with SQS + S3 + SSM + logs permissions
- [ ] LLM vendor keys (Gemini, Groq, Cerebras, OpenRouter, OpenAI) set as Lightsail env vars
- [ ] Database connection string stored in SSM Parameter Store
- [ ] Lambda function deployed with correct role, memory (512MB), timeout (300s)
- [ ] SQS trigger configured on Lambda (batch size 5, window 30s)
- [ ] Lambda reserved concurrency set to 5
- [ ] API environment variables set in production hosting
