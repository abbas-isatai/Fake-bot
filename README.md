# Discord Fake Message Bot

A Discord bot that generates fake Discord message screenshots for pranks.

## Commands

| Command | Description |
|---|---|
| `/fake` | Fake a message from any user |
| `/edited` | Fake an edited message |
| `/react` | Fake a message with emoji reactions |
| `/reply` | Fake a reply to someone |
| `/pcfake` | Same but wider (desktop-style) |
| `/pcedited` | — |
| `/pcreact` | — |
| `/pcreply` | — |

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create a `.env` file**
   ```
   DISCORD_BOT_TOKEN=your_token_here
   ```

3. **Run the bot**
   ```bash
   npm start
   ```

## Getting a Bot Token

1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to **Bot** → copy the token
4. Under **Installation**, set to **User Install** only
5. Add the `applications.commands` scope

## Hosting for free

- [Railway.app](https://railway.app) — connect GitHub repo, add `DISCORD_BOT_TOKEN` env var, done
- [Fly.io](https://fly.io) — free tier available
