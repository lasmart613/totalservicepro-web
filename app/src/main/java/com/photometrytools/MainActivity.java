package com.photometrytools;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.MediaScannerConnection;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.material.bottomnavigation.BottomNavigationView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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
    private static final int RECORD_AUDIO_PERMISSION_CODE = 2108;

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
        ASSET_TO_PATH.put("find_a_rep", "/find-a-rep");
    }

    private WebView webView;
    private BottomNavigationView bottomNav;
    private TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private boolean ttsReady = false;
    private volatile boolean ttsCancelled = false;
    private volatile String activeUtteranceId = null;
    private int ttsEpoch = 0;
    private MediaPlayer grokPlayer;
    private File grokAudioFile;
    private volatile int speechGeneration = 0;
    private volatile boolean answerSpeaking = false;
    private String onlineVoiceScript;
    private int listenGen = 0;
    private boolean voiceCancelRequested = false;
    private boolean pendingVoiceStart = false;
    private String storedSession = null;
    private boolean biometricEnabled = false;
    private BiometricPrompt biometricPrompt;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private String pendingLaunchUrl = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        captureLaunchIntent(getIntent());

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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureLaunchIntent(intent);
        if (webView != null) {
            applyPendingLaunch();
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
                try {
                    // geo: is handled inside navigateInWebView, which returns true so this
                    // method does not start the same intent a second time.
                    if (!navigateInWebView(url)) {
                        startExternal(url);
                    }
                } catch (SecurityException e) {
                    recoverOpenFailure(url);
                } catch (RuntimeException e) {
                    recoverOpenFailure(url);
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

        /**
         * Device TextToSpeech only. The offline assistant calls this after
         * grok-tts already failed. Do not call grok-tts again from here.
         */
        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> speakWithDeviceTts(text));
        }

        /**
         * Online assistant path. Plays grok-tts (or device TTS when that
         * engine is selected) and signals assistant:voice-state around the
         * whole playback, including a device fallback.
         */
        @JavascriptInterface
        public void speakAnswer(String text, String voiceId, String engine, String accessToken) {
            runOnUiThread(() -> startGrokAnswer(text, voiceId, engine, accessToken));
        }

        /**
         * Stop current audio without reporting speaking false. The online page
         * uses this when a new voice question starts so auto-open keeps waiting.
         */
        @JavascriptInterface
        public void interruptSpeech() {
            runOnUiThread(() -> {
                speechGeneration++;
                stopGrokPlayer();
                stopDeviceTts(false);
                answerSpeaking = false;
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> stopAnswer(true));
        }

        @JavascriptInterface
        public void startVoiceRecognition() {
            runOnUiThread(() -> {
                stopAnswer(true);
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    pendingVoiceStart = true;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            RECORD_AUDIO_PERMISSION_CODE);
                    return;
                }
                beginListening();
            });
        }

        @JavascriptInterface
        public void stopVoiceRecognition() {
            runOnUiThread(() -> stopListening(true));
        }

        /**
         * Observe-only. assistant:citation-open is web → native after the page
         * already opened the citation. Do not load a viewer from here.
         */
        @JavascriptInterface
        public void onCitationObserved(String manualId, String page) {
            Log.i(TAG, "assistant:citation-open manualId=" + manualId + " page=" + page);
        }

        @JavascriptInterface
        public void goBack() {
            runOnUiThread(() -> {
                if (webView != null && webView.canGoBack()) webView.goBack();
            });
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
        ensureDeviceTts();
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
        settings.setUserAgentString(settings.getUserAgentString() + " TSPAndroid/0.5.1-beta");
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
                if (url != null && isManualHost(url)) {
                    Toast.makeText(MainActivity.this,
                            "Manuals stay in the in-app viewer — download is disabled.",
                            Toast.LENGTH_LONG).show();
                    webView.loadUrl(PRODUCTION_ORIGIN + "/manuals/view");
                } else {
                    Toast.makeText(MainActivity.this,
                            "Open this file in the app — download is not used here.",
                            Toast.LENGTH_SHORT).show();
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
                if (uri != null && isGeoUrl(uri.toString())) {
                    openGeoOrMaps(uri.toString());
                    return true;
                }
                return uri != null && !navigateInWebView(uri.toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (isGeoUrl(url)) {
                    openGeoOrMaps(url);
                    return true;
                }
                return !navigateInWebView(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                updateBottomNavVisibilityAndSelection(url);
                injectStoredSession(view);
                injectCitationOpenBridge(view);
                injectOnlineVoice(view, url);
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
        if (pendingLaunchUrl != null) {
            String launch = pendingLaunchUrl;
            pendingLaunchUrl = null;
            return launch;
        }
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
        if (isGeoUrl(url)) {
            // One launch. Returning true tells openUrl not to start the intent again.
            openGeoOrMaps(url);
            return true;
        }
        if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("sms:")) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
            return false;
        }
        if (lower.startsWith("totalservicepro://")) {
            captureLaunchIntent(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            applyPendingLaunch();
            return true;
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

    private boolean isGeoUrl(String url) {
        return url != null && url.toLowerCase(Locale.US).startsWith("geo:");
    }

    /**
     * Start the geo intent once. If nothing can handle it, open the https Maps
     * search URL in a browser so a phone without the Maps app still works.
     */
    private void openGeoOrMaps(String geoUrl) {
        if (canResolve(geoUrl)) {
            try {
                startExternal(geoUrl);
                return;
            } catch (SecurityException ignored) {
                // Fall through to the https Maps URL.
            } catch (RuntimeException ignored) {
                // ActivityNotFoundException and other start failures.
            }
        }
        openHttpsMapsFallback(geoUrl);
    }

    private void recoverOpenFailure(String url) {
        if (isGeoUrl(url)) {
            openHttpsMapsFallback(url);
            return;
        }
        showToast("Could not open link");
    }

    private void openHttpsMapsFallback(String geoUrl) {
        String https = mapsSearchUrlFromGeo(geoUrl);
        if (https == null) {
            Toast.makeText(this, "Could not open maps", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startExternal(https);
        } catch (SecurityException e) {
            Toast.makeText(this, "Could not open maps", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, "Could not open maps", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean canResolve(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            return intent.resolveActivity(getPackageManager()) != null;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void startExternal(String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
    }

    /** geo:0,0?q=address → https://www.google.com/maps/search/?api=1&query=address */
    private String mapsSearchUrlFromGeo(String geoUrl) {
        return GeoMapsUrl.mapsSearchUrlFromGeo(geoUrl, Uri::decode, Uri::encode);
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
        String payload = persistableSessionJson(storedSession);
        if (payload == null) payload = storedSession;
        String escaped = payload.replace("\\", "\\\\").replace("'", "\\'");
        view.evaluateJavascript(
                "(function(){" +
                        "try{" +
                        "var sessStr='" + escaped + "';" +
                        "if(!sessStr) return;" +
                        "try{localStorage.setItem('tsp-auth-token', sessStr);}catch(e){}" +
                        "if(typeof restoreSession==='function'){restoreSession(sessStr);}" +
                        "if(window.__tspRestoreAndroidSession){window.__tspRestoreAndroidSession(sessStr);}" +
                        "}catch(e){}" +
                        "})();",
                null
        );
    }

    private String persistableSessionJson(String raw) {
        try {
            org.json.JSONObject parsed = new org.json.JSONObject(raw);
            org.json.JSONObject sess = parsed.has("currentSession")
                    ? parsed.getJSONObject("currentSession")
                    : parsed;
            String access = sess.optString("access_token", "");
            if (access.isEmpty()) return null;
            org.json.JSONObject current = new org.json.JSONObject();
            current.put("access_token", access);
            current.put("refresh_token", sess.optString("refresh_token", ""));
            if (sess.has("expires_at")) current.put("expires_at", sess.get("expires_at"));
            org.json.JSONObject stored = new org.json.JSONObject();
            stored.put("currentSession", current);
            if (sess.has("expires_at")) stored.put("expiresAt", sess.get("expires_at"));
            return stored.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private void captureLaunchIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (scheme == null) return;
        if ("totalservicepro".equalsIgnoreCase(scheme)) {
            pendingLaunchUrl = productionAuthCallbackUrl(uri);
            rememberSessionFromAuthUri(uri);
            return;
        }
        if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && isAllowedWebUrl(uri.toString())
                && !looksLikePdfDownload(uri.toString())) {
            pendingLaunchUrl = uri.toString();
        }
    }

    private void applyPendingLaunch() {
        if (webView == null || pendingLaunchUrl == null) return;
        String url = pendingLaunchUrl;
        pendingLaunchUrl = null;
        webView.loadUrl(url);
    }

    private String productionAuthCallbackUrl(Uri uri) {
        String fragment = uri.getEncodedFragment();
        if (fragment == null || fragment.isEmpty()) {
            String query = uri.getEncodedQuery();
            fragment = query != null ? query : "";
        }
        String next = "/";
        try {
            String raw = uri.getFragment() != null ? uri.getFragment() : uri.getQuery();
            if (raw != null) {
                android.net.Uri q = android.net.Uri.parse("https://repairplanet.net/?" + raw);
                String candidate = q.getQueryParameter("next");
                if (candidate != null && candidate.startsWith("/") && !candidate.startsWith("//")) {
                    next = candidate;
                }
            }
        } catch (Exception ignored) {
        }
        String dest = PRODUCTION_ORIGIN + "/auth/callback";
        if (!"/".equals(next)) {
            dest += "?next=" + Uri.encode(next);
        }
        if (fragment != null && !fragment.isEmpty()) {
            dest += "#" + fragment;
        }
        return dest;
    }

    private void rememberSessionFromAuthUri(Uri uri) {
        try {
            String raw = uri.getFragment() != null ? uri.getFragment() : uri.getQuery();
            if (raw == null) return;
            android.net.Uri q = android.net.Uri.parse("https://repairplanet.net/?" + raw);
            String access = q.getQueryParameter("access_token");
            String refresh = q.getQueryParameter("refresh_token");
            if (access == null || access.isEmpty()) return;
            org.json.JSONObject sess = new org.json.JSONObject();
            sess.put("access_token", access);
            sess.put("refresh_token", refresh != null ? refresh : "");
            storedSession = sess.toString();
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREFS_SESSION_KEY, storedSession)
                    .apply();
        } catch (Exception e) {
            Log.w(TAG, "Could not cache auth-callback tokens", e);
        }
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

    private void ensureDeviceTts() {
        if (textToSpeech != null) return;
        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                textToSpeech.setLanguage(Locale.US);
                textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) { }

                    @Override
                    public void onDone(String utteranceId) {
                        if (ttsCancelled) return;
                        if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                            answerSpeaking = false;
                            signalAssistantVoice(false);
                            notifyVoiceJs("if(window.onDeviceTtsDone)window.onDeviceTtsDone();");
                        }
                    }

                    @Override
                    public void onError(String utteranceId) {
                        if (ttsCancelled) return;
                        if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                            answerSpeaking = false;
                            signalAssistantVoice(false);
                            notifyDeviceTtsError(utteranceId);
                        }
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        if (ttsCancelled) return;
                        if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                            answerSpeaking = false;
                            signalAssistantVoice(false);
                            notifyDeviceTtsError(utteranceId);
                        }
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        // User interrupt. JS already moved the speech generation forward.
                    }
                });
                ttsReady = true;
            }
        });
    }

    /** Device reader used when Grok speech is turned off or the grok-tts call fails. */
    private void speakWithDeviceTts(String text) {
        stopGrokPlayer();
        if (text == null || text.trim().isEmpty() || !ttsReady || textToSpeech == null) {
            answerSpeaking = false;
            signalAssistantVoice(false);
            notifyVoiceJs("if(window.onDeviceTtsError)window.onDeviceTtsError();");
            return;
        }
        try { textToSpeech.stop(); } catch (Exception ignored) {}
        ttsCancelled = false;
        answerSpeaking = true;
        String id = "tts-" + (++ttsEpoch);
        activeUtteranceId = id;
        signalAssistantVoice(true);
        textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
    }

    /**
     * Online /ai-assistant playback. Speaking stays true across a failed
     * grok-tts call into device TTS, and goes false when that playback ends,
     * fails, or is barged in.
     */
    private void startGrokAnswer(String text, String voiceId, String engine, String accessToken) {
        speechGeneration++;
        final int gen = speechGeneration;
        stopGrokPlayer();
        stopDeviceTts(false);
        final String spoken = GrokSpeech.clipSpeechText(text, GrokSpeech.MAX_CHARS);
        if (spoken.isEmpty()) {
            answerSpeaking = false;
            signalAssistantVoice(false);
            return;
        }
        answerSpeaking = true;
        signalAssistantVoice(true);
        if (GrokSpeech.isDeviceEngine(engine)) {
            speakWithDeviceTts(spoken);
            return;
        }
        final String token = (accessToken == null || accessToken.trim().isEmpty())
                ? storedAccessToken()
                : accessToken.trim();
        new Thread(() -> requestGrokTts(spoken, voiceId, token, gen, false), "grok-tts").start();
    }

    private void requestGrokTts(String text, String voiceId, String token, int gen, boolean retried) {
        if (gen != speechGeneration) return;
        if (token == null || token.isEmpty()) {
            runOnUiThread(() -> fallbackToDevice(text, gen, false));
            return;
        }
        HttpURLConnection conn = null;
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("text", text);
            payload.put("voice_id", GrokSpeech.normalizeVoiceId(voiceId));
            payload.put("language", "en");
            byte[] json = payload.toString().getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(GrokSpeech.TTS_URL).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(60000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "audio/mpeg, application/json");
            try (java.io.OutputStream out = conn.getOutputStream()) {
                out.write(json);
            }
            int status = conn.getResponseCode();
            String contentType = conn.getContentType();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] body = readLimited(stream, 8 * 1024 * 1024);
            if (gen != speechGeneration) return;
            String kind = GrokSpeech.classify(status, contentType, body);
            Log.i(TAG, "grok-tts status=" + status + " kind=" + kind);
            if ("audio".equals(kind)) {
                runOnUiThread(() -> playGrokAudio(body, text, gen));
                return;
            }
            if ("too_long".equals(kind) && !retried) {
                int max = GrokSpeech.maxCharacters(body);
                int limit = max > 0 ? Math.min(max, Math.max(1, text.length() - 1)) : Math.max(1, text.length() - 1);
                String shorter = GrokSpeech.clipSpeechText(text, limit);
                if (!shorter.isEmpty() && shorter.length() < text.length()) {
                    runOnUiThread(() -> {
                        if (gen == speechGeneration) {
                            Toast.makeText(MainActivity.this, GrokSpeech.SHORTENED_NOTICE, Toast.LENGTH_SHORT).show();
                        }
                    });
                    requestGrokTts(shorter, voiceId, token, gen, true);
                    return;
                }
            }
            final boolean limit = "limited".equals(kind);
            runOnUiThread(() -> fallbackToDevice(text, gen, limit));
        } catch (Exception e) {
            Log.w(TAG, "grok-tts request failed", e);
            if (gen == speechGeneration) runOnUiThread(() -> fallbackToDevice(text, gen, false));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void fallbackToDevice(String text, int gen, boolean limit) {
        if (gen != speechGeneration) return;
        Toast.makeText(
                MainActivity.this,
                limit ? GrokSpeech.LIMIT_NOTICE : GrokSpeech.FALLBACK_NOTICE,
                Toast.LENGTH_LONG
        ).show();
        speakWithDeviceTts(text);
    }

    private void playGrokAudio(byte[] audio, String fallbackText, int gen) {
        if (gen != speechGeneration) return;
        File file = new File(getCacheDir(), "grok-tts-" + gen + ".mp3");
        try {
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(audio);
            }
            grokAudioFile = file;
            MediaPlayer mp = new MediaPlayer();
            grokPlayer = mp;
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            mp.setDataSource(file.getAbsolutePath());
            mp.setOnPreparedListener(player -> {
                if (gen != speechGeneration || grokPlayer != player) {
                    releasePlayer(player, file);
                    return;
                }
                player.start();
            });
            mp.setOnCompletionListener(player -> finishGrokPlayback(player, file, gen));
            mp.setOnErrorListener((player, what, extra) -> {
                releasePlayer(player, file);
                if (gen == speechGeneration) fallbackToDevice(fallbackText, gen, false);
                return true;
            });
            mp.prepareAsync();
        } catch (Exception e) {
            Log.w(TAG, "grok-tts playback failed", e);
            if (file.exists()) file.delete();
            fallbackToDevice(fallbackText, gen, false);
        }
    }

    private void finishGrokPlayback(MediaPlayer player, File file, int gen) {
        releasePlayer(player, file);
        if (gen != speechGeneration) return;
        answerSpeaking = false;
        signalAssistantVoice(false);
    }

    private void releasePlayer(MediaPlayer player, File file) {
        try {
            player.setOnCompletionListener(null);
            player.setOnErrorListener(null);
            player.release();
        } catch (Exception ignored) {}
        if (grokPlayer == player) grokPlayer = null;
        if (file != null && file.exists()) file.delete();
        if (grokAudioFile == file) grokAudioFile = null;
    }

    private void stopGrokPlayer() {
        MediaPlayer player = grokPlayer;
        File file = grokAudioFile;
        grokPlayer = null;
        grokAudioFile = null;
        if (player != null) {
            try {
                player.setOnCompletionListener(null);
                player.setOnErrorListener(null);
                player.release();
            } catch (Exception ignored) {}
        }
        if (file != null && file.exists()) file.delete();
    }

    /**
     * User barge-in. Always reports speaking false so a hold that the page
     * set before native playback started is released too.
     */
    private void stopAnswer(boolean signalIdle) {
        speechGeneration++;
        stopGrokPlayer();
        stopDeviceTts(false);
        answerSpeaking = false;
        if (signalIdle) signalAssistantVoice(false);
    }

    private void stopDeviceTts(boolean signalIdle) {
        ttsCancelled = true;
        activeUtteranceId = null;
        if (textToSpeech != null) {
            try { textToSpeech.stop(); } catch (Exception ignored) {}
        }
        if (signalIdle) {
            answerSpeaking = false;
            signalAssistantVoice(false);
        }
    }

    private String storedAccessToken() {
        if (storedSession == null || storedSession.isEmpty()) return "";
        try {
            org.json.JSONObject root = new org.json.JSONObject(storedSession);
            org.json.JSONObject sess = root.has("currentSession")
                    ? root.getJSONObject("currentSession")
                    : root;
            return sess.optString("access_token", "");
        } catch (Exception e) {
            return "";
        }
    }

    private static byte[] readLimited(InputStream in, int max) throws java.io.IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(buf)) >= 0) {
            total += n;
            if (total > max) throw new java.io.IOException("grok-tts body too large");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    /**
     * Live /ai-assistant has no voice loop. Inject the page hook that calls
     * speakAnswer. Bundled ai_assistant.html already speaks on its own.
     */
    private void injectOnlineVoice(WebView view, String url) {
        if (view == null || url == null) return;
        if (!url.startsWith(PRODUCTION_ORIGIN) && !url.startsWith("https://www.repairplanet.net")) return;
        if (onlineVoiceScript == null) {
            String grok = assetText("grok-voice.js");
            String online = assetText("online-voice.js");
            if (grok.isEmpty() || online.isEmpty()) return;
            onlineVoiceScript = grok + "\n" + online;
        }
        view.evaluateJavascript(onlineVoiceScript, null);
    }

    private String assetText(String name) {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            Log.w(TAG, "asset " + name, e);
            return "";
        }
    }

    /**
     * Tells the loaded page (repairplanet.net assistant, or the offline asset)
     * that device speech started or ended. Does not open a manual.
     */
    private void signalAssistantVoice(boolean speaking) {
        String flag = speaking ? "true" : "false";
        String dataset = speaking
                ? "root.dataset.assistantVoice='speaking';"
                : "if(root.dataset.assistantVoice==='speaking')delete root.dataset.assistantVoice;";
        notifyVoiceJs(
                "window.__tspNativeVoiceSpeaking=" + flag + ";"
                        + "if(!window.TSP)window.TSP={};"
                        + "if(typeof window.TSP.isVoiceSpeaking!=='function'||window.TSP.isVoiceSpeaking.__tspNative){"
                        + "window.TSP.isVoiceSpeaking=function(){return window.__tspNativeVoiceSpeaking===true;};"
                        + "window.TSP.isVoiceSpeaking.__tspNative=true;}"
                        + "var root=document.documentElement;"
                        + dataset
                        + "window.dispatchEvent(new CustomEvent('assistant:voice-state',{detail:{speaking:" + flag + "}}));"
        );
    }

    private void notifyDeviceTtsError(String utteranceId) {
        if (ttsCancelled) return;
        if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
            notifyVoiceJs("if(window.onDeviceTtsError)window.onDeviceTtsError();");
        }
    }

    private void notifyVoiceJs(String js) {
        runOnUiThread(() -> {
            if (webView == null) return;
            webView.evaluateJavascript("(function(){try{" + js + "}catch(e){}})();", null);
        });
    }

    private void beginListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            deliverVoiceResult(null, "Speech recognition is not available on this device");
            return;
        }
        if (speechRecognizer == null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        }
        try { speechRecognizer.cancel(); } catch (Exception ignored) {}
        final int gen = ++listenGen;
        voiceCancelRequested = false;
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}

            @Override
            public void onError(int error) {
                if (gen != listenGen) return;
                listenGen++;
                if (voiceCancelRequested
                        || error == SpeechRecognizer.ERROR_CLIENT
                        || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                    deliverVoiceResult("", "cancelled");
                    return;
                }
                if (error == SpeechRecognizer.ERROR_NO_MATCH
                        || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    deliverVoiceResult("", "no_match");
                    return;
                }
                deliverVoiceResult("", "recognition_error_" + error);
            }

            @Override
            public void onResults(Bundle results) {
                if (gen != listenGen) return;
                listenGen++;
                ArrayList<String> matches = results == null
                        ? null
                        : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                deliverVoiceResult(text, null);
            }
        });
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toString());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        try {
            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            Log.w(TAG, "startListening", e);
            deliverVoiceResult(null, "Could not start listening");
        }
    }

    private void stopListening(boolean notifyCancelled) {
        voiceCancelRequested = true;
        listenGen++;
        if (speechRecognizer != null) {
            try { speechRecognizer.stopListening(); } catch (Exception ignored) {}
        }
        if (notifyCancelled) deliverVoiceResult("", "cancelled");
    }

    private void deliverVoiceResult(String text, String error) {
        runOnUiThread(() -> {
            if (webView == null) return;
            if (error != null) {
                webView.evaluateJavascript(
                        "(function(){try{if(window.onSpeechError)window.onSpeechError("
                                + jsonForJs(error) + ");}catch(e){}})();",
                        null);
            } else {
                webView.evaluateJavascript(
                        "(function(){try{if(window.onSpeechResult)window.onSpeechResult("
                                + jsonForJs(text == null ? "" : text) + ");}catch(e){}})();",
                        null);
            }
        });
    }

    private String jsonForJs(String value) {
        return org.json.JSONObject.quote(value == null ? "" : value);
    }

    /**
     * assistant:citation-open is web → native only, after the page has opened
     * the citation. This listener records that. It does not call openCitation
     * and it does not load a viewer.
     */
    private void injectCitationOpenBridge(WebView view) {
        if (view == null) return;
        view.evaluateJavascript(
                "(function(){try{"
                        + "if(!window.TSP)window.TSP={};"
                        + "if(typeof window.TSP.isVoiceSpeaking!=='function'){"
                        + "window.TSP.isVoiceSpeaking=function(){return window.__tspNativeVoiceSpeaking===true;};"
                        + "window.TSP.isVoiceSpeaking.__tspNative=true;}"
                        + "if(window.__tspCitationListener)return;"
                        + "window.__tspCitationListener=true;"
                        + "window.addEventListener('assistant:citation-open',function(ev){"
                        + "var d=(ev&&ev.detail)||{};"
                        + "var id=d.manualId!=null?String(d.manualId):'';"
                        + "var page=d.page!=null?String(d.page):'';"
                        + "if(typeof Android!=='undefined'&&Android.onCitationObserved){Android.onCitationObserved(id,page);}"
                        + "});"
                        + "}catch(e){}})();",
                null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != RECORD_AUDIO_PERMISSION_CODE) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted && pendingVoiceStart) {
            pendingVoiceStart = false;
            beginListening();
        } else if (pendingVoiceStart) {
            pendingVoiceStart = false;
            deliverVoiceResult(null, "Microphone permission is required");
        }
    }

    @Override
    protected void onDestroy() {
        stopAnswer(false);
        if (speechRecognizer != null) {
            try { speechRecognizer.destroy(); } catch (Exception ignored) {}
            speechRecognizer = null;
        }
        if (textToSpeech != null) {
            try { textToSpeech.shutdown(); } catch (Exception ignored) {}
            textToSpeech = null;
        }
        ttsReady = false;
        super.onDestroy();
    }
}
