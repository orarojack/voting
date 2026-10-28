# VoteRight – invite-only voting platform

A complete online voting platform where **only email addresses added by the admin can vote**.
The admin sets up the positions (Chairperson, Secretary, Treasurer, …), adds the aspirants vying
for each one (photo, name, tagline), registers the voters, opens and closes the vote, and publishes results.

The look follows the designs in `design-references/`: teal palette, Poppins type, a podium
for the top three, laurel ranks, check-circle vote buttons with "Vote for this!" hover pills, and the
"You voted!" confirmation.

## Quick start

Requires **Node.js 22.13+**. It uses the built-in `node:sqlite`, so there is nothing to compile.

```bash
npm install
cp .env.example .env      # then edit ADMIN_EMAIL / ADMIN_PASSWORD
npm start
```

- Voter site: http://localhost:3000
- Admin dashboard: http://localhost:3000/admin

## How it works

### Admin (`/admin`)
| Tab | What you can do |
| --- | --- |
| **Overview** | Election status (Draft → Open → Closed), setup checklist, turnout stats |
| **Positions & aspirants** | Add, rename, reorder and delete positions; add aspirants with a photo, name and tagline, and edit or remove them |
| **Voters** | Add one email, paste many at once, or import a CSV/TXT file; filter and search; see who has voted (but never *what* they voted) |
| **Results** | Live podium and ranked tallies for every position, plus turnout |
| **Settings** | Election title and description, results visibility (live / after close / admin only), reset all votes |

### Voters (`/`)
1. Enter their email. If the admin added it, they go straight to the ballot. Otherwise they are turned away.
2. Pick one aspirant per position, review the ballot, and submit. Each email can vote once.
3. Results are shown according to the visibility setting.

> **Note:** there is no email verification, so anyone who knows a registered address can vote with it.
> Use it where voters' emails aren't widely known, or among people you trust.

## Security and integrity

- **Anonymous ballots.** The `votes` table holds only position and aspirant, with random IDs, and has
  no voter reference and no timestamp. Voters are only flagged `has_voted`.
- **One person, one vote.** The vote is recorded in a single transaction that only succeeds if the voter
  hasn't voted yet.
- Session tokens are stored as SHA-256 hashes. Cookies are `HttpOnly` and `SameSite=Lax`,
  and admin and voter sessions are separate.
- Sign-in endpoints are rate-limited. Photo uploads are checked by their file bytes (JPG, PNG, WEBP or GIF,
  max 5 MB).

## Deploying

- Set a strong `ADMIN_PASSWORD` (the server warns if the default is still in use).
- Serve over HTTPS behind a reverse proxy and set `SECURE_COOKIES=true`.
- Back up the `DATA_DIR` folder (`voting.db` + `uploads/`).

## Project layout

```
server.js        Express app and all API routes
db.js            SQLite schema and helpers
config.js        .env loading
public/
  index.html     Voter app (sign-in, ballot, results)
  admin.html     Admin dashboard
  css/style.css  Design system
  js/common.js   Shared UI: modals, toasts, podium, results
  js/voter.js    Voter app logic
  js/admin.js    Admin dashboard logic
```
