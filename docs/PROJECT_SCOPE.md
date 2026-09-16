# Cleopatra Ink Studio — Project Scope

A simple guide to what this app does and everything it can do. Written for
anyone — no technical background needed.

---

## What Is This App?

Cleopatra Ink Studio is an in-shop tool for a tattoo studio. A staff member
(a designer or the studio admin) sits with a customer, uses the app to
create a custom tattoo design with AI, shows the customer what it will look
like on their body, and finalizes it — all before a single needle touches
skin.

Customers never use the app themselves or need an account. Staff does
everything on their behalf, right there in the studio.

There are two kinds of staff accounts:
- **Designer** — runs the day-to-day design sessions with customers.
- **Admin** — does everything a designer can do, plus manages the studio:
  staff accounts, customer records, and studio-wide reports.

---

## Starting a Session with a Customer

When a designer sits down with a customer, the first step is finding or
creating their record:

- **Search by name or phone number.** As soon as a few letters or digits are
  typed, matching customers appear instantly.
- **New customer?** If nobody matches, the app offers to create a new
  record on the spot — just a name and phone number, nothing else.
- Once a customer is selected (new or returning), a new design session
  starts for them.

---

## Creating a Tattoo Design

This is the heart of the app. There are four different ways to get a
design started, depending on what the customer wants:

### 1. AI Design (the main path)

The designer describes the tattoo the customer wants — style, subject,
colors, where on the body it will go — and the app generates real design
options using AI.

- **Style picker.** Choose from a large, searchable list of tattoo styles
  (traditional, fine-line, tribal, watercolor, and dozens more), organized
  by category.
- **Reference images.** Add up to a few images to guide the design —
  either uploaded from a device, taken with the camera right there in the
  studio, or found through a built-in Pinterest search. The AI blends
  ideas from all of them into the final designs, not just the first one.
- **Color choices.** Pick specific ink colors for the design, or leave it
  black-and-grey.
- **Placement hint.** Note where on the body the tattoo is going, so the
  design accounts for that area's shape.
- **Text / lettering tattoos.** A dedicated mode for text-based tattoos —
  type the words, pick from a huge library of fonts (searchable, with live
  previews), and the AI turns it into a tattoo-ready design in that exact
  font.
- **Generate.** The app produces 5 design options at once, shown side by
  side, ready to compare.

### 2. Upload Existing Design

If the customer already has a design in mind (a photo, a piece someone
else drew, an image they found), the designer can upload it directly and
skip the AI generation step entirely — go straight to placing it on the
body.

### 3. Browse Previous Designs

Instead of creating something new, a designer can pick from designs
already generated for other customers before — useful for showing
examples, or reusing a popular design. The list can be filtered by
customer or by which designer made it (admins can filter by any designer;
designers see only their own past work).

### 4. Rework (Cover-Up or Extension)

For a customer who already has a tattoo they want changed:
- **Cover-up** — design something new that fully hides the old tattoo.
- **Extend** — build on top of or around the existing tattoo.

The designer uploads a photo of the existing tattoo, describes what the
customer wants, and the AI generates options that work around what's
already there.

---

## Refining a Design

Once initial designs are generated, they land in a chat-style conversation
where the designer keeps iterating with the customer:

- **Ask for changes in plain language** — "make the lines thinner," "add
  more shading," "remove the small stars" — and the app generates new
  versions based on that feedback.
- **See everything at once.** Every batch of generated images stays in the
  conversation, so it's easy to scroll back and compare earlier attempts
  against newer ones.
- **Full-size viewing** with left/right arrows to flip through every image
  generated in the conversation, not just the current batch.
- **Choose how many new options to generate** on each edit round (the very
  first batch is always 5, so there's plenty to choose from up front).
- **Finalize** the moment the customer is happy — with a quick confirmation
  step first, so nothing is locked in by accident.

---

## Placement — Seeing It On the Body

Before committing to a design, the studio shows the customer exactly how
it will look on their actual body:

- **Describe the spot** in words (e.g. "left forearm, inner side"), or
- **Take or upload a photo** of the actual body part and drag the design
  onto it — resize, rotate, and reposition it interactively until it sits
  perfectly.
- The app then generates a realistic photo of the tattoo actually inked
  onto that spot, following the skin's natural curves and lighting — not
  just a flat sticker pasted on top.
- The finished placement preview also gets finalized as part of approving
  the design.

---

## Printing a Stencil

Once a design is finalized, the studio can print a ready-to-use stencil:

- Automatically sized and laid out on standard paper, split across
  multiple pages if the design is large.
- Mirrored (the way a real tattoo stencil needs to be) with a small guide
  margin built in.
- Print size can be adjusted to match the actual tattoo size on the body.

---

## Customer History

Every customer's page shows their complete tattoo history at a glance:

- Every completed tattoo, with a **before/after view** — the original
  design next to how it looked placed on the body (or, for a cover-up, the
  original tattoo photo next to the finished result).
- **Sessions still in progress**, so nothing gets lost track of.
- Filter history by type — AI-designed vs. rework/cover-up.
- Start a brand-new tattoo for that same customer with one click.

---

## For the Studio Admin

Everything a designer can do, plus studio-wide oversight:

### Dashboard
A live snapshot of the whole studio:
- Active sessions, sessions completed this week, total customers, active
  designers, and an overall completion rate.
- A day-by-day chart of session activity over the last two weeks.
- A leaderboard of the busiest designers over the last 30 days.
- A gallery of the studio's most recent finished tattoos.
- A "needs attention" list — sessions still waiting to be assigned to a
  designer.

### Customer Directory
Every customer the studio has ever served, searchable, with their session
count and last visit at a glance.

### Designer Management
- Add new designer accounts, edit their name/email/photo, and
  activate or deactivate them.
- Reset a designer's password when needed.
- View any designer's full profile: every session they've handled, with
  stats on completed vs. in-progress work.

### Recently Deleted
A safety net for deleted sessions:
- When a session is deleted (by a designer or admin), it doesn't disappear
  right away — it moves here first, along with a countdown showing how
  many days remain before it's gone for good (30 days).
- Restore it any time during that window, or delete it permanently right
  away if it's truly not needed.
- A small counter shows how many newly-deleted sessions are waiting to be
  reviewed, so nothing is missed.

### Studio Settings
Change the admin account's own password.

---

## Roles at a Glance

| Can do this... | Designer | Admin |
|---|---|---|
| Look up / create customers | ✅ | ✅ |
| Create & refine tattoo designs | ✅ | ✅ |
| Placement preview & finalize | ✅ | ✅ |
| Print stencils | ✅ | ✅ |
| View customer history | ✅ | ✅ |
| See only their own sessions | ✅ | — |
| See every session, every designer | — | ✅ |
| Studio dashboard & reports | — | ✅ |
| Manage designer accounts | — | ✅ |
| Restore / permanently delete sessions | — | ✅ |
