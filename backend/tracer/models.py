import uuid

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
