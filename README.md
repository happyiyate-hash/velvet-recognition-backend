# Velvet Recognition Backend

Serverless song-recognition backend for Velvet Music, deployed on Vercel.

## Endpoints

- `POST /v1/recognition/batch` — identifies recorded/background music through AudD and ACRCloud.
- `POST /v1/recognition/test` — backend test endpoint.

The backend receives recognition audio, sends it to the configured recognition providers, and returns the recognition result to the Android app. It does not resolve playback sources, stream music, use SoundCloud, or access Redis/storage for playback.

## Environment variables

Configure these in Vercel Project Settings → Environment Variables. Never commit real values.

### Recognition

- `AUDD_API_TOKEN`
- `ACRCLOUD_HOST`
- `ACRCLOUD_ACCESS_KEY`
- `ACRCLOUD_ACCESS_SECRET`

Do not put provider credentials in the Android application.

## Deploy

Import this GitHub repository into Vercel. Vercel will install dependencies and deploy the functions under `api/`.

The `vercel.json` rewrites preserve the public API paths:

- `/health`
- `/v1/recognition/test`
- `/v1/recognition/batch`
