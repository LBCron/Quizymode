# Grafana Cloud Setup Guide

This guide explains how to configure OpenTelemetry and logging to send telemetry data from your QuizyMode API to Grafana Cloud.

## Prerequisites

- A Grafana Cloud account (free tier available at https://grafana.com/auth/sign-up/)
- Your Grafana Cloud instance URL (e.g., `https://yaniskr.grafana.net/`)

## Step 1: Get Grafana Cloud Credentials

1. **Log in to Grafana Cloud**

   - Navigate to https://yaniskr.grafana.net/ (or your Grafana Cloud URL)
   - Log in with your credentials

2. **Get Your Instance ID**

   - In Grafana Cloud, go to **My Account** → **Manage** → **Stacks**
   - Your instance ID is displayed in the stack details (usually a numeric value)

3. **Create API Keys**

   **For OTLP (Traces and Metrics):**

   - Go to **Connections** → **Data Sources** → **Add data source**
   - Search for "OpenTelemetry" or "OTLP"
   - Click on it and note the endpoint URL (e.g., `https://otlp-gateway-prod-us-central-0.grafana.net/otlp`)
   - Go to **My Account** → **Security** → **API Keys**
   - Click **Create API Key**
   - Name: `QuizyMode-OTLP`
   - Role: `MetricsPublisher` and `TracesPublisher`
   - Copy the API key (you won't be able to see it again)

   **For Loki (Logs):**

   - Go to **Connections** → **Data Sources** → **Add data source**
   - Search for "Loki"
   - Click on it and note the endpoint URL (e.g., `https://logs-prod-us-central-0.grafana.net/loki/api/v1/push`)
   - Go to **My Account** → **Security** → **API Keys**
   - Click **Create API Key**
   - Name: `QuizyMode-Loki`
   - Role: `LogsPublisher`
   - Copy the API key

## Step 2: Configure the Application

### Option A: Using appsettings.json (Development)

Edit `src/Quizymode.Api/appsettings.json`:

```json
{
  "GrafanaCloud": {
    "Enabled": true,
    "OtlpEndpoint": "https://otlp-gateway-prod-us-central-0.grafana.net/otlp",
    "LokiEndpoint": "https://logs-prod-us-central-0.grafana.net/loki/api/v1/push",
    "InstanceId": "YOUR_INSTANCE_ID",
    "ApiKey": "YOUR_API_KEY"
  }
}
```

**Note:** For production, use environment variables or user secrets instead of storing credentials in `appsettings.json`.

### Option B: Using Environment Variables (Recommended for Production)

Set the following environment variables on your AWS Lightsail instance:

```bash
APP_GrafanaCloud__Enabled=true
APP_GrafanaCloud__OtlpEndpoint=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
APP_GrafanaCloud__LokiEndpoint=https://logs-prod-us-central-0.grafana.net/loki/api/v1/push
APP_GrafanaCloud__InstanceId=YOUR_INSTANCE_ID
APP_GrafanaCloud__ApiKey=YOUR_API_KEY
```

Alternatively, you can use the standard OpenTelemetry environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic BASE64(INSTANCE_ID:API_KEY)
```

Where `BASE64(INSTANCE_ID:API_KEY)` is the base64 encoding of `INSTANCE_ID:API_KEY`.

### Option C: Using User Secrets (Development)

```bash
cd src/Quizymode.Api
dotnet user-secrets set "GrafanaCloud:Enabled" "true"
dotnet user-secrets set "GrafanaCloud:OtlpEndpoint" "https://otlp-gateway-prod-us-central-0.grafana.net/otlp"
dotnet user-secrets set "GrafanaCloud:LokiEndpoint" "https://logs-prod-us-central-0.grafana.net/loki/api/v1/push"
dotnet user-secrets set "GrafanaCloud:InstanceId" "YOUR_INSTANCE_ID"
dotnet user-secrets set "GrafanaCloud:ApiKey" "YOUR_API_KEY"
```

## Step 3: Deploy to AWS Lightsail

### Using Environment Variables

1. **SSH into your Lightsail instance**

2. **Set environment variables** (choose one method):

   **Method 1: Systemd Service File** (Recommended)

   Edit your systemd service file (e.g., `/etc/systemd/system/quizymode-api.service`):

   ```ini
   [Unit]
   Description=QuizyMode API
   After=network.target

   [Service]
   Type=notify
   ExecStart=/usr/bin/dotnet /path/to/Quizymode.Api.dll
   Restart=always
   RestartSec=10
   Environment="APP_GrafanaCloud__Enabled=true"
   Environment="APP_GrafanaCloud__OtlpEndpoint=https://otlp-gateway-prod-us-central-0.grafana.net/otlp"
   Environment="APP_GrafanaCloud__LokiEndpoint=https://logs-prod-us-central-0.grafana.net/loki/api/v1/push"
   Environment="APP_GrafanaCloud__InstanceId=YOUR_INSTANCE_ID"
   Environment="APP_GrafanaCloud__ApiKey=YOUR_API_KEY"

   [Install]
   WantedBy=multi-user.target
   ```

   Then reload and restart:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart quizymode-api
   ```

   **Method 2: Export in Shell Script**

   Create a startup script that exports the variables before running the application:

   ```bash
   #!/bin/bash
   export APP_GrafanaCloud__Enabled=true
   export APP_GrafanaCloud__OtlpEndpoint=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
   export APP_GrafanaCloud__LokiEndpoint=https://logs-prod-us-central-0.grafana.net/loki/api/v1/push
   export APP_GrafanaCloud__InstanceId=YOUR_INSTANCE_ID
   export APP_GrafanaCloud__ApiKey=YOUR_API_KEY

   dotnet /path/to/Quizymode.Api.dll
   ```

   **Method 3: AWS Systems Manager Parameter Store** (More Secure)

   Store secrets in AWS Systems Manager Parameter Store and reference them in your application or systemd service.

### Using appsettings.Production.json

1. Create `src/Quizymode.Api/appsettings.Production.json`:

```json
{
  "GrafanaCloud": {
    "Enabled": true,
    "OtlpEndpoint": "https://otlp-gateway-prod-us-central-0.grafana.net/otlp",
    "LokiEndpoint": "https://logs-prod-us-central-0.grafana.net/loki/api/v1/push",
    "InstanceId": "YOUR_INSTANCE_ID",
    "ApiKey": "YOUR_API_KEY"
  }
}
```

**Warning:** This file should be excluded from source control (add to `.gitignore`) and only deployed securely to your production server.

## Step 4: Verify the Setup

1. **Start your application** and make some API requests

2. **Check Grafana Cloud:**

   **For Logs:**

   - Go to **Explore** → Select **Loki** data source
   - Query: `{application="QuizyMode"}`
   - You should see logs from your application

   **For Metrics:**

   - Go to **Explore** → Select **Prometheus** or **Mimir** data source
   - Query: `http_server_request_duration_seconds` or `dotnet_runtime_*`
   - You should see metrics from your application

   **For Traces:**

   - Go to **Explore** → Select **Tempo** data source
   - Query: `{service.name="Quizymode.Api"}`
   - You should see traces from your application

3. **Check Application Logs:**
   - Verify that the application starts without errors
   - Check that no authentication errors appear in the console logs

## Troubleshooting

### No Data Appearing in Grafana

1. **Verify credentials:**

   - Double-check your Instance ID and API Key
   - Ensure the API keys have the correct roles (MetricsPublisher, TracesPublisher, LogsPublisher)

2. **Check endpoints:**

   - Verify the OTLP and Loki endpoint URLs are correct for your Grafana Cloud region
   - Test connectivity from your Lightsail instance:
     ```bash
     curl -v https://otlp-gateway-prod-us-central-0.grafana.net/otlp
     ```

3. **Check application logs:**

   - Look for OpenTelemetry or Loki connection errors
   - Verify that `GrafanaCloud:Enabled` is set to `true`

4. **Verify environment variables:**
   - Ensure environment variables are set correctly (check with `env | grep GrafanaCloud`)
   - Remember that ASP.NET Core uses double underscores (`__`) for nested configuration

### Authentication Errors

- Verify that your API key is still valid (check expiration in Grafana Cloud)
- Ensure the Instance ID matches your Grafana Cloud stack
- Check that the base64 encoding of `INSTANCE_ID:API_KEY` is correct

### High Costs on Free Tier

- The free tier includes:
  - 50 GB logs/month
  - 10k metrics series
  - 50 GB traces/month
- Monitor your usage in Grafana Cloud dashboard
- Consider filtering out health check endpoints (already configured) and verbose logs

## Security Best Practices

1. **Never commit credentials to source control**

   - Use environment variables or secure secret management
   - Add `appsettings.Production.json` to `.gitignore` if used

2. **Use separate API keys for different environments**

   - Create different API keys for development, staging, and production
   - Rotate API keys regularly

3. **Limit API key permissions**

   - Only grant the minimum required roles (MetricsPublisher, TracesPublisher, LogsPublisher)
   - Don't use admin API keys for application telemetry

4. **Use AWS Systems Manager Parameter Store or Secrets Manager**
   - Store credentials securely in AWS
   - Reference them in your application or systemd service

## Additional Resources

- [Grafana Cloud Documentation](https://grafana.com/docs/grafana-cloud/)
- [OpenTelemetry .NET Documentation](https://opentelemetry.io/docs/instrumentation/net/)
- [Serilog Loki Sink Documentation](https://github.com/serilog/serilog-sinks-grafana-loki)

## Picture operations

The `Quizymode.Media` meter, concrete alert thresholds, privacy-safe labels and release verification are specified in [MEDIA_OPERATIONS.md](MEDIA_OPERATIONS.md). Provisioning candidate rules does not demonstrate deployment; verify exporter names, data-source readback and notification delivery against the reviewed release.
