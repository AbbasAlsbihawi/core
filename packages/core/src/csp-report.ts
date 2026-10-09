// Parses CSP violation reports into short, log-safe records. Both wire formats: report-uri
// (application/csp-report) and the Reporting API (application/reports+json, an array).
import * as z from 'zod';

/** Reports per request that are logged; a Reporting API batch beyond this is cut. */
export const MAX_REPORTS = 20;
/** Every logged field is cut to this length: report bodies are attacker-controlled text. */
const MAX_FIELD = 128;

export interface CspViolation {
  page: string | undefined;
  directive: string | undefined;
  blocked: string | undefined;
}

const legacyReport = z.object({
  'csp-report': z.looseObject({
    'document-uri': z.string().optional(),
    'violated-directive': z.string().optional(),
    'effective-directive': z.string().optional(),
    'blocked-uri': z.string().optional(),
  }),
});
const reportingApi = z.array(
  z.looseObject({
    type: z.string(),
    body: z
      .looseObject({
        documentURL: z.string().optional(),
        effectiveDirective: z.string().optional(),
        blockedURL: z.string().optional(),
      })
      .optional(),
  }),
);

const cut = (value: string | undefined) => value?.slice(0, MAX_FIELD);

/** A path without query or fragment: reports must not carry tokens or personal data into logs. */
const pathOf = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    return cut(new URL(url).pathname);
  } catch {
    return url.slice(0, 64); // 'inline', 'eval', 'data' …
  }
};

/** At most MAX_REPORTS violations; anything that is not a CSP report yields []. */
export function parseCspReport(body: unknown): CspViolation[] {
  const legacy = legacyReport.safeParse(body);
  if (legacy.success) {
    const r = legacy.data['csp-report'];
    return [
      {
        page: pathOf(r['document-uri']),
        directive: cut(r['effective-directive'] ?? r['violated-directive']),
        blocked: pathOf(r['blocked-uri']),
      },
    ];
  }
  const modern = reportingApi.safeParse(body);
  if (!modern.success) return [];
  return modern.data
    .filter((r) => r.type === 'csp-violation')
    .slice(0, MAX_REPORTS)
    .map((r) => ({
      page: pathOf(r.body?.documentURL),
      directive: cut(r.body?.effectiveDirective),
      blocked: pathOf(r.body?.blockedURL),
    }));
}
