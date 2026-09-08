# Application completion work — 8 September 2026

Completed the interrupted category and verification-policy integration across the shared model, seed, API and frontend.

- Category-driven authoring resolves marks on the server, supports paragraphs and marking guidance, and includes category and word-limit metadata in content hashes.
- Wizard allocations derive question totals, mark totals and difficulty totals. Assembly selects approved questions within the requested category/difficulty quotas and refuses shortages. Running papers cannot be replaced.
- Verification settings are saved and reflected in the candidate flow. The browser demonstration explicitly allows browser clients and does not require preassigned seats; administrators can enable these requirements for new examinations.
- Candidates can enter, save, retry, clear and flag written answers. Navigation waits for unsaved or pending answers. Written answers require the Save written answer action; automatic marking is not provided.
- CSV parsing supports quoted fields, embedded line breaks and escaped quotes. Wizard upload selects matching registered candidates. Import records provides templates, server validation and explicit commit for candidates and seat assignments; device/network imports additionally require device-write permission.
- Examination details include permission-filtered JSON reports and live tracking findings. The tracking worker starts and stops with the API.
- Demo blueprints now match their actual question categories and marking schemes. Page titles follow the screen.

Remaining product scope is documented in limitations.md: production persistence/infrastructure and hardware integrations, marking/results release, section-based navigation semantics, photo/admit-card workflows, and email/SMS remain outstanding. This remains a proof of concept.

## Exam workspace UX and export verification

Examinations now contain their candidate register, question bank, paper builder and integrity/approval screens. Global candidates/questions/paper links redirect to the examination list. Centre and workstation administration remain under Infrastructure. Super administrators can create exams, candidates and draft questions; examination administrators can register centres and workstations. Neither role receives independent reviewer approval permissions.

New candidates receive an exam registration and demo login credentials (Exam!2026). This remains a development credential scheme; production onboarding needs its own credential issuance flow.

Application-controlled report exports, template downloads and candidate receipt download/print actions now require fresh camera verification. Report export enforcement is server-side, using an expiring, session-bound, scope-bound, single-use token. No override/skip is offered. This does not prevent screenshots or copying data already displayed to an authorised browser.

The default demo performs simulated identity comparison with real camera capture. A live integration must enrol staff/candidate reference identities and configure EXPORT_FACE_PROVIDER_URL (HTTPS) and EXPORT_FACE_PROVIDER_TOKEN. The bridge receives userId, challengeId and a JPEG data URL and must return verified:true, live:true, referenceMatched:true and the matching userId/challengeId. This bridge must implement actual liveness and matching against a trusted enrolled identity; a static boolean responder is not a verification provider. Images are not retained by this application. Provider retention must be set independently. Without a provider and with demo mode disabled, exports are refused.

Hosting, cost modelling and the 500-candidate capacity study are deferred until the user accepts these workflows.

### Final UX verification

- Created a demonstration exam, registered a candidate, created a centre, and registered its workstation through the browser. New workstations correctly remain pending approval.
- Verified that report download opens the face-verification dialog and cancellation does not export. No live biometric provider was configured or certified.
- Shared typography now avoids a Tailwind colour/font token collision that hid page headings. Form widths, exam navigation, candidate table density, empty states, and modal focus handling are consistent.
- Automated checks: 64 tests passed, workspace type checking passed, and production build passed. Build retains a large-JavaScript-chunk advisory.
- These checks do not establish capacity for 500 concurrent examinees. Load evidence, client presentation, and hosting/management costs remain a separate follow-up.
