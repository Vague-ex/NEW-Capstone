# Deploying to a Hostinger VPS

End-to-end, from a freshly bought KVM box to HTTPS. Assumes the
`Docker` OS template (Ubuntu with Docker preinstalled).

The database is **not** deployed here. It stays on Supabase.

---

## 0. Choosing the OS template

Hostinger asks once, across three tabs. Pick **one**:

| Tab | Choose |
| --- | --- |
| Plain OS | skip |
| OS with Control Panel | skip |
| **OS with Applications** | **Docker** |

The application templates are Ubuntu underneath, so choosing `Docker`
already gives you Ubuntu. Do **not** pick `Docker and Traefik` — Traefik
is a reverse proxy that binds ports 80 and 443, which is exactly what
Caddy in `docker-compose.yml` needs. The two will fight.

Skip the server control panels (CyberPanel, Plesk, CWP) for the same
reason: they ship their own web server on those ports.

---

## 1. DNS

In hPanel, claim the free domain, then add two A records pointing at the
VPS IP:

| Type | Name  | Value        |
| ---- | ----- | ------------ |
| A    | `@`   | your VPS IP  |
| A    | `api` | your VPS IP  |

Both must resolve **before** you start the stack. Caddy requests a
certificate for each name at boot, and Let's Encrypt fails the challenge
if the name does not yet point here.

Check from your laptop:

```bash
nslookup gradtracer.tech
nslookup api.gradtracer.tech
```

---

## 2. Server prep

SSH in as root, then:

```bash
apt update && apt upgrade -y
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Ports 8000 and 3000 stay closed. Compose binds them to `127.0.0.1`, so
only Caddy is reachable from outside.

---

## 3. Clone and configure

```bash
git clone <your-repo-url> /opt/gradtracer
cd /opt/gradtracer
git checkout RevisedChanges

cp .env.example .env
cp backend/.env.example backend/.env
```

Edit `.env` (used by compose and Caddy):

```
SITE_DOMAIN=gradtracer.tech
ACME_EMAIL=you@example.com
NEXT_PUBLIC_API_URL=https://api.gradtracer.tech
```

Edit `backend/.env`. These are the values that must change from local:

```
DEBUG=False
SECRET_KEY=<generate a new one, do not reuse the dev key>
ALLOWED_HOSTS=gradtracer.tech,api.gradtracer.tech
CORS_ALLOWED_ORIGINS=https://gradtracer.tech
CSRF_TRUSTED_ORIGINS=https://gradtracer.tech,https://api.gradtracer.tech
GRADUATE_LOGIN_URL=https://gradtracer.tech
```

Generate a secret key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Leave the Supabase `DATABASE_URL` / pooler values as they are.

---

## 4. Check migrations before touching the database

The Supabase database is live and already holds real alumni records. Look
before you migrate:

```bash
docker compose --profile prod build
docker compose --profile prod run --rm backend python manage.py showmigrations
```

Only run `migrate` if something shows as unapplied:

```bash
docker compose --profile prod run --rm backend python manage.py migrate
```

---

## 5. Start

```bash
docker compose --profile prod up -d --build
docker compose ps
```

Watch Caddy get its certificates:

```bash
docker compose logs -f caddy
```

`certificate obtained successfully` means TLS is live. If it loops on a
challenge error, DNS has not propagated yet — wait and restart Caddy.

---

## 6. Verify

```bash
curl -I https://gradtracer.tech
curl -I https://api.gradtracer.tech/api/reference/
```

Then in a browser, confirm the parts that need HTTPS:

- Registration face capture prompts for the camera
- Location consent prompts for GPS
- A login POST succeeds (proves CSRF works through the proxy)

If POSTs fail with a CSRF error, `CSRF_TRUSTED_ORIGINS` is missing a
scheme — the entries must start with `https://`.

---

## 7. Email

Sending was previously blocked because there was no domain to verify a
sender against. Now there is one. In Resend, Brevo or SendGrid, add
`gradtracer.tech`, copy the DKIM/SPF records into hPanel DNS, then set
the SMTP values in `backend/.env` and restart:

```bash
docker compose --profile prod up -d
```

Until a domain is verified, most providers only deliver to your own
account address, which is why it looked broken on Vercel.

---

## 8. Updating after a code change

```bash
cd /opt/gradtracer
git pull
docker compose --profile prod up -d --build
```

Rebuild is required when `NEXT_PUBLIC_API_URL` changes — it is compiled
into the frontend bundle, not read at runtime.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Caddy loops on ACME errors | DNS not propagated, or port 80 blocked by ufw |
| Camera / GPS silently unavailable | Page loaded over `http://` or a bare IP, not the domain |
| CSRF failures on every POST | `CSRF_TRUSTED_ORIGINS` missing `https://`, or the proxy header setting was removed |
| Frontend calls `localhost:8000` | Built before `NEXT_PUBLIC_API_URL` was set; rebuild with `--build` |
| `DisallowedHost` in logs | Domain missing from `ALLOWED_HOSTS` |
