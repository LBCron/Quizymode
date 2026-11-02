# AWS Lightsail

AWS Lightsail hosts the Quizymode API container in production.

## Current Role

- Production runtime for the ASP.NET Core API
- Environment-variable based application configuration
- Public API hosting behind the Cloudflare edge

## Operational Notes

- Keep runtime configuration in Lightsail environment variables rather than checked-in appsettings files.
- Cognito and Grafana settings referenced by the API should be supplied through environment variables in the service configuration.
- After deployment changes, verify API health, auth flows, and telemetry export from the running container.

## Related Docs

- [COGNITO_SETUP.md](./COGNITO_SETUP.md)
- [GRAFANA_CLOUD_SETUP.md](./GRAFANA_CLOUD_SETUP.md)
- [GITHUB_ACTIONS_DEPLOY.md](./GITHUB_ACTIONS_DEPLOY.md): automated deployment pipeline

## Media storage settings (uploaded pictures, #399)

The API stores uploaded pictures in the private bucket `quizymode-media-prod` (setup in [S3_CLOUDFRONT.md](./S3_CLOUDFRONT.md)). The Lightsail container has no IAM role, so the API signs in with the access keys of the IAM user `quizymode-api-media`. Add these environment variables to the container in a **new deployment** (Lightsail console: Containers, the API service, Deployments, Modify your deployment, then edit the container's environment). Keep every existing variable: the deploy and rollback workflows copy the environment of the *active* deployment, so variables set once here carry over to later deploys.

| Variable | Value |
| --- | --- |
| `Media__Storage__Provider` | `S3` |
| `Media__S3__BucketName` | `quizymode-media-prod` |
| `Media__S3__Region` | `us-east-1` |
| `Media__S3__AccessKeyId` | the access key id printed by `aws iam create-access-key` |
| `Media__S3__SecretAccessKey` | the secret printed by `aws iam create-access-key` (never commit, paste in chat or log it) |

Notes:

- Without `Media__Storage__Provider=S3` the app uses `None`: media endpoints answer 503 and nothing is written (the default, safe state). A bucket name of `quizymode-web`, or `S3` with no bucket, is refused and logged as an error.
- The names are namespaced (`Media__S3__...`) on purpose, so no `AWS_*` variable is needed and the SDK default credential chain is not involved.
- To rotate the keys: `aws iam create-access-key --user-name quizymode-api-media` for a second key, set the new values in a new deployment, then `aws iam delete-access-key --user-name quizymode-api-media --access-key-id <old id>`.
- After the deployment is active, check `/health`, then upload a small PNG as a signed-in user (`POST /media/images`, multipart field `file`), download it with `GET /media/images/{id}/content` using the same bearer token, and run the `head-object` and unauthenticated `curl` checks from S3_CLOUDFRONT.md.
- Memory: decoding is limited to 16 megapixels and one decode at a time per instance (AC 3.24.9); the SkiaSharp native library is bundled in the image, nothing is installed on the host.
