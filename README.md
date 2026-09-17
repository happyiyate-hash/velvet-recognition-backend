# Velvet Recognition Backend

Serverless recognition backend for Velvet Music. The Android app uploads one audio clip to the backend; the backend sends the same clip to AudD and ACRCloud in parallel and returns both provider results.

## Endpoint

`POST /v1/recognition/batch`

Request: `multipart/form-data` with exactly one file field named `audio`.

Maximum audio size: 5 MB.

The response includes:

- `requestId`
- `results.audd`
- `results.acrcloud`
- provider status: `matched`, `no_match`, or `error`
- confidence
- normalized song metadata
- provider links when available
- `trace`

The Android app remains responsible for comparing the two matched results and deciding which metadata to present. The top-level `song` field is retained only for compatibility with older clients.

## Environment variables

Configure these in Vercel Project Settings → Environment Variables. Do not commit real values to GitHub.

- `AUDD_API_TOKEN`
- `ACRCLOUD_HOST`
- `ACRCLOUD_ACCESS_KEY`
- `ACRCLOUD_ACCESS_SECRET`

For ACRCloud, use the host assigned to the Velvet project. The example file contains the current host discussed for this project.

## Deploy

Import this GitHub repository into Vercel. Vercel will install dependencies and deploy the function under `api/v1/recognition/batch.ts`.

The `vercel.json` rewrite keeps the public API contract at `/v1/recognition/batch`.

After deployment, test:

`POST https://YOUR-VERCEL-DOMAIN/v1/recognition/batch`

Do not put AudD or ACRCloud credentials in the Android application.
