# jev-dynamic-ui

A chat UI that picks a prebuilt UI component to carry out a banking action, filling it with context from the chat. Component selection uses [TypeSafe AI's](https://typesafe.ai) Jev decision model.

Type "Send $50 to Sam for dinner" and the app opens the e-Transfer form with the recipient and amount already filled in. Anything the message doesn't say is left blank and flagged, and anything Jev is unsure about is marked "Please check".

## Run it

Needs Node 22 or newer.

```bash
npm install
cp .env.example .env.local   # then put your TypeSafe API key in .env.local
npm run dev                  # http://localhost:3000
```

`.env.local` is gitignored. The key is only ever read on the server; never give it a `NEXT_PUBLIC_` prefix.

## How it works

```
browser                          server (Next.js)                         TypeSafe
Chat (client component)  --->  classifyMessage (server action)  --->  Jev: one request per message
                                  lib/jev/classify.ts                   "which action?" + every param
ActionPanel picks a form  <---  typed result (action + params)  <---
```

- `src/lib/jev/catalog.ts` is the single source of truth: each action and its parameters. Adding an action here is how you extend the app.
- `src/lib/jev/classify.ts` sends **one** request per message with a question for the action plus a question for every parameter of every action. Code keeps only the chosen action's answers (TypeSafe's function-calling pattern).
- Jev picks, it never writes text. For amounts, emails, phones and names, code first finds candidates in the message (`candidates.ts`) and Jev chooses which one fills each parameter, or "none". Choice parameters (account type and so on) pick from the options in the catalog.
- `src/lib/jev/types.ts` derives the result types from the catalog. `ActionPanel` switches on `call.action`; TypeScript narrows the params in each case and fails the build if an action has no component.
- `src/components/ui/` is shadcn/ui style components (Tailwind + Radix).

## Tests

```bash
npm test          # integration tests: real classifier + real SDK over HTTP to a local fake Jev
npm run test:e2e  # browser tests: the built app in Chromium against the same fake Jev
npm run typecheck
npm run lint
```

The fake Jev (`e2e/fake-jev.mts`) is a crude rule-based stand-in. These tests check the wiring (questions built, candidates offered, answers turned into forms) but say nothing about how accurate the real model is. First run of the browser tests needs a Chromium: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH` to one you already have.

## Dependency notes

- TypeScript 7 (the native compiler) runs `npm run typecheck`. `typescript-eslint`, which `eslint-config-next` uses, doesn't support TS 7 yet, so `typescript` in `package.json` is aliased to Microsoft's `@typescript/typescript6` compatibility package for the tools that import it (ESLint, Next), as the TS 7 announcement recommends, and `@typescript/native` provides `tsc`. Once typescript-eslint supports TS 7, replace both with a plain `typescript@7`.
- `@types/node` stays on 22 to match the Node 22 runtime; newer majors describe APIs Node 22 doesn't have.
- shadcn/ui components are copied into `src/components/ui/` (not a dependency), so they only change when you re-run `npx shadcn add <name> --overwrite`.
- `npm audit` reports a `braces` advisory in the ESLint toolchain (dev only, nothing ships). There is no patched `braces` release yet.

## Before deploying

The server action is a public endpoint. Add authentication (and rate limiting, since each call spends TypeSafe credits) before exposing it. The forms don't call a banking API yet; submitting shows a demo notice.
