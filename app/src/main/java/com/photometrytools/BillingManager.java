package com.photometrytools;

import android.app.Activity;
import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BillingManager implements PurchasesUpdatedListener {

    private static final String TAG = "BillingManager";

    // ── SKU constants ─────────────────────────────────────────────
    public static final String SKU_PREMIUM_MONTHLY = "premium_monthly";
    public static final String SKU_PREMIUM_ANNUAL  = "premium_annual";
    public static final String SKU_TEAM_MONTHLY    = "team_monthly";
    public static final String SKU_TEAM_ANNUAL     = "team_annual";

    // ── Supabase config ───────────────────────────────────────────
    private static final String SUPABASE_URL      = "https://yljztfajyvjzqikxdddf.supabase.co";
    private static final String SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsanp0ZmFqeXZqenFpa3hkZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MjMzMDYsImV4cCI6MjA4NTE5OTMwNn0.O3qRONKT4XdEoSZTPg0Lg_tLyThMxRAMWjGwHy5W5JM";
    private static final String VERIFY_ENDPOINT   = SUPABASE_URL + "/functions/v1/verify-subscription";
    private static final String PACKAGE_NAME      = "com.photometrytools";

    private final Context         context;
    private final BillingClient   billingClient;
    private final ExecutorService executor;
    private       BillingCallback callback;

    // Cached product details after query
    private final List<ProductDetails> productDetailsList = new ArrayList<>();

    // ── Callback interface ────────────────────────────────────────
    public interface BillingCallback {
        void onPurchaseSuccess(String tier, String sku);
        void onPurchaseFailed(String message);
        void onBillingReady();
    }

    // ── Constructor ───────────────────────────────────────────────
    public BillingManager(Context context, BillingCallback callback) {
        this.context  = context;
        this.callback = callback;
        this.executor = Executors.newSingleThreadExecutor();

        billingClient = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases()
                .build();

        connect();
    }

    // ── Connect to Google Play ────────────────────────────────────
    private void connect() {
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client connected");
                    queryProductDetails();
                    if (callback != null) callback.onBillingReady();
                } else {
                    Log.e(TAG, "Billing setup failed: " + result.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected — retrying");
                connect();
            }
        });
    }

    // ── Query product details from Play Console ───────────────────
    private void queryProductDetails() {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String sku : new String[]{
                SKU_PREMIUM_MONTHLY, SKU_PREMIUM_ANNUAL,
                SKU_TEAM_MONTHLY,    SKU_TEAM_ANNUAL }) {
            products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(sku)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build());
        }

        billingClient.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder()
                        .setProductList(products)
                        .build(),
                (billingResult, detailsList) -> {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        productDetailsList.clear();
                        productDetailsList.addAll(detailsList);
                        Log.d(TAG, "Loaded " + detailsList.size() + " products from Play");
                    } else {
                        Log.e(TAG, "queryProductDetails failed: " + billingResult.getDebugMessage());
                    }
                });
    }

    // ── Launch billing flow for a given SKU ───────────────────────
    public void launchBillingFlow(Activity activity, String sku) {
        ProductDetails details = null;
        for (ProductDetails pd : productDetailsList) {
            if (pd.getProductId().equals(sku)) { details = pd; break; }
        }

        if (details == null) {
            Log.e(TAG, "Product details not found for SKU: " + sku);
            if (callback != null) callback.onPurchaseFailed("Product not available. Please try again.");
            return;
        }

        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) {
            if (callback != null) callback.onPurchaseFailed("No subscription offer available.");
            return;
        }

        BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(details)
                                .setOfferToken(offers.get(0).getOfferToken())
                                .build()
                ))
                .build();

        BillingResult result = billingClient.launchBillingFlow(activity, params);
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            Log.e(TAG, "launchBillingFlow failed: " + result.getDebugMessage());
            if (callback != null) callback.onPurchaseFailed("Could not open Google Play billing.");
        }
    }

    // ── Purchase updated callback (called by Google Play) ─────────
    @Override
    public void onPurchasesUpdated(@NonNull BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            Log.d(TAG, "User cancelled billing flow");
        } else {
            Log.e(TAG, "Purchase failed: " + result.getDebugMessage());
            if (callback != null) callback.onPurchaseFailed("Purchase failed: " + result.getDebugMessage());
        }
    }

    // ── Handle a completed purchase ───────────────────────────────
    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;

        final String sku           = purchase.getProducts().get(0);
        final String purchaseToken = purchase.getPurchaseToken();

        executor.execute(() -> {
            try {
                // Always acknowledge purchases promptly (independent of app login state).
                // Verification can be retried later once a session token is available.
                if (!purchase.isAcknowledged()) {
                    AcknowledgePurchaseParams ackParams = AcknowledgePurchaseParams.newBuilder()
                            .setPurchaseToken(purchaseToken)
                            .build();
                    billingClient.acknowledgePurchase(ackParams, ackResult -> {
                        if (ackResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            Log.d(TAG, "Purchase acknowledged: " + sku);
                        } else {
                            Log.e(TAG, "Acknowledgment failed: " + ackResult.getDebugMessage());
                        }
                    });
                }

                // Don't attempt verification without a valid session token
                String token = "";
                if (context instanceof MainActivity) {
                    token = ((MainActivity) context).getAccessToken();
                }
                if (token == null || token.isEmpty()) {
                    Log.w(TAG, "Skipping purchase verification — no session token yet");
                    return;
                }

                verifyPurchaseWithServer(sku, purchaseToken);

            } catch (Exception e) {
                Log.e(TAG, "handlePurchase error: " + e.getMessage());
                // Silently fail for background checks —
                // only surface errors for user-initiated purchases
            }
        });
    }

    // ── Call Supabase Edge Function to verify ─────────────────────
    private void verifyPurchaseWithServer(String sku, String purchaseToken) throws Exception {
        String accessToken = "";
        if (context instanceof MainActivity) {
            accessToken = ((MainActivity) context).getAccessToken();
        }

        JSONObject body = new JSONObject();
        body.put("sku",            sku);
        body.put("purchase_token", purchaseToken);
        body.put("package_name",   PACKAGE_NAME);

        byte[] postData = body.toString().getBytes(StandardCharsets.UTF_8);

        URL url = new URL(VERIFY_ENDPOINT);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type",  "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + accessToken);
        conn.setRequestProperty("apikey",        SUPABASE_ANON_KEY);
        conn.setDoOutput(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(postData);
        }

        int responseCode = conn.getResponseCode();
        if (responseCode == HttpURLConnection.HTTP_OK) {
            java.io.InputStream is = conn.getInputStream();
            String response        = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            JSONObject json        = new JSONObject(response);
            String tier            = json.optString("tier", "premium");
            Log.d(TAG, "✅ Server verified purchase: tier=" + tier);
            if (callback != null) callback.onPurchaseSuccess(tier, sku);
        } else {
            java.io.InputStream es = conn.getErrorStream();
            String errBody = es != null
                    ? new String(es.readAllBytes(), StandardCharsets.UTF_8)
                    : "unknown";
            throw new Exception("Server returned " + responseCode + ": " + errBody);
        }
    }

    // ── Check existing subscription on app launch ─────────────────
    public void checkExistingSubscription() {
        if (!billingClient.isReady()) return;

        billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                (billingResult, purchases) -> {
                    if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
                    for (Purchase purchase : purchases) {
                        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                            handlePurchase(purchase);
                            return;
                        }
                    }
                });
    }

    // ── Cleanup ───────────────────────────────────────────────────
    public void destroy() {
        if (billingClient.isReady()) billingClient.endConnection();
        executor.shutdown();
    }
}