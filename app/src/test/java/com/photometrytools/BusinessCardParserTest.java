package com.photometrytools;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Date;
import java.util.TimeZone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class BusinessCardParserTest {
    @Test
    public void classicCard() {
        BusinessCardFields classic = BusinessCardParser.parse(
                "Jane Q. Smith\n"
                        + "Clinical Director\n"
                        + "Desert Dermatology, LLC\n"
                        + "123 Main St\n"
                        + "Phoenix, AZ 85001\n"
                        + "(602) 555-0199\n"
                        + "jane.smith@desertderm.com\n");
        assertEquals("Jane Q. Smith", classic.name);
        assertEquals("Clinical Director", classic.title);
        assertEquals("Desert Dermatology, LLC", classic.company);
        assertEquals("(602) 555-0199", classic.phone);
        assertEquals("jane.smith@desertderm.com", classic.email);
        assertEquals("123 Main St", classic.address);
        assertEquals("Phoenix", classic.city);
        assertEquals("AZ", classic.state);
        assertEquals("85001", classic.zip);
    }

    @Test
    public void inlineCard() {
        BusinessCardFields inline = BusinessCardParser.parseLines(Arrays.asList(
                "ACME LASER SERVICE",
                "John Doe",
                "Field Service Engineer",
                "john@acme.com | 555.123.4567",
                "456 Oak Avenue, Suite 200, Austin, TX 78701"
        ));
        assertEquals("ACME LASER SERVICE", inline.company);
        assertEquals("John Doe", inline.name);
        assertEquals("Field Service Engineer", inline.title);
        assertEquals("john@acme.com", inline.email);
        assertEquals("555.123.4567", inline.phone);
        assertEquals("Austin", inline.city);
        assertEquals("TX", inline.state);
        assertEquals("78701", inline.zip);
        assertTrue(inline.address.contains("456 Oak Avenue"));
        assertTrue(inline.address.contains("Suite 200"));
    }

    @Test
    public void doctorCardKeepsCredential() {
        BusinessCardFields doctor = BusinessCardParser.parse(
                "Dr. Maria Chen, MD\n"
                        + "Owner\n"
                        + "Sunrise Medical Spa\n"
                        + "maria@sunrise.med\n"
                        + "+1 415-555-0100\n"
                        + "88 Market Street\n"
                        + "San Francisco CA 94105\n");
        assertEquals("Dr. Maria Chen, MD", doctor.name);
        assertEquals("Owner", doctor.title);
        assertEquals("Sunrise Medical Spa", doctor.company);
        assertEquals("San Francisco", doctor.city);
        assertEquals("CA", doctor.state);
        assertEquals("88 Market Street", doctor.address);
        assertTrue(doctor.phone.contains("415"));
    }

    @Test
    public void medicalDirectorIsATitle() {
        BusinessCardFields director = BusinessCardParser.parseLines(Arrays.asList(
                "Medical Director",
                "Alex Kim"
        ));
        assertEquals("Medical Director", director.title);
        assertEquals("Alex Kim", director.name);
        assertEquals("", director.company);
    }

    @Test
    public void payloadMatchesTheIosSelfTest() throws Exception {
        assertEquals("DES", CustomerCardPayload.ticketPrefix("Desert Dermatology, LLC"));
        assertEquals("CUS", CustomerCardPayload.ticketPrefix("!!"));
        assertEquals("directory_contacts", CustomerCardPayload.missingColumn(
                "Could not find the 'directory_contacts' column of 'organizations' in the schema cache"));
        assertNull(CustomerCardPayload.missingColumn("null value in column \"name\""));

        BusinessCardFields fields = new BusinessCardFields();
        fields.name = "Jane Q. Smith";
        fields.company = "Desert Dermatology, LLC";
        fields.phone = "602";
        JSONObject insert = CustomerCardPayload.organizationInsert(fields, "user-1");
        assertEquals("Desert Dermatology, LLC", insert.getString("name"));
        assertEquals("customer", insert.getString("type"));
        assertTrue(insert.getBoolean("is_active"));
        assertEquals("Jane Q. Smith", insert.getString("contact_name"));
        assertEquals("DES", insert.getString("ticket_prefix"));
        assertFalse(insert.has("email"));
        assertEquals("user-1", insert.getString("created_by"));

        String[] parts = CustomerCardPayload.splitPersonName("Dr. Jane Q. Smith");
        assertEquals("Jane", parts[0]);
        assertEquals("Q. Smith", parts[1]);

        BusinessCardFields existing = new BusinessCardFields();
        existing.name = "Old Name";
        existing.company = "Kept Co";
        existing.phone = "111";
        BusinessCardFields scanned = new BusinessCardFields();
        scanned.name = "New Name";
        BusinessCardFields merged = BusinessCardFields.prefill(existing, scanned);
        assertEquals("New Name", merged.name);
        assertEquals("Kept Co", merged.company);
        assertEquals("111", merged.phone);

        JSONObject update = CustomerCardPayload.organizationUpdate(fields, new Date(0L));
        assertEquals("1970-01-01T00:00:00Z", update.getString("updated_at"));
        assertEquals("UTC", TimeZone.getTimeZone("UTC").getID());
    }
}
