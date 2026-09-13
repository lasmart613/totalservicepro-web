/**
 * Server-only Google Analytics Data API client for God Analytics.
 * Do not import this module from client components.
 */

import { createSign } from 'node:crypto';
import {
  GA4_DATA_API,
  GA4_READONLY_SCOPE,
  GA4_TOKEN_AUD,
  loadGodAnalyticsFromReports,
  overviewReportBody,
  parseGa4Config,
  rankedReportBody,
  realtimeReportBody,
  sanitizeGa4Error,
  type Ga4Config,
  type Ga4DataClient,
  type Ga4ReportResponse,
  type Ga4ServiceAccount,
  type GodAnalyticsPayload,
} from './god-analytics.ts';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function signGa4Jwt(
  account: Ga4ServiceAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: account.clientEmail,
    scope: GA4_READONLY_SCOPE,
    aud: GA4_TOKEN_AUD,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(account.privateKey, 'base64url')}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const tokenCache = new Map<string, { token: string; exp: number }>();

export function clearGa4TokenCache(): void {
  tokenCache.clear();
}

export async function fetchGa4AccessToken(
  account: Ga4ServiceAccount,
  fetchImpl: FetchLike,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const cached = tokenCache.get(account.clientEmail);
  if (cached && cached.exp - 60 > nowSeconds) return cached.token;

  const assertion = signGa4Jwt(account, nowSeconds);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetchImpl(GA4_TOKEN_AUD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      sanitizeGa4Error(json.error_description || json.error || `Token exchange failed (${res.status})`)
    );
  }
  const expiresIn = Number(json.expires_in) || 3600;
  tokenCache.set(account.clientEmail, { token: json.access_token, exp: nowSeconds + expiresIn });
  return json.access_token;
}

async function ga4Post(
  url: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<Ga4ReportResponse> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Ga4ReportResponse;
  if (!res.ok || json.error) {
    throw new Error(sanitizeGa4Error(json.error || `GA4 request failed (${res.status})`));
  }
  return json;
}

export function createGa4DataClient(config: Ga4Config, fetchImpl: FetchLike): Ga4DataClient {
  if (!config.account) {
    throw new Error('GA4 service account is not configured');
  }
  const account = config.account;
  const property = `properties/${config.propertyId}`;
  const withToken = async (path: ':runReport' | ':runRealtimeReport', body: Record<string, unknown>) => {
    const token = await fetchGa4AccessToken(account, fetchImpl);
    return ga4Post(`${GA4_DATA_API}/${property}${path}`, token, body, fetchImpl);
  };
  return {
    runReport: (body) => withToken(':runReport', body),
    runRealtimeReport: (body) => withToken(':runRealtimeReport', body),
  };
}

async function settleReport(
  label: string,
  task: Promise<Ga4ReportResponse>,
  errors: string[]
): Promise<Ga4ReportResponse | null> {
  try {
    return await task;
  } catch (error) {
    errors.push(`${label}: ${sanitizeGa4Error(error)}`);
    return null;
  }
}

export async function loadGodAnalytics(opts?: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: FetchLike;
  client?: Ga4DataClient;
}): Promise<GodAnalyticsPayload> {
  const env = opts?.env || process.env;
  const now = opts?.now || new Date();
  const config = parseGa4Config(env);
  if (!config.account) {
    return loadGodAnalyticsFromReports({ config, now });
  }

  const client = opts?.client || createGa4DataClient(config, opts?.fetchImpl || fetch);
  const errors: string[] = [];
  const [realtime, overview, pages, landings, channels, devices, countries, events] = await Promise.all([
    settleReport('realtime', client.runRealtimeReport(realtimeReportBody()), errors),
    settleReport('overview', client.runReport(overviewReportBody()), errors),
    settleReport(
      'pages',
      client.runReport(rankedReportBody('pagePath', ['screenPageViews', 'activeUsers', 'sessions'], 10, 'screenPageViews')),
      errors
    ),
    settleReport(
      'landings',
      client.runReport(rankedReportBody('landingPage', ['sessions', 'activeUsers'], 10, 'sessions')),
      errors
    ),
    settleReport(
      'channels',
      client.runReport(
        rankedReportBody('sessionDefaultChannelGroup', ['sessions', 'activeUsers', 'newUsers'], 10, 'sessions')
      ),
      errors
    ),
    settleReport(
      'devices',
      client.runReport(rankedReportBody('deviceCategory', ['sessions', 'activeUsers'], 8, 'sessions')),
      errors
    ),
    settleReport(
      'countries',
      client.runReport(rankedReportBody('country', ['activeUsers', 'sessions'], 8, 'activeUsers')),
      errors
    ),
    settleReport(
      'events',
      client.runReport(rankedReportBody('eventName', ['eventCount'], 25, 'eventCount')),
      errors
    ),
  ]);

  return loadGodAnalyticsFromReports({
    config,
    now,
    realtime,
    overview,
    pages,
    landings,
    channels,
    devices,
    countries,
    events,
    errors,
  });
}
