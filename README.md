# Velvet Recognition Backend

Serverless recognition and playback backend for Velvet Music, deployed on Vercel.

## Endpoints

- `POST /v1/recognition/batch` — identifies recorded/background music through AudD and ACRCloud.
- `POST /v1/recognition/test` — backend test endpoint.
- `POST /v1/playback/resolve` — resolves a recognized song to a currently playable SoundCloud stream without exposing SoundCloud credentials to Android.

### Playback request

JSON body:

```json
{
  "artist": "Artist Name",
  "title": "Song Title",
  "isrc": "optional",
  "durationMs": 210000
}
```

The backend searches SoundCloud for a playable track, verifies the artist/title and optional ISRC/duration, then asks SoundCloud for a stream URL. Temporary stream URLs are returned to the Android player and are not persisted.

## Environment variables

Configure these in Vercel Project Settings → Environment Variables. Never commit real values.

### Recognition

- `AUDD_API_TOKEN`
- `ACRCLOUD_HOST`
- `ACRCLOUD_ACCESS_KEY`
- `ACRCLOUD_ACCESS_SECRET`

### SoundCloud

- `SOUNDCLOUD_CLIENT_ID`
- `SOUNDCLOUD_CLIENT_SECRET`

SoundCloud credentials remain server-side.

### Shared token cache

This Vercel backend uses Upstash Redis through the Vercel Marketplace for the SoundCloud client-credentials token.

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

The SoundCloud access token is cached for 3300 seconds. A short Redis lock prevents concurrent Vercel instances from refreshing the same token at the same time. No SoundCloud token is placed in the Android app.

Vercel's current storage path is Marketplace Redis/Upstash; the old Vercel KV product is no longer used.

## Deploy

Import this GitHub repository into Vercel. Vercel will install dependencies and deploy the functions under `api/`.

The `vercel.json` rewrites preserve the public API paths:

- `/health`
- `/v1/recognition/test`
- `/v1/recognition/batch`
- `/v1/playback/resolve`

After connecting the project to Vercel, add the environment variables above and connect Upstash Redis from the Vercel Marketplace so `KV_REST_API_URL` and `KV_REST_API_TOKEN` are injected.

Do not put AudD, ACRCloud, SoundCloud, or Redis credentials in the Android application.
