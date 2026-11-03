package com.photometrytools;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns on-device text lines into customer fields. No network calls.
 * Port of the iOS Vision card parser, including the same field rules.
 */
public final class BusinessCardParser {
    private static final String EMAIL_PATTERN = "[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}";
    private static final String PHONE_PATTERN =
            "(?:\\+\\d{1,3}[\\s.\\-]?)?(?:\\(\\d{3}\\)|\\d{3})[\\s.\\-]\\d{3}[\\s.\\-]\\d{4}";
    private static final String WEBSITE_PATTERN =
            "(?:https?:\\/\\/)?(?:www\\.)?[A-Z0-9][A-Z0-9\\-]*\\.[A-Z]{2,}(?:\\/[^\\s]*)?";

    private static final Set<String> STATE_ABBREVIATIONS = new HashSet<>(Arrays.asList(
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
            "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
            "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
            "VA", "WA", "WV", "WI", "WY", "DC"
    ));

    private static final String[] STATE_NAME_KEYS = {
            "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
            "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
            "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
            "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
            "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
            "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
            "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
            "wisconsin", "wyoming", "district of columbia"
    };
    private static final String[] STATE_NAME_VALUES = {
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
            "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
            "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
            "VA", "WA", "WV", "WI", "WY", "DC"
    };

    private static final Set<String> TITLE_TOKENS = new HashSet<>(Arrays.asList(
            "director", "manager", "engineer", "technician", "tech", "owner", "president", "ceo", "cfo",
            "coo", "cto", "founder", "specialist", "consultant", "coordinator", "representative", "bmet",
            "fse", "physician", "doctor", "md", "do", "rn", "np", "administrator", "admin", "sales",
            "vice", "vp", "chief", "partner", "principal", "supervisor", "operator", "dispatcher",
            "officer", "lead", "clinical", "biomed", "biomedical", "aesthetician"
    ));
    private static final Set<String> STRONG_COMPANY = new HashSet<>(Arrays.asList(
            "inc", "llc", "ltd", "corp", "corporation", "company", "clinic", "clinics", "hospital",
            "center", "centre", "group", "associates", "pllc", "institute", "practice", "spa", "spas"
    ));
    private static final Set<String> WEAK_COMPANY = new HashSet<>(Arrays.asList(
            "medical", "laser", "health", "healthcare", "dermatology", "surgery", "wellness",
            "aesthetic", "aesthetics", "systems", "services", "service", "solutions", "repair",
            "labs", "laboratory"
    ));
    private static final Set<String> FILLER = new HashSet<>(Arrays.asList(
            "field", "service", "services", "senior", "junior", "regional", "national", "technical",
            "laser", "medical", "clinical", "aesthetic", "biomedical", "customer", "account",
            "support", "operations", "operation", "general", "of", "and", "the", "for", "at"
    ));
    private static final Set<String> HONORIFIC = new HashSet<>(Arrays.asList(
            "dr", "mr", "mrs", "ms", "prof"
    ));
    private static final Set<String> SUFFIX_ONLY = new HashSet<>(Arrays.asList(
            "md", "do", "phd", "rn", "np", "pa", "jr", "sr", "ii", "iii", "iv"
    ));
    private static final Set<String> STREET_SUFFIX = new HashSet<>(Arrays.asList(
            "street", "st", "avenue", "ave", "road", "rd", "boulevard", "blvd", "drive", "dr",
            "lane", "ln", "way", "court", "ct", "place", "pl", "parkway", "pkwy", "highway", "hwy",
            "circle", "cir", "terrace", "ter", "trail", "trl"
    ));

    private BusinessCardParser() {}

    public static BusinessCardFields parse(String text) {
        if (text == null) text = "";
        String[] raw = text.split("\\r?\\n", -1);
        return parseLines(Arrays.asList(raw));
    }

    public static BusinessCardFields parseLines(List<String> lines) {
        List<String> pool = new ArrayList<>();
        if (lines != null) {
            for (String line : lines) {
                for (String piece : splitCompositeLine(line)) {
                    String trimmed = BusinessCardFields.trim(piece);
                    if (!trimmed.isEmpty()) pool.add(trimmed);
                }
            }
        }
        BusinessCardFields fields = new BusinessCardFields();
        List<String> kept = new ArrayList<>();
        for (String line : pool) {
            String email = firstMatch(line, EMAIL_PATTERN);
            String phone = firstPhone(line);
            String website = email == null ? firstWebsite(line) : null;
            if (fields.email.isEmpty() && email != null) fields.email = email;
            if (fields.phone.isEmpty() && phone != null) fields.phone = phone;
            if (fields.website.isEmpty() && website != null
                    && (email == null || !website.toLowerCase(Locale.US).equals(email.toLowerCase(Locale.US)))) {
                fields.website = website;
            }
            String stripped = stripContacts(line);
            if (!stripped.isEmpty()) kept.add(stripped);
        }
        pool = kept;

        int localityIndex = -1;
        Locality locality = null;
        for (int i = 0; i < pool.size(); i++) {
            locality = parseLocality(pool.get(i));
            if (locality != null) {
                localityIndex = i;
                break;
            }
        }
        if (locality != null) {
            fields.city = locality.city;
            fields.state = locality.state;
            fields.zip = locality.zip;
            List<String> streetParts = new ArrayList<>();
            if (locality.street != null && !locality.street.isEmpty()) streetParts.add(locality.street);
            Set<Integer> consumed = new HashSet<>();
            consumed.add(localityIndex);
            int cursor = localityIndex - 1;
            while (cursor >= 0 && isStreetOrSuite(pool.get(cursor))) {
                streetParts.add(0, pool.get(cursor));
                consumed.add(cursor);
                cursor--;
            }
            cursor = localityIndex + 1;
            while (cursor < pool.size() && isSuiteLine(pool.get(cursor))) {
                streetParts.add(pool.get(cursor));
                consumed.add(cursor);
                cursor++;
            }
            fields.address = join(streetParts, ", ");
            List<String> next = new ArrayList<>();
            for (int i = 0; i < pool.size(); i++) {
                if (!consumed.contains(i)) next.add(pool.get(i));
            }
            pool = next;
        }

        List<String> classified = new ArrayList<>();
        for (String line : pool) {
            String[] split = splitNameAndTitle(line);
            if (split != null) {
                classified.add(split[0]);
                classified.add(split[1]);
            } else {
                classified.add(line);
            }
        }

        List<String> titles = new ArrayList<>();
        List<String> companies = new ArrayList<>();
        List<String> names = new ArrayList<>();
        List<String> leftovers = new ArrayList<>();
        List<String> streets = new ArrayList<>();
        for (String line : classified) {
            if (isStreetOrSuite(line) && !hasStrongCompany(line) && !isTitle(line)) {
                streets.add(line);
            } else if (isTitle(line)) {
                titles.add(line);
            } else if (hasStrongCompany(line) || hasWeakCompany(line)) {
                companies.add(line);
            } else if (isPersonName(line)) {
                names.add(line);
            } else {
                leftovers.add(line);
            }
        }

        if (fields.title.isEmpty()) fields.title = titles.isEmpty() ? "" : titles.get(0);
        if (fields.company.isEmpty()) fields.company = companies.isEmpty() ? "" : companies.get(0);
        if (fields.name.isEmpty()) fields.name = names.isEmpty() ? "" : names.get(0);
        if (fields.address.isEmpty()) {
            fields.address = join(streets, ", ");
        } else if (!streets.isEmpty()) {
            List<String> both = new ArrayList<>(streets);
            both.add(fields.address);
            fields.address = join(both, ", ");
        }

        for (String line : leftovers) {
            if (fields.company.isEmpty() && isShoutedCompany(line)) {
                fields.company = line;
                continue;
            }
            boolean looseName = wordCount(line) >= 2 && wordCount(line) <= 4 && !containsDigit(line);
            if (fields.name.isEmpty() && (isPersonName(line) || looseName)) {
                if (!hasStrongCompany(line) && !isTitle(line)) {
                    fields.name = line;
                    continue;
                }
            }
            if (fields.company.isEmpty()) fields.company = line;
        }

        if (fields.state.length() == 2) fields.state = fields.state.toUpperCase(Locale.US);
        return fields.trimmed();
    }

    private static List<String> splitCompositeLine(String line) {
        if (line == null) return new ArrayList<>();
        String replaced = line.replace(" • ", "\n").replace(" · ", "\n").replace(" | ", "\n");
        String[] parts = replaced.split("\\r?\\n", -1);
        return Arrays.asList(parts);
    }

    private static String firstPhone(String line) {
        String match = firstMatch(line, PHONE_PATTERN);
        if (match != null) return BusinessCardFields.trim(match);
        int digits = 0;
        int compact = 0;
        boolean other = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (Character.isDigit(c)) {
                digits++;
                compact++;
            } else if (c == '+') {
                compact++;
            } else if (c != ' ' && c != '-' && c != '.' && c != '(' && c != ')') {
                other = true;
            }
        }
        if (digits == 10 && compact <= 11 && !other) return BusinessCardFields.trim(line);
        return null;
    }

    private static String firstWebsite(String line) {
        String match = firstMatch(line, WEBSITE_PATTERN);
        if (match == null || match.indexOf('@') >= 0) return null;
        String lower = match.toLowerCase(Locale.US);
        String lineLower = BusinessCardFields.trim(line).toLowerCase(Locale.US);
        if (lower.startsWith("http") || lower.startsWith("www.") || lineLower.equals(lower)) return match;
        return null;
    }

    private static String stripContacts(String line) {
        String text = line;
        text = replacing(text, EMAIL_PATTERN);
        text = replacing(text, PHONE_PATTERN);
        text = replacing(text, WEBSITE_PATTERN);
        int start = 0;
        int end = text.length();
        while (start < end && isStripChar(text.charAt(start))) start++;
        while (end > start && isStripChar(text.charAt(end - 1))) end--;
        String trimmed = text.substring(start, end);
        if (trimmed.length() < 2) return "";
        return trimmed;
    }

    private static boolean isStripChar(char c) {
        if (Character.isWhitespace(c)) return true;
        return c == '|' || c == '•' || c == '·' || c == ',' || c == ';' || c == ':' || c == '/' || c == '-';
    }

    private static final class Locality {
        final String street;
        final String city;
        final String state;
        final String zip;

        Locality(String street, String city, String state, String zip) {
            this.street = street;
            this.city = city;
            this.state = state;
            this.zip = zip;
        }
    }

    private static Locality parseLocality(String line) {
        String[] raw = line.split(",");
        List<String> parts = new ArrayList<>();
        for (String part : raw) {
            String trimmed = BusinessCardFields.trim(part);
            if (!trimmed.isEmpty()) parts.add(trimmed);
        }
        if (parts.size() >= 2) {
            String[] stateZip = matchStateZip(parts.get(parts.size() - 1));
            if (stateZip != null) {
                String city = parts.get(parts.size() - 2);
                String state = normalizeState(stateZip[0]);
                if (looksLikeCity(city) && state != null) {
                    String street = join(parts.subList(0, parts.size() - 2), ", ");
                    return new Locality(street.isEmpty() ? null : street, city, state, stateZip[1]);
                }
            }
        }
        String[] groups = firstGroups(line, "^(.+?)[\\s,]+([A-Za-z]{2})\\s+(\\d{5}(?:-\\d{4})?)\\s*$");
        if (groups != null && groups.length == 3) {
            String state = normalizeState(groups[1]);
            if (state != null && !containsDigit(groups[0])) {
                return new Locality(null, BusinessCardFields.trim(groups[0]), state, groups[2]);
            }
        }
        return null;
    }

    /** @return state, zip or null */
    private static String[] matchStateZip(String text) {
        String[] groups = firstGroups(text, "^([A-Za-z]{2}|[A-Za-z][A-Za-z .]+)\\s+(\\d{5}(?:-\\d{4})?)$");
        if (groups != null && groups.length == 2) return new String[]{groups[0], groups[1]};
        String state = normalizeState(text);
        if (state != null) {
            String key = trimPunctuation(BusinessCardFields.trim(text).toLowerCase(Locale.US));
            if (SUFFIX_ONLY.contains(key)) return null;
            return new String[]{state, ""};
        }
        return null;
    }

    private static String normalizeState(String raw) {
        String trimmed = BusinessCardFields.trim(raw);
        if (trimmed.length() == 2) {
            String upper = trimmed.toUpperCase(Locale.US);
            return STATE_ABBREVIATIONS.contains(upper) ? upper : null;
        }
        String lower = trimmed.toLowerCase(Locale.US);
        for (int i = 0; i < STATE_NAME_KEYS.length; i++) {
            if (STATE_NAME_KEYS[i].equals(lower)) return STATE_NAME_VALUES[i];
        }
        return null;
    }

    private static boolean looksLikeCity(String value) {
        String trimmed = BusinessCardFields.trim(value);
        if (trimmed.isEmpty() || trimmed.length() > 40) return false;
        if (containsDigit(trimmed)) return false;
        return !isSuiteLine(trimmed);
    }

    private static boolean isStreetOrSuite(String line) {
        if (isSuiteLine(line)) return true;
        String lower = line.toLowerCase(Locale.US);
        if (lower.contains("p.o. box") || lower.contains("po box") || lower.contains("p.o.box")) return true;
        List<String> tokens = words(line);
        List<String> streetTokens = new ArrayList<>();
        for (String token : tokens) {
            if (STREET_SUFFIX.contains(token)) streetTokens.add(token);
        }
        if (!streetTokens.isEmpty()) {
            boolean onlyLeadingHonorific = streetTokens.size() == 1
                    && "dr".equals(streetTokens.get(0))
                    && !tokens.isEmpty()
                    && "dr".equals(tokens.get(0))
                    && !containsDigit(line);
            if (!onlyLeadingHonorific) return true;
        }
        return !line.isEmpty() && Character.isDigit(line.charAt(0));
    }

    private static boolean isSuiteLine(String line) {
        String lower = line.toLowerCase(Locale.US);
        return lower.startsWith("suite") || lower.startsWith("ste ") || lower.startsWith("ste.")
                || lower.startsWith("floor") || lower.startsWith("unit ") || lower.startsWith("apt ")
                || lower.startsWith("#");
    }

    private static boolean isTitle(String line) {
        List<String> tokens = words(line);
        if (tokens.isEmpty() || tokens.size() > 8) return false;
        boolean hasTitle = false;
        for (String token : tokens) {
            if (TITLE_TOKENS.contains(token)) {
                hasTitle = true;
                break;
            }
        }
        if (!hasTitle || hasStrongCompany(line)) return false;
        int nameWords = 0;
        for (String token : tokens) {
            if (!TITLE_TOKENS.contains(token) && !FILLER.contains(token) && !HONORIFIC.contains(token)) {
                nameWords++;
            }
        }
        return nameWords < 2;
    }

    /** @return name, title or null */
    private static String[] splitNameAndTitle(String line) {
        int comma = line.indexOf(',');
        if (comma < 0) return null;
        String left = BusinessCardFields.trim(line.substring(0, comma));
        String right = BusinessCardFields.trim(line.substring(comma + 1));
        if (left.isEmpty() || right.isEmpty() || right.indexOf(',') >= 0) return null;
        String suffix = trimPunctuation(right.toLowerCase(Locale.US));
        if (SUFFIX_ONLY.contains(suffix)) return null;
        if (!isPersonName(left) || !isTitle(right)) return null;
        return new String[]{left, right};
    }

    private static boolean hasStrongCompany(String line) {
        for (String token : tokens(line)) {
            if (STRONG_COMPANY.contains(token)) return true;
        }
        return false;
    }

    private static boolean hasWeakCompany(String line) {
        for (String token : tokens(line)) {
            if (WEAK_COMPANY.contains(token)) return true;
        }
        return false;
    }

    private static boolean isPersonName(String line) {
        if (hasStrongCompany(line)) return false;
        String[] raw = line.trim().split("\\s+");
        List<String> tokens = new ArrayList<>();
        for (String token : raw) {
            if (!token.isEmpty()) tokens.add(token);
        }
        Set<String> honorifics = new HashSet<>(Arrays.asList(
                "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof."
        ));
        Set<String> suffixes = new HashSet<>(Arrays.asList(
                "md", "m.d.", "do", "d.o.", "phd", "ph.d.", "jr", "jr.", "sr", "sr.", "rn", "np", "pa", "ii", "iii", "iv"
        ));
        while (!tokens.isEmpty() && honorifics.contains(tokens.get(0).toLowerCase(Locale.US))) {
            tokens.remove(0);
        }
        while (!tokens.isEmpty()) {
            String last = trimPunctuation(tokens.get(tokens.size() - 1).toLowerCase(Locale.US));
            if (!suffixes.contains(last) && !suffixes.contains(tokens.get(tokens.size() - 1).toLowerCase(Locale.US))) {
                break;
            }
            tokens.remove(tokens.size() - 1);
        }
        if (tokens.size() < 2 || tokens.size() > 5) return false;
        for (String token : tokens) {
            if (containsDigit(token)) return false;
        }
        Set<String> particles = new HashSet<>(Arrays.asList(
                "de", "del", "da", "di", "van", "von", "la", "le", "st", "st."
        ));
        for (String word : tokens) {
            String cleaned = trimPunctuation(word);
            if (particles.contains(cleaned.toLowerCase(Locale.US))) continue;
            if (cleaned.length() <= 2 && cleaned.indexOf('.') >= 0) continue;
            if (cleaned.isEmpty() || !Character.isUpperCase(cleaned.charAt(0))) return false;
        }
        return true;
    }

    private static boolean isShoutedCompany(String line) {
        int letters = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (!Character.isLetter(c)) continue;
            letters++;
            if (!Character.isUpperCase(c)) return false;
        }
        return letters >= 6 && wordCount(line) >= 2;
    }

    private static List<String> words(String line) {
        return splitAlpha(line.toLowerCase(Locale.US));
    }

    private static List<String> tokens(String line) {
        return splitAlpha(line.toLowerCase(Locale.US).replace(".", ""));
    }

    private static List<String> splitAlpha(String value) {
        List<String> out = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                current.append(c);
            } else if (current.length() > 0) {
                out.add(current.toString());
                current.setLength(0);
            }
        }
        if (current.length() > 0) out.add(current.toString());
        return out;
    }

    private static int wordCount(String line) {
        String trimmed = line.trim();
        if (trimmed.isEmpty()) return 0;
        return trimmed.split("\\s+").length;
    }

    private static boolean containsDigit(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isDigit(value.charAt(i))) return true;
        }
        return false;
    }

    private static String firstMatch(String text, String pattern) {
        String[] groups = firstGroups(text, pattern);
        if (groups == null || groups.length == 0) return null;
        return groups[0];
    }

    private static String[] firstGroups(String text, String pattern) {
        if (text == null) return null;
        Pattern compiled;
        try {
            compiled = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
        } catch (Exception e) {
            return null;
        }
        Matcher matcher = compiled.matcher(text);
        if (!matcher.find()) return null;
        if (matcher.groupCount() == 0) return new String[]{matcher.group()};
        String[] groups = new String[matcher.groupCount()];
        for (int i = 1; i <= matcher.groupCount(); i++) {
            String group = matcher.group(i);
            if (group == null) return null;
            groups[i - 1] = group;
        }
        return groups;
    }

    private static String replacing(String text, String pattern) {
        try {
            return Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(text).replaceAll(" ");
        } catch (Exception e) {
            return text;
        }
    }

    private static String trimPunctuation(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && isPunctuation(value.charAt(start))) start++;
        while (end > start && isPunctuation(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    private static boolean isPunctuation(char c) {
        int type = Character.getType(c);
        return type == Character.CONNECTOR_PUNCTUATION
                || type == Character.DASH_PUNCTUATION
                || type == Character.START_PUNCTUATION
                || type == Character.END_PUNCTUATION
                || type == Character.INITIAL_QUOTE_PUNCTUATION
                || type == Character.FINAL_QUOTE_PUNCTUATION
                || type == Character.OTHER_PUNCTUATION;
    }

    private static String join(List<String> parts, String sep) {
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            if (part == null || part.isEmpty()) continue;
            if (sb.length() > 0) sb.append(sep);
            sb.append(part);
        }
        return sb.toString();
    }
}
