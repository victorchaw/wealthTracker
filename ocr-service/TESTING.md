# Quick test for OCR Service

## Prerequisites
- Service running on http://localhost:3000
- LLAMAPARSE_API_KEY set in .env
- A receipt image file (JPG/PNG) saved locally

## Test script

```bash
# 1. Start the service in one terminal
cd ocr-service
npm start

# 2. In another terminal, run:
curl -X POST http://localhost:3000/scan \
  -F "image=@/path/to/your/receipt.jpg" \
  -H "Accept: application/json"
```

## Expected response (example)

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

## Test with base64 JSON

```bash
# Convert image to base64 (macOS/Linux)
BASE64=$(base64 -i receipt.jpg | tr -d '\n')

curl -X POST http://localhost:3000/scan \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"${BASE64}\"}"
```

## Health check

```bash
curl http://localhost:3000/health
# => {"ok":true}
```
