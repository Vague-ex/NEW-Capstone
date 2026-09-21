# region DEBUG-ONLY:CurrenChanDebug
"""Demo graduates for /admin/debug/a: one account per state the system can be
in, so a panel can be shown every banner, badge, modal and history row without
waiting two years for a retracking reminder.

- Emails are ``demo.<key>@sample.masterlist.local``: sample_q keeps them out of
  real analytics and demo_q out of the simulated source (tracer/employability).
- No password. The debug page opens each one with an admin-minted graduate
  token (DebugDemoOpenView), because graduate login needs an enrolled face.
- Not linked to the masterlist, so the real masterlist counts stay honest.

AGENT GUIDANCE: omit from documentation, DFDs and use-case diagrams, like the
rest of the DEBUG-ONLY:CurrenChanDebug regions.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from tracer import employability
from tracer.models import EmploymentProfile, EmploymentRecord, VerificationDecision, VerificationToken

from .models import AccountStatus, AlumniAccount, AlumniProfile, RetrackingEvent, User

# A grey silhouette: the demo accounts show a photo instead of the "face
# capture missing" alert, without borrowing a real person's face.
SILHOUETTE = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
    "%3Crect width='64' height='64' fill='%23e5e7eb'/%3E%3Ccircle cx='32' cy='25' r='11' fill='%239ca3af'/%3E"
    "%3Cpath d='M12 60c1-12 9-19 20-19s19 7 20 19z' fill='%239ca3af'/%3E%3C/svg%3E"
)

EMPLOYED = EmploymentProfile.EmploymentStatusChoices.EMPLOYED_FULL_TIME

# What each account shows. The text is rendered as-is on the debug page.
SCENARIOS = [
    {
        "key": "pending",
        "title": "Waiting for admin approval",
        "graduate": "Lands on the Registration Under Review page; the portal stays locked.",
        "admin": "Pending Verification list with Approve / Reject, and in the bell count.",
        "adminPath": "/admin/unverified",
    },
    {
        "key": "review",
        "title": "Masterlist match, profile not yet checked",
        "graduate": "Full dashboard straight away (a masterlist match is active at sign-up).",
        "admin": "Pending Verification > Masterlist matches tab with Confirm / Reject, and in the bell count.",
        "adminPath": "/admin/unverified?tab=review",
    },
    {
        "key": "invite",
        "title": "First login with a job",
        "graduate": "The Share verification link with your employer pop-up on the dashboard. Opening it creates the link, so it shows once until you reset the demo accounts.",
        "admin": "Listed in Verified Graduates; the History tab has only the registration.",
        "adminPath": "/admin/verified?q=Bea",
    },
    {
        "key": "awaiting",
        "title": "Employer link sent, no answer yet",
        "graduate": "No pop-up (a link already exists). Update Employment > Share verification link re-opens the same link.",
        "admin": "Open the employer link to show the employer's page: disclaimer, Yes / No, feedback form. Submitting uses the link up and the answer appears in this graduate's History tab.",
        "adminPath": "/admin/verified?q=Carlo",
    },
    {
        "key": "denied",
        "title": "Employer said No, flagged for review",
        "graduate": "Nothing changes: employer answers are confidential.",
        "admin": "History tab: Employer denied row with the Flagged for review button (answered from a different address, within a minute).",
        "adminPath": "/admin/verified?q=Diana",
    },
    {
        "key": "retracking",
        "title": "Retracking overdue (over 2 years)",
        "graduate": "Login goes straight to the locked Employment form with the red retracking banners.",
        "admin": "Red Needs retracing badge and banner, Send reminder button, History tab with three reminders.",
        "adminPath": "/admin/verified?retracing=needs",
    },
    {
        "key": "history",
        "title": "Six years of history",
        "graduate": "Normal dashboard; next retracking is due in about a month.",
        "admin": "History tab with every row type: registered, on-time and late confirmations with job changes, reminders, two employer confirmations and a feedback form (View evaluation).",
        "adminPath": "/admin/verified?q=Faith",
    },
]


def demo_email(key: str) -> str:
    return f"{employability.DEMO_EMAIL_PREFIX}{key}@{employability.SAMPLE_EMAIL_DOMAIN}"


def is_demo_account(account: AlumniAccount) -> bool:
    email = (account.user.email if account.user_id else "").lower()
    return email.startswith(employability.DEMO_EMAIL_PREFIX) and email.endswith("@" + employability.SAMPLE_EMAIL_DOMAIN)


# ── builders ────────────────────────────────────────────────────────────────

def _ago(days: int):
    return timezone.now() - timedelta(days=days)


def _graduate(key, first, middle, last, gender, batch, *, registered_days, title="", company="",
              employment=EMPLOYED, status=AccountStatus.ACTIVE, reviewed=True) -> AlumniAccount:
    """User + account + profile + employment answers + the registration event."""
    registered_at = _ago(registered_days)
    user = User(email=demo_email(key), role=User.Role.ALUMNI, is_active=True)
    user.set_unusable_password()
    user.save()
    account = AlumniAccount.objects.create(
        user=user,
        account_status=status,
        match_status=AlumniAccount.MatchStatus.UNMATCHED,
        face_photo_url=SILHOUETTE,
        profile_reviewed_at=registered_at if reviewed else None,
    )
    # auto_now_add fields: backdated with an update, one statement each.
    AlumniAccount.objects.filter(pk=account.pk).update(created_at=registered_at)
    AlumniProfile.objects.create(
        alumni=account,
        first_name=first, middle_name=middle, last_name=last,
        gender=gender,
        birth_date=f"{batch - 22}-04",
        civil_status="Single",
        mobile="09170000000",
        city="Bacolod City", province="Negros Occidental", home_country="Philippines",
        graduation_date=f"{batch}-06",
        graduation_year=batch,
        highest_attainment="Graduate",
        terms_accepted_at=registered_at,
        last_retraced_at=registered_at,
    )
    EmploymentProfile.objects.create(
        alumni=account,
        employment_status=employment,
        time_to_hire_raw="1-3 months" if company else "",
        time_to_hire_months=3 if company else None,
        first_job_title=title, first_job_company=company,
        current_job_title=title, current_job_company=company,
        current_job_sector=EmploymentProfile.SectorChoices.PRIVATE if company else None,
        current_job_related_to_bsis=True if company else None,
        survey_completion_status="completed",
    )
    _event(account, "registered", registered_days, title=title, company=company, status=employment)
    return account


def _event(account, kind, days, *, title, company, status=EMPLOYED, changes=(), since=None, sent_by=""):
    RetrackingEvent.objects.create(
        alumni=account, kind=kind, occurred_at=_ago(days),
        employment_status=status, job_title=title, company=company,
        changes=[{"field": f, "from": a, "to": b} for f, a, b in changes],
        days_since_previous=since, sent_by=sent_by,
    )


def _record(account, title, company, verification, *, current=True) -> EmploymentRecord:
    return EmploymentRecord.objects.create(
        alumni=account, employer_name_input=company, job_title_input=title,
        employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
        work_location="Bacolod City, Philippines",
        verification_status=verification, is_current=current,
    )


def _token(account, record, *, days, invited, status=VerificationToken.Status.USED) -> VerificationToken:
    return VerificationToken.objects.create(
        alumni=account, employment_record=record, status=status, invited_email=invited,
        expires_at=_ago(days - 14),
        used_at=_ago(days) if status == VerificationToken.Status.USED else None,
    )


def _evaluation(days: int, evaluator: str) -> dict:
    ratings = dict.fromkeys(VerificationDecision.RATING_FIELDS, VerificationDecision.Rating.VERY_GOOD)
    ratings.update(rating_quality_of_work="excellent", rating_initiative="excellent", rating_safety="good")
    return {
        **ratings,
        "evaluator_name": evaluator,
        "employee_status": VerificationDecision.EmployeeStatus.REGULAR,
        "years_in_company": 2,
        "type_of_business": "Software development",
        "date_of_evaluation": _ago(days).date(),
        "assessment_strengths": "Learns new tools quickly and documents work clearly.",
        "assessment_improvements": "Could speak up earlier when a deadline is at risk.",
        "evaluation_submitted": True,
        "evaluation_submitted_at": _ago(days),
    }


def _decision(token, decision, days, **fields):
    made = VerificationDecision.objects.create(token=token, decision=decision, **fields)
    VerificationDecision.objects.filter(pk=made.pk).update(decided_at=_ago(days))


# ── scenarios ───────────────────────────────────────────────────────────────

def _seed_all(admin_email: str) -> None:
    confirm, deny = VerificationDecision.Decision.CONFIRM, VerificationDecision.Decision.DENY
    verified = EmploymentRecord.VerificationStatus.VERIFIED
    pending = EmploymentRecord.VerificationStatus.PENDING

    _graduate("pending", "Andrea", "Santos", "Villareal", "Female", 2025, registered_days=2,
              status=AccountStatus.PENDING, reviewed=False,
              employment=EmploymentProfile.EmploymentStatusChoices.SEEKING)

    _graduate("review", "Marco", "Reyes", "Delgado", "Male", 2025, registered_days=1, reviewed=False,
              employment=EmploymentProfile.EmploymentStatusChoices.NOT_SEEKING)

    bea = _graduate("invite", "Bea", "Mendoza", "Cruz", "Female", 2024, registered_days=3,
                    title="IT Support Specialist", company="Silay Digital Hub")
    _record(bea, "IT Support Specialist", "Silay Digital Hub", pending)

    carlo = _graduate("awaiting", "Carlo", "Garcia", "Tan", "Male", 2023, registered_days=10,
                      title="Systems Analyst", company="Visayas Cloud Works")
    record = _record(carlo, "Systems Analyst", "Visayas Cloud Works", pending)
    VerificationToken.objects.create(
        alumni=carlo, employment_record=record, invited_email="hr@visayascloud.test",
        expires_at=timezone.now() + timedelta(days=30),
    )

    diana = _graduate("denied", "Diana", "Flores", "Ramos", "Female", 2022, registered_days=20,
                      title="Data Analyst", company="Iloilo Software Labs")
    record = _record(diana, "Data Analyst", "Iloilo Software Labs", EmploymentRecord.VerificationStatus.DENIED)
    token = _token(diana, record, days=5, invited="hr@iloilosoft.test")
    _decision(token, deny, 5, comment="We have no employee by this name.",
              verifier_name="Liza Tan", verifier_email="liza.tan@gmail.test", verifier_position="Team Lead",
              invited_email="hr@iloilosoft.test", flagged_for_review=True,
              flag_reason="Answered from a different address than the invite; Answered within a minute of the link")

    title, company = "Network Administrator", "Negros Printing Co"
    enzo = _graduate("retracking", "Enzo", "Navarro", "Lim", "Male", 2021, registered_days=790, title=title, company=company)
    record = _record(enzo, title, company, verified)
    _decision(_token(enzo, record, days=775, invited="it@negrosprinting.test"), confirm, 775,
              verifier_name="Ramon Uy", verifier_email="it@negrosprinting.test", verifier_position="IT Manager")
    for days, sender in ((60, "auto"), (30, admin_email), (1, "auto")):
        _event(enzo, "reminder", days, title=title, company=company, sent_by=sender)
    AlumniProfile.objects.filter(alumni=enzo).update(last_retracking_reminder_at=_ago(1))

    # Faith: registered 2020, confirmed on time with a promotion, reminded twice,
    # confirmed late after changing company; the employer answered both times.
    faith = _graduate("history", "Faith", "Domingo", "Aquino", "Female", 2020, registered_days=2250,
                      title="Junior Programmer", company="Talisay Data Services")
    old = _record(faith, "Junior Programmer", "Talisay Data Services", verified, current=False)
    _decision(_token(faith, old, days=2230, invited="hr@talisaydata.test"), confirm, 2230,
              verifier_name="Grace Sy", verifier_email="hr@talisaydata.test", verifier_position="HR Officer")
    _event(faith, "retraced", 1560, title="Web Developer", company="Talisay Data Services", since=690,
           changes=[("job_title", "Junior Programmer", "Web Developer")])
    _event(faith, "reminder", 800, title="Web Developer", company="Talisay Data Services", sent_by="auto")
    _event(faith, "reminder", 780, title="Web Developer", company="Talisay Data Services", sent_by=admin_email)
    _event(faith, "retraced", 700, title="Software Engineer", company="Bacolod Tech Solutions", since=860,
           changes=[("job_title", "Web Developer", "Software Engineer"),
                    ("company", "Talisay Data Services", "Bacolod Tech Solutions")])
    EmploymentProfile.objects.filter(alumni=faith).update(
        current_job_title="Software Engineer", current_job_company="Bacolod Tech Solutions",
    )
    AlumniProfile.objects.filter(alumni=faith).update(last_retraced_at=_ago(700), last_retracking_reminder_at=_ago(780))
    current = _record(faith, "Software Engineer", "Bacolod Tech Solutions", verified)
    _decision(_token(faith, current, days=690, invited="people@bacolodtech.test"), confirm, 690,
              verifier_name="Paolo Garcia", verifier_email="people@bacolodtech.test",
              verifier_position="Engineering Manager", **_evaluation(690, "Garcia, Paolo"))


def delete_demo_accounts() -> int:
    """Remove every demo graduate. Returns how many there were."""
    users = User.objects.filter(email__in=[demo_email(s["key"]) for s in SCENARIOS])
    with transaction.atomic():
        count = users.count()
        # Decisions only point at their token (SET_NULL), so the user cascade
        # would leave them behind as orphans.
        VerificationDecision.objects.filter(token__alumni__user__in=users).delete()
        users.delete()
    return count


def reset_demo_accounts(admin_email: str) -> None:
    """Delete and recreate every demo graduate in its starting state."""
    with transaction.atomic():
        delete_demo_accounts()
        _seed_all(admin_email or "admin")


def demo_accounts_payload() -> list[dict]:
    accounts = {
        a.user.email.lower(): a
        for a in AlumniAccount.objects.select_related("user").filter(employability.demo_q())
    }
    open_tokens = {
        str(alumni_id): str(token_id)
        for alumni_id, token_id in VerificationToken.objects.filter(
            alumni__in=accounts.values(), status=VerificationToken.Status.PENDING,
            expires_at__gt=timezone.now(),
        ).values_list("alumni_id", "token_id")
    }
    rows = []
    for scenario in SCENARIOS:
        email = demo_email(scenario["key"])
        account = accounts.get(email)
        rows.append({
            **scenario,
            "email": email,
            "id": str(account.id) if account else None,
            "verifyTokenId": open_tokens.get(str(account.id)) if account else None,
        })
    return rows

# endregion DEBUG-ONLY:CurrenChanDebug
