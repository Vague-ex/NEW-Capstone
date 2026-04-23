# Phase 4: Frontend Survey Component Updates - Implementation Guide

## Overview

The `register-alumni.tsx` component is being expanded from 6 steps to 10 steps to capture all questionnaire data required for the predictive model.

**Status:** In Progress
- ✅ Step constants updated (10 steps)
- ✅ Skills lists added (Technical, Soft, Regions)
- ✅ Form interface expanded with all new fields
- ✅ INITIAL_FORM updated with new field initializations
- ⏳ Step components (4-9) need to be added to the JSX render

---

## New Steps to Implement (Steps 4-9)

### Step 4: Academic & Pre-Employment Profile

**Location in JSX:** After Step 3 (Education), before Step 5
**Fields to collect:**

```typescript
// GPA Range (ordinal: 0-5)
- User selects: "Below 75" | "75-79" | "80-84" | "85-89" | "90-94" | "95-100" | "I don't remember"
- Maps to: general_average_range (0-5 or null)

// Academic Honors (ordinal: 1-4)
- User selects: "None" | "Cum Laude" | "Magna Cum Laude" | "Summa Cum Laude"
- Maps to: academic_honors (1-4)

// Prior Work Experience (boolean)
- Radio: Yes / No
- Maps to: prior_work_experience

// OJT Relevance (ordinal: 0-3)
- User selects: "Not applicable" | "Not related" | "Somewhat related" | "Yes, directly related"
- Maps to: ojt_relevance (0-3 or null)

// Portfolio/GitHub (boolean)
- Radio: Yes / No
- Maps to: has_portfolio

// English Proficiency (ordinal: 1-3)
- User selects: "Basic" | "Conversational" | "Professional/Business"
- Maps to: english_proficiency (1-3 or null)
```

**UI Components:**
- SectionHeader with BookOpen icon
- Ordinal selectors (dropdowns for GPA, Honors, OJT, English)
- Binary toggles (Prior work, Portfolio)

**Validation:**
- GPA must be in {0,1,2,3,4,5} or null
- Honors must be in {1,2,3,4} or null
- OJT must be in {0,1,2,3} or null
- English must be in {1,2,3} or null

---

### Step 5: Employment Status (NEW - CRITICAL)

**Location in JSX:** After Step 4
**Purpose:** Determines conditional rendering of subsequent job history steps
**Fields to collect:**

```typescript
// Current Employment Status (REQUIRED)
employment_status: string
- Radio options:
  - "Employed Full-Time"        → employed_full_time
  - "Employed Part-Time"        → employed_part_time
  - "Self-Employed/Freelance"   → self_employed
  - "Seeking Employment"        → seeking
  - "Not Seeking Employment"    → not_seeking
  - "Never Employed"            → never_employed
```

**UI Components:**
- SectionHeader with Briefcase icon
- Radio button group with 6 options
- Visual indicator of what happens next based on selection

**Conditional Logic:**
```
IF employment_status = 'never_employed' or 'not_seeking'
  THEN skip to Step 8 (Work Address)

IF employment_status = 'seeking'
  THEN show Steps 6-7 with optional fields for previous employment history

IF employment_status = 'employed_full_time' or 'part_time' or 'self_employed'
  THEN show all Steps 6-9 as required
```

**Validation:**
- Must be one of the 6 options (required)

---

### Step 6: First Job Details (EXPANDED)

**Location in JSX:** After Step 5 (conditional on employment_status)
**Note:** This step shows previous employment history even if user is currently seeking/not seeking
**Fields to collect:**

```typescript
// Time-to-Hire (continuous: 1, 3, 4.5, 9, 18, 30)
timeToHire: string                      // User-friendly display
time_to_hire_months: number | null      // Encoded value
- Dropdown options with midpoint conversion:
  - "Within 1 month"              → 1
  - "1-3 months"                  → 3
  - "3-6 months"                  → 4.5
  - "6 months to 1 year"          → 9
  - "1-2 years"                   → 18
  - "More than 2 years"           → 30
  - "Never employed"              → null (select based on employment_status)

// First Job Sector (categorical)
firstJobSector: string                  // UI display
first_job_sector: string | null         // backend: government|private|entrepreneurial
- Radio options:
  - "Government"
  - "Private Sector"
  - "Entrepreneurial/Freelance/Self-Employed"

// First Job Status (categorical)
firstJobStatus: string                  // UI display
first_job_status: string | null         // backend: regular|probationary|contractual|self_employed
- Dropdown:
  - "Regular/Permanent"
  - "Probationary"
  - "Contractual/Casual"
  - "Self-Employed/Freelance"

// First Job Title (text)
first_job_title: string (max 150 chars)

// Related to BSIS (binary)
firstJobRelated: string                 // UI: Yes|Somewhat|Not
first_job_related_to_bsis: boolean | null
- Radio:
  - "Yes, directly related"       → true
  - "Somewhat related"            → false
  - "Not related"                 → false
  - "Not applicable"              → null

// If NOT related - reason (conditional)
first_job_unrelated_reason: string (max 200 chars)
- User can enter reason why job not related

// Duration in First Job (months)
first_job_duration_months: number | null

// Job Applications Count (ordinal: 1-4)
first_job_applications_count: number | null
- Dropdown:
  - "1-5 applications"            → 1
  - "6-15 applications"           → 2
  - "16-30 applications"          → 3
  - "31+ applications"            → 4

// Where Found Job (categorical: 7 options)
jobSource: string                       // UI display
first_job_source: string                // backend value
- Dropdown:
  - "Personal Network/Referral"         → personal_network
  - "Online Job Portal"                 → online_portal
  - "CHMSU Career Fair"                 → career_fair
  - "Company Walk-in/Direct Hire"       → walk_in
  - "Social Media"                      → social_media
  - "Started own business/Freelance"    → entrepreneurship
  - "Other"                             → other
- If "Other", show text input:
  jobSourceOther: string (optional)
```

**UI Components:**
- SectionHeader with Briefcase icon
- Ordinal/numeric dropdowns for time-to-hire, applications count
- Radio groups for yes/no/somewhat fields
- Text inputs for titles, reasons
- Conditional text field for "Other" job source

**Validation:**
- time_to_hire_months must be in {1, 3, 4.5, 9, 18, 30} or null
- first_job_sector must be in {government, private, entrepreneurial}
- first_job_status must be in {regular, probationary, contractual, self_employed}
- first_job_applications_count must be in {1, 2, 3, 4} or null
- first_job_source must be in {personal_network, online_portal, career_fair, walk_in, social_media, entrepreneurship, other}

---

### Step 7: Current/Most Recent Job (NEW - CONDITIONAL)

**Location in JSX:** After Step 6
**Visibility:** Show only if employment_status = 'employed_full_time|part_time|self_employed'
**Purpose:** Capture current employment if different from first job
**Fields to collect:**

```typescript
// Current Job Sector (categorical)
currentJobSector: string                // UI display
current_job_sector: string | null       // backend: government|private|entrepreneurial (or null)
- Radio options (same as first job):
  - "Government"
  - "Private Sector"
  - "Entrepreneurial/Freelance/Self-Employed"
  - Can be N/A if still in first job

// Current Job Title / Occupation
current_job_title: string (max 150 chars)

// Company/Organization Name
current_job_company: string (max 200 chars)

// Related to BSIS (binary)
currentJobRelated: string               // UI display
current_job_related_to_bsis: boolean | null
- Radio:
  - "Yes, directly related"       → true
  - "Somewhat related"            → false
  - "Not related"                 → false
  - "Still in first job/N/A"      → null

// Location Type (binary)
currentJobLocation: string              // UI display
location_type: boolean | null           // backend: true=Local, false=Abroad
- Radio:
  - "Local (Philippines)"         → true
  - "Abroad/Remote Foreign"       → false
  - "Not applicable"              → null
```

**UI Components:**
- SectionHeader with MapPin icon
- Radio groups for sector, relatedness, location
- Text inputs for job title and company
- Optional/conditional fields if needed

**Validation:**
- current_job_sector (if not null) must be in {government, private, entrepreneurial}
- location_type (if not null) must be boolean

---

### Step 8: Work Address for Mapping (EXPANDED)

**Location in JSX:** After Step 7 (or after Step 5 if employment_status is never_employed/not_seeking)
**Purpose:** Geographic distribution data for heat map analysis
**Fields to collect:**

```typescript
// Street Address (optional)
street_address: string (max 200 chars)

// Barangay (optional)
barangay: string (max 100 chars)

// City/Municipality (REQUIRED)
city_municipality: string (max 100 chars)

// Province (REQUIRED)
province: string (max 100 chars) - but this is from "province" field in Step 2... or separate?
NOTE: Use region_address for work location, separate from personal address province

// Region (REQUIRED - from 18 Philippine regions)
region_address: string
- Dropdown with 18 options from PHILIPPINE_REGIONS array:
  - NCR, Region I-XIII, CAR, BARMM, Abroad

// ZIP Code (optional)
zip_code: string (max 20 chars)

// Country (optional, default "Philippines")
country_address: string

// Geographic Coordinates (optional - for mapping)
latitude: number | null (range -90 to 90)
longitude: number | null (range -180 to 180)
- Can be auto-populated from GPS during registration
- Or manually entered
```

**UI Components:**
- SectionHeader with MapPin icon
- Text inputs for address components
- Dropdown for region selection (18 options)
- Optional coordinate fields (might be auto-populated)

**Validation:**
- city_municipality required (non-empty)
- region_address required (must be in PHILIPPINE_REGIONS)
- If latitude provided, must be -90 to 90
- If longitude provided, must be -180 to 180

---

### Step 9: Competency & Skills Assessment (EXPANDED)

**Location in JSX:** After Step 8
**Purpose:** Capture technical and soft skills for regression model
**Fields to collect:**

```typescript
// Technical Skills (12 options - multi-select checkboxes)
technical_skills: string[]              // Array of selected skill names
technical_skill_count: number           // Count (0-12)

Options (from TECHNICAL_SKILLS array):
1. Programming/Software Development
2. Web Development
3. Mobile App Development
4. Database Management
5. Network Administration
6. Cloud Computing
7. Data Analytics/Business Intelligence
8. System Analysis and Design
9. Technical Support/Troubleshooting
10. Project Management
11. UI/UX Design
12. Cybersecurity/Information Security

User selects yes/no for each, count is auto-calculated

// Soft Skills (10 options - multi-select checkboxes)
soft_skills: string[]                   // Array of selected skill names
soft_skill_count: number                // Count (0-10)

Options (from SOFT_SKILLS array):
1. Oral Communication
2. Written Communication
3. Teamwork/Collaboration
4. Problem-solving/Critical Thinking
5. Adaptability/Flexibility
6. Leadership
7. Customer Service Orientation
8. Attention to Detail
9. Ability to Work Under Pressure
10. Time Management

User selects yes/no for each, count is auto-calculated

// Professional Certifications (text)
professional_certifications: string (max 500 chars, comma-separated)
- Free text input for entering certification names
```

**UI Components:**
- SectionHeader with Award icon
- Two CheckOption groups:
  - Technical Skills (12 checkboxes in 2-3 columns)
  - Soft Skills (10 checkboxes in 2 columns)
- Text area for professional certifications
- Display counts under each section: "X of 12 selected" | "X of 10 selected"

**Validation:**
- technical_skill_count must be 0-12
- soft_skill_count must be 0-10
- Count must match selected skills array length

---

### Step 10: Face Biometrics (UNCHANGED)

**Location in JSX:** Last step (after Step 9)
**Status:** Keep existing implementation
**No changes required**

---

## Field Encoding Transformations (Frontend → Backend)

The frontend must transform user-friendly selections into backend model-expected values:

```typescript
// GPA Range
gpaMapping = {
  'Below 75': 0,
  '75-79': 1,
  '80-84': 2,
  '85-89': 3,
  '90-94': 4,
  '95-100': 5,
  "I don't remember": null
}

// Time-to-Hire (midpoints)
timeToHireMapping = {
  'Within 1 month': 1,
  '1-3 months': 3,
  '3-6 months': 4.5,
  '6 months to 1 year': 9,
  '1-2 years': 18,
  'More than 2 years': 30,
  'Never employed': null
}

// Job Applications Count
appCountMapping = {
  '1-5 applications': 1,
  '6-15 applications': 2,
  '16-30 applications': 3,
  '31+ applications': 4
}

// Job Source
jobSourceMapping = {
  'Personal Network/Referral': 'personal_network',
  'Online Job Portal': 'online_portal',
  'CHMSU Career Fair': 'career_fair',
  'Company Walk-in/Direct Hire': 'walk_in',
  'Social Media': 'social_media',
  'Started own business/Freelance': 'entrepreneurship',
  'Other': 'other'
}

// Employment Status
employmentStatusMapping = {
  'Employed Full-Time': 'employed_full_time',
  'Employed Part-Time': 'employed_part_time',
  'Self-Employed/Freelance': 'self_employed',
  'Seeking Employment': 'seeking',
  'Not Seeking Employment': 'not_seeking',
  'Never Employed': 'never_employed'
}

// Job Sector
sectorMapping = {
  'Government': 'government',
  'Private Sector': 'private',
  'Entrepreneurial/Freelance/Self-Employed': 'entrepreneurial'
}

// Job Status
jobStatusMapping = {
  'Regular/Permanent': 'regular',
  'Probationary': 'probationary',
  'Contractual/Casual': 'contractual',
  'Self-Employed/Freelance': 'self_employed'
}

// Location Type
locationTypeMapping = {
  'Local (Philippines)': true,
  'Abroad/Remote Foreign': false,
  'Not applicable': null
}

// Relatedness
relatedMapping = {
  'Yes, directly related': true,
  'Somewhat related': false,
  'Not related': false,
  'Not applicable': null
}
```

---

## Conditional Rendering Logic

```typescript
// After Step 5 (Employment Status)

IF employment_status === 'never_employed' OR 'not_seeking' {
  SKIP Steps 6-7 (job details)
  SHOW Step 8 (Work Address) - with "Address when not employed" context
  SHOW Step 9 (Skills)
  SHOW Step 10 (Biometrics)
}

IF employment_status === 'seeking' {
  SHOW Step 6 (First Job Details) - with optional indication
  SHOW Step 7 (Current Job) - optional (for previous employment)
  SHOW Step 8 (Work Address) - optional/N/A
  SHOW Step 9 (Skills)
  SHOW Step 10 (Biometrics)
}

IF employment_status IN ['employed_full_time', 'employed_part_time', 'self_employed'] {
  SHOW Step 6 (First Job Details) - required
  SHOW Step 7 (Current Job) - required
  SHOW Step 8 (Work Address) - required
  SHOW Step 9 (Skills) - required
  SHOW Step 10 (Biometrics) - required
}
```

---

## Implementation Checklist

- [ ] Step 4: Academic & Pre-Employment Profile UI component
- [ ] Step 5: Employment Status UI component (with conditional logic)
- [ ] Step 6: First Job Details UI component
- [ ] Step 7: Current Job UI component
- [ ] Step 8: Work Address UI component (expand existing)
- [ ] Step 9: Competency Assessment UI component
- [ ] Add field encoding transformer functions
- [ ] Update nextStep() and prevStep() logic for conditional skipping
- [ ] Update form submission logic to include all new fields
- [ ] Add client-side form validation matching backend rules
- [ ] Test end-to-end flow with all conditional paths
- [ ] Test form submission with validation errors

---

## Notes

- **File:** `/frontend/src/components/register-alumni.tsx`
- **Total Size:** Will be significantly larger (2000+ lines)
- **Key Challenge:** Conditional rendering based on employment_status
- **Encoding:** Frontend transforms UI strings → backend numeric/categorical values
- **Validation:** Client-side validation should match `/backend/tracer/validators.py` rules
