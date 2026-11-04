# 73 · The learning record on A4: the Balvatika–II card like the school's, no "DPS" in the product

Status: planned 4 Nov 2026 (decisions below); parts 1–3 to build on "go part N"

## Why

The school shared its Class I card (Term I, six A4 pages; a real pupil's, so only its structure and
wording are used here) and asked that **Exams → Report cards → Card designs**
(`/exams/report-cards/templates`), template **Holistic progress card (Balvatika to II)**, print the same
on A4, and that the name "DPS" go from the page, front end and back end.

The shared card, page by page:

1. **Cover** — the school's name, address, session and affiliation no.; the title (Learning curve,
   progress record); the photo; boxes "My name is …", "My admission number is …", "My roll number is …",
   "I am a shining star of I-A", "I was born on …"; pictures (logos, a bird, a bee, flowers).
2. **Scholastic area** — English and Mathematics: the subject down the side, its skill groups
   (LISTENING SKILLS, SPEAKING SKILLS …) with the skills under them, a **Term I grade** and **Term II
   grade** column, and a right column with the subject's remarks, Term I and Term II. A note: the grades
   come from classroom observation and oral testing; see the evaluation key.
3. **Scholastic area** — Hindi, EVS and GK, the same way.
4. **Co-scholastic area** — personal and social traits (life skills, 14 lines) and activities (music,
   dance, art/craft: interest and skill; sports/games; horse riding), Term I and Term II; pictures.
5. **Health record and attendance** — height, weight, attendance (present / working days) per term; "I
   participated in …" per term; "My teachers say …" per term with the class teachers' names; promoted
   to; signatures per term (principal, co-ordinator, class teachers); the parent's signature per term.
6. **Evaluation key** — A* Outstanding 91–100 %, A Excellent 81–90, B* Very good 71–80, B Good 61–70,
   C Average 51–60, D Scope for improvement 50 and below.

Every page after the cover has a double frame and the pupil's name and admission no. at the top right.

What we have: the HPC template (`hpc_foundational`, docs/design/65 part 5) prints the NEP progress card
as one flowing document (cover, domains with a column per exam, words, portfolio, attendance, health,
signatures). It is A4 already (210 × 297 mm; the worker prints with `preferCSSPageSize`), but its content
flows across pages, it has one column per exam rather than Term I / Term II, no subject remarks column,
one health record and one "participated in", no evaluation key page and no pictures.

"DPS" shows on the page as the **Install the DPS Noida cards** button and in the names and codes of the
seven cards it installs (`dps_i_ii` … `dps_xii`, "DPS Noida I-II learning record" …); behind it the API
route `POST /exams/report-cards/templates/dps`, `installDps`, `DPS_NOIDA_TEMPLATES`. The Registers page
shows "Ready-made scheme (DPS Noida)" with the codes `DPS_VI_VIII`, `DPS_IX`, `DPS_X`, `DPS_XI`,
`DPS_XII` (stored in `mark_schemes.preset`, 130 rows), and comments and API descriptions say "DPS Noida".

## Benchmark

- **Legacy (DPS Noida)**: the learning record above, made per class in Word and filled by hand.
- **Entab CampusCare, Edunext, Fedena, Teachmint**: report card designers with page templates (cover,
  scholastic, co-scholastic, attendance and health, key), term columns side by side, a frame and the
  pupil's name on every page, the school's own artwork uploaded per page; grades A*–D or A1–E with a key.
- **CBSE / NCERT**: for the foundational stage the NEP Holistic Progress Card (domains, curriculum goals,
  Beginner–Proficient), which many schools still print in their older subject-and-skill form.

## Decisions (user, 4 Nov 2026)

1. **Any set, and a ready-made one**: the new design prints whatever indicator set the exam uses, grouped
   onto pages (scholastic subjects, then co-scholastic); and a ready-made set **Learning record (I–II)**
   with the shared card's subjects, skill groups and skills, graded A*–D, which a school can give to
   Class I–II exams (or keep the NEP set).
2. **A designed cover and pages, and the school's own pictures**: a coloured cover with the "My name
   is …" boxes and the photo, framed pages, no clip art shipped; in the designer the school may upload its
   own pictures for the cover and the pages, which print in place.
3. **Term I and Term II side by side**: the year's exams that take the card's indicator set (for the
   pupil's class), in date order, are Term I and Term II; a Term I card leaves Term II blank, a Term II
   card shows both; each term's remarks, health, attendance, participation, teacher's words and
   signatures in its column or box.
4. **"DPS" goes everywhere it shows**: template names and codes, the install button, the Registers
   page's ready-made schemes and their codes, API routes and descriptions, constants and comments; a
   migration renames what each school installed (releases point at templates by id, so they keep them).

## Design

### Part 1 — no "DPS" in the product (migration 0307)

- **Templates**: `DPS_NOIDA_TEMPLATES` → `READY_MADE_TEMPLATES`; codes `dps_i_ii` → `lr_i_ii` "Learning
  record (I–II)", `dps_iii_v` → `lr_iii_v` "Learning record (III–V)", `dps_vi_viii` → `rc_vi_viii`
  "Report card VI–VIII (Term 1 and Term 2)", `dps_ix` → `rc_ix` "Report card IX", `dps_x` → `rc_x`
  "Report card X (pre-term / mid-term)", `dps_xi` → `rc_xi` "Report card XI", `dps_xii` → `rc_xii`
  "Report card XII (pre-term / mid-term)". API `POST /exams/report-cards/templates/ready-made`
  (`installReadyMade`; the HPC install stays `/templates/hpc`); the button **Install the ready-made
  cards**; its notice. 0307 renames every school's installed rows: the code always, the name only when
  it is still the shipped one (a school's own name stays).
- **Register presets** (`SCHEME_PRESETS`): `DPS_VI_VIII` → `CLASS_VI_VIII`, `DPS_IX` → `CLASS_IX`,
  `DPS_X` → `CLASS_X`, `DPS_XI` → `CLASS_XI`, `DPS_XII` → `CLASS_XII`; "Ready-made scheme (DPS Noida)" →
  "Ready-made scheme"; 0307 renames `mark_schemes.preset`; `scripts/seed-exam-sample.mjs` uses the new
  code.
- **Words**: the API descriptions, the doc comments and the help say "the ready-made cards" / "the
  school's old cards" (docs/design keep their history as written).
- **Not part of this** (other pages; found while planning, to decide separately): the admissions field
  "Father/Mother is an Alumnus" stores `dps_alumni` and lists the group's schools (`GroupSchool`: three
  DPS schools, the school's own data); examples in placeholders ("e.g. DPSN(Sr Library)", "e.g.
  DPSNOI", "DPS - Faridabad"); legacy migration notes.

### Part 2 — the card's data by term; the ready-made set

- **Terms** (`report-card-data.ts`, `loadHpc`): the card's set is the HPC exams' set for the class; its
  terms are the year's exams that take that set for the class, by date (`starts_on`, then id); each is
  **filled** when it is one of the release's exams or before them, else blank. `ReportCardHpc.terms`:
  `[{ examId, code, name, filled }]`; each item's `levels` by term (null when not filled).
- **By term** for those exams (blank when not filled): the general remark (and its teacher), the remark
  items of each category, attendance, health (height, weight; the record of that exam), what the pupil
  took part in (`exam_remarks.participation`), the signatures (the same images, printed on a filled
  term's row). Promoted to: the last filled term's. The class teachers: the section's class teacher
  assignments (and coordinators named as class representatives, if set), printed after the teacher's
  words.
- **A subject's remarks**: an area's subject is the subject named like the area (or like the part after
  "·", "Language and literacy development · English" → English); its remarks are the remark category of
  that subject (docs/design/65 part 7). No such category: the column is left out.
- **Ready-made set** `LR_I_II` "Learning record (I–II)" (kind hpc), installed with the template
  (`POST /exams/report-cards/templates/hpc` also adds it when the school has none of that code):
  grades `A*, A, B*, B, C, D` with words (Outstanding … Scope for improvement); areas English, Hindi
  (each: Listening skills — Comprehension, Application; Speaking skills — Vocabulary, Conversation /
  public speaking, Recitation; Reading skills — Comprehension, Fluency, Pronunciation; Writing skills —
  Handwriting, Creative writing, Spelling; Language structure — Grammar, Vocabulary; Activity / project
  work), Mathematics (Conceptual understanding, Mental ability, Written work, Activity / project work),
  EVS (Environmental awareness, Class participation, Activity / project work), General knowledge,
  Personal and social traits (the 14 life skills), Activities (Music, Dance, Art / craft — interest and
  skill; Sports / games; Horse riding). A grade scale `LR_KEY` with the six bands and % (91–100 … 0–50)
  for the key. Remark categories English, Mathematics, Hindi, EVS (free text, the subject's), added
  when missing. Nothing is given to an exam: the school picks the set for Class I–II's exams (Exams →
  Set-up), as with any set.

### Part 3 — the A4 design and the school's pictures (migration 0308)

- **Page sections** (`report-card-html.ts`), each one or more whole A4 pages (a page is
  `297mm` high with the double frame; the pupil's name and admission no. top right after the cover):
  - `lr_cover`: the school (logo, name, address, session, affiliation no.), the title (the section's
    title, "Learning curve (progress record)"), the photo, the five boxes, the school's pictures.
  - `lr_subjects`: the areas given (`areas`; none: every scholastic area), the area down the side, its
    goals / skill groups as headings, the skills with a grade column per term ("Term I grade" …), and
    a remarks column per subject and term; the note; the areas fill as many pages as they need, an area
    never split; a page picture bottom right.
  - `lr_co_scholastic`: the co-scholastic areas the same way (two term columns, no remarks column), the
    page's picture down the right.
  - `lr_record`: height, weight, attendance per term; "I participated in …" per term; "My teachers say
    …" per term with the class teachers; promoted to; signatures per term (principal, coordinator, class
    teachers) and the parent's line.
  - `lr_key`: the evaluation key (the set's grades, words, and the % of the grade scale with the same
    grades), the logos.
- **Design**: the cover a soft gradient in the school's two colours with rounded boxes; tables with
  the green header rows and the subject's name turned down the side, as on the shared card, in the
  design-system print colours; A4 210 × 297 mm, fixed pages (no content flowing over a page).
- **The template** `hpc_foundational` becomes: `lr_cover`, `lr_subjects` (the scholastic areas),
  `lr_co_scholastic`, `lr_record`, `lr_key`; layout options in the designer as now (JSON) — the ready-made
  set's pages are `English, Mathematics` / `Hindi, EVS, General knowledge` / co-scholastic. An area is
  co-scholastic when its name is one of the set's co-scholastic list (layout `coAreas`; the ready-made
  one: Personal and social traits, Activities; the NEP set: the observation areas).
  A school's own copy (changed in the designer) is not overwritten; installing again offers the new
  version as "Holistic progress card (Balvatika to II) v2" beside it.
- **Pictures** (0308: `report_card_templates.assets` jsonb, slot → file id): slots `cover_art` (the
  cover's lower half), `cover_corner` (beside the title), `logo_2` (a second emblem), `scholastic`,
  `co_scholastic`, `record`; the designer uploads PNG / JPEG up to 1 MB per slot (stored like the
  signatures), shows them, removes one; the renderer fills them as data URIs; an empty slot prints
  nothing.
- **Preview and PDF**: the designer's sample and the release's PDFs use it; sample data with two terms.

### Tests

- Unit (`packages/db`): the term rule (filled / blank by the release's exams), a subject's remark
  category by area name, the page breaking (areas whole, page count), the cover boxes, the key from the
  grade scale; the renaming of 0307 (codes, names kept when changed).
- API e2e: install the ready-made cards (new route, codes) and the HPC (set, scale, categories once);
  a Term I and a Term II card's HTML for a pupil (Term II blank, then filled); pictures upload / remove;
  presets by the new codes; old codes refused.
- Browser / a11y: Card designs (button, names), the designer's pictures, the sample preview as six A4
  pages; the PDF from the worker checked by the user (workers are not started from here).

## Found while planning (data, not code)

- Alpha's draft release "Class I to III" (ASS1) uses `hpc_foundational` for Classes I, II and III; Class
  III takes the NEP set `HPC_CLASS1` too (the Class I set), filled with sample grades on 4 Nov.
