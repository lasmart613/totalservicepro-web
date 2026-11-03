package com.photometrytools;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class CustomerCardClientTest {
    @Test
    public void offlineQueuesFieldsAndDoesNotCallTheNetwork() {
        List<String> calls = new ArrayList<>();
        CustomerCardClient.Transport transport = (method, url, body, token, anon, prefer) -> {
            calls.add(method + " " + url);
            return CustomerCardClient.Result.failed("should not be called");
        };
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Acme";
        fields.name = "Ada Lovelace";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        CustomerCardClient.SaveResult result = CustomerCardClient.save(draft, "{}", false, "[]", transport);
        assertTrue(result.queued);
        assertFalse(result.saved);
        assertTrue(result.done);
        assertEquals(CardScanContract.QUEUED_MESSAGE, result.message);
        assertTrue(calls.isEmpty());
        assertEquals("Acme", CustomerCardDrafts.all(result.draftsJson).get(0).fields.company);
        assertFalse(result.draftsJson.contains("base64"));
    }

    @Test
    public void saveDropsAMissingColumnAndIgnoresADuplicateLink() throws Exception {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"sub\":\"user-1\"}".getBytes(StandardCharsets.UTF_8));
        String session = "{\"currentSession\":{\"access_token\":\"h." + payload + ".s\"}}";
        List<String> posts = new ArrayList<>();
        CustomerCardClient.Transport transport = (method, url, body, token, anon, prefer) -> {
            if ("GET".equals(method) && url.contains("user_profiles")) {
                return CustomerCardClient.Result.http(200, "[{\"organization_id\":\"svc-1\"}]");
            }
            if ("POST".equals(method) && url.contains("/organizations")) {
                posts.add(body);
                if (body.contains("website")) {
                    return CustomerCardClient.Result.http(400,
                            "{\"message\":\"Could not find the 'website' column of 'organizations' in the schema cache\"}");
                }
                return CustomerCardClient.Result.http(201, "[{\"id\":\"cust-1\"}]");
            }
            if ("POST".equals(method) && url.contains("organization_customers")) {
                return CustomerCardClient.Result.http(409, "{\"message\":\"duplicate key value violates unique constraint 23505\"}");
            }
            if ("GET".equals(method) && url.contains("contacts")) {
                return CustomerCardClient.Result.http(200, "[]");
            }
            if ("POST".equals(method) && url.contains("contacts")) {
                return CustomerCardClient.Result.http(201, "[]");
            }
            return CustomerCardClient.Result.http(500, "{\"message\":\"unexpected\"}");
        };
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Desert Dermatology, LLC";
        fields.name = "Jane Q. Smith";
        fields.phone = "602";
        fields.website = "https://desertderm.example";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        CustomerCardClient.SaveResult result = CustomerCardClient.save(draft, session, true, "[]", transport);
        assertTrue(result.saved);
        assertFalse(result.queued);
        assertEquals("cust-1", result.organizationId);
        assertEquals(2, posts.size());
        assertFalse(new JSONObject(posts.get(1)).has("website"));
        assertTrue(CustomerCardDrafts.all(result.draftsJson).isEmpty());
    }
}
