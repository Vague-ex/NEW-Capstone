# Running with Docker

```bash
cp backend/.env.example backend/.env     # fill in real values
docker compose up --build
```

- frontend → http://localhost:3000
- backend  → http://localhost:8000

The database stays external (Supabase). Nothing here runs Postgres, so there is
no volume to lose and no container that can wipe your data.

---

## Three things that are easy to get wrong

**1. `NEXT_PUBLIC_API_URL` is baked in at BUILD time.**
Next.js inlines `NEXT_PUBLIC_*` into the bundle during `npm run build`. Setting
it under `environment:` in compose does nothing. To point the frontend at a real
backend you must rebuild:

```bash
NEXT_PUBLIC_API_URL=https://api.your-domain.com docker compose build frontend
```

**2. `DEBUG` must stay `False`.**
`settings.py` defaults `DEBUG` to `True` for local convenience, and when debug is
on `ALLOWED_HOSTS` becomes `["*"]` and Django serves full tracebacks — including
database credentials — to anyone who triggers an error. `docker-compose.yml`
sets `DEBUG: "False"` explicitly so this cannot be inherited by accident. Do not
remove it.

**3. Migrations do not run automatically.**
Deliberate: an auto-migrating container will happily apply a destructive
migration to production on restart. Run them yourself after deploying:

```bash
docker compose exec backend python manage.py migrate
```

---

## Migrating off Render / Vercel

**Email will start working again.** Render blocks outbound SMTP, which is why
Gmail sending fails there. A normal VPS does not, so the existing
`EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` settings work as-is and `RESEND_API_KEY`
becomes optional. If Gmail still fails on a fresh VPS, ask the host whether
port 587 is open on new IPs before touching the code.

**Update these for the new domain** — all are environment variables, no code
change needed:

| Variable | Why it matters |
|---|---|
| `ALLOWED_HOSTS` | Django rejects requests for unlisted hosts |
| `CORS_ALLOWED_ORIGINS` | The browser blocks API calls from an unlisted origin |
| `CSRF_TRUSTED_ORIGINS` | Admin login fails without the new domain |
| `GRADUATE_LOGIN_URL` | **Embedded in employer verification links and email logos.** Stale value = broken verification links |
| `NEXT_PUBLIC_API_URL` | Build arg, see note 1 above |

**Put a reverse proxy in front.** These containers speak plain HTTP. Terminate
TLS at nginx or Caddy on the host and proxy to ports 3000 and 8000. The Django
admin's static files are collected into `/app/staticfiles` inside the backend
image; serve them from nginx or add WhiteNoise if you would rather not.

---

## Verified

- `output: "standalone"` produces `.next/standalone/server.js` plus its own
  `node_modules` — the exact paths the frontend Dockerfile copies.
- `collectstatic` collects 154 files into `STATIC_ROOT`, so the Django admin is
  styled rather than raw HTML.
- Images were **not** built end-to-end in this environment because the Docker
  daemon was not running. Run `docker compose up --build` once before relying
  on it.
