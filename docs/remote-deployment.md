# Remote Deployment With SQLite + Ollama

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
