const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
} = require("docx");

const OUT = "C:/Users/Lenovo/OneDrive/Desktop/NEW-Capstone/documentations";

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun(t)] });
const SAY = (t) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "SAY: ", bold: true, color: "14532d" }), new TextRun(t)] });
const DO = (t) => new Paragraph({ spacing: { after: 150 }, children: [new TextRun({ text: "[ DO: " + t + " ]", italics: true, color: "0F7B3F" })] });
const BUL = (t) => new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const Q = (t) => new Paragraph({ spacing: { before: 140, after: 40 }, children: [new TextRun({ text: "Q: " + t, bold: true })] });
const A = (t) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "A: " }), new TextRun(t)] });
const NOTE = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, italics: true, color: "8a6d00" })] });
const Title = (t) => new Paragraph({ style: "Title", children: [new TextRun(t)] });
const Sub = (t) => new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: t, color: "555555", size: 24 })] });

const styles = {
  default: { document: { run: { font: "Arial", size: 22 } } },
  paragraphStyles: [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 40, bold: true, font: "Arial", color: "0F7B3F" }, paragraph: { spacing: { after: 120 } } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, font: "Arial", color: "14532d" }, paragraph: { spacing: { before: 280, after: 140 } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, font: "Arial", color: "166534" }, paragraph: { spacing: { before: 200, after: 100 } } },
  ],
};
const numbering = { config: [
  { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
]};
const pageProps = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } };

const children = [
  Title("CurrenChan"),
  Sub("Programmer's Presentation Script & Defense Q&A  •  BSIS Graduate Tracer System"),

  P("This is your personal guide as the programmer/developer. It has three parts: (1) what to SAY and DO as you walk the live system module by module, (2) likely questions for every module, and (3) a deep-dive on the prediction module."),
  NOTE("Legend — “SAY” is your line. Green [ DO ] is what you click or show. Speak plainly, click slowly, and pause after each module."),

  H1("Part 1 — Live walkthrough (what to say + what to do)"),

  H2("Module 1 — Graduate Registration & Verification"),
  DO("Open the graduate registration form; type a name that's on the masterlist."),
  SAY("A graduate registers through a guided form. As they type their name, the system checks it live against the official BSIS masterlist. A match auto-verifies them; an unmatched name is flagged for the program chair to review. That's how every record stays tied to a real graduate."),

  H2("Module 2 — Biometric Verification"),
  DO("Show the 3-shot face capture at registration, then a face login."),
  SAY("Identity is captured live through the camera — uploads aren't allowed. At registration we take three guided shots with a liveness check: look forward, open mouth, turn your head, proving a live person, not a photo. The face becomes a 128-number faceprint we compare by distance. Login repeats a quick scan plus one liveness action. Every capture is stamped with date, time, and GPS for the audit trail."),

  H2("Module 3 — Graduate Profile & Employment Monitoring"),
  DO("Log in as a graduate flagged for retracking; update the current job; show the admin seeing the change."),
  SAY("Careers change, so every two years a graduate is asked to update their record — only what changed, like their current job or location. When they change employer or role, the record re-opens for re-verification, and the program chair can monitor those changes from the admin side."),

  H2("Module 4 — Employer Interaction"),
  DO("Walk the employer flow: register → pending → admin approves → confirm a graduate → evaluate."),
  SAY("Employers get their own portal. They register, wait for the program chair's approval, then confirm a graduate's employment and fill a short, confidential evaluation. If two evaluators come from the same company, the admin list groups them under one company. Employers can also see anonymized insights, including unemployed-graduate counts."),

  H2("Module 5 — Geographic Distribution & Mapping"),
  DO("Open the geomap; filter by batch and status."),
  SAY("This map plots where our graduates work. The chair can filter by batch, industry, or status to see local and overseas concentrations. Exact pins come from a graduate-set location; otherwise we estimate from the city and mark the pin as approximate, so we never overstate precision."),

  H2("Module 6 — Predictive Employability Trend Analysis"),
  DO("Open Analytics; show the Batch Trend & Forecast chart, then the Top Skills panel."),
  SAY("Using the 2020–2025 data, the system learns how a graduate's background relates to their outcomes, then predicts two things: whether they're employed, and how long it took them to get hired. The line across the years is the trend; the dashed part is the forecast for the next batch, with a shaded 80% range. The skills panel ranks which skills are rising. We also display whether jobs are BSIS-related, but that's observed data, not a prediction."),
  NOTE("See Part 3 for the deep-dive answers on this module."),

  H2("Module 7 — Administrative Dashboard"),
  DO("Open the admin dashboard; point at the verification queue and the stat cards."),
  SAY("The dashboard is the program chair's command center — verification queues, user and reference-data management, and a single view of the system's status. Access is role-based, so each user only sees what they should."),

  H2("Module 8 — Reporting & Documentation"),
  DO("Open Reports; export a sample report."),
  SAY("Finally, the system turns everything into reports — batch summaries, employment outcomes, a skills inventory, and a data-quality report — all exportable for accreditation and planning."),
  DO("Open the Predictive Employability Trend report; preview it, then export as PDF."),
  SAY("The flagship one is the Predictive Employability Trend report, and it's built to read top to bottom for a non-technical reader: a plain introduction and summary, the observed employment trend per batch from 2020 to 2025, a three-year forecast, a short 'why you can trust this' note with our cross-validated accuracy, and an observed time-to-hire breakdown — closing with a conclusion. Every section exports to PDF and Excel, and the PDF even draws the trend as a line chart."),

  H1("Part 2 — Possible questions (all modules)"),

  H2("Registration & Verification"),
  Q("How do you stop fake or duplicate graduates?"),
  A("Live face capture (no uploads) plus a name match against the official BSIS masterlist; matched graduates auto-verify, unmatched go to the program chair."),
  Q("Why match against a masterlist?"),
  A("It anchors every registrant to an official institutional record — that's what makes the verification credible for accreditation."),

  H2("Biometric"),
  Q("How does the face recognition actually work?"),
  A("The model turns a face into a 128-number faceprint; we compare a new faceprint to the stored one by distance and accept it within a set threshold."),
  Q("How does the liveness check stop a photo or video?"),
  A("It uses facial-landmark math — mouth-opening ratio and head-turn angle — and the action is requested live, so a static photo or a single clip can't reliably satisfy it."),
  Q("Is the biometric data secure?"),
  A("Faces are stored as numeric faceprints, access is role-based, and every capture is logged with date, time, and GPS. Collection is consented and purpose-limited."),

  H2("Profile & Employment Monitoring"),
  Q("Why retrack every two years?"),
  A("Careers change — promotions, new employers, going abroad — so periodic updates keep the data and the trends meaningful. It also matches the alumni office's real 2-year reporting interval."),
  Q("What stops a graduate from faking a promotion?"),
  A("Any company or role change re-opens the record as pending and needs employer confirmation before it counts as verified."),

  H2("Employer Interaction"),
  Q("Why let employers verify instead of trusting the graduate?"),
  A("Self-reported employment can be inaccurate; employer confirmation, approved by the program chair, makes it credible."),
  Q("Two rows showed the same company — is that wrong?"),
  A("No. Each evaluator is their own account identified by email. The admin list groups multiple evaluators under one company; we tell them apart by contact person."),

  H2("Geomapping"),
  Q("How accurate are the map locations?"),
  A("Exact when the graduate sets their workplace pin; otherwise we estimate from the city and clearly mark the pin as approximate, so we never overstate precision."),
  Q("You capture GPS on every login — is it shown on the map?"),
  A("The login GPS is captured and stored in the login audit trail — that already works. The geomap currently visualizes employment and work locations; plotting recent-login locations is the same stored coordinates as an additional layer, so it's a planned next step, not a new data pipeline. We prioritized the employment-location map because that's the core tracer output; the login coordinates are retained for audit and security."),

  H2("Admin Dashboard & Reporting"),
  Q("Who can access the admin side?"),
  A("Only the program chair / faculty admin, with role-based access; graduates and employers never see admin functions."),
  Q("What reports can the system produce?"),
  A("Batch summaries, employment outcomes, a skills inventory, and a data-quality report — all exportable."),
  Q("Walk us through the Predictive Employability Trend report."),
  A("Ten short sections: introduction, executive summary, the observed trend per batch, an interpretation, the three-year forecast, notes on the forecast, a model-reliability note with our cross-validated metrics, an observed time-to-hire breakdown, and a conclusion. It shows what actually happened alongside one forward forecast — instead of re-predicting batches we already have data for."),
  Q("The report used to have 'actual vs predicted' columns — where did they go?"),
  A("We removed them. Comparing the model's guess against batches we already have real data for is an accuracy check, not a forecast, and it confused readers. We replaced it with one plain sentence plus the cross-validated metrics — the same evidence, far clearer."),
  Q("Why show observed data per batch instead of predictions?"),
  A("For past batches we already have the real outcomes, so predicting them again adds nothing. The report shows what actually happened — the trend — and reserves prediction for the one thing we don't know yet: the next batches, in the forecast."),
  Q("Why does the system have a data-quality report?"),
  A("Tracer data is self-reported and often incomplete, so we audit it. The report checks every record against seven required fields — employment status, time-to-hire, sector, job title, work address, technical skills and soft skills — and shows overall coverage, which fields are most often missing, and the completion rate per batch. It's how the program chair spots gaps, follows up with those graduates, and trusts the analytics built on top."),
  Q("Isn't measuring data quality trivial?"),
  A("It's the foundation, not a frill. It pairs with validation at entry — we reject bad data going in and measure coverage after. Everything depends on it: the geomap can't plot a graduate with no work address, and the model shouldn't predict on half-empty records. The data-quality report is the integrity check that makes the predictions and the map credible — exactly what accreditation expects."),

  H1("Part 3 — Prediction module deep-dive"),
  NOTE("Current numbers, on synthetic data (230 training rows, 2020–2025): employment — Random Forest, ~90% accuracy / 0.93 F1 in-sample, 0.89 cross-validated F1. Time-to-hire — Random Forest, cross-validated R² 0.25, average error ~0.37 months. Quote the cross-validated numbers."),

  Q("What's the trend?"),
  A("The trend is the line across the batch years in the Batch Trend & Forecast chart — the employment rate (or time-to-hire) from 2020 to 2025, with a dashed forecast continuing it past the latest batch. A rising line means each batch is doing better; the Top Skills panel shows which skills are climbing. So “trend” is the direction of graduate outcomes over time, not a single number."),

  Q("How do you know the prediction is correct?"),
  A("We don't grade it on the data it learned from. We use 5-fold cross-validation: train on four parts, test on a fifth it never saw, repeat five times. On those unseen graduates the employment model is right about 89% of the time (cross-validated F1), and time-to-hire explains about a quarter of the variation (R² 0.25). “Correct” means it matched graduates whose real outcomes we already knew."),

  Q("How can you evaluate that it's correct?"),
  A("With standard metrics. For the yes/no employment prediction: accuracy, precision, recall, F1, and the confusion matrix. For time-to-hire: R² and mean absolute error in months. We report the cross-validated numbers, not the easier training-fit ones, and we watch the gap between training and cross-validation to catch overfitting — which is exactly how we rejected a model that scored a perfect 100% on training but only 85% on held-out data."),

  Q("Why did you build it this way?"),
  A("Two separate targets because the questions are different types — employment is yes/no (classification), time-to-hire is a number (regression). We tested three candidate models per target under cross-validation and kept the best; Random Forest won both because it captures non-linear patterns the straight-line models miss. We scale features so none dominates. The skills trend is deliberately a plain calculation — count per batch, fit a line, check employment lift — not a black-box model, so it's fully transparent."),

  Q("Isn't the data synthetic?"),
  A("Yes, and we're upfront about it. Real 2025 tracer data doesn't exist yet because the alumni office needs the 2-year reporting interval, so the demo is populated with representative synthetic graduates spanning 2020–2025. The pipeline is built so that the moment real verified records arrive, we swap the data source and retrain — nothing else in the model changes."),
  Q("What does the time-to-hire breakdown count?"),
  A("Real graduates, bucketed by how long they actually took to get hired — within 3 months, 3 to 6, 6 to 12, and more than 12. It's a count of people, observed, not a model output. Graduates who were never hired simply have no time-to-hire and aren't counted."),
  Q("Why does the forecast only go one to three years out?"),
  A("The forecast extends a straight line through the batches. One or two years past the last batch stays close to what we've seen, but further out the line extrapolates beyond the data and the uncertainty widens — so we cap the horizon. We also floor time-to-hire at one month, since nobody is hired in zero months."),
  Q("What's the single biggest factor in how fast a graduate gets hired?"),
  A("Internship or OJT relevance, by far — about 37% of the model's importance — then the number of job applications. A relevant internship matters more than raw grades, which is itself a useful finding for the program."),
  Q("How is the skills trend different from the prediction model?"),
  A("It isn't machine learning at all. For each skill we count how common it is per batch, fit a trend line, and check 'employment lift' — whether graduates who hold it are employed more. Skills that are both rising and job-linked get flagged for the curriculum. You can verify it by hand, which is the whole point."),
  Q("Why does employment trend upward in the demo?"),
  A("We tuned the synthetic generator so later batches are modestly more employable and hire a little faster — a realistic upward trend — while capping it so no batch is an unrealistic 100%. On real data the trend would simply reflect whatever the graduates report."),

  H1("Part 4 — Demo safety"),
  BUL("Keep each module to ~30–45 seconds; name the screen before you click."),
  BUL("If a live step is risky, have a screenshot fallback ready for that module."),
  BUL("For prediction, lead with the cross-validated numbers, then the synthetic-data caveat — owning it is stronger than hiding it."),
  BUL("If asked a number you don't recall, say the metric in plain words first, then give the figure from Part 3."),
];

const doc = new Document({ styles, numbering, sections: [{ properties: pageProps, children }] });
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT + "/CurrenChan.docx", b); console.log("CurrenChan.docx"); });
