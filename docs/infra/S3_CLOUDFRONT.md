# S3 and CloudFront

Quizymode's React SPA is hosted on S3 behind CloudFront.

## Current Role

- S3 stores the built static web assets
- CloudFront serves those assets through the CDN
- CloudFront handles SPA route fallback behavior for browser deep links

## Operational Notes

- Deploy the web app with [scripts/deploy-to-s3.ps1](../../scripts/deploy-to-s3.ps1).
- Because the SPA uses `BrowserRouter`, configure CloudFront custom error handling so deep-link misses return `index.html`.
- Required fallback behavior:
  - `403 -> /index.html` with HTTP `200`
  - `404 -> /index.html` with HTTP `200`
- Without that fallback, direct reloads of non-root routes can return the S3 `AccessDenied` page instead of the app shell.

## Private media bucket (uploaded pictures, #399)

Uploaded pictures use a **separate private bucket, `quizymode-media-prod`**, never `quizymode-web`. The web bucket is synced with `--delete` on every deploy and CloudFront rewrites its 403 and 404 responses to `/index.html`, so anything uploaded there would be deleted or masked. The API reads and writes the media bucket itself and serves pictures through `GET /media/images/{id}/content` (AC 3.24.6); there is no CloudFront distribution, CORS rule or public URL for it. Until these steps are done and the Lightsail variables below are set, the feature answers 503 (AC 3.24.8).

Run these as an AWS administrator (not the API user). Replace nothing: the names are fixed by AC 7.7. Put the JSON files in any temporary folder and run the commands from there. No secret appears in this section.

### 1. Create the bucket (us-east-1) with all public access blocked

```bash
aws s3api create-bucket --bucket quizymode-media-prod --region us-east-1
aws s3api put-public-access-block --bucket quizymode-media-prod \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket quizymode-media-prod \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
```

(`create-bucket` in `us-east-1` takes no `LocationConstraint`. Versioning stays off: do not enable it.)

### 2. Default encryption: SSE-S3 with the bucket key

```bash
aws s3api put-bucket-encryption --bucket quizymode-media-prod \
  --server-side-encryption-configuration file://encryption.json
```

`encryption.json`:

```json
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" },
      "BucketKeyEnabled": true
    }
  ]
}
```

### 3. Bucket policy: TLS only, and no overwrites

```bash
aws s3api put-bucket-policy --bucket quizymode-media-prod --policy file://bucket-policy.json
```

`bucket-policy.json` (the second statement denies any `PutObject` that does not send `If-None-Match`, so even the API's own credentials cannot replace an existing picture; the API always sends `If-None-Match: *`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::quizymode-media-prod", "arn:aws:s3:::quizymode-media-prod/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "DenyPutWithoutIfNoneMatch",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::quizymode-media-prod/*",
      "Condition": { "Null": { "s3:if-none-match": "true" } }
    }
  ]
}
```

### 4. Lifecycle: abort incomplete multipart uploads after 1 day

```bash
aws s3api put-bucket-lifecycle-configuration --bucket quizymode-media-prod \
  --lifecycle-configuration file://lifecycle.json
```

`lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

### 5. IAM user for the API with a minimal inline policy

```bash
aws iam create-user --user-name quizymode-api-media
aws iam put-user-policy --user-name quizymode-api-media --policy-name quizymode-media-put-get \
  --policy-document file://api-media-policy.json
aws iam create-access-key --user-name quizymode-api-media
```

`api-media-policy.json` (put and get on `normalized/*` only: no list, no delete, no ACLs):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PutGetNormalizedPictures",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::quizymode-media-prod/normalized/*"
    }
  ]
}
```

`create-access-key` prints the access key id and the secret **once**. Copy them straight into the Lightsail console (next section); do not paste them into a chat, an issue, a commit or a file in the repository.

### 6. Verify the bucket (no picture needed)

```bash
aws s3api get-public-access-block --bucket quizymode-media-prod
aws s3api get-bucket-encryption --bucket quizymode-media-prod
: > probe.txt   # an empty local file
aws s3api put-object --bucket quizymode-media-prod --key normalized/v1/probe.txt --body probe.txt   # expect AccessDenied from the bucket policy (no If-None-Match)
curl -s -o /dev/null -w "%{http_code}\n" https://quizymode-media-prod.s3.amazonaws.com/normalized/v1/anything.webp   # expect 403
```

After the first real upload (see LIGHTSAIL.md), `aws s3api head-object --bucket quizymode-media-prod --key <objectKey>` should show `ServerSideEncryption: AES256`, and an unauthenticated `curl` of the same object URL must answer 403.

### Accepted deviations

One principal (the API IAM user) both writes and reads `normalized/*`, using long-lived access keys, because the Lightsail container has no IAM role. The keys live in the Lightsail deployment environment, which the deploy role can read and the deploy workflow copies to the runner's temporary `env.json`. See AC 7.7.3 and AC 3.24.10 for the full list.
