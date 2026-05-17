# Remote Deployment Notes

SayNext currently supports two operating modes behind one stable Mentra URL:

```text
https://saynext.167.172.153.109.sslip.io
```

## Current Two-Mode Setup

### Local Mode

Use this most of the time to save money.

```text
MentraOS -> VPS Caddy -> VPS frps -> local frpc -> local SayNext -> local Ollama
```

Requirements on the local Windows machine:

```powershell
cd D:\SayNext
$env:Path += ";C:\Users\Admin\.bun\bin"
bun run dev

$env:Path += ";$env:LOCALAPPDATA\Programs\Ollama"
ollama serve

Start-Process "$env:USERPROFILE\.saynext\frp\frpc.exe" `
  -ArgumentList "-c `"$env:USERPROFILE\.saynext\frp\frpc.toml`"" `
  -WindowStyle Hidden
```

Switch the VPS to local mode:

```bash
ssh root@167.172.153.109
saynext-local-mode
saynext-mode-status
```

### Travel Mode

Use this when the local computer is not available.

```text
MentraOS -> VPS Caddy -> VPS SayNext -> OpenAI API
```

Switch the VPS to travel mode:

```bash
ssh root@167.172.153.109
saynext-travel-mode
saynext-mode-status
```

Switch back when local is available:

```bash
saynext-local-mode
```

The VPS has a 1 GB swap file so the 512 MB Droplet can run the Bun app more safely.

## VPS Services

```bash
systemctl status caddy
systemctl status frps
systemctl status saynext
```

In local mode:

```text
frps: active
saynext: inactive
caddy -> 127.0.0.1:8080
```

In travel mode:

```text
frps: inactive
saynext: active
caddy -> 127.0.0.1:3000
SAYNEXT_RUNTIME_MODE=travel
LLM_PROVIDER=openai
session memory extraction -> synchronous OpenAI
batch -> disabled
```

Check public health:

```powershell
curl.exe --ssl-no-revoke https://saynext.167.172.153.109.sslip.io/api/health
```

## Local/VPS Database Sync

Use one database as the source of truth at a time:

```text
At home: Local is the main database.
During travel: VPS is the main database.
Sync before switching.
Do not let both sides write new transcript or memory at the same time.
```

Update VPS code after pushing to GitHub:

```powershell
cd D:\SayNext
.\scripts\update-vps-code.ps1
```

Switch from Local main database to VPS main database before travel:

```powershell
cd D:\SayNext
.\scripts\sync-local-to-vps.ps1 -SwitchToTravelMode
```

Switch from VPS main database back to Local main database after travel:

```powershell
cd D:\SayNext
.\scripts\sync-vps-to-local.ps1 -SwitchToLocalMode
```

## Old Full Remote Ollama Plan

This deployment removes ngrok/local tunnel from the runtime path.

Target shape:

```text
MentraOS -> https://your-domain.com -> VPS/Docker -> SayNext -> Ollama
                                      -> SQLite persistent volume
```

## Server Requirements

Minimum for `qwen2.5:14b-instruct`:

- Docker and Docker Compose
- 16 GB RAM minimum, 24 GB+ recommended
- GPU strongly recommended for realtime use
- Persistent disk for SQLite and Ollama model data

CPU-only can work, but realtime replies may be slow.

## First Deploy

```bash
git clone https://github.com/Clsrwalker/SayNext.git
cd SayNext
cp .env.production.example .env
```

Edit `.env`:

```env
PACKAGE_NAME=com.xiangli.saynext.dev
MENTRAOS_API_KEY=...
COOKIE_SECRET=...
OLLAMA_MODEL=qwen2.5:14b-instruct
PIPELINE_OLLAMA_MODEL=qwen2.5:14b-instruct
PERSONALIZATION_PIPELINE_ENABLED=false
SAYNEXT_DB_PATH=/data/saynext.sqlite
```

Start services:

```bash
docker compose up -d --build
```

Pull the model into the remote Ollama volume:

```bash
docker compose exec ollama ollama pull qwen2.5:14b-instruct
```

Check health:

```bash
curl http://localhost:3000/api/health
```

## Persistent Volumes

The compose file creates:

- `saynext_data`: SQLite database at `/data/saynext.sqlite`
- `ollama_data`: Ollama model files at `/root/.ollama`

Do not store SQLite in the container filesystem. It will disappear when the container is recreated.

## Mentra Console

Set Server URL / Public URL to your HTTPS domain:

```text
https://your-domain.com
```

Do not include `/webview`. MentraOS will use:

```text
https://your-domain.com/webview
```

## HTTPS

Use Caddy, Nginx, Traefik, or a cloud load balancer to terminate HTTPS.

Example Caddyfile:

```caddy
your-domain.com {
  reverse_proxy localhost:3000
}
```

## Update Deployment

```bash
git pull
docker compose up -d --build
```

If the model is already in `ollama_data`, it does not need to be pulled again.
