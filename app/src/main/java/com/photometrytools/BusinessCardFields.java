package com.photometrytools;

import org.json.JSONObject;

/** Contact fields read from a business card. The photo is not stored. */
public final class BusinessCardFields {
    public String name = "";
    public String title = "";
    public String company = "";
    public String phone = "";
    public String email = "";
    public String address = "";
    public String city = "";
    public String state = "";
    public String zip = "";
    public String website = "";

    public BusinessCardFields() {}

    public BusinessCardFields copy() {
        BusinessCardFields next = new BusinessCardFields();
        next.name = name;
        next.title = title;
        next.company = company;
        next.phone = phone;
        next.email = email;
        next.address = address;
        next.city = city;
        next.state = state;
        next.zip = zip;
        next.website = website;
        return next;
    }

    public BusinessCardFields trimmed() {
        BusinessCardFields next = new BusinessCardFields();
        next.name = trim(name);
        next.title = trim(title);
        next.company = trim(company);
        next.phone = trim(phone);
        next.email = trim(email);
        next.address = trim(address);
        next.city = trim(city);
        next.state = trim(state);
        next.zip = trim(zip);
        next.website = trim(website);
        return next;
    }

    public boolean hasAnyValue() {
        BusinessCardFields value = trimmed();
        return !value.name.isEmpty() || !value.title.isEmpty() || !value.company.isEmpty()
                || !value.phone.isEmpty() || !value.email.isEmpty() || !value.address.isEmpty()
                || !value.city.isEmpty() || !value.state.isEmpty() || !value.zip.isEmpty()
                || !value.website.isEmpty();
    }

    /** Existing directory values stay when the scan missed a field. */
    public static BusinessCardFields prefill(BusinessCardFields existing, BusinessCardFields scanned) {
        BusinessCardFields incoming = scanned == null ? new BusinessCardFields() : scanned.trimmed();
        if (existing == null) return incoming;
        BusinessCardFields base = existing.trimmed();
        overlay(base, incoming.name, "name");
        overlay(base, incoming.title, "title");
        overlay(base, incoming.company, "company");
        overlay(base, incoming.phone, "phone");
        overlay(base, incoming.email, "email");
        overlay(base, incoming.address, "address");
        overlay(base, incoming.city, "city");
        overlay(base, incoming.state, "state");
        overlay(base, incoming.zip, "zip");
        overlay(base, incoming.website, "website");
        return base;
    }

    public JSONObject bridgeJson() {
        BusinessCardFields value = trimmed();
        JSONObject obj = new JSONObject();
        try {
            obj.put("name", value.name);
            obj.put("title", value.title);
            obj.put("company", value.company);
            obj.put("phone", value.phone);
            obj.put("email", value.email);
            obj.put("address", value.address);
            obj.put("city", value.city);
            obj.put("state", value.state);
            obj.put("zip", value.zip);
            obj.put("website", value.website);
        } catch (Exception ignored) {
        }
        return obj;
    }

    private static void overlay(BusinessCardFields base, String value, String key) {
        if (value == null || value.isEmpty()) return;
        if ("name".equals(key)) base.name = value;
        else if ("title".equals(key)) base.title = value;
        else if ("company".equals(key)) base.company = value;
        else if ("phone".equals(key)) base.phone = value;
        else if ("email".equals(key)) base.email = value;
        else if ("address".equals(key)) base.address = value;
        else if ("city".equals(key)) base.city = value;
        else if ("state".equals(key)) base.state = value;
        else if ("zip".equals(key)) base.zip = value;
        else if ("website".equals(key)) base.website = value;
    }

    static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
