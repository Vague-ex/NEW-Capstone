import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractBaseUser, Group, Permission, PermissionsMixin
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
    groups = models.ManyToManyField(
        Group,
        blank=True,
        db_table="users_account_groups",
        help_text=(
            "The groups this user belongs to. A user will get all permissions "
            "granted to each of their groups."
        ),
        related_name="user_set",
        related_query_name="user",
        verbose_name="groups",
    )
    user_permissions = models.ManyToManyField(
        Permission,
        blank=True,
        db_table="users_account_permissions",
        help_text="Specific permissions for this user.",
        related_name="user_set",
        related_query_name="user",
        verbose_name="user permissions",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        db_table = "users_accounts"

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
    batch_year = models.PositiveSmallIntegerField(db_index=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_graduate_master_records"
        ordering = ["full_name"]
        indexes = [
            models.Index(fields=["batch_year"], name="users_gradu_batch_y_7f0cc1_idx"),
        ]

    def __str__(self):
        return self.full_name


class AlumniAccount(models.Model):
    """
    DS2: Alumni Account DB
    Registered alumni credentials and account status.
    biometric_template stays as JSONField ONLY for the 128-float face descriptor vector.
    All other data (profile, face scans, login history) now lives in separate tables.
    """

    class MatchStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        MATCHED = "matched", "Matched"
        UNMATCHED = "unmatched", "Unmatched"
        BROKEN = "broken", "Broken"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="alumni_account")
    master_record = models.ForeignKey(
        GraduateMasterRecord,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="alumni_accounts",
    )
    face_photo_url = models.URLField(max_length=500, blank=True)
    # Stores ONLY the 128-float face descriptor vector for biometric matching.
    # This is kept as JSON because it is a single opaque numeric vector
    # used only for distance computation, never queried by column.
    biometric_template = models.JSONField(default=dict, blank=True)
    account_status = models.CharField(
        max_length=20,
        choices=AccountStatus.choices,
        default=AccountStatus.ACTIVE,
    )
    match_status = models.CharField(
        max_length=20,
        choices=MatchStatus.choices,
        default=MatchStatus.PENDING,
    )
    matched_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_alumni_accounts"
        indexes = [
            models.Index(fields=["account_status"], name="users_alumn_account_e0bd8c_idx"),
            models.Index(fields=["match_status"], name="users_alumn_match_s_a183c4_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.user.role != User.Role.ALUMNI:
            self.user.role = User.Role.ALUMNI
            self.user.save(update_fields=["role"])
        super().save(*args, **kwargs)

    def __str__(self):
        return f"AlumniAccount<{self.user.email}>"


class AlumniProfile(models.Model):
    """
    DS2 extension: All survey/personal fields for a registered alumni.
    One-to-one with AlumniAccount. Created at registration time.
    """

    GENDER_CHOICES = [
        ("Male", "Male"),
        ("Female", "Female"),
        ("Other", "Other"),
    ]
    CIVIL_STATUS_CHOICES = [
        ("Single", "Single"),
        ("Married", "Married"),
        ("Widowed", "Widowed"),
        ("Separated", "Separated"),
    ]
    ATTAINMENT_CHOICES = [
        ("NA", "None / Undergraduate"),
        ("Graduate", "College Graduate"),
        ("PostGrad", "Post-Graduate"),
        ("Doctorate", "Doctorate"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alumni = models.OneToOneField(
        AlumniAccount, on_delete=models.CASCADE, related_name="profile"
    )

    # Personal info (from survey_data in old JSON)
    first_name = models.CharField(max_length=120, blank=True)
    middle_name = models.CharField(max_length=120, blank=True)
    last_name = models.CharField(max_length=120, blank=True)
    gender = models.CharField(max_length=20, choices=GENDER_CHOICES, blank=True)
    birth_date = models.CharField(max_length=10, blank=True)  # stored as MM/DD from form
    civil_status = models.CharField(max_length=20, choices=CIVIL_STATUS_CHOICES, blank=True)
    mobile = models.CharField(max_length=20, blank=True)
    facebook_url = models.URLField(max_length=500, blank=True)
    city = models.CharField(max_length=120, blank=True)
    province = models.CharField(max_length=120, blank=True)

    # Academic info
    graduation_date = models.CharField(max_length=10, blank=True)  # stored as MM/DD from form
    graduation_year = models.PositiveSmallIntegerField(null=True, blank=True)
    scholarship = models.CharField(max_length=120, blank=True)
    highest_attainment = models.CharField(max_length=20, choices=ATTAINMENT_CHOICES, blank=True)
    graduate_school = models.CharField(max_length=255, blank=True)

    # Professional eligibility (comma-separated; e.g. "TESDA,PRC")
    prof_eligibility = models.CharField(max_length=255, blank=True)
    prof_eligibility_other = models.CharField(max_length=255, blank=True)

    # Awards / honors
    awards = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_alumni_profiles"

    def __str__(self):
        return f"Profile<{self.alumni}>"


class FaceScan(models.Model):
    """
    DS2 extension: Individual face scan images captured during registration or login.
    Replaces the registration_face_scans and last_login_scan_url fields in the old JSON blob.
    """

    SCAN_TYPE_CHOICES = [
        ("face_front", "Front"),
        ("face_left", "Left"),
        ("face_right", "Right"),
        ("login", "Login"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alumni = models.ForeignKey(
        AlumniAccount, on_delete=models.CASCADE, related_name="face_scans"
    )
    scan_type = models.CharField(max_length=20, choices=SCAN_TYPE_CHOICES)
    url = models.URLField(max_length=500)
    captured_at = models.DateTimeField(null=True, blank=True)
    gps_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    gps_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "users_face_scans"
        indexes = [
            models.Index(fields=["alumni", "scan_type"]),
            models.Index(fields=["alumni", "created_at"]),
        ]

    def __str__(self):
        return f"FaceScan<{self.alumni} - {self.scan_type}>"


class LoginAudit(models.Model):
    """
    DS2 extension: One row per login attempt for an alumni account.
    Replaces the login_audit array appended to the old JSON blob.
    """

    STATUS_CHOICES = [
        ("success", "Success"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alumni = models.ForeignKey(
        AlumniAccount, on_delete=models.CASCADE, related_name="login_audits"
    )
    timestamp = models.DateTimeField()
    scan_url = models.URLField(max_length=500, blank=True)
    similarity_score = models.FloatField(null=True, blank=True)
    descriptor_distance = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="success")

    class Meta:
        db_table = "users_login_audits"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["alumni", "timestamp"]),
        ]

    def __str__(self):
        return f"LoginAudit<{self.alumni} @ {self.timestamp}>"


class EmployerAccount(models.Model):
    """
    DS3: Employer Account DB
    Employer login plus company profile and status.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="employer_account")
    company_email = models.EmailField(unique=True)
    company_name = models.CharField(max_length=255, db_index=True)
    industry = models.CharField(max_length=120, blank=True)
    contact_name = models.CharField(max_length=255, blank=True)
    contact_position = models.CharField(max_length=120, blank=True)
    company_website = models.URLField(blank=True)
    company_phone = models.CharField(max_length=50, blank=True)
    company_address = models.CharField(max_length=255, blank=True)
    account_status = models.CharField(
        max_length=20,
        choices=AccountStatus.choices,
        default=AccountStatus.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_employer_accounts"
        indexes = [
            models.Index(
                fields=["company_name", "account_status"],
                name="users_emplo_company_5e7d75_idx",
            )
        ]

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

    class Meta:
        db_table = "users_admin_credentials"

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