import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
	def create_user(self, email, password=None, **extra_fields):
		if not email:
			raise ValueError("Email is required")
		email = self.normalize_email(email)
		user = self.model(email=email, **extra_fields)
		user.set_password(password)
		user.save(using=self._db)
		return user

	def create_superuser(self, email, password=None, **extra_fields):
		extra_fields.setdefault("is_staff", True)
		extra_fields.setdefault("is_superuser", True)
		extra_fields.setdefault("role", User.Role.ADMIN)

		if extra_fields.get("is_staff") is not True:
			raise ValueError("Superuser must have is_staff=True")
		if extra_fields.get("is_superuser") is not True:
			raise ValueError("Superuser must have is_superuser=True")

		return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
	class Role(models.TextChoices):
		ALUMNI = "alumni", "Alumni"
		EMPLOYER = "employer", "Employer"
		ADMIN = "admin", "Admin"

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	email = models.EmailField(unique=True)
	role = models.CharField(max_length=20, choices=Role.choices, default=Role.ALUMNI)
	is_active = models.BooleanField(default=True)
	is_staff = models.BooleanField(default=False)
	date_joined = models.DateTimeField(default=timezone.now)

	USERNAME_FIELD = "email"
	REQUIRED_FIELDS = []

	objects = UserManager()

	def __str__(self):
		return f"{self.email} ({self.role})"


class AccountStatus(models.TextChoices):
	PENDING = "pending", "Pending"
	ACTIVE = "active", "Active"
	REJECTED = "rejected", "Rejected"
	SUSPENDED = "suspended", "Suspended"


class GraduateMasterRecord(models.Model):
	"""
	DS1: Graduate Master List DB
	Pre-loaded cohort data used for registration identity lookup.
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	full_name = models.CharField(max_length=255)
	last_name = models.CharField(max_length=120)
	birth_date = models.DateField()
	email = models.EmailField(blank=True)
	batch_year = models.PositiveSmallIntegerField(db_index=True)
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ["full_name"]
		indexes = [
			models.Index(fields=["batch_year"]),
		]

	def __str__(self):
		return self.full_name


class AlumniAccount(models.Model):
	"""
	DS2: Alumni Account DB
	Registered alumni credentials and account status.
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="alumni_account")
	master_record = models.ForeignKey(
		GraduateMasterRecord,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="alumni_accounts",
	)
	face_photo_url = models.URLField(blank=True)
	biometric_template = models.TextField(blank=True)
	account_status = models.CharField(
		max_length=20,
		choices=AccountStatus.choices,
		default=AccountStatus.ACTIVE,
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		indexes = [models.Index(fields=["account_status"])]

	def save(self, *args, **kwargs):
		if self.user.role != User.Role.ALUMNI:
			self.user.role = User.Role.ALUMNI
			self.user.save(update_fields=["role"])
		super().save(*args, **kwargs)

	def __str__(self):
		return f"AlumniAccount<{self.user.email}>"


class EmployerAccount(models.Model):
	"""
	DS3: Employer Account DB
	Employer login plus company profile and status.
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="employer_account")
	company_email = models.EmailField(unique=True)
	company_name = models.CharField(max_length=255, db_index=True)
	profile_json = models.TextField(blank=True)
	account_status = models.CharField(
		max_length=20,
		choices=AccountStatus.choices,
		default=AccountStatus.PENDING,
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		indexes = [models.Index(fields=["company_name", "account_status"])]

	def save(self, *args, **kwargs):
		if self.user.role != User.Role.EMPLOYER:
			self.user.role = User.Role.EMPLOYER
			self.user.save(update_fields=["role"])
		super().save(*args, **kwargs)

	def __str__(self):
		return self.company_name


class AdminCredential(models.Model):
	"""
	DS5: Admin Credential DB
	Admin access records mapped to auth users.
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="admin_credential")
	admin_email = models.EmailField(unique=True)
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	def save(self, *args, **kwargs):
		changed_fields = []
		if self.user.role != User.Role.ADMIN:
			self.user.role = User.Role.ADMIN
			changed_fields.append("role")
		if not self.user.is_staff:
			self.user.is_staff = True
			changed_fields.append("is_staff")
		if changed_fields:
			self.user.save(update_fields=changed_fields)
		super().save(*args, **kwargs)

	def __str__(self):
		return self.admin_email
