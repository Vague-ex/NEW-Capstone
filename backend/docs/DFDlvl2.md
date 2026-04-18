Level 2 Data Flow Diagram (DFD)

This Level 2 decomposition follows your Level 1 process names exactly:
- P1: Manage Registration
- P2: Authenticate Users
- P3: Manage Profile
- P4: Manage Employment
- P5: Manage Users
- P6: Generate Analytics
- P7: Process Verification
- P8: Maintain References

Data Stores
- DS1: users_graduate_master_records
- DS2: users_alumni_accounts
- DS3: users_employer_accounts
- DS4: tracer_employment_records and tracer_alumni_skills
- DS5: users_accounts and users_admin_credentials
- DS6: tracer_industries, tracer_job_titles, tracer_skill_categories, tracer_skills, tracer_regions
- DS7: tracer_verification_tokens and tracer_verification_decisions

External Entities
- Alumni
- Employer
- Admin
- Supabase Storage

Major Process Purpose Summary

| Process | Purpose |
| --- | --- |
| P1: Manage Registration | Collect and validate new alumni/employer registration data, then create pending accounts. |
| P2: Authenticate Users | Control sign-in and access by checking credentials, role, and account status before allowing entry. |
| P3: Manage Profile | Return alumni profile and account status data for viewing and updates. |
| P4: Manage Employment | Save alumni employment and survey updates that later feed reports and analytics. |
| P5: Manage Users | Let admin review and approve/reject alumni and employer accounts. |
| P6: Generate Analytics | Show admin reporting outputs, including geomapping and predictive employability trends. |
| P7: Process Verification | Handle employer-side workplace verification flow after employer account approval. |
| P8: Maintain References | Keep master and reference data clean and updated for consistent system behavior. |

P1: Manage Registration

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 1.1 | Alumni | Submit alumni registration form | 1.2 | Credentials, personal data, survey data, FaceID images, GPS/capture time |
| 1.2 | 1.1 | Validate alumni registration data | 1.3 | Validated data |
| 1.3 | 1.2 | Check graduate data against master list | DS1 | Name-based master list lookup |
| 1.4 | DS1 | Return master-list match result | 1.5 | If matched: verified status; if unmatched: pending status |
| 1.5 | 1.4 | Upload FaceID and create alumni account | Supabase Storage, DS2, DS5 | Face scans saved; GPS/capture metadata saved to DS2; alumni account created with status from step 1.4 |
| 1.6 | Employer | Submit employer registration form | 1.7 | Company and contact data, credential email, password |
| 1.7 | 1.6 | Validate employer registration data | 1.8 | Validated data |
| 1.8 | 1.7 | Create employer pending account | DS5, DS3 | Employer credentials in DS5 + employer profile in DS3 with pending status |
| 1.9 | DS5, DS3 | Send employer account for admin review | P5 | Employer remains pending until admin approval |

P2: Authenticate Users

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 2.1 | Admin | Authenticate admin login | DS5 | Credential and role check |
| 2.2 | Employer | Authenticate employer login with status gate | DS5, DS3 | Credential check + account status check |
| 2.3 | Alumni | Authenticate alumni credentials | DS5, DS2 | Credential check + alumni account lookup |
| 2.4 | 2.3 | Verify alumni biometrics | DS2 | Compare live scan with enrolled references |
| 2.5 | 2.4 | Save login audit and return session result | Supabase Storage, DS2, Admin/Employer/Alumni | Login scan audit + access allow/deny response |

P3: Manage Profile

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 3.1 | Alumni | Request profile/account status | 3.2 | Alumni account id |
| 3.2 | 3.1 | Load profile and master context | DS2, DS1 | Alumni account data + linked master data |
| 3.3 | 3.2 | Return profile payload | Alumni | Profile fields, status, survey snapshot |

P4: Manage Employment

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 4.1 | Alumni | Submit employment update | 4.2 | employment_status + survey_data changes |
| 4.2 | 4.1 | Validate and normalize employment data | 4.3 | Cleaned employment values |
| 4.3 | 4.2 | Save employment profile updates | DS2 | Updated profile employment block |
| 4.4 | DS2 | Return updated employment data | Alumni | Updated employment/profile payload |
| 4.5 | DS2 | Provide analytics input and planned DS4 sync | P6, DS4 | Reporting input now; normalized record sync planned |

P5: Manage Users

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 5.1 | Admin | Read alumni queues | DS2 | Pending and verified alumni lists |
| 5.2 | Admin | Decide alumni account status | DS2 | Approve/reject alumni account |
| 5.3 | Admin | Read employer queue | DS3 | Employer request list |
| 5.4 | Admin | Decide employer account status | DS3 | Approve/reject employer account |

P6: Generate Analytics

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 6.1 | Admin | Open Geomapping | 6.2 | Geomap request |
| 6.2 | 6.1 | Load verified graduate GPS dataset | DS2 | lat/lng + batch + status of verified graduates |
| 6.3 | 6.2 | Render geomap view | Admin | Pins, filters, and location distribution |
| 6.4 | Admin | Open Predictive Trend | 6.5 | Prediction request for target batch |
| 6.5 | 6.4 | Build historical model dataset | DS2, DS4 | Historical alumni features + employment outcomes |
| 6.6 | 6.5 | Run regression and show projection | Admin | Time-to-hire buckets and average predicted time |

P6 Notes
- Geomapping data capture path exists (GPS from registration metadata).
- Predictive modeling flow is planned design and not yet implemented as backend endpoints.

P7: Process Verification

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 7.1 | P1 | Employer enters pending state after registration | DS3 | Employer account status=pending |
| 7.2 | P5 | Admin approves employer account | DS3 | Employer account status=active |
| 7.3 | DS3 | Grant employer dashboard access | Employer | Approved employer can use portal |
| 7.4 | Employer | Load graduates linked to employer company | DS2, DS4 | Graduate profile + employment context |
| 7.5 | Employer | Submit endorsement/verification decision | DS7 | Employer comment and verification decision |
| 7.6 | DS7 | Apply verification result to workplace state | DS4, Employer, Admin | Updated verification status reflected in views |

P7 Notes
- Employer can only verify after admin approval.
- DS7-to-DS4 update is planned and not yet exposed as tracer REST endpoints.

P8: Maintain References

| Subprocess | Source | Process | Destination | Flow |
| --- | --- | --- | --- | --- |
| 8.1 | Admin | Maintain graduate master list | DS1 | Add/update/deactivate graduate master entries |
| 8.2 | Admin | Maintain reference dictionaries | DS6 | Maintain industry/job/skill/category/region references |
| 8.3 | Admin | Maintain admin credential/role mappings | DS5 | Admin governance and access mappings |
| 8.4 | Admin | Maintain batch onboarding source | DS1 | Batch upload persistence (planned backend endpoint) |

Notes
- Subprocesses above are aligned to your Level 1 process names and current implemented behavior.
- Some DS4 and DS7 structured verification flows are schema-ready but still pending dedicated tracer REST endpoints.
