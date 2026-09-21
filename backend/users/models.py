import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractBaseUser, Group, Permission, PermissionsMixin
from django.core.validators import MinValueValidator, MaxValueValidator
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
    Pre-loaded batch data used for registration identity lookup.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    full_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=120)
    # Optional. The masterlist match (_find_master_record) uses last_name +
    # first_name + batch_year only, so birth_date is informational and
    # nullable for CSV / manual-entry batch uploads that do not collect it.
    birth_date = models.DateField(null=True, blank=True)
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
        # Database backstop for the upload validation: a report CSV once saved
        # "Total" / batch 33 here. Postgres refuses such a row even if a future
        # code path forgets to validate.
        constraints = [
            models.CheckConstraint(
                condition=models.Q(batch_year__gte=2000) & models.Q(batch_year__lte=2100),
                name="master_batch_year_realistic",
            ),
            models.CheckConstraint(
                condition=models.Q(full_name__regex=r"[[:alpha:]]") & ~models.Q(full_name__regex=r"[0-9]"),
                name="master_full_name_is_a_name",
            ),
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
    # Admin's comment when an account is rejected. Surfaced to the admin in the
    # request lists and included in the rejection email sent to the graduate.
    rejection_reason = models.TextField(blank=True, default="")
    matched_at = models.DateTimeField(null=True, blank=True)
    # When an admin checked this graduate is real. A masterlist-matched
    # registration is active straight away but stays in the admin's Profile
    # Review list until this is set (or the account is rejected and deleted).
    profile_reviewed_at = models.DateTimeField(null=True, blank=True)
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
    birth_date = models.CharField(max_length=10, blank=True)  # YYYY-MM (month + year). Legacy MM/DD rows tolerated.
    civil_status = models.CharField(max_length=20, choices=CIVIL_STATUS_CHOICES, blank=True)
    mobile = models.CharField(max_length=20, blank=True)
    facebook_url = models.URLField(max_length=500, blank=True)
    city = models.CharField(max_length=120, blank=True)
    province = models.CharField(max_length=120, blank=True)
    # The rest of the home address. Registration always sent these, but nothing
    # stored them, so every graduate's region, barangay and country were
    # silently discarded on the way in.
    home_region = models.CharField(max_length=120, blank=True)
    home_barangay = models.CharField(max_length=160, blank=True)
    home_country = models.CharField(max_length=120, blank=True)
    home_is_abroad = models.BooleanField(default=False)
    # Exact home location, set only when the graduate uses "Use my current
    # location" (optionally dragging the pin). Plotted on the admin geomap for
    # graduates who gave geomap consent; null when the address was typed in.
    home_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    home_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    home_location_accuracy_m = models.FloatField(null=True, blank=True)

    # Academic info
    graduation_date = models.CharField(max_length=10, blank=True)  # YYYY-MM (month + year). Legacy MM/DD rows tolerated.
    graduation_year = models.PositiveSmallIntegerField(null=True, blank=True)
    scholarship = models.CharField(max_length=120, blank=True)
    highest_attainment = models.CharField(max_length=20, choices=ATTAINMENT_CHOICES, blank=True)
    graduate_school = models.CharField(max_length=255, blank=True)

    # Further studies (post-baccalaureate). Captures alumni who went to grad school
    # without forcing them through a separate "did you graduate?" gate — every
    # registered alumnus already holds the BSIS bachelor's by definition.
    FURTHER_STUDIES_CHOICES = [
        ("none", "Bachelor's only"),
        ("enrolled", "Currently enrolled in further studies"),
        ("completed", "Completed further studies"),
    ]
    further_studies_status = models.CharField(
        max_length=20, choices=FURTHER_STUDIES_CHOICES, blank=True, default="none",
    )
    postgrad_program = models.CharField(max_length=200, blank=True)
    postgrad_field = models.CharField(max_length=200, blank=True)
    postgrad_school = models.CharField(max_length=255, blank=True)
    postgrad_year_started = models.PositiveSmallIntegerField(null=True, blank=True)
    postgrad_year_completed = models.PositiveSmallIntegerField(null=True, blank=True)

    # Professional eligibility (comma-separated; e.g. "TESDA,PRC")
    prof_eligibility = models.CharField(max_length=255, blank=True)
    prof_eligibility_other = models.CharField(max_length=255, blank=True)

    # Consent record (Data Privacy Act). Consent must be *recorded*, not merely
    # clicked, so the timestamp is stored rather than a bare boolean.
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    # Plotting a graduate's workplace on the public geomap is a separate,
    # more intrusive disclosure than joining the tracer study, so it carries its
    # own opt-in. Alumni without this must never appear on the map.
    geomap_consent = models.BooleanField(default=False)

    # Awards / honors
    awards = models.TextField(blank=True)

    # Academic Profile Fields (Questionnaire Section 3)
    # GPA Range: 0=<75, 1=75-79, 2=80-84, 3=85-89, 4=90-94, 5=95-100, None=I don't remember
    general_average_range = models.IntegerField(
        choices=[(0, 'Below 75'), (1, '75-79'), (2, '80-84'), (3, '85-89'), (4, '90-94'), (5, '95-100')],
        null=True,
        blank=True,
        help_text="GPA range encoding for regression model"
    )
    # Academic Honors: 1=None, 2=Cum Laude, 3=Magna Cum Laude, 4=Summa Cum Laude
    academic_honors = models.IntegerField(
        choices=[(1, 'None'), (2, 'Cum Laude'), (3, 'Magna Cum Laude'), (4, 'Summa Cum Laude')],
        null=True,
        blank=True,
        help_text="Academic honors for regression model"
    )

    # Pre-Employment Experience (Questionnaire Section 3 continued)
    prior_work_experience = models.BooleanField(default=False)
    # OJT Relevance: 0=Not applicable, 1=Not related, 2=Somewhat related, 3=Yes, directly related
    ojt_relevance = models.IntegerField(
        choices=[(0, 'Not applicable'), (1, 'Not related'), (2, 'Somewhat related'), (3, 'Yes, directly related')],
        null=True,
        blank=True,
        help_text="OJT relevance to BSIS degree"
    )
    has_portfolio = models.BooleanField(default=False)

    # Skill Counts (Questionnaire Section 8) - denormalized for regression model
    technical_skill_count = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(12)],
        help_text="Count of technical skills selected (0-12)"
    )
    soft_skill_count = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
        help_text="Count of soft skills selected (0-10)"
    )

    # Competency Assessment
    professional_certifications = models.JSONField(
        default=list,
        blank=True,
        help_text="Array of professional certification strings"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # When the graduate last confirmed their employment record (registration or a
    # submitted employment form). The two-year retracking clock runs from here;
    # personal-detail saves deliberately never touch it.
    last_retraced_at = models.DateTimeField(null=True, blank=True)

    # Tracks when the 2-year retracking email reminder was last sent (used by send_retracking_reminders)
    last_retracking_reminder_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "users_alumni_profiles"
        # Backstops for intake validation. Mobile is deliberately not
        # constrained yet: some save paths store it as typed, so a rule here
        # would turn a formatting slip into a server error.
        constraints = [
            models.CheckConstraint(
                condition=(
                    ~models.Q(first_name__regex=r"[0-9]")
                    & ~models.Q(middle_name__regex=r"[0-9]")
                    & ~models.Q(last_name__regex=r"[0-9]")
                ),
                name="profile_names_have_no_digits",
            ),
            models.CheckConstraint(
                condition=models.Q(birth_date="") | models.Q(birth_date__regex=r"^[0-9]{4}-(0[1-9]|1[0-2])$"),
                name="profile_birth_date_is_year_month",
            ),
            models.CheckConstraint(
                condition=models.Q(graduation_date="") | models.Q(graduation_date__regex=r"^[0-9]{4}-(0[1-9]|1[0-2])$"),
                name="profile_graduation_date_is_year_month",
            ),
        ]

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
    gps_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    gps_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    gps_accuracy_m = models.FloatField(null=True, blank=True)

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
    # Admin's comment when an employer account is rejected. Surfaced to the admin
    # in the request list and included in the rejection email to the employer.
    rejection_reason = models.TextField(blank=True, default="")
    # Skills the employer is hiring for. Pulled live from the Skill reference
    # table so admin-added skills appear automatically in the employer-register
    # form's chip selectors.
    desired_skills = models.ManyToManyField(
        "tracer.Skill",
        related_name="employer_accounts_wanting",
        blank=True,
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

class PasswordResetCode(models.Model):
    """
    DS10: Password Reset Codes.

    One row per request. Stores only the sha256 hash of the code, never
    the plaintext. The row is keyed on (email, role) so the same email
    can hold reset codes for Graduate and Employer independently.
    """

    ROLE_GRADUATE = "graduate"
    ROLE_EMPLOYER = "employer"
    ROLE_ADMIN = "admin"
    ROLE_CHOICES = [
        (ROLE_GRADUATE, "Graduate"),
        (ROLE_EMPLOYER, "Employer"),
        (ROLE_ADMIN, "Admin"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(db_index=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    request_ip = models.GenericIPAddressField(null=True, blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "users_password_reset_codes"
        indexes = [
            models.Index(fields=["email", "role", "used_at"]),
            models.Index(fields=["sent_at"]),
        ]
        ordering = ["-sent_at"]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and not self.is_expired

    def __str__(self):
        return f"reset({self.role}:{self.email})"


class LoginAttemptThrottle(models.Model):
    """
    DS11: Login Throttle.

    One row per (role + email) identifier. Tracks consecutive failed
    login attempts and the active lockout (if any). Reset to zero on
    successful login.
    """

    identifier = models.CharField(max_length=320, unique=True, db_index=True)
    role = models.CharField(max_length=10)
    failed_count = models.PositiveIntegerField(default=0)
    last_failed_at = models.DateTimeField(null=True, blank=True)
    lockout_until = models.DateTimeField(null=True, blank=True)
    lockout_tier = models.PositiveSmallIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_login_attempt_throttle"

    def __str__(self):
        return f"throttle({self.identifier}) fails={self.failed_count} tier={self.lockout_tier}"


class RetrackingEvent(models.Model):
    """
    DS2 extension: Retracking history, one row per event.

    AlumniProfile only keeps the LATEST confirmation and reminder dates, so on its
    own it cannot say how often a graduate confirmed, whether they were late, or
    what changed. Each confirmation stores a snapshot of the employment record
    and what changed from the previous one; each reminder stores who sent it.
    Employer decisions are not copied here: the history endpoint reads them
    from tracer.VerificationDecision.
    """

    class Kind(models.TextChoices):
        REGISTERED = "registered", "Registered"
        RETRACED = "retraced", "Employment record confirmed"
        REMINDER = "reminder", "Reminder sent"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alumni = models.ForeignKey(AlumniAccount, on_delete=models.CASCADE, related_name="retracking_events")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    occurred_at = models.DateTimeField(default=timezone.now)
    # Snapshot of the employment record right after the event.
    employment_status = models.CharField(max_length=30, blank=True)
    job_title = models.CharField(max_length=150, blank=True)
    company = models.CharField(max_length=200, blank=True)
    #: [{"field": "job_title", "from": "...", "to": "..."}] for a confirmation.
    changes = models.JSONField(default=list, blank=True)
    #: Confirmations only: days since the previous confirmation (730+ = overdue).
    days_since_previous = models.PositiveIntegerField(null=True, blank=True)
    #: Reminders only: "auto" for the daily command, otherwise the admin's email.
    sent_by = models.CharField(max_length=254, blank=True)
    #: Rebuilt from the saved dates when the history was introduced; no snapshot.
    is_backfilled = models.BooleanField(default=False)

    class Meta:
        db_table = "users_retracking_events"
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["alumni", "-occurred_at"], name="users_retrack_alumni_idx")]

    def __str__(self):
        return f"{self.kind} {self.occurred_at:%Y-%m-%d} ({self.alumni_id})"
