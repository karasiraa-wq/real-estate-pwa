# CLAUDE.md — Development Rules

This file governs how Claude Code works on this project. These rules are fixed. Do not deviate from them without an explicit instruction from the project owner.

## Project

A professional real estate PWA for the Ugandan market. It connects landlords and tenants directly, replacing middlemen (brokers). The core promise to users is a **scam-free marketplace**: every listing is manually verified before it goes live.

## Rule 1 — Claude Code is the primary driver

Development is done through Claude Code. Keep changes small, explainable, and reviewable. When a task is ambiguous, ask the owner before building.

## Rule 2 — Admin-First architecture (non-negotiable)

- **No listing goes live without manual approval by the owner via the admin panel.**
- Every new listing is created with status `pending`. Only an admin action can move it to `approved`. Only `approved` listings are ever returned by public/tenant-facing endpoints.
- This gate must be enforced **server-side in the API layer** (not just hidden in the UI). Any query powering the tenant feed must filter on `status = 'approved'`.
- Never add a code path, flag, or shortcut that bypasses this gate — including in seeds, fixtures, or "demo" modes that could reach production.

## Rule 3 — Product feel: premium, native, mobile-first

- The frontend is a **PWA built with React + Vite**. The backend is **FastAPI (Python)**.
- Design mobile-first for mid-range Android devices on variable networks: fast first paint, small bundles, compressed images, skeleton loaders over spinners, offline-tolerant shell.
- The UI should feel like a native app: clean layouts, smooth transitions, touch-friendly targets, no web-page clutter.

## Rule 4 — Incremental, test-driven development

- Work in small vertical slices: one feature end-to-end (API + UI + tests) before starting the next.
- Backend: pytest against FastAPI endpoints. The listing status lifecycle (`pending → approved` / `rejected`) must always have test coverage, especially the invariant that non-approved listings never appear in public responses.
- Frontend: Vitest + React Testing Library for critical flows.
- Do not merge or move on while tests are failing.

## Rule 5 — No stack or scope drift

- Stack is fixed: **React (Vite) frontend, FastAPI backend, SQLite database.** Do not introduce alternative frameworks, ORMs beyond what we standardize on, heavy state libraries, or replacement databases without owner approval.
- Do not swap models, rewrite architecture, or "improve" the design beyond the PRD. If a change seems necessary, propose it and wait for approval.
- MVP scope is defined in `PRD.md`. Features not in the PRD are out of scope until the owner says otherwise.

## Rule 6 — Security is a feature

- Admin panel requires authentication; admin credentials are never hardcoded or committed.
- All input is validated server-side (Pydantic). Uploaded photos are validated for type and size.
- No secrets in the repo — use environment variables and a `.env` file that stays gitignored.
- Rate-limit public submission endpoints to deter spam listings.
