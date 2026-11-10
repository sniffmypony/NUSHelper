# Security

## Reporting a vulnerability

Please report security problems **privately**: on GitHub, open this repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do. You'll get a reply as soon as possible.

## Never share secrets

Never paste a bot token, API key, Canvas token, database URL, Google key or `.env` contents into an issue, pull request or chat. If you exposed one, revoke it first (BotFather `/revoke`, your AI provider's dashboard, Canvas **Account → Settings**, Supabase password reset, Google Cloud key deletion), then update it in Vercel.

## How the bot protects you

- Webhook requests must carry a secret derived from the bot token; forged updates are rejected.
- Only the configured owner, in a private chat, can use the bot.
- Deletions need an explicit **Delete** tap.
- Secrets are read from environment variables and never logged.
