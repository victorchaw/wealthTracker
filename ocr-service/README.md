# OCR Service — Standalone Receipt Parsing API

A lightweight Node.js microservice that extracts structured data from receipt images using LlamaParse OCR.

## What it does

- Accepts receipt images via `POST /scan` (multipart/form-data or JSON base64)
- Runs OCR via LlamaParse API
- Extracts: amount, merchant, date, suggested category, note
- Returns clean JSON matching the mobile app contract

## Quick start

### 1. Install dependencies

```bash
cd ocr-service
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your LLAMAPARSE_API_KEY
```

Get your LlamaParse API key from: https://cloud.llamaindex.ai/

### 3. Run locally

```bash
npm start
# or in dev mode:
npm run dev
```

Service starts at `http://localhost:3000`

### 4. Test with curl

```bash
# Using multipart/form-data (recommended for file uploads)
curl -X POST http://localhost:3000/scan \
  -F "image=@path/to/receipt.jpg" \
  -H "Accept: application/json"

# Using JSON base64 payload
curl -X POST http://localhost:3000/scan \
  -H "Content-Type: application/json" \
  -d '{"image": "'"$(base64 -i receipt.jpg | tr -d '\n')"'"}'
```

### 5. Health check

```bash
curl http://localhost:3000/health
# {"ok":true}
```

## API Specification

### POST /scan

Accepts:
- `multipart/form-data` with field `image` (JPEG/PNG/WebP/HEIC, max 10MB)
- `application/json` with `{ "image": "<base64-encoded-bytes>" }`

Returns `200 OK`:

```json
{
  "amount": 12.50,
  "merchant": "Blue Bottle Coffee",
  "date": "2026-04-29T10:13:00Z",
  "category": "Food",
  "note": "Blue Bottle Coffee; Latte — 4.50; Croissant — 3.00",
  "currency": "USD",
  "confidence": 0.94
}
```

Field rules:
- `amount`: total receipt amount (required)
- `merchant`: store/vendor name (required if detectable)
- `date`: ISO 8601 string (optional, omitted if unparseable)
- `category`: one of `"Food","Transport","Shopping","Entertainment","Bills","Health","Travel","Salary","Freelance","Investment","Other"` (optional; omitted if not confident)
- `note`: brief description including line items (optional)
- `currency`: ISO 4217 code (optional; currently always `USD`)
- `confidence`: 0.0–1.0 (optional)

Error response (`4xx`/`5xx`):
```json
{ "error": "Human-readable error message" }
```

### GET /health

```json
{ "ok": true }
```

## Deploy

### Render (recommended)
```bash
# Create a new Web Service
# Build command: npm run build
# Start command: npm start
# Add env var: LLAMAPARSE_API_KEY=your_key
```

### Docker

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t ocr-service .
docker run -p 3000:3000 --env LLAMAPARSE_API_KEY=your_key ocr-service
```

### Fly.io
```bash
fly launch
# Select Dockerfile
# Set env: LLAMAPARSE_API_KEY
fly deploy
```

### Replit
1. Create new Node.js repl
2. Upload all files
3. Secrets → add `LLAMAPARSE_API_KEY`
4. Run: `npm start`

## Environment variables

| Name | Required | Description |
|------|----------|-------------|
| `LLAMAPARSE_API_KEY` | Yes | LlamaParse API key from https://cloud.llamaindex.ai/ |
| `PORT` | No | Server port (default: 3000) |
| `MAX_FILE_SIZE` | No | Max upload size in bytes (default: 10485760 = 10MB) |
| `LOG_LEVEL` | No | `debug`/`info`/`warn`/`error` (default: `info`) |

## Limitations

- Stateless — no database, no user accounts
- Single OCR provider (LlamaParse). Switch provider by editing `src/index.ts`.
- Max file size: 10 MB
- Supported formats: JPEG, PNG, WebP, HEIC

## Cost

LlamaParse pricing: ~$0.001–$0.003 per page (free tier available). Check https://llamaindex.ai/pricing

## License

MIT
