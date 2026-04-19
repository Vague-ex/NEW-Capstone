# Data Reset Guide (Local DB + Supabase Face Storage)

This project includes a reusable reset script at `backend/scripts/reset_demo_data.py`.

## What it resets

By default, it removes transactional data only:

- Auth/account data for selected roles in `users_accounts` (alumni, employer, admin)
- `users_alumni_accounts`
- `users_alumni_profiles`
- `users_face_scans`
- `users_login_audits`
- `users_employer_accounts`
- `users_admin_credentials`
- `tracer_employment_records`
- `tracer_alumni_skills`
- `tracer_verification_tokens`
- `tracer_verification_decisions`
- Supabase storage objects under:
  - `face-registration/`
  - `face-login/`

It does **not** delete seed/reference datasets such as:

- `users_graduate_master_records`
- `tracer_regions`
- `tracer_skills`
- `tracer_skill_categories`
- `tracer_job_titles`
- `tracer_industries`

## Run modes

### 1) Dry run (safe, default)

From workspace root:

```powershell
venv\Scripts\python.exe backend\scripts\reset_demo_data.py
```

### 2) Execute destructive reset

```powershell
venv\Scripts\python.exe backend\scripts\reset_demo_data.py --execute --confirm RESET
```

### 3) Keep admin accounts

```powershell
venv\Scripts\python.exe backend\scripts\reset_demo_data.py --execute --confirm RESET --keep-admin
```

### 4) Database only

```powershell
venv\Scripts\python.exe backend\scripts\reset_demo_data.py --execute --confirm RESET --skip-storage
```

### 5) Storage only

```powershell
venv\Scripts\python.exe backend\scripts\reset_demo_data.py --execute --confirm RESET --skip-database
```

## Notes

- Storage cleanup requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set in backend env.
- If storage credentials are missing, storage cleanup is skipped with a warning.
- Always run dry-run first before destructive mode.
