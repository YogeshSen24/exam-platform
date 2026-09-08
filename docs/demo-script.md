# Demonstration script

A 10–15 minute walkthrough of the complete examination lifecycle.

## Before you start

```bash
npm run dev
```

Open two browser windows side by side:

- **Window A** — http://localhost:5173, signed in as `exam.admin@examboard.demo`
- **Window B** — http://localhost:5173/exam, the candidate workstation

Open **Demo mode** in window B and confirm the presenter controls are at their
defaults (fingerprint `MATCH`, face `VERIFIED`, everything else off).

> Open with the honest framing: *"This is a proof of concept. The cryptography,
> the integrity checks, the authorisation and the audit chain are real. The
> biometrics, the hardware attestation and the key custody are simulated, and the
> interface labels every one of them."*

---

## 1 · The examination — 1 minute

**Window A → Dashboard**

One active examination with 500 candidates, one upcoming, one draft. 23 of 25
workstations approved. Three security alerts.

> "This is a live 500-candidate examination, 45 minutes in."

---

## 2 · Maximum Assurance — 2 minutes

**Examinations → National Technical Aptitude Examination 2026 → Security tab**

Nineteen effective controls, each labelled **Implemented**, **Partly
implemented** or **Simulated**.

> "The administrator chose an assurance level, not an algorithm. Nobody in this
> organisation picks a cipher — the platform does that. And notice every control
> says honestly whether this build implements it or demonstrates it."

Point out **Dual approval before publication**.

---

## 3 · The signed, encrypted paper — 2 minutes

**Paper integrity** (button at the top right)

> "Four mechanisms, each answering a different question."

- **Encryption** — hides the content. A copy taken from a backup is unreadable.
- **Hashes** — detect any change. 50 of 50 questions still match.
- **Signature** — proves *who* approved this exact paper. Ed25519, valid.
- **Release window** — controls *when* it can be opened.

Scroll to the manifest entries: fifty questions, each with the fingerprint
recorded at approval. Note the key-provider warning at the side.

> "No key material is ever shown here. These are fingerprints, not content."

---

## 4 · Workstation readiness — 1 minute

**Workstations → WS-CEC-007 → Readiness**

Nine checks. The camera fails on this machine, so it is not allocated to a
monitored examination.

> "Secure boot, disk encryption, kiosk policy and application signature are
> simulated — a browser cannot see the operating system. In production a native
> Windows shell reports TPM-backed attestation. The certificate and network
> checks are real."

---

## 5 · The candidate signs in — 2 minutes

**Window B**

Note the separate application: no navigation, one task, workstation identifier
and network status on screen.

Click **Fill in the demonstration candidate**, then **Sign in**.

The verification sequence runs, each check moving visibly from waiting to
checking to passed:

1. Account · 2. Eligibility · 3. Workstation certificate · 4. Approved network ·
5. Question paper verified

> "All five run on the server. Nothing here trusts what the workstation says
> about itself."

**Scan fingerprint** → match. **Start the camera** → capture → identity
confirmed.

> "Both simulated, both labelled. The workflow around them — retry, invigilator
> override, the recorded reason — is real."

**Continue to the instructions.** Note the neutral wording, the monitoring notice
with retention, and the four explicit confirmations. Confirm and **Prepare my
examination**.

> "Watch what it says it is doing: verify the signature, re-check every
> fingerprint, release the key inside the window, generate this candidate's own
> order, and store it so it can be replayed exactly."

**Start the examination.**

---

## 6 · Answering, and randomisation — 2 minutes

Answer question 1 with the keyboard: press `3`.

> "Saved to the server — and that appears only after the database commit, not
> when the request was sent."

Move with `N`. Flag with `F`.

> "Every candidate has the same fifty questions in a different order, with the
> options shuffled too. 'The answer is C' means nothing to the person beside you."

Point to the navigator legend: every state has an icon and a label, not just a
colour.

---

## 7 · Network interruption and recovery — 2 minutes

**Demo mode → Network disconnected**

Answer another question.

> "Saved on this workstation. The candidate is told plainly that nothing is
> lost."

**Demo mode → Network restored**

> "Reconnected and saved — and the retry reused the same idempotency key, so the
> server records one answer, not two."

Optionally reload the page and return to a question already seen.

> "Same question, same order, same options. The sequence was generated once and
> stored; reconnection replays it rather than regenerating it."

---

## 8 · Presence failure and restriction — 2 minutes

**Demo mode → No face detected**

Wait for three capture cycles (30 seconds each; shorten by watching the presence
panel).

1. Subtle warning
2. Prominent warning with camera preview
3. Navigation restricted → the reverification screen

> "Notice what it does *not* say. It does not accuse. It says the examination is
> paused, that every answer is safe, that an invigilator has been notified, and
> what to do next."

Return **Demo mode → Face verified**.

---

## 9 · The invigilator responds — 2 minutes

**Window A → sign out → sign in as `invigilator@examboard.demo` → Live
examination**

500 candidates broken down across seven states, adding to exactly 500. The table
sorts the most urgent first.

Open the restricted candidate.

> "Session state, identity events, device health, answer-save progress. No
> question content and no answers — that separation is enforced by the server,
> not by this screen."

**Approve recovery.** A reason is mandatory.

> "Every sensitive action requires a reason and writes an audit event. Software
> never ends an examination on its own — a person decides."

---

## 10 · Submission and receipt — 1 minute

**Window B** → the session resumes → **Review and submit**

Answered, unanswered, flagged, time remaining. Submit and confirm.

The receipt: receipt ID, server submission time, and the integrity values —
answer-set fingerprint, paper fingerprint, paper-order reference, audit anchor,
signature.

> "One code summarising every answer they submitted. If there is ever a dispute
> about what was stored, this settles it."

---

## 11 · The audit trail — 1 minute

**Window A → sign in as `super.admin@examboard.demo` → Audit log**

> "The chain is intact — every entry links to the one before it."

Open any entry: actor, role, action, target, result, reason, device, address,
trace id, previous hash, own hash.

> "There is no update or delete route for audit events anywhere in this API.
> That is the enforcement, not a convention. In production this also mirrors to
> independent WORM storage."

---

## 12 · Tampering is caught — 2 minutes

**System health → Incident simulator → Modified question**

> "This is the one scenario that changes real state. It genuinely alters a
> stored question after approval."

**Examinations → NTAE-2026-01 → Paper integrity**

The verdict flips to failed. One question no longer matches its approved
fingerprint, the expected and actual hashes are shown side by side, and
publication status is now **Blocked**.

> "Release is blocked automatically. No candidate receives that paper. The
> signature is still valid — the paper was properly approved — but the *content*
> changed afterwards, and the platform can tell the difference."

Try the other scenarios if there is time: DDoS traffic, revoked device, replayed
answer. Each shows detection, control activated, user impact and recovery.

> "None of these run a real attack. They create synthetic monitoring events so
> you can see how each situation is detected, contained and recovered."

**Demo mode → Reset demo data** restores everything.

---

## Closing

> "Four promises. The right student, verified at an approved machine on an
> approved network. The right paper, fingerprinted, signed and encrypted, with
> integrity checked before every single release. Answers that provably belong to
> the correct attempt, saved idempotently and version-controlled. And an
> examination that stays available through disconnection, restriction and
> failure — with a person, never software alone, making every consequential
> decision.
>
> The parts marked simulated are the parts that need certified hardware and
> managed services. Everything else you have just seen is working code."

---

## If something goes wrong mid-demonstration

| Situation | Recovery |
| --- | --- |
| Camera blocked by the browser | Expected. The simulation-mode fallback is part of the story — say so. |
| Candidate session in a strange state | **Demo mode → Reset demo data**, then sign in as `NTAE26-000002`. |
| Presence checks too slow to wait for | Reduce the interval in the wizard, or narrate the three-stage escalation from the reverification screen. |
| Integrity left failing | Reset demo data. |
| Need a fresh candidate | Any of `NTAE26-000001` to `NTAE26-000022` has not yet started. |
