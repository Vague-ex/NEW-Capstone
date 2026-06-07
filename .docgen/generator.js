const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
} = require("docx");

const OUT = "C:/Users/Lenovo/OneDrive/Desktop/NEW-Capstone/documentations";

// ---- helpers ----
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun(t)] });
const SAY = (name, t) => new Paragraph({ spacing: { after: 150 }, children: [new TextRun({ text: name + ": ", bold: true }), new TextRun(t)] });
const DO = (t) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "[ " + t + " ]", italics: true, color: "0F7B3F" })] });
const BUL = (t) => new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const NUM = (t) => new Paragraph({ numbering: { reference: "num", level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const Q = (t) => new Paragraph({ spacing: { before: 150, after: 50 }, children: [new TextRun({ text: "Q: " + t, bold: true })] });
const A = (t) => new Paragraph({ spacing: { after: 110 }, children: [new TextRun({ text: "A: " }), new TextRun(t)] });
const NOTE = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, italics: true, color: "8a6d00" })] });
const Title = (t) => new Paragraph({ style: "Title", children: [new TextRun(t)] });
const Sub = (t) => new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: t, color: "555555", size: 24 })] });

const baseStyles = {
  default: { document: { run: { font: "Arial", size: 22 } } },
  paragraphStyles: [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 40, bold: true, font: "Arial", color: "0F7B3F" }, paragraph: { spacing: { after: 120 } } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, font: "Arial", color: "14532d" }, paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, font: "Arial", color: "166534" }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true, font: "Arial", color: "333333" }, paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
  ],
};
const numbering = { config: [
  { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
  { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
]};
const pageProps = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } };
function build(children) { return new Document({ styles: baseStyles, numbering, sections: [{ properties: pageProps, children }] }); }

const MODS = [
  "Module 1 — Graduate Registration & Verification",
  "Module 2 — Biometric Verification",
  "Module 3 — Graduate Profile & Employment Monitoring",
  "Module 4 — Employer Interaction",
  "Module 5 — Geographic Distribution & Mapping",
  "Module 6 — Predictive Employability Trend Analysis",
  "Module 7 — Administrative Dashboard",
  "Module 8 — Reporting & Documentation",
];

// ============================================================ SCRIPT
const script = [
  Title("BSIS Graduate Tracer System"),
  Sub("Pre-Oral Defense Script  •  CHMSU–Talisay  •  Presentation + Live Demo"),

  H2("Presenters & Roles"),
  BUL("Pingcale — Project Manager (PPT intro & framing, Admin Dashboard, Reporting, closing)"),
  BUL("Espiritu — System Analyst (Registration/Verification, Profile & Employment Monitoring, Employer Interaction)"),
  BUL("Aguilar — Programmer (Biometric, Geomapping, Predictive Analytics — the technical demos)"),
  P("Legend — Bold name = who speaks.  Green [ brackets ] = what to click / show."),

  H1("Part 1 — Presentation (PowerPoint)"),
  H2("1.1 Title & Team"),
  DO("Title slide on screen."),
  SAY("Pingcale", "Good morning/afternoon. We present the BSIS Graduate Tracer System with Predictive Employability Trend Analysis for CHMSU–Talisay. I'm Pingcale, project manager, with Espiritu, our system analyst, and Aguilar, our programmer."),

  H2("1.2 Introduction"),
  SAY("Pingcale", "Tracing where our graduates end up is required for accreditation and program improvement, but the usual methods — forms and spreadsheets — give data that is incomplete, hard to verify, and rarely used for decisions. Our system fixes this by making graduate data trustworthy, visual, and predictive."),

  H2("1.3 Objectives"),
  P("General objective:"),
  BUL("To design and develop a web-based graduate tracer system that collects verified employment data and predicts employability trends for the BSIS program."),
  P("Specific objectives:"),
  NUM("Verify graduate identity using biometric (face) capture with a liveness check and geo-tagging."),
  NUM("Collect standardized employment data through a CHED-based tracer survey."),
  NUM("Let employers confirm and evaluate graduate employment."),
  NUM("Map graduate work locations geographically."),
  NUM("Predict employability outcomes and trends from the 2020–2025 data."),
  NUM("Provide the program chair an admin dashboard and exportable reports."),

  H2("1.4 Significance of the Study"),
  BUL("Graduates — a simple, verified way to keep their employment record current."),
  BUL("Employers — a quick channel to confirm hires and view talent/skill trends."),
  BUL("Program Chair / Faculty — clean data, a live map, analytics, and accreditation-ready reports."),
  BUL("The Institution & future researchers — an evidence base for curriculum decisions and further study."),

  H2("1.5 Scope & Limitations"),
  P("Scope:"),
  BUL("BSIS graduates of CHMSU–Talisay, batches 2020–2025."),
  BUL("Eight modules: registration/verification, biometric, profile & employment monitoring, employer interaction, geomapping, prediction, admin dashboard, and reporting."),
  P("Limitations:"),
  BUL("Predictions are statistical estimates of likelihood/trend, not guarantees."),
  BUL("The dataset is limited to our graduate population, so accuracy improves as more batches are traced."),
  BUL("Face verification needs adequate lighting and a working camera; it requires internet access."),
  BUL("Workplace map pins are city-level estimates unless the graduate sets an exact pin."),
  SAY("Pingcale", "With the framing done, we'll now demonstrate the live system, module by module."),

  H1("Part 2 — Live System Demonstration (by Module)"),

  H2(MODS[0]),
  DO("Espiritu opens the graduate registration flow, then the admin verification queue."),
  SAY("Espiritu", "A graduate registers through a guided form — account, personal and educational details, then the employment survey. As they type their name, the system checks it against the official BSIS masterlist; a match means automatic verification, while an unmatched entry is flagged for the program chair. On the admin side, the chair reviews pending graduates and approves them — that's how we keep every record real and accountable."),

  H2(MODS[1]),
  DO("Aguilar shows face capture at registration, then a face login."),
  SAY("Aguilar", "Identity is captured live through the camera — uploads aren't allowed. During registration we take three guided shots with a liveness check: look forward, open mouth, and turn your head — proving a live person, not a photo. For login it's two quick steps: a front-facing scan to recognize the face, then a liveness action that shows 'Approved' before verifying. Each capture is stamped with date, time, and GPS for the audit trail."),

  H2(MODS[2]),
  DO("Espiritu logs in as a graduate flagged for retracking; shows the update + admin monitoring."),
  SAY("Espiritu", "Careers change, so every two years a graduate is asked to update their record. The system shows a notice and only asks for what changes — current job, work location, and personal details — not their first-job or academic history. When a graduate changes employer or role, the record re-opens for re-verification, and the program chair can monitor these changes from the admin side."),

  H2(MODS[3]),
  DO("Espiritu walks the employer flow: register → pending → admin approve → check graduate → evaluate."),
  SAY("Espiritu", "Employers interact through their own portal. They register, wait for the program chair's approval, then can confirm a graduate's employment and complete a short, confidential performance evaluation. If two evaluators come from the same company, the admin list groups them under one company. Employers can also view anonymized insights, including unemployed-graduate counts, to support recruitment."),

  H2(MODS[4]),
  DO("Aguilar opens the geomap and filters by batch/industry."),
  SAY("Aguilar", "This map plots where our graduates work. The chair can filter by batch, industry, or status to see local and overseas concentrations. Exact pins come from a graduate-set location; otherwise we estimate from the city, which we clearly mark as approximate so the data stays honest."),

  H2(MODS[5]),
  DO("Aguilar opens the analytics / predictions dashboard."),
  SAY("Aguilar", "Using the 2020–2025 data, the system learns how a graduate's background relates to their outcomes, then predicts two things: whether the graduate is employed, and how long it took them to get hired. We also track whether their first and current jobs are BSIS-related — but that's observed data we display, not a prediction. We aggregate the results into trends — rising skills, growing industries, and typical time-to-hire. It's a forecast: not a guarantee for one person, but a reliable direction for the program."),

  H2(MODS[6]),
  DO("Pingcale opens the admin dashboard."),
  SAY("Pingcale", "The administrative dashboard is the program chair's command center — verification queues, user management, reference lists for industries, job titles and skills, and a single view of the system's status. Access is role-based, so each user sees only what they should."),

  H2(MODS[7]),
  DO("Pingcale opens reports and exports a sample."),
  SAY("Pingcale", "Finally, the system turns everything into reports — batch summaries, employment outcomes, a skills inventory, and a data-quality report — all exportable for accreditation and planning. This is how the data becomes documentation the program can act on."),

  H1("Closing"),
  SAY("Pingcale", "In summary, our system verifies the graduate, maps where they work, confirms employment through employers, and turns it all into foresight that keeps the BSIS program aligned with industry needs. Thank you — we welcome your questions."),

  H2("Speaking order at a glance"),
  BUL("Pingcale: Part 1 (all PPT) → Module 7 → Module 8 → Closing"),
  BUL("Espiritu: Module 1 → Module 3 → Module 4"),
  BUL("Aguilar: Module 2 → Module 5 → Module 6"),
];

// ============================================================ QUESTIONS
const questions = [
  Title("Anticipated Panel Questions"),
  Sub("Suggested Answers  •  organized to match the 8 modules"),
  NOTE("The model metrics below are the REAL current numbers from your trained pipeline (model_metadata.json / evaluation_report.json, trained 2026-05-20). They are measured on synthetic training data and will change once 80+ real verified records replace it — say so if asked. Always quote the cross-validation number, not the in-sample one."),

  H1("A. Project, Objectives & Scope"),
  Q("What problem does the system solve?"),
  A("Graduate tracer data is usually incomplete, self-reported, and rarely acted on. We make it trustworthy (verified identity + employer confirmation), visual (map + reports), and useful (employability prediction)."),
  Q("How is this different from a Google Form tracer?"),
  A("A form can't verify identity, can't confirm employment, can't map results, and can't predict trends. Ours does all four and keeps the data clean enough to analyze."),
  Q("What are your limitations?"),
  A("Predictions are estimates, the dataset is limited to our batches, face verification needs lighting/internet, and map pins are city-level estimates unless a graduate sets an exact pin."),

  H1("B. Module 1 — Registration & Verification"),
  Q("How do you prevent fake or duplicate graduates?"),
  A("Live face capture (no uploads) plus a name match against the official BSIS masterlist; matched graduates are auto-verified and unmatched ones go to the program chair for manual review."),
  Q("Why match against a masterlist?"),
  A("It anchors every registrant to an official institutional record, which is what makes the verification credible for accreditation."),

  H1("C. Module 2 — Biometric Verification"),
  Q("How does face recognition actually work?"),
  A("The model turns a face into a 128-number 'faceprint'; we compare a new faceprint to the stored one by distance and accept it within a set threshold."),
  Q("How does the liveness check stop a photo or video?"),
  A("It uses facial-landmark math — mouth-opening ratio and head-turn angle — and the action is requested live, so a static photo or a single pre-recorded clip can't reliably satisfy it."),
  Q("Is the biometric data secure / RA 10173 compliant?"),
  A("Faces are stored as numeric faceprints, access is role-based, captures are logged with date/time/GPS, and collection is consented and purpose-limited."),

  H1("D. Module 3 — Profile & Employment Monitoring"),
  Q("Why retrack every two years?"),
  A("Careers change — promotions, new employers, going abroad — so periodic updates keep the data and the trends meaningful."),
  Q("What stops a graduate from faking a promotion to look better?"),
  A("Any company/role change re-opens the record as pending and requires employer confirmation before it counts as verified."),

  H1("E. Module 4 — Employer Interaction"),
  Q("Why let employers verify instead of trusting the graduate?"),
  A("Self-reported employment can be inaccurate; employer confirmation, approved by the program chair, makes it credible."),
  Q("Two rows showed the same company — is that wrong?"),
  A("No. A company isn't a unique record; each evaluator is their own account identified by email. The admin list groups multiple evaluators under one company, and we distinguish them by contact person."),

  H1("F. Module 5 — Geographic Mapping"),
  Q("How accurate are the map locations?"),
  A("Exact when the graduate sets their workplace pin; otherwise we estimate from the city and mark the pin as 'approximate,' so we never overstate precision."),

  H1("G. Module 6 — Predictive Employability Analysis"),
  NOTE("Dataset behind every answer here: 230 records, batches 2020–2025, 31 features, about 67% employed, 5-fold cross-validation. Currently synthetic data because real verified records are still below the 80+ threshold — be ready to say so."),

  Q("What exactly does the model predict?"),
  A("Two things. First, whether a graduate is employed — a yes/no classification. Second, how long it took them to get hired in months — a numeric regression. We also display whether their first and current jobs are BSIS-related, but that is observed survey data, not a model prediction."),

  Q("How do you know if a prediction is right?"),
  A("We don't grade the model on the data it learned from. We use 5-fold cross-validation: the data is split into five parts, the model trains on four and is tested on the fifth it never saw, repeated five times. 'Right' means how well it matched graduates whose real outcomes we already know — and we always report that cross-validation number, not the easier in-sample one."),

  Q("What are your actual numbers?"),
  A("For employment status, our Random Forest classifier scores about 90% accuracy — precision 0.92, recall 0.93, F1 0.93 in-sample, and a cross-validated F1 of 0.89. Out of 230 graduates it classifies 207 correctly: 64 correctly unemployed and 143 correctly employed, with 23 misses. For time-to-hire, our Random Forest reaches a cross-validation R-squared of 0.25 — it explains about a quarter of the variation in how fast graduates get hired; in-sample it fits to R-squared 0.87 with an average error of about 0.37 months."),

  Q("Your employment model is about 90% — how do you know that isn't just overfitting?"),
  A("Because we choose the winning model on cross-validation, not on how well it fits the training data. Gradient boosting actually scored a perfect 100% on the training set but only 85% on held-out folds — a textbook overfit, so we rejected it. Random Forest generalized best: 90% on training and 89% cross-validated, and that small gap is what tells us the 90% is honest rather than memorized. It's trained on synthetic data for now, so the exact figure will shift once real verified records replace it."),

  Q("Your time-to-hire R-squared is 0.87 in training but 0.25 in cross-validation — explain that gap."),
  A("That gap is the overfitting. The model memorizes patterns in the 230 training rows it can't reproduce on held-out folds. We quote the 0.25 because it's the honest generalization number. The fix is more real data, not a deeper model — which is exactly why the pipeline is built to retrain the moment real records arrive."),

  P("Say each metric in plain words:"),
  BUL("Accuracy — share of predictions that were correct (employment: about 90%, 89% cross-validated)."),
  BUL("Precision — when it predicts 'employed,' how often that's actually true (0.92)."),
  BUL("Recall — of the truly employed, how many it caught (0.93)."),
  BUL("F1 — the balance of precision and recall in one number (0.93 in-sample, 0.89 cross-validated)."),
  BUL("R-squared — share of variation the model explains, 0 to 1 (time-to-hire: 0.25 cross-validated)."),
  BUL("MAE — average miss for time-to-hire, in months (about 0.37 months in-sample)."),

  Q("Why Random Forest for both targets?"),
  A("We didn't hand-pick — we tested three candidates per target under cross-validation and kept the best. For time-to-hire, plain linear and ridge regression scored worse than just guessing the average (negative R-squared around -0.22), while Random Forest captured the non-linear patterns and won at 0.25. For employment status, logistic regression scored a cross-validated F1 of 0.88 and gradient boosting overfit (perfect on training but only 0.85 cross-validated), so Random Forest won at a cross-validated F1 of 0.89."),

  Q("What's the single biggest factor in how fast a graduate gets hired?"),
  A("OJT or internship relevance, by far — about 37% of the model's importance — followed by the number of job applications at 20% and the batch year at 8%. That's a useful finding for the program: a relevant internship matters more than raw grades."),

  Q("How does the skills-trend ranking work — is it from the model?"),
  A("No, deliberately. The skills ranking is a direct calculation from the survey data, not a machine-learning output, so it's fully transparent. For each skill we count how common it is in each batch, fit a trend line to see whether it's rising, and check 'employment lift' — whether graduates who have the skill are employed more than those who don't. Skills that are both rising and job-linked are flagged for the curriculum."),
  Q("Give a plain example of a rising skill."),
  A("If 20% of the 2020 batch listed Python and 60% of the 2025 batch did, the trend line points up, so Python is rising. If Python-holders are also employed at a higher rate, it gets recommended. Anyone could verify it by hand from the survey counts — that transparency is the point."),

  Q("Why did you design the survey based on the CHED Graduate Tracer format?"),
  A("Because it is the recognized national instrument for tracing graduates. Using it makes our data comparable, accreditation-accepted, and already focused on the agreed employability indicators — rather than us inventing our own. We adapted it to BSIS so the fields feed the model."),

  Q("What is your confidence in the prediction?"),
  A("We present it as a trend and probability, not certainty. It's strongest at showing direction — a rising skill, a growing industry — and weakest at exact individual prediction. On the synthetic 2020–2025 data it's grounded in the metrics above, and it improves as more verified batches are added."),

  Q("Isn't the dataset too small?"),
  A("It's our main limitation, and we're transparent about it. We mitigate it with clean, verified data, simple models, feature scaling, and cross-validation to avoid overfitting. The pipeline is built so that the moment we hit 80+ real verified records, we swap the data source and retrain — nothing else in the model code changes."),

  Q("How do you prevent overfitting?"),
  A("Cross-validation instead of a single split, preferring simpler models, scaling features so none dominates, and watching the gap between training and cross-validation scores — which is precisely how we caught the time-to-hire gap and chose to report the honest number."),

  H1("H. Module 7 — Admin Dashboard"),
  Q("Who can access the admin side, and how is it secured?"),
  A("Only the program chair / faculty admin, with role-based access; graduates and employers never see admin functions."),

  H1("I. Module 8 — Reporting & Documentation"),
  Q("What reports can the system produce?"),
  A("Batch summaries, employment outcomes, a skills inventory, and a data-quality report — all exportable for accreditation and planning."),
  Q("How do you measure data quality?"),
  A("A data-quality report scores completeness per record, so we're transparent about coverage and gaps and the model trains on the cleanest data."),

  H1("J. Rapid-Fire"),
  Q("In one number, how accurate is it?"),
  A("On employment status it's about 90% (89% cross-validated) on our current synthetic data, and for time-to-hire it explains about a quarter of the variation (cross-validated R-squared 0.25), missing by under half a month in training. The figures will shift once real records replace the synthetic set."),
  Q("Can the system be cheated?"),
  A("We layered defenses: live face capture with a random liveness action, employer confirmation of employment, and program-chair approval of every employer account."),
  Q("Why not just use LinkedIn?"),
  A("It isn't verified, isn't complete for our batches, and can't be exported as institutional tracer data for accreditation."),

  H1("Your numbers at a glance (current trained model)"),
  BUL("Records: 230 (synthetic), batches 2020–2025, 31 features, about 67% employed, 5-fold cross-validation."),
  BUL("Employment status — Random Forest: accuracy 0.90, precision 0.92, recall 0.93, F1 0.93 in-sample; cross-validated F1 0.89; confusion matrix 64 + 143 correct, 23 misclassified (on synthetic data)."),
  BUL("Time-to-hire — Random Forest: cross-validation R-squared 0.25; in-sample R-squared 0.87, MAE about 0.37 months. Quote the 0.25."),
  BUL("Models compared per target: time-to-hire — linear, ridge, random forest (random forest won; linear/ridge were negative). Employment — logistic (CV F1 0.88), random forest (CV F1 0.89, won), gradient boosting (overfit: 1.00 on training, 0.85 cross-validated)."),
  BUL("Top time-to-hire drivers: OJT relevance 37%, job applications 20%, batch year 8%, technical skills 5%, GPA 5%."),
  NOTE("Source: backend/ml/models/model_metadata.json and evaluation_report.json (retrained 2026-06-05 with realistic label noise). Re-run stages 1–3 of the pipeline after real records are added — the numbers will move."),
];

// ============================================================ STORYBOARD (table)
const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const COLS = [820, 2600, 4180, 1760]; // sums to 9360
function hcell(t) {
  return new TableCell({ borders, width: { size: 0, type: WidthType.AUTO }, shading: { fill: "166534", type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 20 })] })] });
}
function cell(t, w, bold) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, size: 20, bold: !!bold })] })] });
}
function srow(scene, visual, narration, who) {
  return new TableRow({ children: [cell(scene, COLS[0], true), cell(visual, COLS[1]), cell(narration, COLS[2]), cell(who, COLS[3])] });
}
const storyTable = new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: COLS,
  rows: [
    new TableRow({ tableHeader: true, children: [hcell("Scene"), hcell("Screen / Visual"), hcell("Narration (talking point)"), hcell("Presenter")] }),
    srow("1", "Title slide — system name, CHMSU logo, team", "Greeting + one-line pitch of the system.", "Pingcale"),
    srow("2", "Intro slide — the problem", "Tracer data is incomplete and unused; our system makes it trustworthy, visual, predictive.", "Pingcale"),
    srow("3", "Objectives slide", "Read general + 6 specific objectives.", "Pingcale"),
    srow("4", "Significance slide", "Beneficiaries: graduates, employers, program chair, institution.", "Pingcale"),
    srow("5", "Scope & Limitations slide", "Batches 2020–2025, 8 modules; estimates, lighting/internet, city-level pins.", "Pingcale"),
    srow("6", "Live: Registration form + admin verification queue", "Guided registration, masterlist match, admin approves pending graduates.", "Espiritu"),
    srow("7", "Live: Face capture + face login (Approved)", "3-shot liveness at registration; front scan + liveness 'Approved' at login; GPS stamp.", "Aguilar"),
    srow("8", "Live: Retracking update + admin monitoring", "2-year notice; update only current job/location; change re-opens verification.", "Espiritu"),
    srow("9", "Live: Employer portal (register→approve→verify→evaluate)", "Employer registers, chair approves, confirms + evaluates a graduate; multi-evaluator grouping.", "Espiritu"),
    srow("10", "Live: Geomap with filters", "Plot work locations; filter by batch/industry; 'approximate' pins explained.", "Aguilar"),
    srow("11", "Live: Predictive analytics dashboard", "31 features → 2 predictions (employed?, time-to-hire) plus skill & industry trends.", "Aguilar"),
    srow("12", "Live: Admin dashboard", "Verification queues, user + reference-data management, role-based access.", "Pingcale"),
    srow("13", "Live: Reports + data-quality export", "Batch summary, employment outcomes, skills inventory, data quality.", "Pingcale"),
    srow("14", "Closing slide / Q&A", "Recap: verify → map → confirm → predict. Invite questions.", "Pingcale"),
  ],
});
const storyboard = [
  Title("BSIS Graduate Tracer System"),
  Sub("Pre-Oral Storyboard  •  Presentation flow, scene by scene"),
  P("Flow: a short PowerPoint (Scenes 1–5) sets the framing — introduction, objectives, significance, scope & limitations — then a live demonstration of the system by its 8 modules (Scenes 6–13), and a closing/Q&A (Scene 14)."),
  storyTable,
  H2("Tips"),
  BUL("Keep each PPT scene to ~30 seconds and each demo scene to ~30–45 seconds."),
  BUL("Hand off clearly: name the next presenter at the end of your scene."),
  BUL("If a live step is risky, have a screenshot fallback ready for that scene."),
];

// ---- write ----
Packer.toBuffer(build(script)).then((b) => { fs.writeFileSync(OUT + "/script.docx", b); console.log("script.docx"); });
Packer.toBuffer(build(questions)).then((b) => { fs.writeFileSync(OUT + "/possible-questions.docx", b); console.log("possible-questions.docx"); });
Packer.toBuffer(build(storyboard)).then((b) => { fs.writeFileSync(OUT + "/storyboard.docx", b); console.log("storyboard.docx"); });
