# PRD — Real Estate PWA for Uganda (MVP)

## Vision

A professional, scam-free rental marketplace for Uganda that connects landlords and tenants **directly**, removing broker fees and fake listings. Trust is the product: every listing is manually verified by the admin before tenants ever see it.

**Target users**
- **Landlords** — want to list a property quickly from their phone and get contacted directly by serious tenants.
- **Tenants** — want to browse real, verified properties and contact the owner instantly, without paying a middleman.
- **Admin (owner)** — the single gatekeeper who verifies every listing before it goes live.

**MVP success criteria**
- A landlord can submit a listing with photos in under 3 minutes on a phone.
- Zero unverified listings ever visible to tenants.
- A tenant can go from opening the app to messaging a landlord on WhatsApp in under 60 seconds.

---

## Feature 1 — Landlord Listing Flow

A simple, mobile-first form for landlords to submit a property.

**Fields (MVP)**
- Title, property type (e.g., single room, self-contained, apartment, house)
- Location (district + area/neighborhood, free-text landmark)
- Monthly rent in UGX
- Description
- Photos (1–8 images, validated for type/size, compressed client-side)
- Landlord name and WhatsApp phone number

**Behavior**
- On submit, the listing is saved with status **`pending`** and is NOT publicly visible.
- Landlord sees a clear confirmation: "Your listing is under review. It will go live once verified."
- Server-side validation on every field (Pydantic); photo uploads validated and stored on the backend.

**Out of scope for MVP:** landlord accounts/login, editing after submission, payments.

## Feature 2 — The Admin Gatekeeper

The owner's private interface for verifying listings. This is the trust engine of the marketplace.

**Behavior**
- Admin-only route protected by authentication (single admin account for MVP).
- Queue view of all `pending` listings, oldest first, showing every field and all photos.
- Actions per listing: **Approve** (goes live immediately) or **Reject** (with optional reason, never shown publicly).
- Approved listings become visible in the tenant feed; rejected listings never do.
- The `approved`-only filter is enforced in the API layer — the public endpoints can never return `pending` or `rejected` listings, regardless of client behavior.

**Out of scope for MVP:** multiple admin users, audit logs, landlord notifications (can be done manually via WhatsApp at first).

## Feature 3 — The Tenant "App" Experience

A clean, fast, installable PWA feed of verified properties.

**Behavior**
- Home feed shows **approved listings only**, newest first, as photo-forward cards (photo, title, location, rent in UGX).
- Search and filter: by location text, property type, and rent range.
- Listing detail page: photo gallery, full description, location, rent.
- **"WhatsApp Owner" button** — one tap opens WhatsApp (`wa.me` link) with a pre-filled message referencing the listing. No in-app chat.
- Installable PWA: manifest + service worker, app icon, works as a home-screen app, tolerates flaky connections (cached shell, skeleton loaders).
- No tenant account or login required to browse and contact.

**Out of scope for MVP:** saved favorites, map view, in-app messaging, tenant accounts, push notifications.

---

## Tech Stack (fixed)

| Layer | Choice |
|---|---|
| Frontend | React + Vite, PWA (manifest + service worker) |
| Backend | FastAPI (Python), Pydantic validation |
| Database | SQLite |
| Contact channel | WhatsApp deep links (`wa.me`) |

**Listing status lifecycle:** `pending → approved` or `pending → rejected`. No other transitions in MVP.

## Build order (incremental, test-driven)

1. Backend foundation: listing model, status lifecycle, submission + public endpoints, tests proving non-approved listings are never exposed.
2. Feature 1: landlord submission form (UI + photo upload) wired to the API.
3. Feature 2: admin auth + approval queue.
4. Feature 3: tenant feed, search, detail page, WhatsApp button, PWA polish.
