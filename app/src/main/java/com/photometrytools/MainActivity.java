package com.photometrytools;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.media.MediaScannerConnection;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.constraintlayout.widget.ConstraintLayout;
import androidx.constraintlayout.widget.ConstraintSet;
import androidx.core.content.ContextCompat;

import com.google.android.material.bottomnavigation.BottomNavigationView;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * Total Service Pro Android shell.
 * Primary surface is the live website (repairplanet.net) so field techs get
 * the same tickets, schedule, manuals viewer, Report an Issue, and org switch
 * as the browser. Bundled HTML is offline / calculator fallback only.
 */
public class MainActivity extends AppCompatActivity {

    static final String PRODUCTION_ORIGIN = "https://repairplanet.net";
    private static final String TAG = "TotalServicePro";
    private static final String PREFS_NAME = "TSPPrefs";
    private static final String PREFS_SESSION_KEY = "storedSession";
    private static final String PREFS_LAST_URL = "last_url";
    private static final String PREFS_BIOMETRIC_KEY = "biometricEnabled";

    private static final Map<String, String> ASSET_TO_PATH = new HashMap<>();
    static {
        ASSET_TO_PATH.put("index", "/");
        ASSET_TO_PATH.put("accepted_bids", "/accepted-bids");
        ASSET_TO_PATH.put("service_requests", "/service-requests");
        ASSET_TO_PATH.put("notifications", "/notifications");
        ASSET_TO_PATH.put("service_schedule", "/service-schedule");
        ASSET_TO_PATH.put("marketplace", "/marketplace");
        ASSET_TO_PATH.put("equipment_listing", "/marketplace");
        ASSET_TO_PATH.put("my_lasers", "/my-lasers");
        ASSET_TO_PATH.put("customer_directory", "/customers");
        ASSET_TO_PATH.put("customer_profile", "/customers");
        ASSET_TO_PATH.put("company_profile", "/company");
        ASSET_TO_PATH.put("estimates_list", "/estimates");
        ASSET_TO_PATH.put("estimate_generator", "/estimates/new");
        ASSET_TO_PATH.put("invoices_list", "/invoices");
        ASSET_TO_PATH.put("invoice_form", "/invoices/new");
        ASSET_TO_PATH.put("reports_list", "/reports");
        ASSET_TO_PATH.put("service_report", "/reports/new");
        ASSET_TO_PATH.put("manuals", "/manuals");
        ASSET_TO_PATH.put("manual_library", "/manuals");
        ASSET_TO_PATH.put("service_manuals", "/manuals");
        ASSET_TO_PATH.put("pdf_viewer", "/manuals/view");
        ASSET_TO_PATH.put("test_equipment", "/test-equipment");
        ASSET_TO_PATH.put("calculators_menu", "/calculators");
        ASSET_TO_PATH.put("ai_assistant", "/ai-assistant");
        ASSET_TO_PATH.put("onboarding", "/onboarding");
        ASSET_TO_PATH.put("list_equipment", "/marketplace");
        ASSET_TO_PATH.put("list_parts", "/marketplace/parts");
        ASSET_TO_PATH.put("settings", "/settings");
        ASSET_TO_PATH.put("user_profile", "/profile");
        ASSET_TO_PATH.put("parts_catalog", "/parts");
        ASSET_TO_PATH.put("service_hub", "/hub");
        ASSET_TO_PATH.put("paywall", "/plans");
        ASSET_TO_PATH.put("coming_soon", "/#app");
    }

    private WebView webView;
    private BottomNavigationView bottomNav;
    private String storedSession = null;
    private boolean biometricEnabled = false;
    private BiometricPrompt biometricPrompt;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        storedSession = prefs.getString(PREFS_SESSION_KEY, null);
        biometricEnabled = prefs.getBoolean(PREFS_BIOMETRIC_KEY, false);
        if (biometricEnabled && !canAuthenticateWithBiometrics()) {
            biometricEnabled = false;
            prefs.edit().putBoolean(PREFS_BIOMETRIC_KEY, false).apply();
        }

        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
                    if (filePathCallback != null) {
                        filePathCallback.onReceiveValue(uris);
                        filePathCallback = null;
                    }
                });

        if (biometricEnabled && canAuthenticateWithBiometrics() && storedSession != null && !storedSession.isEmpty()) {
            showBiometricPrompt(this::loadApp);
        } else {
            loadApp();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null && webView.getUrl() != null) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREFS_LAST_URL, webView.getUrl())
                    .apply();
        }
        CookieManager.getInstance().flush();
    }

    private void updateBottomNavVisibilityAndSelection(String url) {
        if (bottomNav == null) return;
        boolean localTools = url != null && url.startsWith("file:///android_asset/")
                && (url.contains("calculators") || url.contains("fluence") || url.contains("irradiance")
                || url.contains("wavelength") || url.contains("duty_cycle") || url.contains("avgpower")
                || url.contains("density_calculator"));
        bottomNav.setVisibility(localTools ? View.VISIBLE : View.GONE);
        ConstraintLayout root = findViewById(R.id.main);
        if (root != null && webView != null) {
            ConstraintSet set = new ConstraintSet();
            set.clone(root);
            if (localTools) {
                set.connect(R.id.webView, ConstraintSet.BOTTOM, R.id.bottom_navigation, ConstraintSet.TOP);
            } else {
                set.connect(R.id.webView, ConstraintSet.BOTTOM, ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM);
            }
            set.applyTo(root);
        }
    }

    private final BottomNavigationView.OnItemSelectedListener navListener = item -> {
        int id = item.getItemId();
        if (id == R.id.nav_home) loadProductionOrAsset("/", "index.html");
        else if (id == R.id.nav_schedule) loadProductionOrAsset("/service-schedule", "service_schedule.html");
        else if (id == R.id.nav_manuals) loadProductionOrAsset("/manuals", "manual_library.html");
        else if (id == R.id.nav_reports) loadProductionOrAsset("/reports", "reports_list.html");
        else if (id == R.id.nav_calc) loadProductionOrAsset("/calculators", "calculators_menu.html");
        return true;
    };

    public class WebAppInterface {

        @JavascriptInterface
        public void showToast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void saveSession(String sessionJson) {
            storedSession = sessionJson;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREFS_SESSION_KEY, sessionJson)
                    .apply();
        }

        @JavascriptInterface
        public String getStoredSession() {
            return storedSession;
        }

        @JavascriptInterface
        public void clearSession() {
            storedSession = null;
            biometricEnabled = false;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .remove(PREFS_SESSION_KEY)
                    .putBoolean(PREFS_BIOMETRIC_KEY, false)
                    .apply();
        }

        @JavascriptInterface
        public void setBiometricEnabled(boolean enabled) {
            biometricEnabled = enabled;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putBoolean(PREFS_BIOMETRIC_KEY, enabled)
                    .apply();
        }

        @JavascriptInterface
        public boolean isBiometricEnabled() {
            return biometricEnabled;
        }

        @JavascriptInterface
        public boolean canUseBiometric() {
            return canAuthenticateWithBiometrics();
        }

        @JavascriptInterface
        public void setPremiumStatus(boolean premium) {
            // Ads removed from this build. Paid "no ads" is already true.
        }

        @JavascriptInterface
        public void launchBillingFlow(String sku) {
            runOnUiThread(() -> loadProductionOrAsset("/plans", "paywall.html"));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null) return;
            runOnUiThread(() -> {
                if (!navigateInWebView(url)) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        showToast("Could not open link: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void printReport(String html, String jobName) {
            runOnUiThread(() -> {
                WebView pdfWebView = new WebView(MainActivity.this);
                WebSettings settings = pdfWebView.getSettings();
                settings.setJavaScriptEnabled(true);

                int pageWidth = 1240;
                int pageHeight = 1754;
                pdfWebView.layout(0, 0, pageWidth, pageHeight);
                pdfWebView.setInitialScale(100);

                pdfWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                                () -> generateAndSavePdfDirectly(view, jobName), 300);
                    }
                });
                pdfWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            });
        }

        private void generateAndSavePdfDirectly(WebView webView, String jobName) {
            final String safeName = (jobName != null ? jobName : "ServiceReport")
                    .replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                int pageWidthPx = 1240;
                int pageHeightPx = 1754;
                Bitmap bitmap = Bitmap.createBitmap(pageWidthPx, pageHeightPx, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                canvas.drawColor(Color.WHITE);
                webView.draw(canvas);

                PdfDocument pdfDocument = new PdfDocument();
                PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(pageWidthPx, pageHeightPx, 1).create();
                PdfDocument.Page page = pdfDocument.startPage(pageInfo);
                page.getCanvas().drawBitmap(bitmap, 0, 0, null);
                pdfDocument.finishPage(page);

                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                File pdfFile = new File(downloadsDir, safeName + ".pdf");
                try (FileOutputStream fos = new FileOutputStream(pdfFile)) {
                    pdfDocument.writeTo(fos);
                }
                pdfDocument.close();
                bitmap.recycle();
                MediaScannerConnection.scanFile(MainActivity.this,
                        new String[]{pdfFile.getAbsolutePath()}, null, null);
                showToast("PDF saved to Downloads: " + safeName + ".pdf");
            } catch (Exception e) {
                showToast("PDF export failed: " + e.getMessage());
            }
        }
    }

    private boolean canAuthenticateWithBiometrics() {
        BiometricManager biometricManager = BiometricManager.from(this);
        int result = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        return result == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void showBiometricPrompt(Runnable onSuccess) {
        Executor executor = ContextCompat.getMainExecutor(this);
        biometricPrompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Biometric auth failed: " + errString, Toast.LENGTH_SHORT).show();
                    loadApp();
                });
            }

            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                runOnUiThread(onSuccess);
            }

            @Override
            public void onAuthenticationFailed() {
                super.onAuthenticationFailed();
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Fingerprint not recognized. Try again or use PIN.", Toast.LENGTH_SHORT).show());
            }
        });

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Total Service Pro")
                .setSubtitle("Use your fingerprint to sign in")
                .setNegativeButtonText("Use Password / PIN")
                .build();
        biometricPrompt.authenticate(promptInfo);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void loadApp() {
        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " TSPAndroid/1.3");
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    new androidx.appcompat.app.AlertDialog.Builder(MainActivity.this)
                            .setTitle("Exit App")
                            .setMessage("Are you sure you want to exit?")
                            .setPositiveButton("Yes", (d, w) -> finish())
                            .setNegativeButton("No", null)
                            .show();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                try {
                    fileChooserLauncher.launch(fileChooserParams.createIntent());
                    return true;
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            boolean pdf = (mimeType != null && mimeType.toLowerCase(Locale.US).contains("pdf"))
                    || (name != null && name.toLowerCase(Locale.US).endsWith(".pdf"))
                    || (url != null && url.toLowerCase(Locale.US).contains(".pdf"));
            if (pdf) {
                Toast.makeText(MainActivity.this,
                        "Manuals stay in the in-app viewer — download is disabled.",
                        Toast.LENGTH_LONG).show();
                if (url != null && isManualHost(url)) {
                    webView.loadUrl(PRODUCTION_ORIGIN + "/manuals/view");
                }
                return;
            }
            Toast.makeText(MainActivity.this, "Open this file in the app — download is not used here.",
                    Toast.LENGTH_SHORT).show();
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return uri != null && !navigateInWebView(uri.toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !navigateInWebView(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                updateBottomNavVisibilityAndSelection(url);
                injectStoredSession(view);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (failingUrl != null && failingUrl.startsWith(PRODUCTION_ORIGIN) && !isNetworkAvailable()) {
                    view.loadUrl(localAssetUrl("index.html"));
                }
            }
        });

        bottomNav = findViewById(R.id.bottom_navigation);
        if (bottomNav != null) {
            bottomNav.setOnItemSelectedListener(navListener);
        }

        String start = chooseStartUrl();
        webView.loadUrl(start);
    }

    private String chooseStartUrl() {
        String last = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREFS_LAST_URL, null);
        if (isNetworkAvailable()) {
            if (last != null && isAllowedWebUrl(last) && !looksLikePdfDownload(last)) {
                return last;
            }
            return PRODUCTION_ORIGIN + "/";
        }
        if (last != null && last.startsWith("file:///android_asset/")) return last;
        return localAssetUrl("index.html");
    }

    private void loadProductionOrAsset(String path, String asset) {
        if (webView == null) return;
        if (isNetworkAvailable()) {
            webView.loadUrl(PRODUCTION_ORIGIN + path);
        } else {
            webView.loadUrl(localAssetUrl(asset));
        }
    }

    /** @return true if the URL was handled inside the WebView (or we navigated). */
    private boolean navigateInWebView(String url) {
        if (url == null) return true;
        String lower = url.toLowerCase(Locale.US);
        if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("sms:")) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
            return false;
        }
        if (lower.startsWith("intent:") || lower.startsWith("market:")) return false;
        if (lower.contains("play.google.com/store") || lower.contains("apps.apple.com")) {
            Toast.makeText(this, "The mobile apps are coming soon — they are not in the stores yet.",
                    Toast.LENGTH_LONG).show();
            return false;
        }
        if (looksLikePdfDownload(url) && isManualHost(url)) {
            webView.loadUrl(PRODUCTION_ORIGIN + "/manuals/view");
            return true;
        }
        if (url.startsWith("file:///android_asset/")) {
            String mapped = mapAssetUrlToProduction(url);
            if (mapped != null && isNetworkAvailable()) {
                webView.loadUrl(mapped);
                return true;
            }
            webView.loadUrl(url);
            return true;
        }
        if (isAllowedWebUrl(url)) {
            webView.loadUrl(url);
            return true;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
        return false;
    }

    private String mapAssetUrlToProduction(String url) {
        try {
            Uri uri = Uri.parse(url);
            String last = uri.getLastPathSegment();
            if (last == null) return PRODUCTION_ORIGIN + "/";
            String base = last.replaceAll("\\.html$", "").toLowerCase(Locale.US);
            String dest = ASSET_TO_PATH.get(base);
            if (dest == null) dest = "/" + base.replace('_', '-');
            String query = uri.getEncodedQuery();
            if (query != null && !query.isEmpty() && !"/".equals(dest)) {
                return PRODUCTION_ORIGIN + dest + "?" + query;
            }
            return PRODUCTION_ORIGIN + dest;
        } catch (Exception e) {
            return PRODUCTION_ORIGIN + "/";
        }
    }

    private boolean isAllowedWebUrl(String url) {
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.US);
            return host.equals("repairplanet.net")
                    || host.endsWith(".repairplanet.net")
                    || host.endsWith("supabase.co")
                    || host.endsWith("stripe.com")
                    || host.endsWith("netlify.app")
                    || host.endsWith("googleapis.com")
                    || host.endsWith("gstatic.com")
                    || host.endsWith("google.com");
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isManualHost(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.US);
            return host.contains("supabase.co") || host.contains("repairplanet.net");
        } catch (Exception e) {
            return false;
        }
    }

    private boolean looksLikePdfDownload(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.contains(".pdf") || lower.contains("content-disposition=attachment");
    }

    private String localAssetUrl(String asset) {
        String base = "file:///android_asset/" + asset;
        String param = getSessionUrlParam();
        return param != null ? base + "?" + param : base;
    }

    private void injectStoredSession(WebView view) {
        if (storedSession == null || storedSession.isEmpty()) return;
        String escaped = storedSession.replace("\\", "\\\\").replace("'", "\\'");
        view.evaluateJavascript(
                "(function(){" +
                        "try{" +
                        "var sessStr='" + escaped + "';" +
                        "if(sessStr){" +
                        "try{localStorage.setItem('tsp-auth-token', sessStr);}catch(e){}" +
                        "if(typeof restoreSession==='function'){restoreSession(sessStr);}" +
                        "}" +
                        "}catch(e){}" +
                        "})();",
                null
        );
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private String getSessionUrlParam() {
        if (storedSession == null || storedSession.isEmpty()) return null;
        try {
            org.json.JSONObject root = new org.json.JSONObject(storedSession);
            org.json.JSONObject sess = root.has("currentSession")
                    ? root.getJSONObject("currentSession")
                    : root;
            String access = sess.optString("access_token", "");
            String refresh = sess.optString("refresh_token", "");
            String expires = sess.optString("expires_at", "");
            if (access.isEmpty()) return null;
            org.json.JSONObject minimal = new org.json.JSONObject();
            minimal.put("access_token", access);
            if (!refresh.isEmpty()) minimal.put("refresh_token", refresh);
            if (!expires.isEmpty()) minimal.put("expires_at", expires);
            String json = minimal.toString();
            byte[] bytes = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            return "_s=" + b64;
        } catch (Exception e) {
            Log.w(TAG, "Could not build _s session param for direct nav", e);
            return null;
        }
    }
}
