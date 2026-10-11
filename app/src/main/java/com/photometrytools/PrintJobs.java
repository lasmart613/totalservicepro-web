package com.photometrytools;

/**
 * Print job names for the system print UI. Service report HTML titles are
 * "Service Report &lt;n&gt;" (see the live print document); those become
 * ServiceReport-&lt;n&gt;. Every other title is kept, with characters the
 * print spooler rejects removed.
 */
public final class PrintJobs {
    private PrintJobs() {}

    public static String jobNameFromTitle(String title) {
        if (title == null) return "Document";
        String trimmed = title.replace('\u00a0', ' ').trim();
        if (trimmed.isEmpty() || "about:blank".equalsIgnoreCase(trimmed)) return "Document";
        String prefix = "Service Report";
        if (trimmed.regionMatches(true, 0, prefix, 0, prefix.length())) {
            String rest = trimmed.substring(prefix.length()).trim();
            rest = rest.replaceFirst("^[\\-–—:]+\\s*", "");
            if (rest.isEmpty()) return "ServiceReport";
            return "ServiceReport-" + sanitize(rest);
        }
        return sanitize(trimmed);
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
