import { predictMessage } from "@/lib/jev/predict";

/**
 * The chat's prediction endpoint. A plain route (not a Server Action) so the browser can abort a request: when the
 * customer types something newer, `request.signal` fires and the extractor stops working on the old text.
 * Public endpoint like the Server Action was: add authentication and rate limiting before deploying.
 */
export async function POST(request: Request) {
  let body: { message?: unknown; sent?: unknown; guess?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Message must be text." }, { status: 400 });
  }
  const outcome = await predictMessage(body.message, { sent: body.sent === true, guess: body.guess, signal: request.signal });
  return Response.json(outcome);
}
