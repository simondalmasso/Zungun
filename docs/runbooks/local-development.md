# Local development

Requirements are Node.js 22.16 or newer, Java 17, Android SDK 35 for Android builds, Python 3 and Chromium for browser tests, plus Docker for container checks.

```bash
npm ci
npm run verify:deep
RECEIVER_AUTH_TOKEN=local-development-token-change-before-shared-use npm run start:receiver
```

Container startup:

```bash
docker compose -f infra/local/compose.yaml up --build
```
