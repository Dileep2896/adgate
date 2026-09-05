import { NextResponse } from 'next/server';

import { currentSession } from '@/lib/auth';
import { sameOriginRedirect } from '@/lib/http';
import { loadReportBundle } from '@/lib/report-generate';
import { getReport } from '@/lib/report-queries';

/**
 * The downloadable JSON bundle of one report: the document, the underlying audit records with
 * the neighbours their checks read, the creative content behind every content_hash, and the
 * public keys - everything packages/dashboard/scripts/verify-bundle.ts needs to re-verify the
 * whole thing offline (lib/report-bundle.ts).
 *
 * A route handler does NOT render app/(dashboard)/layout.tsx, so the session is checked here.
 * An anonymous request is sent to the login form rather than given a 401 body, because this URL
 * is reached by clicking a link: sameOriginRedirect keeps the session cookie (lib/http.ts).
 *
 * Read only. The records are re-read now rather than frozen at generation time - see
 * loadReportBundle: a record edited since the report was generated must show up as a bundle that
 * fails to verify, which is the whole point of handing one over.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id } = await context.params;

  if ((await currentSession()) === null) {
    return sameOriginRedirect(`/login?from=${encodeURIComponent(`/reports/${id}`)}`, 303);
  }

  const report = await getReport(id);
  if (report === null) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'no such report' } },
      { status: 404 },
    );
  }

  const bundle = await loadReportBundle(report);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${report.id}.json"`,
      'cache-control': 'no-store',
    },
  });
};
