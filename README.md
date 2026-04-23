# NEW-Capstone

Graduate Tracer System with a Django backend and Next.js frontend.

## Project Structure

- `backend/`: Django API server
- `frontend/`: Next.js app
- `Figmanuts/`: design/migration reference app assets

## Backend Setup

1. Create/activate your virtual environment.
2. Install dependencies:

```bash
cd backend
..\venv\Scripts\python.exe -m pip install -r requirements.txt
```

3. Run the backend:

```bash
cd backend
..\venv\Scripts\python.exe manage.py runserver
```

## Frontend Setup

1. Install dependencies:

```bash
cd frontend
npm install
```

2. Face model files are copied automatically during install via postinstall.

If you need to copy manually (fallback):

```bash
cd frontend
if (-not (Test-Path "public/modern-face-models")) { New-Item -ItemType Directory -Path "public/modern-face-models" | Out-Null }
Copy-Item -Path "node_modules/modern-face-api/weights/*" -Destination "public/modern-face-models" -Recurse -Force
```

3. Run the frontend:

```bash
cd frontend
npm run dev
```

## Notes

- Face model files in `frontend/public/modern-face-models/` are intentionally gitignored.
- Run lint when needed:

```bash
cd frontend
npm run lint
```

## Test Production Deployment (Vercel + Railway)

Recommended for this project:

- Frontend: Vercel (`frontend/`)
- Backend: Railway (`backend/`)
- Database/Storage: existing Supabase configuration

### 1) Safety First: Use an isolated branch

```bash
git checkout main
git pull
git checkout -b test_prod
git push -u origin test_prod
```

Do all test-production changes and deploy verification from `test_prod` before merging to main.

### 2) Backend on Railway

1. Create a Railway project/service using `backend/` as the service root.
2. Railway will use `backend/Procfile`:
	- `web: gunicorn core.wsgi:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
3. Add backend environment variables from `backend/.env.example` with real values.
4. Run migrations in Railway once after first deploy:

```bash
python manage.py migrate
```

5. Verify API is reachable from your Railway public URL.

### 3) Frontend on Vercel

1. Import the `frontend/` directory as a Vercel project.
2. Set environment variables from `frontend/.env.example`.
3. Required variable:
	- `NEXT_PUBLIC_API_URL=https://<your-railway-backend-domain>`
4. Optional variable for employer-sharing links:
	- `NEXT_PUBLIC_EMPLOYER_PORTAL_URL=/employer` (same domain path)
	- or absolute URL if you use a different portal domain.
5. Deploy and verify browser requests are hitting Railway API, not localhost.

### 4) Production behavior checks

- Backend requires strict values when `DEBUG=False`:
  - `ALLOWED_HOSTS`
  - `CORS_ALLOWED_ORIGINS`
  - `CSRF_TRUSTED_ORIGINS`
- Do not use wildcard CORS in production.
- Keep `SECRET_KEY` unique and private.

### 5) Smoke test checklist

1. Alumni login and profile edit routes.
2. Employer registration and login.
3. Employer dashboard data loading.
4. Alumni employment form employer-link copy and open behavior.
5. No CORS/CSRF errors in browser console/network.
