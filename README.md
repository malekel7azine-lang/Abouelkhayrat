# MCP Media Generator

A Next.js application that exposes image/video generation and media-management tools through an MCP Streamable HTTP endpoint, with an Arabic RTL administration dashboard.

## Status

Initial repository scaffold. Provider integrations, database migrations, security hardening, and deployment validation are implemented in subsequent commits.

## Stack

- Next.js App Router + TypeScript
- Model Context Protocol SDK (Streamable HTTP)
- Turso / libSQL
- Tailwind CSS

## Required environment variables

See [`.env.example`](./.env.example). Never commit API keys, database tokens, or access tokens.

## Local development

```bash
npm install
npm run dev
```

## MCP endpoint

`/mcp`

## Deployment

Deploy to Vercel after configuring the environment variables listed in `.env.example`.