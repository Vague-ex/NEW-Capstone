Database Schema from DFD

Scope
- DS1 Graduate Master List DB
- DS2 Alumni Account DB
- DS3 Employer Account DB
- DS4 Employment and Skills DB
- DS5 Admin Credential DB
- DS6 Reference Tables DB
- DS7 Verification Token DB

Core Auth and Accounts
- users.User
  - id (UUID, PK)
  - email (unique)
  - password (hash from Django auth)
  - role (alumni, employer, admin)
  - is_active, is_staff, date_joined

- users.GraduateMasterRecord (DS1)
  - full_name
  - last_name
  - birth_date
  - email
  - batch_year

- users.AlumniAccount (DS2)
  - user (1:1 users.User)
  - master_record (FK users.GraduateMasterRecord)
  - face_photo_url
  - biometric_template
  - account_status (pending, active, rejected, suspended)

- users.EmployerAccount (DS3)
  - user (1:1 users.User)
  - company_email (unique)
  - company_name
  - account_status (pending, active, rejected, suspended)

- users.AdminCredential (DS5)
  - user (1:1 users.User)
  - admin_email (unique)
  - is_active

Reference Tables (DS6)
- tracer.Industry
- tracer.JobTitle (optional FK to Industry)
- tracer.SkillCategory
- tracer.Skill (optional FK to SkillCategory)
- tracer.Region

Employment and Skills (DS4)
- tracer.EmploymentRecord
  - alumni (FK users.AlumniAccount)
  - employer_account (nullable FK users.EmployerAccount)
  - employer_name_input
  - employer_name_verified
  - job_title_input
  - job_title (nullable FK tracer.JobTitle)
  - industry (nullable FK tracer.Industry)
  - employment_status (employed, self_employed, unemployed)
  - work_location
  - region (nullable FK tracer.Region)
  - verification_status (pending, verified, denied)
  - employer_comment
  - verified_at
  - is_current

- tracer.AlumniSkill
  - alumni (FK users.AlumniAccount)
  - skill (FK tracer.Skill)
  - proficiency_level (beginner, intermediate, advanced, expert)
  - unique (alumni, skill)

Verification Security (DS7)
- tracer.VerificationToken
  - token_id (UUID, PK)
  - graduate (FK users.AlumniAccount)
  - employment_record (nullable FK tracer.EmploymentRecord)
  - expires_at
  - status (pending, used, expired, revoked)
  - used_at

- tracer.VerificationDecision
  - employment_record (FK tracer.EmploymentRecord)
  - employer_account (FK users.EmployerAccount)
  - token (nullable FK tracer.VerificationToken)
  - decision (confirm, deny)
  - comment
  - decided_at

DFD Process Mapping
- P1 Manage Registration
  - Lookup on users.GraduateMasterRecord
  - Create users.User + users.AlumniAccount
- P2 Authenticate Users
  - users.User password hash + role routing
  - alumni/employer/admin status checks via account tables
- P3 Manage Profile
  - users.AlumniAccount + tracer.AlumniSkill updates
- P4 Manage Employment
  - tracer.EmploymentRecord create/update
  - tracer.VerificationToken generate
- P5 Manage Users
  - Batch upload into users.GraduateMasterRecord
  - Status updates in users.AlumniAccount and users.EmployerAccount
- P6 Generate Analytics
  - Query tracer.EmploymentRecord and tracer.AlumniSkill with references
- P7 Process Verification
  - Validate tracer.VerificationToken
  - Update tracer.EmploymentRecord verification fields
  - Log tracer.VerificationDecision
- P8 Maintain References
  - CRUD on tracer.Industry/JobTitle/SkillCategory/Region
