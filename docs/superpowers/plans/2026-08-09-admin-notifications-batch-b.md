# Notifications and Admin Workflow Batch B Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-device notifications and reorganize the desktop admin workflow while making caption retry and video assignment direct and recoverable.

**Architecture:** Derive notifications from existing announcement, homework, journal, and security records and persist only read receipts. Keep existing admin APIs/actions, presenting them behind themed tabs. Extend the video library response with effective lessons and reuse the validated override/caption APIs for row-level actions.

**Tech Stack:** Next.js 14, React, TypeScript, Vercel Blob, Kinescope REST API, Vitest.

### Task 1: Notifications

- Add persistent per-user notification read receipts.
- Add authenticated GET/POST notification aggregation API.
- Add a TopNav notification center with unread count, empty/error/retry states, and strike visibility only after the first strike.

### Task 2: Admin information architecture

- Add desktop tabs for Homework, Students, Videos, Announcements, and Security.
- Keep Curriculum as a direct management link because curriculum controls already live on the lessons surface.
- Preserve all existing controls and data sources.

### Task 3: Video operations

- Return effective lessons from the admin video-library API.
- Add direct assignment per video using the validated lesson override endpoint.
- Add explicit English-caption generate/retry state per video row.
- Reject assignment to unknown lesson IDs server-side.

### Task 4: Verify and deploy

- Run full tests, TypeScript, production build, diff checks, code review, GitHub push, and Vercel Ready monitoring.
