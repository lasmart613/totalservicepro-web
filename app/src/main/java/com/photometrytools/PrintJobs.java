package com.photometrytools;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Print job names. A service-report title in any shipped language becomes
 * ServiceReport-&lt;n&gt;. On a report page with no number, the name is
 * ServiceReport-&lt;yyyyMMdd-HHmm&gt; rather than the site title.
 */
public final class PrintJobs {
    private static final String[] REPORT_PREFIXES = {
            "Service Report",
            "Informe de servicio",
            "Rapport d'intervention",
            "Rapport d’intervention",
            "Servicebericht",
            "Relatório de serviço",
            "Rapporto di assistenza",
            "דוח שירות",
            "گزارش سرویس",
            "تقرير الخدمة",
    };

    private PrintJobs() {}

    public static String jobNameFromTitle(String title) {
        return jobName(title, null, null, 0L, TimeZone.getTimeZone("UTC"));
    }

    public static String jobName(String title, String reportNumber, String path, long nowMs, TimeZone zone) {
        String number = token(reportNumber);
        if (number.isEmpty()) number = token(reportIdFromPath(path));
        if (!number.isEmpty()) return "ServiceReport-" + number;
        String fromTitle = fromTranslatedTitle(title, path, nowMs, zone);
        if (fromTitle != null) return fromTitle;
        if (isReportPath(path)) return "ServiceReport-" + stamp(nowMs, zone);
        if (isGenericSiteTitle(title)) return "Document";
        return sanitize(title == null ? "" : title);
    }

    static String fromTranslatedTitle(String title, String path, long nowMs, TimeZone zone) {
        if (title == null) return null;
        String trimmed = title.replace('\u00a0', ' ').trim();
        if (trimmed.isEmpty() || "about:blank".equalsIgnoreCase(trimmed)) return null;
        for (int i = 0; i < REPORT_PREFIXES.length; i++) {
            String prefix = REPORT_PREFIXES[i];
            if (prefix.length() > trimmed.length()) continue;
            if (!trimmed.regionMatches(true, 0, prefix, 0, prefix.length())) continue;
            String rest = trimmed.substring(prefix.length()).trim();
            rest = rest.replaceFirst("^[\\-–—:]+\\s*", "");
            if (rest.isEmpty()) {
                if (isReportPath(path)) return "ServiceReport-" + stamp(nowMs, zone);
                return "ServiceReport";
            }
            String number = token(rest);
            if (number.isEmpty()) return "ServiceReport";
            return "ServiceReport-" + number;
        }
        return null;
    }

    static String reportIdFromPath(String path) {
        if (!isReportPath(path)) return "";
        String p = path;
        int q = p.indexOf('?');
        if (q >= 0) p = p.substring(0, q);
        int h = p.indexOf('#');
        if (h >= 0) p = p.substring(0, h);
        if (p.length() > 1 && p.endsWith("/")) p = p.substring(0, p.length() - 1);
        if (!p.startsWith("/reports/")) return "";
        String rest = p.substring("/reports/".length());
        if (rest.isEmpty() || "new".equalsIgnoreCase(rest)) return "";
        int slash = rest.indexOf('/');
        if (slash >= 0) rest = rest.substring(0, slash);
        return rest;
    }

    static boolean isReportPath(String path) {
        if (path == null || path.isEmpty()) return false;
        String p = path;
        int q = p.indexOf('?');
        if (q >= 0) p = p.substring(0, q);
        int h = p.indexOf('#');
        if (h >= 0) p = p.substring(0, h);
        if (p.length() > 1 && p.endsWith("/")) p = p.substring(0, p.length() - 1);
        return "/reports".equals(p) || p.startsWith("/reports/");
    }

    static boolean isGenericSiteTitle(String title) {
        if (title == null) return true;
        String trimmed = title.replace('\u00a0', ' ').trim();
        if (trimmed.isEmpty() || "about:blank".equalsIgnoreCase(trimmed)) return true;
        if ("Total Service Pro".equalsIgnoreCase(trimmed)) return true;
        return trimmed.regionMatches(true, 0, "RepairPlanet", 0, "RepairPlanet".length());
    }

    static String stamp(long nowMs, TimeZone zone) {
        TimeZone tz = zone == null ? TimeZone.getTimeZone("UTC") : zone;
        Calendar calendar = Calendar.getInstance(tz, Locale.US);
        calendar.setTimeInMillis(nowMs);
        return String.format(Locale.US, "%04d%02d%02d-%02d%02d",
                calendar.get(Calendar.YEAR),
                calendar.get(Calendar.MONTH) + 1,
                calendar.get(Calendar.DAY_OF_MONTH),
                calendar.get(Calendar.HOUR_OF_DAY),
                calendar.get(Calendar.MINUTE));
    }

    static String token(String raw) {
        if (raw == null) return "";
        String cleaned = sanitize(raw);
        if ("Document".equals(cleaned) && (raw.trim().isEmpty())) return "";
        if ("Document".equals(cleaned)) return "";
        return cleaned;
    }

    static String sanitize(String raw) {
        String cleaned = raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-");
        cleaned = cleaned.replaceAll("\\s+", "-");
        cleaned = cleaned.replaceAll("-{2,}", "-");
        cleaned = cleaned.replaceAll("^-+", "").replaceAll("-+$", "");
        if (cleaned.length() > 80) cleaned = cleaned.substring(0, 80);
        cleaned = cleaned.replaceAll("-+$", "");
        if (cleaned.isEmpty()) return "Document";
        return cleaned;
    }
}
