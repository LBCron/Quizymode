# GitHub Actions Deployment

CI (`ci.yml`) builds, tests, and pushes the Docker image to GHCR on every merge to `main`.
A separate deploy workflow (`deploy.yml`) then deploys the container to LightSail and the UI to S3/CloudFront.

## How it works

1. **CI completes** on `main` → image pushed to `ghcr.io/yanis-kr/quizymode:<sha>`
2. **`deploy-container` job** — reads env vars from the currently active LightSail deployment, then creates a new deployment with the updated image. Waits up to 10 minutes for `ACTIVE` state.
3. **`deploy-ui` job** — rebuilds the frontend and syncs to S3 with per-type cache headers, then invalidates CloudFront.

## AWS OIDC setup (one-time)

GitHub Actions authenticates to AWS via OIDC — no long-lived keys stored in secrets.

### 1. Create the Identity Provider

In **IAM → Identity providers → Add provider**:

| Field | Value |
|---|---|
| Provider type | OpenID Connect |
| Provider URL | `https://token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |

Click **Get thumbprint**, then **Add provider**.

### 2. Create the IAM Role

In **IAM → Roles → Create role**:

| Field | Value |
|---|---|
| Trusted entity | Web identity |
| Identity provider | `token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |
| GitHub organization | `yanis-kr` |
| GitHub repository | `Quizymode` |
| GitHub branch | `main` |

Name the role `github-actions-quizymode-deploy` and create it.

### 3. Attach inline permissions policy

Open the created role → **Permissions → Add permissions → Create inline policy** → JSON editor:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LightSailDeploy",
      "Effect": "Allow",
      "Action": [
        "lightsail:CreateContainerServiceDeployment",
        "lightsail:GetContainerServiceDeployments"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Deploy",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::quizymode-web",
        "arn:aws:s3:::quizymode-web/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "*"
    }
  ]
}
```

Name the policy `quizymode-deploy-policy`.

### 4. Add GitHub secret

In the repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the role created above (e.g. `arn:aws:iam::123456789012:role/github-actions-quizymode-deploy`) |

## LightSail configuration preserved across deployments

The deploy workflow fetches env vars from the currently active deployment via `get-container-service-deployments`, so values configured in the LightSail console are preserved. Only the image tag changes.

Current container env vars (values stored in LightSail, not in GitHub):

- `APP_Authentication__Cognito__ClientId`
- `APP_Authentication__Cognito__Audience`
- `APP_Authentication__Cognito__Authority`
- `APP_ConnectionStrings__PostgreSQL`
- `APP_Gemini__ApiKey` / `APP_Groq__ApiKey` / `APP_Cerebras__ApiKey` / `APP_OpenRouter__ApiKey` / `APP_OpenAI__ApiKey` (study-guide LLM vendors, #464; a vendor without a key is skipped). `APP_DeepSeek__*` is no longer read and can be removed. Optional: `APP_{Vendor}__BaseUrl`, `APP_{Vendor}__MaxTokens` (Groq defaults to 4000).
- `APP_GrafanaCloud__ApiKey`
- `APP_GrafanaCloud__Enabled`
- `APP_GrafanaCloud__LokiInstanceId`
- `APP_GrafanaCloud__LokiEndpoint`
- `APP_GrafanaCloud__OtlpEndpoint`
- `APP_GrafanaCloud__OtlpInstanceId`
- `APP_Turnstile__Enabled` (`true` in prod) and `APP_Turnstile__SecretKey` (Cloudflare secret; the public site key is `VITE_TURNSTILE_SITE_KEY` in `src/Quizymode.Web/.env.production`)
- `ASPNETCORE_ENVIRONMENT`

## Related docs

- [LIGHTSAIL.md](./LIGHTSAIL.md)
- [S3_CLOUDFRONT.md](./S3_CLOUDFRONT.md)
