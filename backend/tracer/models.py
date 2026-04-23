import uuid

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Industry(models.Model):
	"""DS6: Reference - Industries"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	name = models.CharField(max_length=120, unique=True)
	is_active = models.BooleanField(default=True)

	class Meta:
		db_table = "tracer_industries"
		ordering = ["name"]

	def __str__(self):
		return self.name


class JobTitle(models.Model):
	"""DS6: Reference - Job Titles"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	name = models.CharField(max_length=150, unique=True)
	industry = models.ForeignKey(
		Industry,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="job_titles",
	)
	is_active = models.BooleanField(default=True)

	class Meta:
		db_table = "tracer_job_titles"
		ordering = ["name"]

	def __str__(self):
		return self.name


class SkillCategory(models.Model):
	"""DS6: Reference - Skill Categories"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	name = models.CharField(max_length=120, unique=True)
	is_active = models.BooleanField(default=True)

	class Meta:
		db_table = "tracer_skill_categories"
		ordering = ["name"]

	def __str__(self):
		return self.name


class Skill(models.Model):
	"""DS4/DS6: Skills inventory items"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	name = models.CharField(max_length=120, unique=True)
	category = models.ForeignKey(
		SkillCategory,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="skills",
	)
	is_active = models.BooleanField(default=True)

	class Meta:
		db_table = "tracer_skills"
		ordering = ["name"]

	def __str__(self):
		return self.name


class Region(models.Model):
	"""DS6: Reference - Regions"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	code = models.CharField(max_length=40, unique=True)
	name = models.CharField(max_length=120, unique=True)
	is_active = models.BooleanField(default=True)

	class Meta:
		db_table = "tracer_regions"
		ordering = ["name"]

	def __str__(self):
		return self.name


class EmploymentRecord(models.Model):
	"""
	DS4: Employment & Skills DB
	Captures alumni employment submission and employer verification lifecycle.
	"""

	class EmploymentStatus(models.TextChoices):
		EMPLOYED = "employed", "Employed"
		SELF_EMPLOYED = "self_employed", "Self-Employed"
		UNEMPLOYED = "unemployed", "Unemployed"

	class VerificationStatus(models.TextChoices):
		PENDING = "pending", "Pending"
		VERIFIED = "verified", "Verified"
		DENIED = "denied", "Denied"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="employment_records",
	)
	employer_account = models.ForeignKey(
		"users.EmployerAccount",
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="employment_records",
	)
	employer_name_input = models.CharField(max_length=255)
	job_title_input = models.CharField(max_length=255)
	job_title = models.ForeignKey(
		JobTitle,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="employment_records",
	)
	employment_status = models.CharField(max_length=20, choices=EmploymentStatus.choices)
	work_location = models.CharField(max_length=255, blank=True)
	region = models.ForeignKey(
		Region,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="employment_records",
	)
	verification_status = models.CharField(
		max_length=20,
		choices=VerificationStatus.choices,
		default=VerificationStatus.PENDING,
	)
	is_current = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "tracer_employment_records"
		ordering = ["-created_at"]
		indexes = [
			models.Index(fields=["verification_status"]),
			models.Index(fields=["employment_status"]),
			models.Index(fields=["alumni", "is_current"]),
			models.Index(fields=["job_title", "region"]),
		]
		constraints = [
			models.UniqueConstraint(
				fields=["alumni"],
				condition=Q(is_current=True),
				name="uniq_current_employment_per_alumni",
			)
		]

	def __str__(self):
		identifier = self.alumni.master_record.full_name if self.alumni.master_record else self.alumni.user.email
		return f"{identifier} - {self.employer_name_input}"


class AlumniSkill(models.Model):
	"""DS4: Alumni skill inventory"""

	class Proficiency(models.TextChoices):
		BEGINNER = "beginner", "Beginner"
		INTERMEDIATE = "intermediate", "Intermediate"
		ADVANCED = "advanced", "Advanced"
		EXPERT = "expert", "Expert"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="skills",
	)
	skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name="alumni_entries")
	proficiency_level = models.CharField(max_length=20, choices=Proficiency.choices)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "tracer_alumni_skills"
		ordering = ["-updated_at"]
		constraints = [
			models.UniqueConstraint(fields=["alumni", "skill"], name="uniq_alumni_skill")
		]
		indexes = [
			models.Index(fields=["skill", "proficiency_level"]),
		]

	def __str__(self):
		identifier = self.alumni.master_record.full_name if self.alumni.master_record else self.alumni.user.email
		return f"{identifier} - {self.skill.name}"


class VerificationToken(models.Model):
	"""
	DS7: Verification Token DB
	Invite token used by employers to verify alumni employment records.
	"""

	class Status(models.TextChoices):
		PENDING = "pending", "Pending"
		USED = "used", "Used"
		EXPIRED = "expired", "Expired"
		REVOKED = "revoked", "Revoked"

	token_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="verification_tokens",
	)
	employment_record = models.ForeignKey(
		EmploymentRecord,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="verification_tokens",
	)
	expires_at = models.DateTimeField()
	status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
	created_at = models.DateTimeField(auto_now_add=True)
	used_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = "tracer_verification_tokens"
		indexes = [
			models.Index(fields=["alumni", "status"]),
			models.Index(fields=["expires_at", "status"]),
		]

	def mark_used(self):
		self.status = self.Status.USED
		self.used_at = timezone.now()
		self.save(update_fields=["status", "used_at"])

	def __str__(self):
		return f"Token {self.token_id} ({self.status})"


class VerificationDecision(models.Model):
	"""
	P7 flow history:
	Employer confirmation/denial with comment against a pending employment record.
	"""

	class Decision(models.TextChoices):
		CONFIRM = "confirm", "Confirm"
		DENY = "deny", "Deny"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	employer_account = models.ForeignKey(
		"users.EmployerAccount",
		on_delete=models.CASCADE,
		related_name="verification_decisions",
	)
	token = models.ForeignKey(
		VerificationToken,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="decisions",
	)
	verified_employer_name = models.CharField(max_length=255, blank=True)
	verified_job_title = models.ForeignKey(
		JobTitle,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="verification_decisions",
	)
	decision = models.CharField(max_length=20, choices=Decision.choices)
	comment = models.TextField(blank=True)
	is_held = models.BooleanField(default=False)
	held_activated_at = models.DateTimeField(null=True, blank=True)
	decided_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = "tracer_verification_decisions"
		ordering = ["-decided_at"]
		indexes = [
			models.Index(fields=["decision", "decided_at"]),
			models.Index(fields=["is_held", "employer_account"]),
		]

	def __str__(self):
		return f"{self.employer_account.company_name} - {self.decision}"


class EmploymentProfile(models.Model):
	"""
	DS4: Structured Employment Profile from Questionnaire
	Stores comprehensive employment history data from questionnaire sections 4, 5, 6, 7
	"""

	class EmploymentStatusChoices(models.TextChoices):
		EMPLOYED_FULL_TIME = "employed_full_time", "Employed Full-Time"
		EMPLOYED_PART_TIME = "employed_part_time", "Employed Part-Time"
		SELF_EMPLOYED = "self_employed", "Self-Employed/Freelance"
		SEEKING = "seeking", "Seeking Employment"
		NOT_SEEKING = "not_seeking", "Not Seeking Employment"

	class SectorChoices(models.TextChoices):
		GOVERNMENT = "government", "Government"
		PRIVATE = "private", "Private"
		ENTREPRENEURIAL = "entrepreneurial", "Entrepreneurial/Freelance/Self-Employed"

	class JobStatusChoices(models.TextChoices):
		REGULAR = "regular", "Regular/Permanent"
		PROBATIONARY = "probationary", "Probationary"
		CONTRACTUAL = "contractual", "Contractual/Casual"
		SELF_EMPLOYED = "self_employed", "Self-Employed/Freelance"

	class JobSourceChoices(models.TextChoices):
		PERSONAL_NETWORK = "personal_network", "Personal Network/Referral"
		ONLINE_PORTAL = "online_portal", "Online Job Portal"
		CAREER_FAIR = "career_fair", "CHMSU Career Fair"
		WALK_IN = "walk_in", "Company Walk-in/Direct Hire"
		SOCIAL_MEDIA = "social_media", "Social Media"
		ENTREPRENEURSHIP = "entrepreneurship", "Started own business/Freelance"
		OTHER = "other", "Other"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="employment_profiles"
	)

	# Section 5: Current Employment Status
	employment_status = models.CharField(
		max_length=20,
		choices=EmploymentStatusChoices.choices,
		null=True,
		blank=True,
		help_text="Current employment status of alumni"
	)

	# Section 6: First Job Details
	time_to_hire_raw = models.CharField(
		max_length=50,
		null=True,
		blank=True,
		help_text="Original user response for time-to-hire (e.g., '3-6 months')"
	)
	# Numeric value: 1, 3, 4.5, 9, 18, 30 (midpoint of ranges)
	time_to_hire_months = models.FloatField(
		null=True,
		blank=True,
		help_text="Time-to-hire in months (1, 3, 4.5, 9, 18, 30 or NULL if never employed)"
	)
	first_job_sector = models.CharField(
		max_length=20,
		choices=SectorChoices.choices,
		null=True,
		blank=True,
		help_text="Sector of first job"
	)
	first_job_status = models.CharField(
		max_length=30,
		choices=JobStatusChoices.choices,
		null=True,
		blank=True,
		help_text="Employment status of first job"
	)
	first_job_title = models.CharField(
		max_length=150,
		null=True,
		blank=True,
		help_text="Job title of first employment"
	)
	first_job_related_to_bsis = models.BooleanField(
		null=True,
		blank=True,
		help_text="True=Directly related to BSIS, False=Not related, NULL=N/A"
	)
	first_job_unrelated_reason = models.CharField(
		max_length=200,
		null=True,
		blank=True,
		help_text="Reason why first job is not related to BSIS"
	)
	first_job_duration_months = models.IntegerField(
		null=True,
		blank=True,
		help_text="Duration of first job in months"
	)
	first_job_applications_count = models.IntegerField(
		null=True,
		blank=True,
		validators=[MinValueValidator(1)],
		help_text="Number of job applications before receiving offer (1-5=1, 6-15=2, 16-30=3, 31+=4)"
	)
	first_job_source = models.CharField(
		max_length=50,
		choices=JobSourceChoices.choices,
		null=True,
		blank=True,
		help_text="How the first job was found"
	)

	# Section 7: Current/Most Recent Job
	current_job_sector = models.CharField(
		max_length=20,
		null=True,
		blank=True,
		help_text="Sector of current/most recent job"
	)
	current_job_title = models.CharField(
		max_length=150,
		null=True,
		blank=True,
		help_text="Job title of current/most recent employment"
	)
	current_job_company = models.CharField(
		max_length=200,
		null=True,
		blank=True,
		help_text="Company name of current/most recent employment"
	)
	current_job_related_to_bsis = models.BooleanField(
		null=True,
		blank=True,
		help_text="True=Directly related to BSIS, False=Not related, NULL=N/A"
	)
	location_type = models.BooleanField(
		null=True,
		blank=True,
		help_text="True=Local (Philippines), False=Abroad/Remote, NULL=N/A"
	)

	# Metadata
	survey_completion_status = models.CharField(
		max_length=20,
		choices=[("pending", "Pending"), ("completed", "Completed")],
		default="pending",
		help_text="Survey completion status"
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "tracer_employment_profiles"
		ordering = ["-updated_at"]
		indexes = [
			models.Index(fields=["alumni", "-updated_at"]),
			models.Index(fields=["employment_status"]),
		]

	def __str__(self):
		identifier = self.alumni.master_record.full_name if self.alumni.master_record else self.alumni.user.email
		return f"EmploymentProfile<{identifier}>"


class WorkAddress(models.Model):
	"""
	DS4: Work Address for Geographic Distribution Mapping
	Records work location data from Questionnaire Section 7
	Supports multiple work addresses per alumni with geographic coordinates
	"""

	class RegionChoices(models.TextChoices):
		NCR = "NCR", "→ NCR"
		REGION_I = "Region I", "Region I (Ilocos)"
		REGION_II = "Region II", "Region II (Cagayan Valley)"
		REGION_III = "Region III", "Region III (Central Luzon)"
		REGION_IV_A = "Region IV-A", "Region IV-A (CALABARZON)"
		REGION_IV_B = "Region IV-B", "Region IV-B (MIMAROPA)"
		REGION_V = "Region V", "Region V (Bicol)"
		REGION_VI = "Region VI", "Region VI (Western Visayas)"
		REGION_VII = "Region VII", "Region VII (Central Visayas)"
		REGION_VIII = "Region VIII", "Region VIII (Eastern Visayas)"
		REGION_IX = "Region IX", "Region IX (Zamboanga Peninsula)"
		REGION_X = "Region X", "Region X (Northern Mindanao)"
		REGION_XI = "Region XI", "Region XI (Davao)"
		REGION_XII = "Region XII", "Region XII (SOCCSKSARGEN)"
		REGION_XIII = "Region XIII", "Region XIII (Caraga)"
		CAR = "CAR", "CAR (Cordillera)"
		BARMM = "BARMM", "BARMM"
		ABROAD = "Abroad", "Abroad/International"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="work_addresses"
	)
	employment_profile = models.ForeignKey(
		EmploymentProfile,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name="work_addresses",
		help_text="Link to employment profile (optional)"
	)

	street_address = models.CharField(
		max_length=200,
		blank=True,
		help_text="Street address (optional)"
	)
	barangay = models.CharField(
		max_length=100,
		blank=True,
		help_text="Barangay (optional)"
	)
	city_municipality = models.CharField(
		max_length=100,
		help_text="City/Municipality (required)"
	)
	province = models.CharField(
		max_length=100,
		help_text="Province (required)"
	)
	region = models.CharField(
		max_length=50,
		choices=RegionChoices.choices,
		help_text="Philippine region or Abroad"
	)
	zip_code = models.CharField(
		max_length=20,
		blank=True,
		help_text="ZIP code (optional)"
	)
	country = models.CharField(
		max_length=100,
		default="Philippines",
		help_text="Country name"
	)

	# Geographic coordinates for mapping
	latitude = models.FloatField(
		null=True,
		blank=True,
		help_text="Latitude coordinate"
	)
	longitude = models.FloatField(
		null=True,
		blank=True,
		help_text="Longitude coordinate"
	)

	is_current = models.BooleanField(
		default=True,
		help_text="Mark as current work address"
	)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = "tracer_work_addresses"
		ordering = ["-is_current", "-created_at"]
		indexes = [
			models.Index(fields=["alumni", "-is_current"]),
			models.Index(fields=["region"]),
		]

	def __str__(self):
		return f"{self.city_municipality}, {self.province} ({self.country})"


class CompetencyProfile(models.Model):
	"""
	DS4: Detailed Competency and Skills Assessment
	Stores skills assessment from Questionnaire Section 8
	Maintains both detailed skill selections and count totals (denormalized for regression model)
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	alumni = models.ForeignKey(
		"users.AlumniAccount",
		on_delete=models.CASCADE,
		related_name="competency_profiles"
	)

	# Technical Skills (12 possible from questionnaire)
	# Format: [{"name": "Programming/Software Development", "selected": true}, ...]
	technical_skills = models.JSONField(
		default=list,
		blank=True,
		help_text="Array of technical skill selections with boolean flags"
	)

	# Soft Skills (10 possible from questionnaire)
	# Format: [{"name": "Oral Communication", "selected": true}, ...]
	soft_skills = models.JSONField(
		default=list,
		blank=True,
		help_text="Array of soft skill selections with boolean flags"
	)

	# Count totals (denormalized for regression model efficiency)
	technical_skill_count = models.IntegerField(
		default=0,
		validators=[MinValueValidator(0), MaxValueValidator(12)],
		help_text="Count of selected technical skills (0-12)"
	)
	soft_skill_count = models.IntegerField(
		default=0,
		validators=[MinValueValidator(0), MaxValueValidator(10)],
		help_text="Count of selected soft skills (0-10)"
	)

	professional_certifications = models.CharField(
		max_length=500,
		blank=True,
		help_text="Comma-separated list of professional certifications"
	)
	assessment_date = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "tracer_competency_profiles"
		ordering = ["-assessment_date"]

	def __str__(self):
		identifier = self.alumni.master_record.full_name if self.alumni.master_record else self.alumni.user.email
		return f"CompetencyProfile<{identifier}>"
