from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tracer.models import EmploymentProfile, VerificationDecision, VerificationToken
from users.auth import generate_admin_access_token, generate_alumni_access_token
from users.models import AccountStatus, AlumniAccount, AlumniProfile, RetrackingEvent, User


class RetrackingHistoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="history-admin@example.com", password="AdminPass123!", role=User.Role.ADMIN, is_staff=True,
        )
        self.admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(self.admin.id)}"}
        self.user = User.objects.create_user(email="history-grad@example.com", password="GradPass123!", role=User.Role.ALUMNI)
        self.account = AlumniAccount.objects.create(user=self.user, account_status=AccountStatus.ACTIVE)
        AlumniProfile.objects.create(
            alumni=self.account, first_name="Divine", last_retraced_at=timezone.now() - timedelta(days=800),
        )
        EmploymentProfile.objects.create(
            alumni=self.account, employment_status="employed_full_time",
            current_job_title="Web Developer", current_job_company="Acme",
        )

    def _save_employment(self, **extra):
        return self.client.post(
            f"/api/auth/alumni/account/{self.account.id}/employment/",
            {
                "employment_status": "employed",
                "survey_data": {
                    "employment_status": "employed_full_time",
                    "currentJobPosition": "Artist",
                    "currentJobCompany": "Studio One",
                },
                "notify_previous_evaluator": False,
                **extra,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {generate_alumni_access_token(self.user.id)}",
        )

    def test_employment_form_save_logs_what_changed_and_how_late(self):
        self.assertEqual(self._save_employment(retrace_submission=True).status_code, 200)

        event = RetrackingEvent.objects.get(alumni=self.account)
        self.assertEqual(event.kind, RetrackingEvent.Kind.RETRACED)
        self.assertGreaterEqual(event.days_since_previous, 800)
        changes = {c["field"]: (c["from"], c["to"]) for c in event.changes}
        self.assertEqual(changes["job_title"], ("Web Developer", "Artist"))
        self.assertEqual(changes["company"], ("Acme", "Studio One"))
        self.assertNotIn("employment_status", changes)

    def test_other_profile_saves_are_not_logged(self):
        self.assertEqual(self._save_employment().status_code, 200)
        self.assertFalse(RetrackingEvent.objects.filter(alumni=self.account).exists())

    def test_admin_reminder_is_logged_with_sender(self):
        with patch("users.api.send_retracking_email"):
            response = self.client.post(
                f"/api/admin/alumni/{self.account.id}/retracking-reminder/", {}, format="json", **self.admin_auth,
            )
        self.assertEqual(response.status_code, 200)
        event = RetrackingEvent.objects.get(alumni=self.account)
        self.assertEqual((event.kind, event.sent_by), (RetrackingEvent.Kind.REMINDER, self.admin.email))

    def test_history_is_admin_only_and_merges_employer_decisions_newest_first(self):
        now = timezone.now()
        RetrackingEvent.objects.create(
            alumni=self.account, kind=RetrackingEvent.Kind.REGISTERED, occurred_at=now - timedelta(days=900),
            is_backfilled=True,
        )
        RetrackingEvent.objects.create(
            alumni=self.account, kind=RetrackingEvent.Kind.RETRACED, occurred_at=now - timedelta(days=1),
            days_since_previous=760, changes=[{"field": "employment_status", "from": "seeking", "to": "employed_full_time"}],
        )
        RetrackingEvent.objects.create(
            alumni=self.account, kind=RetrackingEvent.Kind.REMINDER, occurred_at=now - timedelta(days=10), sent_by="auto",
        )
        token = VerificationToken.objects.create(alumni=self.account, expires_at=now + timedelta(days=7))
        VerificationDecision.objects.create(
            token=token, decision=VerificationDecision.Decision.CONFIRM,
            verified_employer_name="Studio One", verifier_name="Ana Cruz", verifier_position="HR",
        )

        url = f"/api/admin/alumni/{self.account.id}/retracking-history/"
        self.assertIn(self.client.get(url).status_code, (401, 403))
        response = self.client.get(url, **self.admin_auth)
        self.assertEqual(response.status_code, 200)

        events = response.data["events"]
        self.assertEqual([e["kind"] for e in events], ["employer_confirmed", "retraced", "reminder", "registered"])
        self.assertEqual(events[0]["verifier"], "Ana Cruz, HR")
        self.assertEqual(events[1]["overdueDays"], 30)
        self.assertEqual(events[1]["changes"][0]["to"], "Employed Full-Time")
        self.assertTrue(events[3]["backfilled"])
        self.assertEqual(
            response.data["summary"],
            {"confirmations": 1, "lateConfirmations": 1, "reminders": 1, "employerDecisions": 1},
        )

    def test_history_of_unknown_graduate_is_not_found_but_empty_history_is_fine(self):
        from uuid import uuid4

        self.assertEqual(
            self.client.get(f"/api/admin/alumni/{uuid4()}/retracking-history/", **self.admin_auth).status_code, 404,
        )
        response = self.client.get(f"/api/admin/alumni/{self.account.id}/retracking-history/", **self.admin_auth)
        self.assertEqual((response.status_code, response.data["events"]), (200, []))
