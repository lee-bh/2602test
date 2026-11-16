# Worker Diary

A diary feed that anyone can read without signing in. It runs entirely on **Cloudflare Workers** (not Pages), with D1 for entries, R2 for images, and Google OAuth for signing in to write.

## Provision Cloudflare resources

```bash
npm install
npx wrangler d1 create worker-diary
npx wrangler r2 bucket create worker-diary-images
```

The configured D1 database is `leebh-first` (`42bf2fd6-f5d4-4462-a2a6-d28171c8fa1a`). Apply the schema with:

```bash
npx wrangler d1 migrations apply leebh-first --remote
```

Create a Google OAuth **Web application** client. Add both of these authorized redirect URIs (replace the origin):

- `http://localhost:8787/auth/google/callback`
- `https://2602test.<your-subdomain>.workers.dev/auth/google/callback`

The redirect URI must match the deployed host exactly, including the Worker name (`2602test`, as set in `wrangler.toml`).

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
- `GET /api/entries`: public feed of every entry signed with its author's nickname (never the Google name or email); no sign-in needed. Signed-in visitors also get `mine` on their own entries.
- `GET /api/me`, `PUT /api/me`: the signed-in account, and setting its nickname (2-20 letters, digits, spaces, `_ . -`; unique regardless of case). A new account is sent to `/me` to pick one and cannot post until it has. A nickname is set once and cannot be changed.
- `POST /api/entries`, `PUT|DELETE /api/entries/:id`: authenticated; only the author can change an entry.
- `POST /api/entries/:id/comments`, `DELETE /api/comments/:id`: authenticated comments (1-1000 characters), signed with the nickname; only the commenter can delete one. `GET /api/entries` returns each entry's comments, oldest first.
- `GET /api/images/:id`: public for photos attached to an entry; a photo not yet saved with an entry is shown only to its uploader.
- `POST /api/images`, `DELETE /api/images/:id`: authenticated R2 upload and delete.

Images are never public R2 objects: the Worker checks the image is attached to an entry, or belongs to the current user, before streaming it from R2.

## Automatic merge to main

`.github/workflows/auto-merge-claude.yml` merges every push to a `claude/*` branch into `main`, so no pull request is needed. If the merge conflicts, `main` is left as it was and the run shows as failed in the Actions tab.
