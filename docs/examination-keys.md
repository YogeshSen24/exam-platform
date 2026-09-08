# Examination keys

A board runs several examinations at once. A machine in a room therefore has to
be told **which one it is running** before anybody can sit at it. That is what a
key is for.

```
SEPKEY1.2269b102b00e.J8FsmDN8vy2AeB9O.kUkdaIGJ2-7Jout…
```

An administrator issues one in the dashboard; an invigilator pastes it into the
examination page on each machine in the room. Until that happens, the page
refuses to show a sign-in box, because a sign-in it could not honour is worse
than an honest refusal.

---

## What a key carries

| | |
| --- | --- |
| **Which examination** | The exam, its sealed paper, and the version of it |
| **Which centre** | The centre the results belong to |
| **When** | The window candidates may sit in, and how long they get |
| **Identity checks** | Fingerprint off / optional / required, face check at sign-in, camera during the examination |
| **The paper shape** | How many questions from each category, at what spread of difficulty |
| **Metadata** | Room, sitting, and any tags the board attaches |
| **Limits** | How many machines this key may set up, and when it expires |

It carries **no question content**. The paper stays sealed and separate, so a
key that is intercepted tells someone what the examination will demand of
candidates and gives them no way to read a single question.

### Why a leaked key cannot be forged into another one

The key is **signed** with Ed25519 and **encrypted** with AES-256-GCM. Both
halves derive from one deployment secret that lives only on the server. Reading
a key requires that secret; so does minting one. Nothing that ever leaves the
building can produce a key the server will accept.

Every key is also recorded when it is issued — who asked for it, for what, and
what became of it — and the register holds only fingerprints, never keys.

---

## Issuing a key

**Infrastructure → Centre keys.** Choose the examination and the centre, name
the room and the sitting, then issue.

The key is displayed **once**. It is never stored, so it cannot be retrieved
later and cannot leak from the database. Copy it before leaving the page.

A key for an examination with no published paper is refused at issue time: a
machine configured for a paper that does not exist would fail on the morning
instead, in front of candidates.

### Room, sitting and tags

Whatever is set here is stamped onto **every attempt** started on a machine
this key sets up, and signed into the submission receipt. A board running the
same paper in six halls on one morning can then tell the results apart, and can
invalidate one hall without touching the other five.

---

## Setting a machine up

Open the examination page on the machine. It says it is not set up, and asks
for the key. Paste it and the machine shows what it is about to do — the
examination, the checks, the paper shape, the metadata — **before** anything is
committed. Confirm, and it is ready for candidates.

The same key sets up every machine in the room, up to its limit.

### The setup lapses on its own

A machine stays set up for **four hours**, or for the examination window if that
runs longer, and never longer than the key itself is valid.

This is deliberate. A machine left switched on after a sitting is a machine
somebody can walk up to the next morning and start an examination on. Rather
than relying on an invigilator remembering to clear it, the setup expires and
the machine asks for the key again.

The binding is held in a signed, HTTP-only cookie the browser cannot read or
forge. A plain-language copy — which examination, which room, when it lapses —
sits beside it in local storage so the machine can describe itself without
asking the server. **The key itself is never written to local storage**: anyone
sitting at the machine could read it there.

A candidate's sign-in is treated the same way, and capped the same way.

---

## Every candidate gets a different paper

The sealed package holds a **pool** several times larger than the paper anyone
sits. Each candidate draws from it:

- the **same number of questions from each category** as everyone else
- the **same spread of difficulty** within each category
- a **different selection**, in a different order, with options shuffled

In the demonstration dataset that is 50 questions drawn from a pool of 150, and
two candidates at neighbouring desks share roughly 17 of their 50 questions.

The draw is deterministic, derived from the paper's fingerprint plus the
candidate and the attempt. Two consequences worth understanding:

- A candidate whose machine loses power gets **their own paper** back, not a
  fresh one.
- The board can **reproduce and re-check** any paper from the seed alone, which
  is what makes a result defensible if it is ever challenged.

---

## Where a result comes from

Every attempt records where it happened, and the receipt is signed over it:

```
centre    CEC-01, Central Examination Centre
room      Hall B
sitting   Afternoon
machine   CEC-01-HALLB-01
key       the key that set the machine up
tags      invigilator: RK
```

Because the provenance is signed with the receipt, a result cannot later be
moved to a different room or sitting without the signature failing.

---

## Revoking a key

**Centre keys → Revoke.** Machines set up with that key stop being able to
start new attempts immediately.

An attempt already in progress is left running. Ending someone's examination
mid-question is an invigilator's decision, not a side effect of an
administrative action.

---

## What is real and what is simulated

The security profile table in [docs/security.md](security.md) applies
unchanged. Specific to keys:

| Capability | This build | Production requirement |
| --- | --- | --- |
| Key signing | Real Ed25519 over the sealed rules | Signing key in a KMS or HSM, never derived in process |
| Key encryption | Real AES-256-GCM | Same, with the content key released by a KMS |
| Setup binding | Signed HTTP-only cookie | Same, over TLS, with a shorter session where the estate allows |
| Machine identity | The centre's own workstation register | TPM-backed attestation verified by an attestation service |
| Transport | Plain HTTP in development | TLS throughout |

Set `DEPLOYMENT_ID` and `DEPLOYMENT_SECRET` before running anything a real
centre will use. The development default is in the repository, and any key
issued under it can be forged by anyone holding a copy.
