# Graduate Tracer System with Predictive Employability Trend Analysis

Carlos Hilado Memorial State University – Talisay Campus · BSIS Program

A Django REST API and Next.js front end that traces BSIS graduate employment
outcomes, verifies identity by face recognition, collects employer confirmation
through one-time links, and reports how well graduates' jobs align with the BSIS
curriculum.

---

## Project structure

| Path | What it is |
|---|---|
| `backend/` | Django 5.2 REST API |
| `frontend/` | Next.js 16 / React 19 app |
| `backend/ml/` | Predictive model: data generation, training, evaluation |
| `documentations/` | DFDs, ERD, use cases, test documentation |
| `Figmanuts/` | Design reference assets |

**Database:** PostgreSQL hosted on Supabase. Nothing runs Postgres locally.

---

## Backend setup

Dependencies are declared in **`backend/requirements.txt`** — that is the file
listing every package the virtual environment needs.

```bash
# 1. Activate the virtual environment
venv\Scripts\activate

# 2. Install dependencies
cd backend
..\venv\Scripts\python.exe -m pip install -r requirements.txt

# 3. Configure environment (never commit this file)
copy .env.example .env

# 4. Apply migrations
..\venv\Scripts\python.exe manage.py migrate

# 5. Run
..\venv\Scripts\python.exe manage.py runserver
```

> **Use `venv\`, not `.venv\`.** Both directories exist. `venv` is the complete
> environment (50 packages); `.venv` is a stale partial one (19 packages) that
> is missing `psycopg2`. Using `.venv` or the system Python fails with
> `No module named 'psycopg2'` even though the package *is* installed — just
> not in the environment you ran.

### Verify which database you are on

The settings fall back to SQLite when `DATABASE_URL` is unset, which silently
invalidates any migration rehearsal. Confirm before trusting a result:

```bash
..\venv\Scripts\python.exe manage.py shell -c "from django.db import connection; print(connection.vendor)"
```

Expect `postgresql`. If it prints `sqlite`, your `.env` is not being read.

### Tests

```bash
cd backend
..\venv\Scripts\python.exe manage.py test users tracer
```

47 tests covering validation, authentication, link verification, alignment
resolution and name parsing. See `documentations/whitebox-testing.txt`.

---

## Frontend setup

```bash
cd frontend
npm install          # postinstall copies the face-recognition model weights
npm run dev
```

Manual fallback if the model weights are missing (PowerShell):

```powershell
cd frontend
if (-not (Test-Path "public/modern-face-models")) { New-Item -ItemType Directory -Path "public/modern-face-models" | Out-Null }
Copy-Item -Path "node_modules/modern-face-api/weights/*" -Destination "public/modern-face-models" -Recurse -Force
```

Checks:

```bash
npx tsc --noEmit     # type safety
npm run lint
npm run build
```

---

## Running with Docker

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

Front end on `:3000`, API on `:8000`. See **`DOCKER.md`** — particularly that
`NEXT_PUBLIC_API_URL` is baked in at build time and that migrations do not run
automatically.

---

## Machine learning pipeline

```bash
cd backend
..\venv\Scripts\python.exe ml/scripts/1_generate_synthetic_data.py
..\venv\Scripts\python.exe ml/scripts/2_train_models.py
..\venv\Scripts\python.exe ml/scripts/3_evaluate_models.py
```

> The model is trained on **synthetic data** and applied to real graduates for
> comparison. It has never been fitted on real outcomes — there are too few of
> them for 30 features. The analytics page states this on screen, and it should
> be stated in any write-up too.

---

## Deployment

Currently front end on Vercel, API on Render, database on Supabase.

**Known issue:** Render blocks outbound SMTP, so Gmail email sending fails
there. Either set `RESEND_API_KEY` (with a verified sender) or move to a host
that permits SMTP, where the existing Gmail settings work unchanged.

When moving hosts, these environment variables must be updated:

| Variable | Consequence if stale |
|---|---|
| `ALLOWED_HOSTS` | Django rejects every request |
| `CORS_ALLOWED_ORIGINS` | Browser blocks all API calls |
| `CSRF_TRUSTED_ORIGINS` | Admin login fails |
| `GRADUATE_LOGIN_URL` | **Employer verification links break** — it is embedded in the emails |
| `NEXT_PUBLIC_API_URL` | Build-time; requires a front-end rebuild |

Set `DEBUG=False` in production. It defaults to `True`, and with debug on
`ALLOWED_HOSTS` becomes `["*"]` and tracebacks expose database credentials.

---

## Notes

- Face model weights in `frontend/public/modern-face-models/` are gitignored.
- Employers have **no accounts**. They verify through a one-time link at
  `/verify/:tokenId`.
- Migrations are never applied automatically. Run `manage.py migrate` yourself
  after deploying.
