Normalized Database Schema

Naming Convention
- Physical tables use snake_case and plural nouns.
- Every domain table is prefixed by bounded context: users_ or tracer_.
- Junction tables are explicit and readable (for example users_account_permissions).

Scope
- DS1: Graduate Master List
- DS2: Alumni Accounts
- DS3: Employer Accounts
- DS4: Employment and Skills
- DS5: Admin Accounts
- DS6: Reference Tables
- DS7: Verification Workflow

Canonical Tables

Users Domain
- users_accounts (model: users.User)
  - id (UUID, PK)
  - email (unique)
  - password (Django auth hash)
  - role (alumni, employer, admin)
  - is_active, is_staff, date_joined

- users_account_groups (junction)
  - user_id -> users_accounts.id
  - group_id -> auth_group.id

- users_account_permissions (junction)
  - user_id -> users_accounts.id
  - permission_id -> auth_permission.id

- users_graduate_master_records (model: users.GraduateMasterRecord)
  - id (UUID, PK)
  - full_name
  - last_name
  - birth_date
  - batch_year
  - is_active

- users_alumni_accounts (model: users.AlumniAccount)
  - id (UUID, PK)
  - user_id (1:1 -> users_accounts.id)
  - master_record_id (nullable FK -> users_graduate_master_records.id)
  - match_status (pending, matched, unmatched, broken)
  - matched_at
  - face_photo_url
  - biometric_template
  - account_status (pending, active, rejected, suspended)

- users_employer_accounts (model: users.EmployerAccount)
  - id (UUID, PK)
  - user_id (1:1 -> users_accounts.id)
  - company_email (unique)
  - company_name
  - industry
  - contact_name
  - contact_position
  - company_website
  - company_phone
  - company_address
  - account_status (pending, active, rejected, suspended)

- users_admin_credentials (model: users.AdminCredential)
  - id (UUID, PK)
  - user_id (1:1 -> users_accounts.id)
  - admin_email (unique)
  - is_active

Tracer Domain
- tracer_industries (model: tracer.Industry)
  - id (UUID, PK)
  - name (unique)

- tracer_job_titles (model: tracer.JobTitle)
  - id (UUID, PK)
  - name (unique)
  - industry_id (nullable FK -> tracer_industries.id)

- tracer_skill_categories (model: tracer.SkillCategory)
  - id (UUID, PK)
  - name (unique)

- tracer_skills (model: tracer.Skill)
  - id (UUID, PK)
  - name (unique)
  - category_id (nullable FK -> tracer_skill_categories.id)

- tracer_regions (model: tracer.Region)
  - id (UUID, PK)
  - code (unique)
  - name (unique)

- tracer_employment_records (model: tracer.EmploymentRecord)
  - id (UUID, PK)
  - alumni_id (FK -> users_alumni_accounts.id)
  - employer_account_id (nullable FK -> users_employer_accounts.id)
  - employer_name_input
  - job_title_input
  - job_title_id (nullable FK -> tracer_job_titles.id)
  - employment_status (employed, self_employed, unemployed)
  - work_location
  - region_id (nullable FK -> tracer_regions.id)
  - verification_status (pending, verified, denied)
  - is_current
  - constraint: one current job per alumni

- tracer_alumni_skills (model: tracer.AlumniSkill)
  - id (UUID, PK)
  - alumni_id (FK -> users_alumni_accounts.id)
  - skill_id (FK -> tracer_skills.id)
  - proficiency_level (beginner, intermediate, advanced, expert)
  - unique (alumni_id, skill_id)

- tracer_verification_tokens (model: tracer.VerificationToken)
  - token_id (UUID, PK)
  - alumni_id (FK -> users_alumni_accounts.id)
  - employment_record_id (nullable FK -> tracer_employment_records.id)
  - expires_at
  - status (pending, used, expired, revoked)
  - used_at

- tracer_verification_decisions (model: tracer.VerificationDecision)
  - id (UUID, PK)
  - token_id (nullable FK -> tracer_verification_tokens.token_id)
  - employer_account_id (FK -> users_employer_accounts.id)
  - verified_employer_name
  - verified_job_title_id (nullable FK -> tracer_job_titles.id)
  - decision (confirm, deny)
  - comment
  - decided_at

Relationship Summary
- users_accounts 1:1 users_alumni_accounts
- users_accounts 1:1 users_employer_accounts
- users_accounts 1:1 users_admin_credentials
- users_graduate_master_records 1:N users_alumni_accounts
- users_alumni_accounts 1:N tracer_employment_records
- users_employer_accounts 1:N tracer_employment_records
- tracer_industries 1:N tracer_job_titles
- tracer_skill_categories 1:N tracer_skills
- users_alumni_accounts N:M tracer_skills via tracer_alumni_skills
- tracer_employment_records 1:N tracer_verification_tokens
- tracer_verification_tokens 1:N tracer_verification_decisions
- tracer_job_titles 1:N tracer_verification_decisions (via verified_job_title_id)

Legacy to Canonical Name Mapping
- users_user -> users_accounts
- users_user_groups -> users_account_groups
- users_user_user_permissions -> users_account_permissions
- users_graduatemasterrecord -> users_graduate_master_records
- users_alumniaccount -> users_alumni_accounts
- users_employeraccount -> users_employer_accounts
- users_admincredential -> users_admin_credentials
- tracer_industry -> tracer_industries
- tracer_jobtitle -> tracer_job_titles
- tracer_skillcategory -> tracer_skill_categories
- tracer_skill -> tracer_skills
- tracer_region -> tracer_regions
- tracer_employmentrecord -> tracer_employment_records
- tracer_alumniskill -> tracer_alumni_skills
- tracer_verificationtoken -> tracer_verification_tokens
- tracer_verificationdecision -> tracer_verification_decisions

Column-Level Normalization Notes
- users_graduate_master_records.email was removed to avoid dual-source identity with users_accounts.email.
- users_alumni_accounts now carries explicit master-list matching state via match_status and matched_at.
- users_employer_accounts.profile_json was replaced with typed relational columns.
- tracer_employment_records no longer stores verification output fields or transitive industry_id.
- tracer_verification_tokens.graduate_id was renamed to alumni_id for consistent FK naming.
- tracer_verification_decisions now stores verification outputs and links to employment through token_id.
