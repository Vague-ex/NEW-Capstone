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

2. Copy face model files (required for modern-face-api runtime):

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
