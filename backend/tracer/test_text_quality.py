from django.test import SimpleTestCase

from tracer.text_quality import (
    job_text_problem,
    person_name_problem,
    ph_mobile_problem,
    profanity_problem,
    year_month_problem,
)


class ProfanityTests(SimpleTestCase):
    def test_vulgar_words_and_common_dodges_are_caught(self):
        for text in ["Gago", "Tanginamo", "p u t a n g i n a", "Fvck boy", "fuuuck", "B0b0", "Sh1t Manager"]:
            self.assertIsNotNone(profanity_problem(text), text)

    def test_ordinary_words_that_contain_bad_substrings_pass(self):
        # Substring matching would wrongly block all of these.
        for text in ["Scunthorpe Analyst", "Cockpit Crew", "Shitake Farmer", "Class Adviser", "Assistant", "Bobby"]:
            self.assertIsNone(profanity_problem(text), text)

    def test_names_that_are_also_slang_are_allowed_as_names_only(self):
        self.assertIsNone(person_name_problem("Dick Gordon"))
        self.assertIsNotNone(job_text_problem("Dick"))


class PersonNameTests(SimpleTestCase):
    def test_real_filipino_names_pass(self):
        for name in ["Ma. Niña O'Neil-Reyes", "Juan Dela Cruz", "Sto. Tomas"]:
            self.assertIsNone(person_name_problem(name, required=True), name)

    def test_digits_symbols_and_blanks_are_refused(self):
        self.assertEqual(person_name_problem("Juan 2"), "contains digits")
        self.assertEqual(person_name_problem("J@ne"), "contains symbols")
        self.assertEqual(person_name_problem(".", required=True), "has no letters")
        self.assertEqual(person_name_problem("  ", required=True), "is blank")


class OtherFieldTests(SimpleTestCase):
    def test_job_text(self):
        self.assertEqual(job_text_problem("123"), "has no letters")
        self.assertEqual(job_text_problem("A"), "is too short")
        self.assertIsNone(job_text_problem("Security Guard"))

    def test_ph_mobile(self):
        self.assertIsNone(ph_mobile_problem("0917 123 4567"))
        self.assertIsNone(ph_mobile_problem("+639171234567"))
        self.assertIsNotNone(ph_mobile_problem("12345"))

    def test_year_month(self):
        self.assertIsNone(year_month_problem("2001-06", min_age=18, max_age=70))
        self.assertEqual(year_month_problem("2001-13"), "is not in YYYY-MM format")
        self.assertEqual(year_month_problem("2099-01"), "is in the future")
