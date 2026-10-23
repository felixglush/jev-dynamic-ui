import { NextResponse, type NextRequest } from "next/server";

import { agentEnabled } from "@/lib/agent/flag";

// Runs on every request to /agent, so the flag is read when the server runs, not when it was built. With the
// flag off the request is rewritten to a path that doesn't exist, which serves not-found.tsx with a 404.
export function proxy(request: NextRequest) {
  if (agentEnabled()) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_agent-disabled", request.url));
}

export const config = {
  matcher: ["/agent", "/agent/:path*"],
};
