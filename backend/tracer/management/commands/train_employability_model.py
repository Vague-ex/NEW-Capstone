"""
Train the "employed within 12 months" model, run the acceptance gate, and save
the result as a new version under ml/models/employability/.

    python manage.py train_employability_model                      # real graduate records
    python manage.py train_employability_model --activate           # activate if it passes
    python manage.py train_employability_model --source simulated-accounts --activate
                                                                    # seeded graduates (seed_simulated_graduates)
    python manage.py train_employability_model --source simulated \
        --scenario harsh --signal moderate --respondents 1500       # in-memory demonstration data

Real and seeded graduates each have their own active model (active.json and
active-simulated.json), matching the analytics source chosen on /admin/debug/a.

Every run is saved, including runs that fail the gate, so a rejection is
documented. Only a passing run can be activated, and the previous active
version is recorded in active.json for rollback. This command is the only way
the model changes: adding or removing accounts never retrains it.
"""

from django.core.management.base import BaseCommand, CommandError

from tracer import employability


class Command(BaseCommand):
    help = "Train the employability model, run the acceptance gate, and save a new version."

    def add_arguments(self, parser):
        parser.add_argument("--source", choices=["database", "simulated-accounts", "simulated"], default="database")
        parser.add_argument("--scenario", choices=["harsh", "pids"], default="harsh",
                            help="Simulated source only: labor market.")
        parser.add_argument("--signal", choices=["weak", "moderate", "strong"], default="moderate",
                            help="Simulated source only: how much the survey answers matter.")
        parser.add_argument("--respondents", type=int, default=None,
                            help="Simulated source only: approximate number of respondents.")
        parser.add_argument("--seed", type=int, default=20260916)
        parser.add_argument("--include-samples", action="store_true",
                            help="Database source only: keep seeded sample accounts (demonstration only).")
        parser.add_argument("--activate", action="store_true",
                            help="Make this version active if it passes every check.")

    def handle(self, *args, **opts):
        if opts["source"] == "database":
            frame = employability.build_graduate_frame()
            future = int(frame["future_graduation"].astype(bool).sum())
            frame = employability.reportable(frame)
            samples = int(frame["is_sample"].astype(bool).sum())
            if not opts["include_samples"]:
                frame = frame[~frame["is_sample"].astype(bool)]
            details = {
                "graduates": int(len(frame)),
                "sample_accounts_excluded": 0 if opts["include_samples"] else samples,
                "future_graduation_excluded": future,
            }
        elif opts["source"] == "simulated-accounts":
            frame = employability.build_graduate_frame(source=employability.SOURCE_SIMULATED)
            future = int(frame["future_graduation"].astype(bool).sum())
            frame = employability.reportable(frame)
            details = {"seeded_graduates": int(len(frame)), "future_graduation_excluded": future}
        else:
            frame, details = employability.simulated_frame(
                scenario=opts["scenario"], signal=opts["signal"],
                respondents=opts["respondents"], seed=opts["seed"],
            )

        eligible = int(frame[employability.TARGET].notna().sum())
        self.stdout.write(f"Source: {opts['source']} {details}")
        self.stdout.write(f"{len(frame)} graduates, {eligible} with a known 12-month outcome")

        result = employability.evaluate_candidate(frame, seed=opts["seed"])
        version, meta = employability.save_version(result, frame, opts["source"], details)

        self.stdout.write("")
        for c in meta["checks"]:
            mark = self.style.SUCCESS("PASS") if c["passed"] else self.style.ERROR("FAIL")
            self.stdout.write(f"  [{mark}] {c['label']}: {c['value']}")
        if meta["factors"]:
            self.stdout.write("\n  Factors (odds ratio, 95% interval):")
            for f in meta["factors"]:
                note = "" if f["clear"] else "  (no clear association)"
                self.stdout.write(f"    {f['label']}: {f['odds_ratio']:.2f} ({f['ci_low']:.2f}-{f['ci_high']:.2f}){note}")

        self.stdout.write(f"\nSaved {version} in {employability.model_root()}")
        if meta["passed"]:
            self.stdout.write(self.style.SUCCESS("Passed every acceptance check."))
            if opts["activate"]:
                # Anything trained on simulated graduates can only ever become the
                # simulated source's model, never the real one.
                target = (
                    employability.SOURCE_REAL if opts["source"] == "database" else employability.SOURCE_SIMULATED
                )
                employability.activate_version(version, target)
                self.stdout.write(self.style.SUCCESS(f"Activated {version}."))
            else:
                self.stdout.write(f"Not activated. Run again with --activate, or activate {version} later.")
        else:
            if opts["activate"]:
                raise CommandError(f"{version} failed the acceptance gate and was not activated.")
            self.stdout.write(self.style.WARNING("Did not pass the acceptance gate; saved as a record only."))
