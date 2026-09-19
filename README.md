# Worker Diary

A private diary that runs entirely on **Cloudflare Workers** (not Pages), with D1 for entries, R2 for images, and Google OAuth for sign-in.

## Provision Cloudflare resources

```bash
npm install
npx wrangler d1 create worker-diary
npx wrangler r2 bucket create worker-diary-images
```

Copy the D1 `database_id` to `wrangler.toml`, then apply the schema:

```bash
npx wrangler d1 migrations apply worker-diary --remote
```

Create a Google OAuth **Web application** client. Add both of these authorized redirect URIs (replace the origin):

- `http://localhost:8787/auth/google/callback`
- `https://your-worker.your-subdomain.workers.dev/auth/google/callback`

Set the Worker secrets. `SESSION_SECRET` should be a cryptographically random value at least 32 characters long.

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

For local development, put those values in `.dev.vars`, then run:

```bash
npm run dev
```

Deploy as a Worker with:

```bash
npm run deploy
```

## Routes

- `GET /auth/google` and `GET /auth/google/callback`: Google OAuth PKCE sign-in flow.
- `POST /auth/logout`: signed-session logout.
- `GET|POST /api/entries`, `PUT|DELETE /api/entries/:id`: authenticated diary CRUD.
- `POST /api/images`, `GET /api/images/:id`, `DELETE /api/images/:id`: authenticated R2 uploads and image delivery.

Images are never public R2 objects: the Worker checks the current user owns the image before streaming it from R2.
