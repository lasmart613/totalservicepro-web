package com.photometrytools;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class CardScanContractTest {
    @Test
    public void pageUrlsMatchTheIosResolver() {
        assertEquals("directory", CardScanContract.resolvePage("https://repairplanet.net/customers").kind);
        assertEquals("directory", CardScanContract.resolvePage("https://repairplanet.net/customers/").kind);
        CardScanContract.Page profile = CardScanContract.resolvePage("https://repairplanet.net/customers/abc-123");
        assertTrue(profile.isProfile());
        assertEquals("abc-123", profile.profileId);
        assertEquals("none", CardScanContract.resolvePage("https://repairplanet.net/customers/abc-123/edit").kind);
        assertEquals("none", CardScanContract.resolvePage("https://repairplanet.net/").kind);
        assertEquals("directory", CardScanContract.resolvePage("file:///tmp/customer_directory.html").kind);
        CardScanContract.Page bundled = CardScanContract.resolvePage("file:///tmp/customer_profile.html?id=42");
        assertEquals("42", bundled.profileId);
        assertEquals("none", CardScanContract.resolvePage("https://repairplanet.net/customers/new").kind);
    }

    @Test
    public void requestUsesThePagePayload() throws Exception {
        JSONObject update = new JSONObject();
        update.put("mode", "update");
        update.put("organizationId", "org-9");
        CardScanContract.Request request = CardScanContract.requestFrom(update, "https://repairplanet.net/customers");
        assertEquals("update", request.mode);
        assertEquals("org-9", request.organizationId);

        JSONObject create = new JSONObject();
        create.put("mode", "create");
        create.put("organizationId", "");
        CardScanContract.Request created = CardScanContract.requestFrom(
                create, "https://repairplanet.net/customers/should-not-win");
        assertEquals("create", created.mode);
        assertNull(created.organizationId);

        CardScanContract.Request fromPage = CardScanContract.requestFrom(
                new JSONObject(), "https://www.repairplanet.net/customers/abc");
        assertEquals("update", fromPage.mode);
        assertEquals("abc", fromPage.organizationId);
    }

    @Test
    public void outcomeAndCancelMatchTheBridge() throws Exception {
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Acme";
        JSONObject outcome = CardScanContract.outcomeJson(true, false, "org-1", fields);
        assertTrue(outcome.getBoolean("saved"));
        assertFalse(outcome.getBoolean("queued"));
        assertEquals("org-1", outcome.getString("organizationId"));
        assertEquals("Acme", outcome.getJSONObject("fields").getString("company"));
        assertTrue(CardScanContract.ERR_CANCELLED.toLowerCase().contains("cancel"));
        assertEquals("A card scan is already open.", CardScanContract.ERR_BUSY);
        assertEquals("A camera is required to scan a business card.", CardScanContract.ERR_CAMERA);
    }

    @Test
    public void accessTokenSubjectUsesBase64Url() {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"sub\":\"user-1\"}".getBytes(StandardCharsets.UTF_8));
        String token = "eyJhbGciOiJub25lIn0." + payload + ".sig";
        assertEquals("user-1", CardScanContract.userIdFromAccessToken(token));
        assertEquals("", CardScanContract.userIdFromAccessToken("not-a-jwt"));
        assertEquals("tok", CardScanContract.accessTokenFromSession(
                "{\"currentSession\":{\"access_token\":\"tok\"}}"));
    }

    @Test
    public void mlKitLinesGroupTopToBottomThenLeftToRight() {
        List<String> lines = CardScanContract.groupLines(Arrays.asList(
                new CardScanContract.Glyph("Smith", 18f, 40f),
                new CardScanContract.Glyph("Director", 80f, 4f),
                new CardScanContract.Glyph("Jane", 10f, 0f)
        ), 1000f);
        assertEquals(Arrays.asList("Jane Smith", "Director"), lines);
    }

    @Test
    public void draftRoundTripKeepsConfirmedFieldsOnly() throws Exception {
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Desert Dermatology, LLC";
        fields.name = "Jane Q. Smith";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        draft.createdAt = 1_700_000_000_000L;
        String stored = CustomerCardDrafts.upsert("[]", draft);
        List<CustomerCardDrafts.Draft> loaded = CustomerCardDrafts.all(stored);
        assertEquals(1, loaded.size());
        assertEquals(fields.company, loaded.get(0).fields.company);
        assertNull(loaded.get(0).organizationId);
        assertTrue(loaded.get(0).needsLink);
        String cleared = CustomerCardDrafts.remove(stored, draft.id);
        assertTrue(CustomerCardDrafts.all(cleared).isEmpty());
        assertFalse(stored.contains("jpeg"));
        assertFalse(stored.contains("image/"));
    }
}
