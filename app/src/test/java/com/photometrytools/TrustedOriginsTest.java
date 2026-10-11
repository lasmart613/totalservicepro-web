package com.photometrytools;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Matcher for scheme + host as {@code android.net.Uri#getScheme()} and
 * {@code getHost()} return them. Production calls {@link TrustedOrigins#allowsUrl}
 * which parses with Uri and then this method.
 */
public class TrustedOriginsTest {
    @Test
    public void exactHttpsHosts() {
        assertTrue(TrustedOrigins.allows("https", "repairplanet.net"));
        assertTrue(TrustedOrigins.allows("https", "www.repairplanet.net"));
        assertTrue(TrustedOrigins.allows("https", "yljztfajyvjzqikxdddf.supabase.co"));
        assertTrue(TrustedOrigins.allows("HTTPS", "repairplanet.net"));
    }

    @Test
    public void rejectsSuffixesWildcardsAndOtherHosts() {
        assertFalse(TrustedOrigins.allows("https", "evil.repairplanet.net"));
        assertFalse(TrustedOrigins.allows("https", "repairplanet.net.evil.com"));
        assertFalse(TrustedOrigins.allows("https", "notrepairplanet.net"));
        assertFalse(TrustedOrigins.allows("https", "www.repairplanet.net.attacker.com"));
        assertFalse(TrustedOrigins.allows("https", "evil.supabase.co"));
        assertFalse(TrustedOrigins.allows("https", "yljztfajyvjzqikxdddf.supabase.co.evil.net"));
        assertFalse(TrustedOrigins.allows("https", "supabase.co"));
        assertFalse(TrustedOrigins.allows("https", "totalservicepro.netlify.app"));
        assertFalse(TrustedOrigins.allows("https", "evil.netlify.app"));
        assertFalse(TrustedOrigins.allows("https", "checkout.stripe.com"));
        assertFalse(TrustedOrigins.allows("https", "accounts.google.com"));
        assertFalse(TrustedOrigins.allows("http", "repairplanet.net"));
        assertFalse(TrustedOrigins.allows("javascript", "repairplanet.net"));
        assertFalse(TrustedOrigins.allows("https", null));
        assertFalse(TrustedOrigins.allows(null, "repairplanet.net"));
        assertFalse(TrustedOrigins.allows("https", ""));
        assertFalse(TrustedOrigins.allows("https", "repairplanet.net."));
        assertFalse(TrustedOrigins.allows("https", "RepairPlanet.net"));
    }
}
