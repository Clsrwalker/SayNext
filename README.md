# SayNext

SayNext is a MentraOS miniapp that listens to conversation context and suggests a short, speakable reply for Xiang.

It is optimized for:

- real-time smart glasses replies
- simple spoken English
- interview, classroom, daily chat, and service/advisor contexts
- personal style examples and offline personalization data

## Local Development

```bash
bun install
cp .env.example .env
bun run dev
```

For MentraOS local testing, expose port `3000` through a public HTTPS URL and set that URL in the Mentra Developer Console.

## Required Environment

```env
PORT=3000
PACKAGE_NAME=com.xiangli.saynext.dev
MENTRAOS_API_KEY=your_mentraos_api_key_here
COOKIE_SECRET=replace_with_long_random_secret

LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b-instruct

DATA_LOGGING_ENABLED=true
SAYNEXT_DB_PATH=./data/saynext.sqlite
```

Do not commit `.env`; use `.env.example` or `.env.production.example` as templates.

## Remote Deployment

For deployment without ngrok/local tunneling, use Docker Compose with:

- SayNext app container
- remote Ollama container
- persistent SQLite volume
- persistent Ollama model volume

See [docs/remote-deployment.md](docs/remote-deployment.md).

## Personalization Pipeline

Raw transcripts and AI outputs can be processed by a local/remote Ollama model into:

- cleaned transcript
- segments
- context classification
- event extraction
- output intent
- quality scoring
- pseudo labels
- personal memory candidates

See [docs/personalization-pipeline.md](docs/personalization-pipeline.md).

## Scripts

```bash
bun run dev
bun run start
```

## License

MIT
