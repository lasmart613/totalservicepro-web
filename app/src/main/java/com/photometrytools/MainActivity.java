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
import android.os.SystemClock;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.os.Message;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebStorage;
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
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.material.bottomnavigation.BottomNavigationView;

import javax.crypto.Cipher;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
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
    private static final String PREFS_BIOMETRIC_PROMPTED = "biometricPrompted";
    private static final String PREFS_AUTH_NONCE = "pending_auth_nonce";
    private static final String PREFS_AUTH_STATE = "pending_auth_state";
    private static final String PREFS_AUTH_EXPIRY = "pending_auth_expiry";
    private static final String PREFS_CARD_DRAFTS = "card_drafts";
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
    private final ArrayList<WebView> printPopups = new ArrayList<>();
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
    private boolean sessionHeld = false;
    private boolean sessionRefreshRunning = false;
    private boolean pendingBiometricGate = false;
    private KeystoreSessionStore sessionStore;
    private androidx.webkit.ScriptHandler sessionLockScript;
    private androidx.webkit.ScriptHandler sessionInjectScript;
    private int refreshFailures = 0;
    private String pendingAfterSeedUrl;
    private boolean clearHistoryOnNextFinish;
    private boolean clearSecureOnNextPage;
    private boolean unlockInProgress;
    private boolean reauthOnResume;
    private boolean retryUnlockAfterResume;
    private long backgroundElapsed;
    /** Plain session read once at startup so it can be deleted before the prompt. */
    private String startupPlain;
    /** Drop the in-memory data key after this long in the background. */
    private static final long BACKGROUND_LOCK_MS = 5L * 60L * 1000L;
    private SessionEnvelope.Lock sessionLock = SessionEnvelope.Lock.locked(null);
    private final android.os.Handler sessionHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable sessionRefreshTask = new Runnable() {
        @Override
        public void run() {
            if (sessionHeld || webView == null) return;
            refreshSessionThenLoad();
        }
    };
    private final Runnable biometricGateTask = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || isDestroyed() || webView != null) return;
            beginUnlock();
        }
    };
    private final Runnable lockForBackgroundTask = new Runnable() {
        @Override
        public void run() {
            reauthOnResume = true;
            lockForBackground();
        }
    };
    private BiometricPrompt biometricPrompt;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private Uri pendingCameraUri;
    private ActivityResultLauncher<Intent> cardCameraLauncher;
    private Uri pendingCardCameraUri;
    private File pendingCardCameraFile;
    private CardScanController cardScanController;
    private String cardScanScript;
    private String pendingLaunchUrl = null;
    private String acceptedAuthNavigation;
    private boolean closedForExternalAuth;
    private volatile String mainFrameUrl;
    /** Set only while tspNative is dispatching a main-frame message. */
    private final ThreadLocal<Boolean> originLockedCaller = new ThreadLocal<>();
    private boolean recoveringRenderer;
    private boolean backCallbackInstalled;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);
        View root = findViewById(R.id.main);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(getWindow(), root);
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);

        captureLaunchIntent(getIntent());
        if (closedForExternalAuth) {
            finish();
            return;
        }

        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
                    if ((uris == null || uris.length == 0)
                            && result.getResultCode() == RESULT_OK
                            && pendingCameraUri != null) {
                        uris = new Uri[]{pendingCameraUri};
                    }
                    pendingCameraUri = null;
                    if (filePathCallback != null) {
                        filePathCallback.onReceiveValue(uris);
                        filePathCallback = null;
                    }
                });

        cardCameraLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    Uri uri = pendingCardCameraUri;
                    File photo = pendingCardCameraFile;
                    pendingCardCameraUri = null;
                    pendingCardCameraFile = null;
                    if (cardScanController != null) {
                        cardScanController.onCameraResult(result.getResultCode() == RESULT_OK, uri, photo);
                    }
                });
        cardScanController = new CardScanController(new CardScanController.Host() {
            @Override
            public android.app.Activity activity() {
                return MainActivity.this;
            }

            @Override
            public boolean online() {
                return isNetworkAvailable();
            }

            @Override
            public String sessionJson() {
                return storedSession;
            }

            @Override
            public String readDrafts() {
                return getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREFS_CARD_DRAFTS, "[]");
            }

            @Override
            public void writeDrafts(String json) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(PREFS_CARD_DRAFTS, json == null ? "[]" : json)
                        .apply();
            }

            @Override
            public void reloadPage() {
                if (webView != null) webView.reload();
            }

            @Override
            public void complete(String requestId, boolean ok, String valueJson, String error) {
                completeCardScan(requestId, ok, valueJson, error);
            }

            @Override
            public boolean launchCamera() {
                Intent intent = cardCameraIntent();
                if (intent == null || cardCameraLauncher == null) return false;
                cardCameraLauncher.launch(intent);
                return true;
            }

            @Override
            public void alert(String title, String message) {
                if (isFinishing()) return;
                new androidx.appcompat.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(title)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, null)
                        .show();
            }
        });

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        sessionStore = new KeystoreSessionStore(prefs);
        String legacy = prefs.getString(PREFS_SESSION_KEY, null);
        biometricEnabled = prefs.getBoolean(PREFS_BIOMETRIC_KEY, false);
        if (biometricEnabled) {
            storedSession = null;
            sessionHeld = true;
            setSessionSecure(true);
            boolean enveloped = sessionStore.hasEnvelope();
            String leftover = sessionStore.readPlain();
            sessionStore.clearPlain();
            if (legacy != null && !legacy.isEmpty()) {
                prefs.edit().remove(PREFS_SESSION_KEY).apply();
                if (leftover == null || leftover.isEmpty()) leftover = legacy;
            }
            startupPlain = enveloped ? null : leftover;
            sessionLock = SessionEnvelope.Lock.locked(sessionStore.readEnvelope());
            if (biometricPermanentlyUnavailable() || !sessionStore.hasBiometric()) {
                wipeLockedSession();
            } else {
                pendingBiometricGate = true;
            }
        } else {
            setSessionSecure(false);
            storedSession = sessionStore.readPlain();
            if ((storedSession == null || storedSession.isEmpty()) && legacy != null && !legacy.isEmpty()) {
                storedSession = legacy;
                sessionStore.writePlain(legacy);
                prefs.edit().remove(PREFS_SESSION_KEY).apply();
            }
            sessionLock = SessionEnvelope.Lock.locked(null);
            refreshSessionThenLoad();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        sessionHandler.removeCallbacks(lockForBackgroundTask);
        boolean timedOut = biometricEnabled && backgroundElapsed > 0L
                && SystemClock.elapsedRealtime() - backgroundElapsed >= BACKGROUND_LOCK_MS;
        backgroundElapsed = 0L;
        if (timedOut) {
            reauthOnResume = true;
            lockForBackground();
        }
        if (biometricEnabled && biometricPermanentlyUnavailable()) {
            wipeLockedSession();
            return;
        }
        if (retryUnlockAfterResume) {
            retryUnlockAfterResume = false;
            if (biometricEnabled && !unlockInProgress) {
                beginUnlock();
                return;
            }
        }
        if (pendingBiometricGate && webView == null) {
            pendingBiometricGate = false;
            if (!biometricEnabled || sessionStore == null || !sessionStore.hasBiometric()) {
                if (biometricEnabled) wipeLockedSession();
                else if (storedSession == null || storedSession.isEmpty()) loadWithoutSession();
                else refreshSessionThenLoad();
                return;
            }
            sessionHandler.post(biometricGateTask);
            return;
        }
        if (reauthOnResume) {
            reauthOnResume = false;
            if (biometricEnabled && !unlockInProgress) beginUnlock();
            return;
        }
        if (webView == null || sessionHeld) return;
        if (SessionTokens.needsRefresh(storedSession, System.currentTimeMillis(), SystemClock.elapsedRealtime())) {
            refreshSessionThenLoad();
        } else {
            scheduleSessionRefresh();
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
        if (webView != null && webView.getUrl() != null && !"about:blank".equals(webView.getUrl())) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREFS_LAST_URL, webView.getUrl())
                    .apply();
        }
        CookieManager.getInstance().flush();
        backgroundElapsed = SystemClock.elapsedRealtime();
        if (biometricEnabled && !unlockInProgress && sessionStore != null && sessionStore.hasBiometric()) {
            sessionHandler.postDelayed(lockForBackgroundTask, BACKGROUND_LOCK_MS);
        }
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

    /**
     * Injected into every frame, which cannot be told apart here.
     * https pages call tspNative instead. These methods run only for a bundled
     * file page, and none of them return a session or token.
     * {@code postOrgApi} returns org-switch JSON; the bearer is an argument.
     */
    public class WebAppInterface {

        @JavascriptInterface
        public void showToast(String msg) {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void saveSession(String sessionJson) {
            if (!javascriptInterfaceAllowed()) return;
            final String previousUser = SessionTokens.userId(storedSession);
            final String nextUser = SessionTokens.userId(sessionJson);
            storedSession = sessionJson;
            sessionHeld = false;
            refreshFailures = 0;
            runOnUiThread(() -> {
                if (!nextUser.isEmpty()) retainDraftsForUser(nextUser);
                if (biometricEnabled && (sessionLock == null || sessionLock.isLocked())) {
                    sealUnlockedSession(storedSession, true);
                    return;
                }
                persistStoredSession();
                removeSessionLockScript();
                if (webView != null) installSessionInjectScript(webView);
                maybeOfferBiometric(previousUser);
            });
        }

        @JavascriptInterface
        public void clearSession() {
            if (!javascriptInterfaceAllowed()) return;
            storedSession = null;
            biometricEnabled = false;
            sessionHeld = false;
            refreshFailures = 0;
            runOnUiThread(() -> {
                storedSession = null;
                biometricEnabled = false;
                if (sessionLock != null) sessionLock.invalidate();
                sessionLock = SessionEnvelope.Lock.locked(null);
                startupPlain = null;
                if (sessionStore != null) sessionStore.clearAll();
                sessionHandler.removeCallbacks(sessionRefreshTask);
                sessionHandler.removeCallbacks(lockForBackgroundTask);
                clearCardDrafts();
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .remove(PREFS_SESSION_KEY)
                        .putBoolean(PREFS_BIOMETRIC_KEY, false)
                        .remove(PREFS_BIOMETRIC_PROMPTED)
                        .apply();
                removeSessionLockScript();
                removeSessionInjectScript();
                concealLockedSession();
                clearSecureOnNextPage = true;
                wipeWebSessionThen(true, MainActivity.this::publishBiometricState);
            });
        }

        @JavascriptInterface
        public void setBiometricEnabled(boolean enabled) {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> applyBiometricChoice(enabled));
        }

        @JavascriptInterface
        public void noteCardScan(String type, String payload) {
            if (!javascriptInterfaceAllowed()) return;
        }

        @JavascriptInterface
        public boolean isBiometricEnabled() {
            if (!javascriptInterfaceAllowed()) return false;
            return biometricEnabled;
        }

        @JavascriptInterface
        public boolean canUseBiometric() {
            if (!javascriptInterfaceAllowed()) return false;
            return canAuthenticateWithBiometrics();
        }

        @JavascriptInterface
        public void setPremiumStatus(boolean premium) {
            if (!javascriptInterfaceAllowed()) return;
            // Ads removed from this build. Paid "no ads" is already true.
        }

        @JavascriptInterface
        public void launchBillingFlow(String sku) {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> loadProductionOrAsset("/plans", "paywall.html"));
        }

        /**
         * Offline file pages cannot POST to repairplanet.net (no CORS, and file
         * URL access stays locked). Switch and leave go through this instead.
         */
        @JavascriptInterface
        public String postOrgApi(String path, String organizationId, String bearer) {
            if (!javascriptInterfaceAllowed()) return orgApiError("Not allowed");
            if (!"/api/org/switch".equals(path) && !"/api/org/leave".equals(path)) {
                return orgApiError("Not allowed");
            }
            if (organizationId == null || organizationId.trim().isEmpty() || organizationId.length() > 64) {
                return orgApiError("organizationId is required");
            }
            if (bearer == null || bearer.isEmpty() || bearer.indexOf('\r') >= 0 || bearer.indexOf('\n') >= 0
                    || bearer.length() > 8192) {
                return orgApiError("Not signed in");
            }
            HttpURLConnection conn = null;
            try {
                org.json.JSONObject payload = new org.json.JSONObject();
                payload.put("organizationId", organizationId.trim());
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(PRODUCTION_ORIGIN + path).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Authorization", "Bearer " + bearer);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");
                conn.getOutputStream().write(body);
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) return orgApiError("Could not update this company");
                InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String text = readLimited(stream);
                if (text == null || text.isEmpty() || text.charAt(0) != '{') {
                    return orgApiError("Could not update this company");
                }
                return text;
            } catch (Exception e) {
                return orgApiError("Could not update this company");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (!javascriptInterfaceAllowed() || url == null) return;
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
            if (!javascriptInterfaceAllowed()) return;
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
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> speakWithDeviceTts(text));
        }

        /**
         * Online assistant path. Plays grok-tts (or device TTS when that
         * engine is selected) and signals assistant:voice-state around the
         * whole playback, including a device fallback.
         */
        @JavascriptInterface
        public void speakAnswer(String text, String voiceId, String engine, String accessToken) {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> startGrokAnswer(text, voiceId, engine, accessToken));
        }

        /**
         * Stop current audio without reporting speaking false. The online page
         * uses this when a new voice question starts so auto-open keeps waiting.
         */
        @JavascriptInterface
        public void interruptSpeech() {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> {
                speechGeneration++;
                stopGrokPlayer();
                stopDeviceTts(false);
                answerSpeaking = false;
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> stopAnswer(true));
        }

        @JavascriptInterface
        public void startVoiceRecognition() {
            if (!javascriptInterfaceAllowed()) return;
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
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> stopListening(true));
        }

        /**
         * Observe-only. assistant:citation-open is web → native after the page
         * already opened the citation. Do not load a viewer from here.
         */
        @JavascriptInterface
        public void onCitationObserved(String manualId, String page) {
            if (!javascriptInterfaceAllowed()) return;
            Log.i(TAG, "assistant:citation-open manualId=" + manualId + " page=" + page);
        }

        @JavascriptInterface
        public void goBack() {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> {
                if (webView != null && webView.canGoBack()) webView.goBack();
            });
        }

        /**
         * File pages cannot use a WebMessageListener without {@code *}.
         * The page wrapper calls this, then {@code window.__tspComplete}.
         * The body is a method name and request id, not a session.
         */
        @JavascriptInterface
        public void __startCardScan(String body) {
            if (!javascriptInterfaceAllowed()) return;
            runOnUiThread(() -> beginCardScan(body));
        }
    }

    private interface CipherReady {
        void ready(Cipher cipher);
    }

    private int biometricAuthenticators() {
        return BiometricManager.Authenticators.BIOMETRIC_STRONG;
    }

    private boolean canAuthenticateWithBiometrics() {
        BiometricManager biometricManager = BiometricManager.from(this);
        int result = biometricManager.canAuthenticate(biometricAuthenticators());
        return result == BiometricManager.BIOMETRIC_SUCCESS;
    }

    /** CryptoObject cannot be combined with device credential. Fingerprint only, per use. */
    private void promptForCipher(final Cipher cipher, final CipherReady onReady, final Runnable onCancel) {
        if (cipher == null) {
            if (onCancel != null) onCancel.run();
            return;
        }
        Executor executor = ContextCompat.getMainExecutor(this);
        biometricPrompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                runOnUiThread(() -> {
                    if (onCancel != null) onCancel.run();
                });
            }

            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                Cipher unlocked = cipher;
                BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                if (crypto != null && crypto.getCipher() != null) unlocked = crypto.getCipher();
                final Cipher done = unlocked;
                runOnUiThread(() -> {
                    if (onReady != null) onReady.ready(done);
                });
            }

            @Override
            public void onAuthenticationFailed() {
                super.onAuthenticationFailed();
            }
        });

        BiometricPrompt.PromptInfo prompt = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Total Service Pro")
                .setSubtitle("Use fingerprint to restore this sign-in")
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
        biometricPrompt.authenticate(prompt, new BiometricPrompt.CryptoObject(cipher));
    }

    private void beginUnlock() {
        if (sessionStore == null) {
            loadWithoutSession();
            return;
        }
        if (unlockInProgress) return;
        if (biometricPermanentlyUnavailable()) {
            wipeLockedSession();
            return;
        }
        KeystoreSessionStore.Prepared prepared = sessionStore.prepareDecrypt();
        if (prepared != null && prepared.transientFailure) {
            noteTransientUnlock();
            return;
        }
        if (prepared == null || prepared.invalidated) {
            wipeLockedSession();
            return;
        }
        if (!prepared.needsAuth) {
            finishUnlock(prepared.cipher);
            return;
        }
        unlockInProgress = true;
        promptForCipher(prepared.cipher, new CipherReady() {
            @Override
            public void ready(Cipher cipher) {
                unlockInProgress = false;
                finishUnlock(cipher);
            }
        }, new Runnable() {
            @Override
            public void run() {
                unlockInProgress = false;
                loadWithoutSession();
            }
        });
    }

    private void finishUnlock(Cipher cipher) {
        byte[] opened = sessionStore == null ? null : sessionStore.finishDecrypt(cipher);
        if (opened == null) {
            if (sessionStore != null && sessionStore.decryptWasTransient()) {
                noteTransientUnlock();
                return;
            }
            wipeLockedSession();
            return;
        }
        javax.crypto.SecretKey dataKey = SessionEnvelope.unpackDataKey(opened);
        String legacyText = null;
        if (dataKey == null) {
            legacyText = new String(opened, java.nio.charset.StandardCharsets.UTF_8);
            SessionEnvelope.zero(opened);
        }
        if (dataKey != null) {
            sessionLock = SessionEnvelope.Lock.restore(sessionStore.readEnvelope(), dataKey);
            storedSession = sessionLock.session();
            startupPlain = null;
            if (storedSession == null) {
                wipeLockedSession();
                return;
            }
            sessionStore.clearPlain();
            sessionHeld = false;
            setSessionSecure(false);
            removeSessionLockScript();
            refreshSessionThenLoad();
            return;
        }
        String legacy = legacyText != null && legacyText.contains("access_token") ? legacyText : null;
        if ((legacy == null || legacy.isEmpty()) && startupPlain != null && !startupPlain.isEmpty()) {
            legacy = startupPlain;
        }
        startupPlain = null;
        if (legacy == null || legacy.isEmpty()) {
            wipeLockedSession();
            return;
        }
        storedSession = legacy;
        sealUnlockedSession(legacy, false);
    }

    private void loadWithoutSession() {
        sessionHeld = true;
        storedSession = null;
        startupPlain = null;
        sessionHandler.removeCallbacks(sessionRefreshTask);
        clearCardDrafts();
        removeSessionInjectScript();
        concealLockedSession();
        if (webView == null) {
            loadApp();
            return;
        }
        navigateAfterWipe(chooseStartUrl());
    }

    /** The refresh token stays under the data key while biometrics are on. */
    private void persistStoredSession() {
        if (sessionStore == null) return;
        if (storedSession == null || storedSession.isEmpty()) {
            sessionStore.clearAll();
            if (sessionLock != null) sessionLock.invalidate();
            sessionLock = SessionEnvelope.Lock.locked(null);
        } else if (biometricEnabled) {
            if (sessionLock == null || sessionLock.isLocked()) return;
            if (sessionLock.rotate(storedSession) == null) return;
            sessionStore.writeEnvelope(sessionLock.ciphertext());
        } else {
            sessionStore.writePlain(storedSession);
            sessionStore.clearBiometric();
            sessionStore.clearEnvelope();
        }
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(PREFS_SESSION_KEY).apply();
    }

    /**
     * Wrap a new data key with the biometric cipher and store the session only
     * as envelope ciphertext. {@code passwordSignIn} keeps the new token under
     * the non-auth key when the prompt is cancelled, and turns the lock off.
     */
    private void sealUnlockedSession(final String json, final boolean passwordSignIn) {
        if (json == null || json.isEmpty() || sessionStore == null) {
            publishBiometricState();
            return;
        }
        final javax.crypto.SecretKey dataKey;
        final byte[] packed;
        try {
            dataKey = SessionEnvelope.newDataKey();
            packed = SessionEnvelope.packDataKey(dataKey);
        } catch (java.security.GeneralSecurityException e) {
            if (passwordSignIn) storeWithoutBiometric(json);
            else if (biometricEnabled) wipeLockedSession();
            else publishBiometricState();
            return;
        }
        KeystoreSessionStore.Prepared prepared = sessionStore.prepareEncrypt();
        if (prepared != null && prepared.transientFailure) {
            if (passwordSignIn) storeWithoutBiometric(json);
            else if (biometricEnabled) noteTransientUnlock();
            else publishBiometricState();
            return;
        }
        if (prepared == null || prepared.invalidated) {
            if (passwordSignIn) storeWithoutBiometric(json);
            else if (biometricEnabled) wipeLockedSession();
            else publishBiometricState();
            return;
        }
        final CipherReady seal = new CipherReady() {
            @Override
            public void ready(Cipher cipher) {
                boolean sealed = sessionStore != null && sessionStore.finishEncrypt(cipher, packed);
                SessionEnvelope.zero(packed);
                if (!sealed) {
                    if (passwordSignIn) storeWithoutBiometric(json);
                    else if (biometricEnabled && (sessionStore == null || !sessionStore.hasBiometric())) wipeLockedSession();
                    else if (biometricEnabled) noteTransientUnlock();
                    else publishBiometricState();
                    return;
                }
                String latest = storedSession != null && !storedSession.isEmpty() ? storedSession : json;
                try {
                    byte[] body = SessionEnvelope.seal(dataKey, latest);
                    sessionLock = SessionEnvelope.Lock.restore(body, dataKey);
                    storedSession = sessionLock.session();
                } catch (java.security.GeneralSecurityException e) {
                    wipeLockedSession();
                    return;
                }
                if (storedSession == null) {
                    wipeLockedSession();
                    return;
                }
                sessionStore.writeEnvelope(sessionLock.ciphertext());
                biometricEnabled = true;
                sessionHeld = false;
                startupPlain = null;
                setSessionSecure(false);
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putBoolean(PREFS_BIOMETRIC_KEY, true)
                        .remove(PREFS_SESSION_KEY)
                        .apply();
                removeSessionLockScript();
                if (webView != null) installSessionInjectScript(webView);
                publishBiometricState();
                refreshSessionThenLoad();
            }
        };
        final Runnable onCancel = new Runnable() {
            @Override
            public void run() {
                if (passwordSignIn) storeWithoutBiometric(json);
                else if (!biometricEnabled) publishBiometricState();
                else loadWithoutSession();
            }
        };
        if (!prepared.needsAuth) {
            seal.ready(prepared.cipher);
            return;
        }
        unlockInProgress = true;
        promptForCipher(prepared.cipher, new CipherReady() {
            @Override
            public void ready(Cipher cipher) {
                unlockInProgress = false;
                seal.ready(cipher);
            }
        }, new Runnable() {
            @Override
            public void run() {
                unlockInProgress = false;
                onCancel.run();
            }
        });
    }

    private void storeWithoutBiometric(String json) {
        biometricEnabled = false;
        storedSession = json;
        sessionHeld = false;
        startupPlain = null;
        setSessionSecure(false);
        if (sessionLock != null) sessionLock.invalidate();
        sessionLock = SessionEnvelope.Lock.locked(null);
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putBoolean(PREFS_BIOMETRIC_KEY, false)
                .remove(PREFS_SESSION_KEY)
                .apply();
        if (sessionStore != null) {
            sessionStore.clearBiometric();
            sessionStore.clearEnvelope();
            sessionStore.writePlain(json);
        }
        removeSessionLockScript();
        if (webView != null) installSessionInjectScript(webView);
        publishBiometricState();
    }

    private void applyBiometricChoice(boolean enabled) {
        if (enabled) {
            if (!canAuthenticateWithBiometrics()) {
                Toast.makeText(this, "Set up fingerprint on this phone to use biometric sign-in.", Toast.LENGTH_LONG).show();
                publishBiometricState();
                return;
            }
            if (sessionStore == null || storedSession == null || storedSession.isEmpty()) {
                publishBiometricState();
                return;
            }
            sealUnlockedSession(storedSession, false);
            return;
        }
        biometricEnabled = false;
        startupPlain = null;
        setSessionSecure(false);
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putBoolean(PREFS_BIOMETRIC_KEY, false)
                .apply();
        if (storedSession != null && sessionStore != null) sessionStore.writePlain(storedSession);
        if (sessionStore != null) {
            sessionStore.clearBiometric();
            sessionStore.clearEnvelope();
        }
        if (sessionLock != null) sessionLock.dropDataKey();
        sessionLock = SessionEnvelope.Lock.locked(null);
        publishBiometricState();
    }

    private void lockForBackground() {
        if (!biometricEnabled) return;
        storedSession = null;
        startupPlain = null;
        sessionHeld = true;
        sessionHandler.removeCallbacks(sessionRefreshTask);
        concealLockedSession();
    }

    /** Keystore blip. Keep the sealed session and try the prompt again on the next resume. */
    private void noteTransientUnlock() {
        retryUnlockAfterResume = true;
        sessionHeld = true;
        storedSession = null;
        concealLockedSession();
    }

    /** Drop the in-memory key, blank the page, and hide the task snapshot. */
    private void concealLockedSession() {
        if (sessionLock != null) sessionLock.dropDataKey();
        setSessionSecure(true);
        if (webView == null) return;
        try {
            final CookieManager cookies = CookieManager.getInstance();
            cookies.removeAllCookies(value -> {
                try {
                    cookies.flush();
                } catch (RuntimeException ignored) {
                }
            });
        } catch (RuntimeException ignored) {
        }
        webView.loadUrl("about:blank");
    }

    private void setSessionSecure(boolean locked) {
        if (locked) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    /** Fingerprints or the screen lock are gone. The encrypted session cannot be opened. */
    private boolean biometricPermanentlyUnavailable() {
        int status = BiometricManager.from(this).canAuthenticate(biometricAuthenticators());
        return status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                || status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
                || status == BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED;
    }

    private void wipeLockedSession() {
        storedSession = null;
        startupPlain = null;
        sessionHeld = true;
        biometricEnabled = false;
        unlockInProgress = false;
        reauthOnResume = false;
        retryUnlockAfterResume = false;
        pendingBiometricGate = false;
        if (sessionLock != null) sessionLock.invalidate();
        sessionLock = SessionEnvelope.Lock.locked(null);
        refreshFailures = 0;
        sessionHandler.removeCallbacks(sessionRefreshTask);
        sessionHandler.removeCallbacks(biometricGateTask);
        sessionHandler.removeCallbacks(lockForBackgroundTask);
        if (sessionStore != null) sessionStore.clearAll();
        clearCardDrafts();
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .remove(PREFS_SESSION_KEY)
                .putBoolean(PREFS_BIOMETRIC_KEY, false)
                .apply();
        removeSessionLockScript();
        removeSessionInjectScript();
        concealLockedSession();
        clearSecureOnNextPage = true;
        publishBiometricState();
        if (webView == null) {
            clearSecureOnNextPage = false;
            setSessionSecure(false);
            if (pendingLaunchUrl == null) pendingLaunchUrl = PRODUCTION_ORIGIN + "/login";
            loadApp();
            return;
        }
        navigateAfterWipe(PRODUCTION_ORIGIN + "/login");
    }

    private void maybeOfferBiometric(String previousUser) {
        if (biometricEnabled || isFinishing()) return;
        if (previousUser != null && !previousUser.isEmpty()) return;
        if (SessionTokens.userId(storedSession).isEmpty()) return;
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(PREFS_BIOMETRIC_PROMPTED, false)) return;
        if (!canAuthenticateWithBiometrics()) return;
        prefs.edit().putBoolean(PREFS_BIOMETRIC_PROMPTED, true).apply();
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Unlock with biometrics?")
                .setMessage("Stay signed in on this device. Next launch can require fingerprint before the session is restored.")
                .setPositiveButton("Enable", (d, w) -> applyBiometricChoice(true))
                .setNegativeButton("Not now", null)
                .show();
    }

    private void refreshSessionThenLoad() {
        if (sessionRefreshRunning) return;
        long now = System.currentTimeMillis();
        long elapsed = SystemClock.elapsedRealtime();
        if (storedSession == null || storedSession.isEmpty()
                || !SessionTokens.needsRefresh(storedSession, now, elapsed)) {
            presentSession();
            scheduleSessionRefresh();
            return;
        }
        sessionRefreshRunning = true;
        final String snapshot = storedSession;
        if (webView != null) {
            webView.evaluateJavascript("try{localStorage.removeItem('tsp-auth-token');}catch(e){}", null);
        }
        new Thread(() -> {
            SupabaseSessionRefresh.Outcome outcome =
                    SupabaseSessionRefresh.refreshBlocking(snapshot, BillingManager.supabaseAnonKey());
            runOnUiThread(() -> {
                sessionRefreshRunning = false;
                if (isDestroyed()) return;
                if (!snapshot.equals(storedSession)) return;
                if (outcome.kind == SupabaseSessionRefresh.Outcome.Kind.REVOKED) {
                    discardRevokedSession();
                    return;
                }
                if (outcome.kind == SupabaseSessionRefresh.Outcome.Kind.UPDATED && outcome.session != null) {
                    storedSession = outcome.session;
                    refreshFailures = 0;
                    persistStoredSession();
                    presentSession();
                    scheduleSessionRefresh();
                    CookieManager.getInstance().flush();
                    return;
                }
                refreshFailures++;
                presentSession();
                scheduleRetry();
                CookieManager.getInstance().flush();
            });
        }, "session-refresh").start();
    }

    private boolean sessionIsFresh() {
        if (sessionHeld || storedSession == null || storedSession.isEmpty()) return false;
        return !SessionTokens.needsRefresh(storedSession, System.currentTimeMillis(), SystemClock.elapsedRealtime());
    }

    private void presentSession() {
        if (!sessionIsFresh()) {
            if (webView == null) {
                loadApp();
                return;
            }
            webView.evaluateJavascript("try{localStorage.removeItem('tsp-auth-token');}catch(e){}", null);
            return;
        }
        if (webView == null) {
            loadApp();
            return;
        }
        if (webView.getUrl() == null || "about:blank".equals(webView.getUrl())) {
            navigateAfterWipe(chooseStartUrl());
            return;
        }
        injectStoredSession(webView);
        installSessionInjectScript(webView);
    }

    private void discardRevokedSession() {
        storedSession = null;
        sessionHeld = false;
        biometricEnabled = false;
        refreshFailures = 0;
        pendingBiometricGate = false;
        reauthOnResume = false;
        retryUnlockAfterResume = false;
        startupPlain = null;
        if (sessionLock != null) sessionLock.invalidate();
        sessionLock = SessionEnvelope.Lock.locked(null);
        sessionHandler.removeCallbacks(sessionRefreshTask);
        sessionHandler.removeCallbacks(biometricGateTask);
        sessionHandler.removeCallbacks(lockForBackgroundTask);
        if (sessionStore != null) sessionStore.clearAll();
        clearCardDrafts();
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .remove(PREFS_SESSION_KEY)
                .putBoolean(PREFS_BIOMETRIC_KEY, false)
                .remove(PREFS_BIOMETRIC_PROMPTED)
                .apply();
        removeSessionLockScript();
        removeSessionInjectScript();
        concealLockedSession();
        clearSecureOnNextPage = true;
        publishBiometricState();
        if (webView == null) {
            if (pendingLaunchUrl == null) pendingLaunchUrl = PRODUCTION_ORIGIN + "/login";
            loadApp();
            return;
        }
        navigateAfterWipe(PRODUCTION_ORIGIN + "/login");
    }

    private void scheduleSessionRefresh() {
        sessionHandler.removeCallbacks(sessionRefreshTask);
        long delay = SessionTokens.millisUntilRefresh(
                storedSession, System.currentTimeMillis(), SystemClock.elapsedRealtime());
        if (delay <= 0L) return;
        sessionHandler.postDelayed(sessionRefreshTask, delay);
    }

    private void scheduleRetry() {
        sessionHandler.removeCallbacks(sessionRefreshTask);
        int shift = refreshFailures - 1;
        if (shift < 0) shift = 0;
        if (shift > 5) shift = 5;
        long delay = 30_000L << shift;
        long cap = 15L * 60L * 1000L;
        if (delay > cap || delay <= 0L) delay = cap;
        sessionHandler.postDelayed(sessionRefreshTask, delay);
    }

    private void clearCardDrafts() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(PREFS_CARD_DRAFTS).apply();
    }

    private void retainDraftsForUser(String userId) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String kept = CustomerCardDrafts.keepForUser(prefs.getString(PREFS_CARD_DRAFTS, "[]"), userId);
        prefs.edit().putString(PREFS_CARD_DRAFTS, kept).apply();
    }

    /**
     * Cookie removal and, when requested, the WebStorage wipe both finish
     * before {@code after}. {@code deleteAllData} reports completion through
     * the {@code getOrigins} callback posted behind it. The fallback timer
     * waits for that callback instead of loading over an in-flight wipe.
     * A fresh seed is written after this returns, so a full wipe is used only
     * when the next page must not keep a session.
     */
    private void wipeWebSessionThen(boolean deleteAll, Runnable after) {
        final Runnable next = after == null ? new Runnable() {
            @Override
            public void run() { }
        } : after;
        final boolean[] started = new boolean[]{false};
        final boolean[] storageDone = new boolean[]{!deleteAll};
        final Runnable[] fallback = new Runnable[1];
        final Runnable once = new Runnable() {
            @Override
            public void run() {
                if (started[0]) return;
                if (!storageDone[0]) return;
                started[0] = true;
                if (fallback[0] != null) sessionHandler.removeCallbacks(fallback[0]);
                if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) next.run();
                else runOnUiThread(next);
            }
        };
        fallback[0] = new Runnable() {
            private int waits = 0;

            @Override
            public void run() {
                if (started[0]) return;
                if (!storageDone[0] && waits < 5) {
                    waits++;
                    sessionHandler.postDelayed(this, 2000);
                    return;
                }
                storageDone[0] = true;
                once.run();
            }
        };
        sessionHandler.postDelayed(fallback[0], 2000);
        final int[] pending = new int[]{0};
        final Runnable step = new Runnable() {
            @Override
            public void run() {
                sessionHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        pending[0]--;
                        if (pending[0] <= 0) once.run();
                    }
                });
            }
        };
        if (deleteAll) {
            pending[0]++;
            deleteAllDataThen(new Runnable() {
                @Override
                public void run() {
                    sessionHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            storageDone[0] = true;
                            pending[0]--;
                            if (pending[0] <= 0) once.run();
                        }
                    });
                }
            });
        }
        pending[0]++;
        if (webView != null && webView.getUrl() != null) {
            webView.evaluateJavascript(
                    "(function(){try{localStorage.removeItem('tsp-auth-token');}catch(e){}})()",
                    value -> step.run());
        } else {
            sessionHandler.post(step);
        }
        pending[0]++;
        CookieManager cookies = CookieManager.getInstance();
        try {
            cookies.removeAllCookies(value -> {
                try {
                    cookies.flush();
                } catch (RuntimeException ignored) {
                }
                step.run();
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "Cookie wipe failed", e);
            step.run();
        }
    }

    /** {@code getOrigins} is queued after {@code deleteAllData}, so it runs when the wipe has finished. */
    private void deleteAllDataThen(final Runnable done) {
        final Runnable finish = done == null ? new Runnable() {
            @Override
            public void run() { }
        } : done;
        try {
            final WebStorage storage = WebStorage.getInstance();
            storage.deleteAllData();
            storage.getOrigins(new ValueCallback<java.util.Map>() {
                @Override
                public void onReceiveValue(java.util.Map value) {
                    finish.run();
                }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "Web storage wipe failed", e);
            finish.run();
        }
    }

    private void navigateAfterWipe(String url) {
        final String target = url == null || url.isEmpty() ? homeUrl() : url;
        final boolean fresh = sessionIsFresh();
        wipeWebSessionThen(!fresh, () -> {
            if (webView == null || isDestroyed()) return;
            if (sessionIsFresh()) {
                removeSessionLockScript();
                installSessionInjectScript(webView);
            } else {
                removeSessionInjectScript();
                installSessionLockScript(webView);
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                webView.loadUrl(target);
                return;
            }
            seedOriginThenLoad(webView, target);
        });
    }

    /** Sets origin localStorage, then loads the real URL after that document finishes. */
    private void seedOriginThenLoad(WebView view, String url) {
        if (view == null) return;
        pendingAfterSeedUrl = url;
        String payload = sessionIsFresh() ? persistableSessionJson(storedSession) : null;
        String set = payload == null ? "" : "localStorage.setItem('tsp-auth-token'," + org.json.JSONObject.quote(payload) + ");";
        String html = "<!DOCTYPE html><html><body><script>try{localStorage.removeItem('tsp-auth-token');"
                + set + "}catch(e){}</script></body></html>";
        view.loadDataWithBaseURL(PRODUCTION_ORIGIN + "/", html, "text/html", "UTF-8", null);
    }

    private void publishBiometricState() {
        boolean available = canAuthenticateWithBiometrics();
        notifyVoiceJs(
                "window.__tspBiometric={enabled:" + (biometricEnabled ? "true" : "false")
                        + ",available:" + (available ? "true" : "false") + "};"
                        + "try{window.dispatchEvent(new CustomEvent('tsp-biometric',{detail:window.__tspBiometric}));}catch(e){}"
                        + "var box=document.getElementById('biometricLogin');if(box)box.checked="
                        + (biometricEnabled ? "true" : "false") + ";"
        );
    }

    private void installSessionLockScript(WebView target) {
        if (sessionLockScript != null || target == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        java.util.Set<String> origins = new java.util.HashSet<>();
        origins.add("https://" + TrustedOrigins.HOST_REPAIRPLANET);
        origins.add("https://" + TrustedOrigins.HOST_WWW);
        try {
            sessionLockScript = WebViewCompat.addDocumentStartJavaScript(
                    target,
                    "try{localStorage.removeItem('tsp-auth-token');}catch(e){}",
                    origins);
        } catch (RuntimeException e) {
            Log.w(TAG, "Session lock script unavailable", e);
        }
    }

    private void removeSessionLockScript() {
        androidx.webkit.ScriptHandler script = sessionLockScript;
        sessionLockScript = null;
        if (script == null) return;
        try {
            script.remove();
        } catch (RuntimeException e) {
            Log.w(TAG, "Session lock script remove failed", e);
        }
    }

    /** Writes the native session before page scripts so the WebView does not refresh on its own. */
    private void installSessionInjectScript(WebView target) {
        removeSessionInjectScript();
        if (!sessionIsFresh() || target == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        String payload = persistableSessionJson(storedSession);
        if (payload == null) return;
        java.util.Set<String> origins = new java.util.HashSet<>();
        origins.add("https://" + TrustedOrigins.HOST_REPAIRPLANET);
        origins.add("https://" + TrustedOrigins.HOST_WWW);
        try {
            String js = "try{localStorage.setItem('tsp-auth-token'," + org.json.JSONObject.quote(payload) + ");}catch(e){}";
            sessionInjectScript = WebViewCompat.addDocumentStartJavaScript(target, js, origins);
        } catch (RuntimeException e) {
            Log.w(TAG, "Session inject script unavailable", e);
        }
    }

    private void removeSessionInjectScript() {
        androidx.webkit.ScriptHandler script = sessionInjectScript;
        sessionInjectScript = null;
        if (script == null) return;
        try {
            script.remove();
        } catch (RuntimeException e) {
            Log.w(TAG, "Session inject script remove failed", e);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void loadApp() {
        ensureDeviceTts();
        webView = findViewById(R.id.webView);
        bindWebView(webView);
        navigateAfterWipe(chooseStartUrl());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void bindWebView(WebView webView) {
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
        // Live /reports/[id] prints with window.open('') + document.write + print.
        // Without these, window.open returns null and the page reports a blocked pop-up.
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " TSPAndroid/0.5.4-beta");
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new WebAppInterface(), "Android");
        webView.addJavascriptInterface(new PrintBridge(webView, false), "TSPPrint");
        installOriginLockedListener(webView);
        installDocumentStartShim(webView);
        if (sessionIsFresh()) {
            removeSessionLockScript();
            installSessionInjectScript(webView);
        } else {
            installSessionLockScript(webView);
            removeSessionInjectScript();
        }

        if (!backCallbackInstalled) {
            backCallbackInstalled = true;
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (closeTopPrintPreview()) return;
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
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (!originAllowsBridge()) {
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                pendingCameraUri = null;
                try {
                    Intent content = fileChooserParams.createIntent();
                    Intent chooser = Intent.createChooser(content, "Upload");
                    if (acceptsImages(fileChooserParams)) {
                        Intent capture = cameraCaptureIntent();
                        if (capture != null) {
                            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{capture});
                        }
                    }
                    fileChooserLauncher.launch(chooser);
                    return true;
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    pendingCameraUri = null;
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return openPopupWindow(view, resultMsg);
            }

            @Override
            public void onCloseWindow(WebView window) {
                if (window != null && window != webView) disposePrintPopup(window);
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            boolean pdf = (mimeType != null && mimeType.toLowerCase(Locale.US).contains("pdf"))
                    || (name != null && name.toLowerCase(Locale.US).endsWith(".pdf"))
                    || (url != null && url.toLowerCase(Locale.US).contains(".pdf"));
            if (pdf) {
                String current = webView.getUrl();
                boolean alreadyViewing = current != null && (current.contains("/manuals")
                        || current.contains("pdf_viewer"));
                if (alreadyViewing) {
                    return;
                }
                if (url != null && TrustedOrigins.allowsUrl(url)) {
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
                if (uri == null) return false;
                String url = uri.toString();
                if (!request.isForMainFrame()) {
                    if (isGeoUrl(url)) {
                        openGeoOrMaps(url);
                        return true;
                    }
                    return !TrustedOrigins.subframeMayLoad(url);
                }
                return overrideMainFrame(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return overrideMainFrame(view, url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (url == null) return;
                String shown = view.getUrl();
                if (shown != null && TrustedOrigins.isSessionPage(shown) && !shown.equals(url)
                        && !TrustedOrigins.isSessionPage(url)) {
                    return;
                }
                mainFrameUrl = url;
                if (handEmailLinkToBrowser(url)) {
                    view.stopLoading();
                    return;
                }
                if (TrustedOrigins.isSessionPage(url) || isInlineDocumentUrl(url)) return;
                if (url.equals(acceptedAuthNavigation)) return;
                view.stopLoading();
                openOutside(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (pendingAfterSeedUrl != null && view == webView) {
                    String next = pendingAfterSeedUrl;
                    pendingAfterSeedUrl = null;
                    clearHistoryOnNextFinish = true;
                    view.loadUrl(next);
                    return;
                }
                if (clearHistoryOnNextFinish && view == webView) {
                    String seeded = view.getUrl();
                    if (seeded == null || url == null || url.equals(seeded)) {
                        clearHistoryOnNextFinish = false;
                        view.clearHistory();
                    }
                }
                if (clearSecureOnNextPage && view == webView && !biometricEnabled) {
                    String shown = view.getUrl();
                    if (shown != null && !"about:blank".equals(shown)) {
                        clearSecureOnNextPage = false;
                        setSessionSecure(false);
                    }
                }
                String main = view.getUrl();
                if (url != null && main != null && !url.equals(main)) return;
                String page = main != null ? main : url;
                mainFrameUrl = page;
                updateBottomNavVisibilityAndSelection(page);
                if (page != null && page.equals(acceptedAuthNavigation)) acceptedAuthNavigation = null;
                if (!TrustedOrigins.isSessionPage(page)) return;
                injectStoredSession(view);
                injectCitationOpenBridge(view);
                injectOnlineVoice(view, page);
                injectPrintHook(view);
                injectOriginLockedShim(view);
                injectFileCardShim(view);
                injectCardScanPage(view);
                publishBiometricState();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    if (view == webView) recoverFromRendererCrash();
                    else disposePrintPopup(view);
                });
                return true;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (failingUrl != null && failingUrl.startsWith(PRODUCTION_ORIGIN) && !isNetworkAvailable()) {
                    view.loadUrl(localAssetUrl("index.html"));
                }
            }
        });

        if (bottomNav == null) bottomNav = findViewById(R.id.bottom_navigation);
        if (bottomNav != null) {
            bottomNav.setOnItemSelectedListener(navListener);
        }
    }

    private String chooseStartUrl() {
        if (pendingLaunchUrl != null) {
            String launch = pendingLaunchUrl;
            pendingLaunchUrl = null;
            return launch;
        }
        String last = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREFS_LAST_URL, null);
        if (isNetworkAvailable()) {
            if (last != null && TrustedOrigins.isFirstPartyAppPage(last) && !looksLikePdfDownload(last)) {
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

    /** @return true when openUrl should not start a second intent. */
    private boolean navigateInWebView(String url) {
        if (webView == null || url == null) return true;
        if (!overrideMainFrame(webView, url)) webView.loadUrl(url);
        return true;
    }

    /**
     * @return true when the WebView must not load this main-frame URL.
     * First-party https pages and bundled assets stay. Auth starts a Custom Tab
     * bound to a one-time nonce. Every other host leaves the WebView.
     */
    private boolean overrideMainFrame(WebView view, String url) {
        if (url == null) return true;
        if (isGeoUrl(url)) {
            openGeoOrMaps(url);
            return true;
        }
        String lower = url.toLowerCase(Locale.US);
        if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("sms:")
                || lower.startsWith("intent:") || lower.startsWith("market:")) {
            openOutside(url);
            return true;
        }
        if (handEmailLinkToBrowser(url)) return true;
        if (lower.startsWith("totalservicepro://")) {
            Uri uri = Uri.parse(url);
            if (!allowCredentialCallback(uri)) {
                if (view != null) view.loadUrl(homeUrl());
                return true;
            }
            String dest = productionAuthCallbackUrl(uri);
            acceptedAuthNavigation = dest;
            rememberSessionFromAuthUri(uri);
            if (view != null) view.loadUrl(dest);
            return true;
        }
        if (TrustedOrigins.isAuthCallback(url) && callbackCarriesCredential(Uri.parse(url))) {
            if (url.equals(acceptedAuthNavigation)) {
                acceptedAuthNavigation = null;
                return false;
            }
            Uri uri = Uri.parse(url);
            if (!allowCredentialCallback(uri)) return true;
            rememberSessionFromAuthUri(uri);
            return false;
        }
        if (TrustedOrigins.isAuthStart(url)) {
            beginAuthAndOpenCustomTab(url);
            return true;
        }
        if (TrustedOrigins.isBundledAsset(url)) {
            if (isNetworkAvailable()) {
                if (view != null) view.loadUrl(mapAssetUrlToProduction(url));
                return true;
            }
            return false;
        }
        if (TrustedOrigins.isFirstPartyAppPage(url)) {
            if (looksLikePdfDownload(url) && TrustedOrigins.allowsUrl(url)) {
                if (view != null) view.loadUrl(PRODUCTION_ORIGIN + "/manuals/view");
                return true;
            }
            return false;
        }
        openOutside(url);
        return true;
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

    private void showToast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
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

    private void openCustomTab(String url) {
        try {
            CustomTabsIntent tabs = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tabs.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
            tabs.launchUrl(this, Uri.parse(url));
        } catch (RuntimeException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (RuntimeException ignored) {
                showToast("Could not open link");
            }
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

    private boolean isInlineDocumentUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.startsWith("about:") || lower.startsWith("data:")
                || lower.startsWith("blob:") || lower.startsWith("javascript:");
    }

    private String homeUrl() {
        if (isNetworkAvailable()) return PRODUCTION_ORIGIN + "/";
        return localAssetUrl("index.html");
    }

    /**
     * Email, magic-link, and password-reset URLs that do not match the login
     * this app started. The default browser is chosen with an http probe so
     * the verified https App Link does not open this app again.
     */
    private boolean handEmailLinkToBrowser(String url) {
        if (!AuthLinks.shouldOpenInBrowser(url, loadPendingAuth(), System.currentTimeMillis())) return false;
        openInExternalBrowser(url);
        if (webView == null) closedForExternalAuth = true;
        return true;
    }

    private void openInExternalBrowser(String url) {
        showToast("Opening in your browser");
        String browser = defaultBrowserPackage();
        if (browser == null) {
            showToast("Could not open link");
            return;
        }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            view.setPackage(browser);
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(view);
        } catch (RuntimeException e) {
            showToast("Could not open link");
        }
    }

    private String defaultBrowserPackage() {
        try {
            Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com/"));
            probe.addCategory(Intent.CATEGORY_BROWSABLE);
            android.content.pm.ResolveInfo preferred = getPackageManager().resolveActivity(
                    probe, PackageManager.MATCH_DEFAULT_ONLY);
            String chosen = browserPackage(preferred);
            if (chosen != null) return chosen;
            java.util.List<android.content.pm.ResolveInfo> all = getPackageManager().queryIntentActivities(probe, 0);
            for (int i = 0; i < all.size(); i++) {
                chosen = browserPackage(all.get(i));
                if (chosen != null) return chosen;
            }
            return null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private String browserPackage(android.content.pm.ResolveInfo info) {
        if (info == null || info.activityInfo == null) return null;
        String pkg = info.activityInfo.packageName;
        if (pkg == null || pkg.equals(getPackageName()) || "android".equals(pkg)) return null;
        return pkg;
    }

    private static String orgApiError(String message) {
        try {
            org.json.JSONObject obj = new org.json.JSONObject();
            obj.put("ok", false);
            obj.put("error", message);
            return obj.toString();
        } catch (org.json.JSONException e) {
            return "{\"ok\":false,\"error\":\"Could not update this company\"}";
        }
    }

    private static String readLimited(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096];
        int total = 0;
        int n;
        while ((n = in.read(tmp)) >= 0 && total < 65536) {
            int take = Math.min(n, 65536 - total);
            buf.write(tmp, 0, take);
            total += take;
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private void openOutside(String url) {
        if (url == null || url.isEmpty()) return;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        if ("https".equals(scheme) || "http".equals(scheme)) {
            openCustomTab(url);
            return;
        }
        try {
            startExternal(url);
        } catch (RuntimeException ignored) {
            showToast("Could not open link");
        }
    }

    private void beginAuthAndOpenCustomTab(String url) {
        String nonce = newNonce();
        String state = null;
        try {
            state = Uri.parse(url).getQueryParameter("state");
        } catch (RuntimeException ignored) {
        }
        long expiry = System.currentTimeMillis() + AuthHandoff.TTL_MS;
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(PREFS_AUTH_NONCE, nonce)
                .putString(PREFS_AUTH_STATE, state == null ? "" : state)
                .putLong(PREFS_AUTH_EXPIRY, expiry)
                .apply();
        openCustomTab(AuthHandoff.withNonceOnRedirect(url, nonce));
    }

    private String newNonce() {
        return AuthHandoff.newNonce(new SecureRandom());
    }

    private AuthHandoff.Pending loadPendingAuth() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String nonce = prefs.getString(PREFS_AUTH_NONCE, "");
        if (nonce == null || nonce.isEmpty()) return null;
        return new AuthHandoff.Pending(nonce, prefs.getString(PREFS_AUTH_STATE, ""),
                prefs.getLong(PREFS_AUTH_EXPIRY, 0L));
    }

    private void clearPendingAuth() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .remove(PREFS_AUTH_NONCE)
                .remove(PREFS_AUTH_STATE)
                .remove(PREFS_AUTH_EXPIRY)
                .apply();
    }

    /** Single-use. A callback with a code or tokens must match the login this app started. */
    private boolean allowCredentialCallback(Uri uri) {
        if (uri == null || !callbackCarriesCredential(uri)) return false;
        boolean ok = AuthHandoff.matches(loadPendingAuth(),
                callbackParam(uri, "tsp_nonce"),
                callbackParam(uri, "state"),
                System.currentTimeMillis());
        clearPendingAuth();
        return ok;
    }

    private boolean callbackCarriesCredential(Uri uri) {
        return callbackParam(uri, "access_token") != null || callbackParam(uri, "code") != null;
    }

    private String callbackParam(Uri uri, String name) {
        if (uri == null || name == null) return null;
        try {
            String query = uri.getQueryParameter(name);
            if (query != null && !query.isEmpty()) return query;
            String fragment = uri.getFragment();
            if (fragment == null || fragment.isEmpty()) return null;
            String fromFragment = Uri.parse("https://repairplanet.net/?" + fragment).getQueryParameter(name);
            return fromFragment == null || fromFragment.isEmpty() ? null : fromFragment;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean originAllowsBridge() {
        return TrustedOrigins.isSessionPage(urlOnUiThread(webView));
    }

    /**
     * JavascriptInterface cannot see the calling frame. https pages must use
     * tspNative. File pages stay on this object because a WebMessageListener
     * origin list cannot name file:// without allowing every origin.
     */
    private boolean javascriptInterfaceAllowed() {
        if (Boolean.TRUE.equals(originLockedCaller.get())) return true;
        return TrustedOrigins.isBundledAsset(urlOnUiThread(webView));
    }

    /**
     * Print popups are about:blank documents owned by a session page.
     * A popup whose own URL is some other origin does not get the bridge.
     */
    private boolean originAllowsPrint(WebView target) {
        String url = urlOnUiThread(target);
        if (TrustedOrigins.isSessionPage(url)) return true;
        if (target == null || target == webView || !isInlineDocumentUrl(url)) return false;
        return TrustedOrigins.isSessionPage(urlOnUiThread(webView));
    }

    private String urlOnUiThread(WebView target) {
        final String[] holder = new String[1];
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            holder[0] = target != null ? target.getUrl() : mainFrameUrl;
            return holder[0];
        }
        CountDownLatch latch = new CountDownLatch(1);
        runOnUiThread(() -> {
            holder[0] = target != null ? target.getUrl() : mainFrameUrl;
            latch.countDown();
        });
        try {
            if (!latch.await(750, TimeUnit.MILLISECONDS)) return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
        return holder[0];
    }

    private void installOriginLockedListener(WebView target) {
        if (target == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        Set<String> origins = new HashSet<>();
        origins.add("https://" + TrustedOrigins.HOST_REPAIRPLANET);
        origins.add("https://" + TrustedOrigins.HOST_WWW);
        try {
            WebViewCompat.addWebMessageListener(target, "tspNative", origins,
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || message == null) return;
                        if (sourceOrigin == null || !TrustedOrigins.isFirstPartyAppPage(sourceOrigin.toString())) {
                            return;
                        }
                        onOriginLockedMessage(view, message.getData(), replyProxy);
                    });
        } catch (RuntimeException e) {
            Log.w(TAG, "WebMessageListener unavailable", e);
        }
    }

    private void installDocumentStartShim(WebView target) {
        if (target == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        Set<String> origins = new HashSet<>();
        origins.add("https://" + TrustedOrigins.HOST_REPAIRPLANET);
        origins.add("https://" + TrustedOrigins.HOST_WWW);
        try {
            WebViewCompat.addDocumentStartJavaScript(target, ORIGIN_SHIM_JS, origins);
        } catch (RuntimeException e) {
            Log.w(TAG, "Document-start shim unavailable", e);
        }
    }

    private void onOriginLockedMessage(WebView source, String data, JavaScriptReplyProxy replyProxy) {
        if (data == null || data.isEmpty()) return;
        runOnUiThread(() -> {
            if (!originAllowsBridge()) return;
            originLockedCaller.set(Boolean.TRUE);
            try {
                org.json.JSONObject obj = new org.json.JSONObject(data);
                String method = obj.optString("m", "");
                if ("getStoredSession".equals(method)) {
                    replyToPage(replyProxy, storedSession == null ? "" : storedSession);
                    return;
                }
                WebAppInterface bridge = new WebAppInterface();
                if ("showToast".equals(method)) bridge.showToast(obj.optString("msg", ""));
                else if ("saveSession".equals(method)) bridge.saveSession(obj.optString("json", ""));
                else if ("clearSession".equals(method)) bridge.clearSession();
                else if ("setBiometricEnabled".equals(method)) bridge.setBiometricEnabled(obj.optBoolean("on", false));
                else if ("launchBillingFlow".equals(method)) bridge.launchBillingFlow(obj.optString("sku", ""));
                else if ("openUrl".equals(method)) bridge.openUrl(obj.optString("url", ""));
                else if ("printReport".equals(method)) bridge.printReport(obj.optString("html", ""), obj.optString("jobName", ""));
                else if ("speak".equals(method)) bridge.speak(obj.optString("text", ""));
                else if ("speakAnswer".equals(method)) bridge.speakAnswer(
                        obj.optString("text", ""), obj.optString("voiceId", ""),
                        obj.optString("engine", ""), obj.optString("token", ""));
                else if ("interruptSpeech".equals(method)) bridge.interruptSpeech();
                else if ("stopSpeaking".equals(method)) bridge.stopSpeaking();
                else if ("startVoiceRecognition".equals(method)) bridge.startVoiceRecognition();
                else if ("stopVoiceRecognition".equals(method)) bridge.stopVoiceRecognition();
                else if ("onCitationObserved".equals(method)) bridge.onCitationObserved(
                        obj.optString("manualId", ""), obj.optString("page", ""));
                else if ("goBack".equals(method)) bridge.goBack();
                else if ("captureCardImage".equals(method) || "openCamera".equals(method)) {
                    beginCardScan(data);
                }
                else if ("cardPage".equals(method) || "cardButton".equals(method)) {
                    return;
                }
                else if ("queryBiometric".equals(method)) {
                    publishBiometricState();
                }
                else if ("printPage".equals(method)) printWebView(source != null ? source : webView, data, source != null && source != webView);
            } catch (Exception e) {
                Log.w(TAG, "tspNative message rejected", e);
            } finally {
                originLockedCaller.remove();
            }
        });
    }

    private void replyToPage(JavaScriptReplyProxy replyProxy, String body) {
        if (replyProxy == null || body == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try {
            replyProxy.postMessage(body);
        } catch (RuntimeException e) {
            Log.w(TAG, "tspNative reply failed", e);
        }
    }

    /**
     * Replaces window.Android on https://repairplanet.net and www before page
     * scripts run. The replacement posts to tspNative and never reads the
     * JavascriptInterface. File pages do not receive this script.
     */
    private static final String ORIGIN_SHIM_JS =
            "(function(){window.__tspOriginShim=true;"
                    + "function post(o){try{if(window.tspNative&&window.tspNative.postMessage)window.tspNative.postMessage(JSON.stringify(o));}catch(e){}}"
                    + "window.__tspPending=window.__tspPending||{};"
                    + "window.__tspComplete=function(msg){if(!msg||!msg.id)return;var pending=window.__tspPending[msg.id];if(!pending)return;delete window.__tspPending[msg.id];if(msg.ok)pending.resolve(msg.value);else pending.reject(new Error(msg.error||'Native request failed'));};"
                    + "function invoke(method,payload){return new Promise(function(resolve,reject){var id=String(Date.now())+'-'+Math.random().toString(16).slice(2);window.__tspPending[id]={resolve:resolve,reject:reject};var spec=payload&&typeof payload==='object'?payload:{};post({m:method,requestId:id,payload:spec});});}"
                    + "window.Android={"
                    + "showToast:function(m){post({m:'showToast',msg:m});},"
                    + "saveSession:function(j){post({m:'saveSession',json:j});},"
                    + "getStoredSession:function(){return null;},"
                    + "clearSession:function(){post({m:'clearSession'});},"
                    + "setBiometricEnabled:function(v){post({m:'setBiometricEnabled',on:!!v});},"
                    + "isBiometricEnabled:function(){return !!(window.__tspBiometric&&window.__tspBiometric.enabled);},"
                    + "canUseBiometric:function(){return !!(window.__tspBiometric&&window.__tspBiometric.available);},"
                    + "setPremiumStatus:function(){},"
                    + "launchBillingFlow:function(s){post({m:'launchBillingFlow',sku:s});},"
                    + "openUrl:function(u){post({m:'openUrl',url:u});},"
                    + "postOrgApi:function(){return '{\\\"ok\\\":false,\\\"error\\\":\\\"Not allowed\\\"}';},"
                    + "printReport:function(h,n){post({m:'printReport',html:h,jobName:n});},"
                    + "speak:function(t){post({m:'speak',text:t});},"
                    + "speakAnswer:function(t,v,e,a){post({m:'speakAnswer',text:t,voiceId:v,engine:e,token:a});},"
                    + "interruptSpeech:function(){post({m:'interruptSpeech'});},"
                    + "stopSpeaking:function(){post({m:'stopSpeaking'});},"
                    + "startVoiceRecognition:function(){post({m:'startVoiceRecognition'});},"
                    + "stopVoiceRecognition:function(){post({m:'stopVoiceRecognition'});},"
                    + "onCitationObserved:function(id,p){post({m:'onCitationObserved',manualId:id,page:p});},"
                    + "goBack:function(){post({m:'goBack'});},"
                    + "captureCardImage:function(p){return invoke('captureCardImage',p);},"
                    + "openCamera:function(p){return invoke('openCamera',p);},"
                    + "noteCardScan:function(t,p){post({m:t==='cardButton'?'cardButton':'cardPage',payload:p||''});}"
                    + "};})();";

    /**
     * File pages keep the JavascriptInterface. This wrapper adds the same
     * Promise methods the https shim exposes. It does not return a session.
     */
    private static final String FILE_CARD_SHIM =
            "(function(){if(window.__tspFileCardShim)return;var host=window.Android;if(!host||host.__tspWrapped)return;window.__tspFileCardShim=true;"
                    + "window.__tspPending=window.__tspPending||{};"
                    + "window.__tspComplete=function(msg){if(!msg||!msg.id)return;var pending=window.__tspPending[msg.id];if(!pending)return;delete window.__tspPending[msg.id];if(msg.ok)pending.resolve(msg.value);else pending.reject(new Error(msg.error||'Native request failed'));};"
                    + "function invoke(method,payload){return new Promise(function(resolve,reject){var id=String(Date.now())+'-'+Math.random().toString(16).slice(2);window.__tspPending[id]={resolve:resolve,reject:reject};var spec=payload&&typeof payload==='object'?payload:{};try{host.__startCardScan(JSON.stringify({m:method,requestId:id,payload:spec}));}catch(e){delete window.__tspPending[id];reject(e);}});}"
                    + "window.Android={__tspWrapped:true,"
                    + "showToast:function(m){return host.showToast(m);},"
                    + "saveSession:function(j){return host.saveSession(j);},"
                    + "clearSession:function(){return host.clearSession();},"
                    + "setBiometricEnabled:function(v){return host.setBiometricEnabled(v);},"
                    + "isBiometricEnabled:function(){return host.isBiometricEnabled();},"
                    + "canUseBiometric:function(){return host.canUseBiometric();},"
                    + "setPremiumStatus:function(p){return host.setPremiumStatus(p);},"
                    + "launchBillingFlow:function(s){return host.launchBillingFlow(s);},"
                    + "openUrl:function(u){return host.openUrl(u);},"
                    + "postOrgApi:function(p,o,b){return host.postOrgApi(p,o,b);},"
                    + "printReport:function(h,n){return host.printReport(h,n);},"
                    + "speak:function(t){return host.speak(t);},"
                    + "speakAnswer:function(t,v,e,a){return host.speakAnswer(t,v,e,a);},"
                    + "interruptSpeech:function(){return host.interruptSpeech();},"
                    + "stopSpeaking:function(){return host.stopSpeaking();},"
                    + "startVoiceRecognition:function(){return host.startVoiceRecognition();},"
                    + "stopVoiceRecognition:function(){return host.stopVoiceRecognition();},"
                    + "onCitationObserved:function(id,p){return host.onCitationObserved(id,p);},"
                    + "goBack:function(){return host.goBack();},"
                    + "captureCardImage:function(p){return invoke('captureCardImage',p);},"
                    + "openCamera:function(p){return invoke('openCamera',p);},"
                    + "noteCardScan:function(t,p){return host.noteCardScan(t,p);}"
                    + "};})();";

    private void injectOriginLockedShim(WebView view) {
        if (view == null) return;
        if (!TrustedOrigins.isFirstPartyAppPage(view.getUrl())) return;
        view.evaluateJavascript(ORIGIN_SHIM_JS, null);
    }

    private void injectFileCardShim(WebView view) {
        if (view == null || !TrustedOrigins.isBundledAsset(view.getUrl())) return;
        view.evaluateJavascript(FILE_CARD_SHIM, null);
    }

    private void injectCardScanPage(WebView view) {
        if (view == null || !TrustedOrigins.isSessionPage(view.getUrl())) return;
        if (cardScanScript == null) cardScanScript = assetText("AndroidCardScan.js");
        if (cardScanScript.isEmpty()) return;
        view.evaluateJavascript(
                "(function(){if(window.__tspCardScanInstalled)return;window.__tspCardScanInstalled=1;\n"
                        + cardScanScript + "\n})();",
                null);
    }

    private void beginCardScan(String body) {
        if (cardScanController == null || body == null || body.isEmpty()) return;
        try {
            org.json.JSONObject obj = new org.json.JSONObject(body);
            String method = obj.optString("m", "");
            if (!"captureCardImage".equals(method) && !"openCamera".equals(method)) return;
            String page = webView != null ? webView.getUrl() : mainFrameUrl;
            cardScanController.start(obj.optString("requestId", ""), obj.optJSONObject("payload"), page);
        } catch (Exception e) {
            Log.w(TAG, "card scan start rejected", e);
        }
    }

    private void completeCardScan(String requestId, boolean ok, String valueJson, String error) {
        if (webView == null || requestId == null || requestId.isEmpty()) return;
        try {
            org.json.JSONObject msg = new org.json.JSONObject();
            msg.put("id", requestId);
            msg.put("ok", ok);
            if (ok) {
                if (valueJson != null && !valueJson.isEmpty()) msg.put("value", new org.json.JSONObject(valueJson));
            } else {
                msg.put("error", error == null || error.isEmpty() ? "Card scan failed" : error);
            }
            String json = msg.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
            webView.evaluateJavascript("window.__tspComplete&&window.__tspComplete(" + json + ");", null);
        } catch (Exception e) {
            Log.w(TAG, "card scan reply failed", e);
        }
    }

    private boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        if (params == null) return false;
        String[] types = params.getAcceptTypes();
        if (types == null) return false;
        for (String type : types) {
            if (type == null) continue;
            String lower = type.trim().toLowerCase(Locale.US);
            if (lower.startsWith("image/") || "image".equals(lower)) return true;
        }
        return false;
    }

    private Intent cameraCaptureIntent() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File photo = new File(dir, "capture-" + System.currentTimeMillis() + ".jpg");
            Uri output = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (capture.resolveActivity(getPackageManager()) == null) return null;
            capture.putExtra(MediaStore.EXTRA_OUTPUT, output);
            capture.setClipData(android.content.ClipData.newRawUri("capture", output));
            capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pendingCameraUri = output;
            return capture;
        } catch (RuntimeException e) {
            pendingCameraUri = null;
            return null;
        }
    }

    /** Separate from the file-chooser capture so the two extras do not share a URI. */
    private Intent cardCameraIntent() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File photo = new File(dir, "card-" + System.currentTimeMillis() + ".jpg");
            Uri output = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (capture.resolveActivity(getPackageManager()) == null) {
                if (!photo.delete()) photo.deleteOnExit();
                return null;
            }
            capture.putExtra(MediaStore.EXTRA_OUTPUT, output);
            capture.setClipData(android.content.ClipData.newRawUri("card", output));
            capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pendingCardCameraUri = output;
            pendingCardCameraFile = photo;
            return capture;
        } catch (RuntimeException e) {
            pendingCardCameraUri = null;
            pendingCardCameraFile = null;
            return null;
        }
    }

    private void recoverFromRendererCrash() {
        if (recoveringRenderer || isDestroyed()) return;
        recoveringRenderer = true;
        try {
            for (int i = printPopups.size() - 1; i >= 0; i--) disposePrintPopup(printPopups.get(i));
            ConstraintLayout root = findViewById(R.id.main);
            WebView dead = webView;
            if (root == null || dead == null) return;
            int index = root.indexOfChild(dead);
            android.view.ViewGroup.LayoutParams params = dead.getLayoutParams();
            root.removeView(dead);
            WebView fresh = new WebView(this);
            fresh.setId(R.id.webView);
            if (index < 0) root.addView(fresh, params);
            else root.addView(fresh, index, params);
            webView = fresh;
            try {
                dead.destroy();
            } catch (RuntimeException ignored) {
            }
            bindWebView(fresh);
            String next = chooseStartUrl();
            if (!TrustedOrigins.isSessionPage(next)) next = homeUrl();
            navigateAfterWipe(next);
        } finally {
            recoveringRenderer = false;
        }
    }

    private void injectStoredSession(WebView view) {
        if (!sessionIsFresh()) return;
        if (view == null || !TrustedOrigins.isSessionPage(view.getUrl())) return;
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
        if (handEmailLinkToBrowser(uri.toString())) return;
        if (TrustedOrigins.isAuthCallback(uri.toString()) && callbackCarriesCredential(uri)) {
            if (!allowCredentialCallback(uri)) return;
            if ("totalservicepro".equalsIgnoreCase(scheme)) {
                pendingLaunchUrl = productionAuthCallbackUrl(uri);
            } else {
                pendingLaunchUrl = uri.toString();
            }
            acceptedAuthNavigation = pendingLaunchUrl;
            rememberSessionFromAuthUri(uri);
            return;
        }
        if ("https".equalsIgnoreCase(scheme)
                && TrustedOrigins.isFirstPartyAppPage(uri.toString())
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
            persistStoredSession();
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
        new Thread(() -> requestGrokTts(spoken, voiceId, token, gen, false, false), "grok-tts").start();
    }

    /**
     * shortened: already retried a text_too_long response once.
     * omitVoice: already retried a 400 invalid_voice_id once, with voice_id left off
     * so grok-tts applies its own default.
     */
    private void requestGrokTts(String text, String voiceId, String token, int gen, boolean shortened, boolean omitVoice) {
        if (gen != speechGeneration) return;
        if (token == null || token.isEmpty()) {
            runOnUiThread(() -> fallbackToDevice(text, gen, false));
            return;
        }
        HttpURLConnection conn = null;
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("text", text);
            if (!omitVoice) payload.put("voice_id", GrokSpeech.normalizeVoiceId(voiceId));
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
            if ("invalid_voice".equals(kind) && !omitVoice) {
                requestGrokTts(text, voiceId, token, gen, shortened, true);
                return;
            }
            if ("too_long".equals(kind) && !shortened) {
                int max = GrokSpeech.maxCharacters(body);
                int limit = max > 0 ? Math.min(max, Math.max(1, text.length() - 1)) : Math.max(1, text.length() - 1);
                String shorter = GrokSpeech.clipSpeechText(text, limit);
                if (!shorter.isEmpty() && shorter.length() < text.length()) {
                    runOnUiThread(() -> {
                        if (gen == speechGeneration) {
                            Toast.makeText(MainActivity.this, GrokSpeech.SHORTENED_NOTICE, Toast.LENGTH_SHORT).show();
                        }
                    });
                    requestGrokTts(shorter, voiceId, token, gen, true, omitVoice);
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

    /** Access token for purchase verification. Empty when there is no session. */
    public String getAccessToken() {
        return storedAccessToken();
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

    /**
     * window.print() is a no-op in WebView. Override it on each document so
     * the live site's Print buttons reach PrintManager. Blank popups
     * (window.open('') + document.write + print) also get the override
     * reapplied after document.write, which can replace the child document.
     * Real http(s) window.open targets are not printed here.
     */
    private static final String PRINT_HOOK_JS =
            "(function(){"
                    + "function hookPrint(win){"
                    + "if(!win)return;"
                    + "function reportNumber(){"
                    + "try{"
                    + "var path=(location&&location.pathname)||'';"
                    + "var id=path.match(/\\/reports\\/([^\\/?#]+)/);"
                    + "if(id&&id[1]&&id[1]!=='new')return decodeURIComponent(id[1]);"
                    + "var labels=document.querySelectorAll('label');"
                    + "for(var i=0;i<labels.length;i++){"
                    + "var text=(labels[i].innerText||'').replace(/\\s+/g,' ').trim();"
                    + "if(!text||text.length>48)continue;"
                    + "var input=labels[i].querySelector('input');"
                    + "if(!input&&labels[i].htmlFor)input=document.getElementById(labels[i].htmlFor);"
                    + "if(!input||!(input.value||'').trim())continue;"
                    + "if(/report|informe|rapport|bericht|relat|rapporto|דוח|گزارش|تقرير|#/i.test(text))return input.value.trim();"
                    + "}"
                    + "var marked=document.querySelector('input[placeholder*=\"SR-\"]');"
                    + "if(marked&&(marked.value||'').trim())return marked.value.trim();"
                    + "}catch(e){}"
                    + "return '';"
                    + "}"
                    + "try{win.print=function(){"
                    + "var payload={title:'',reportNumber:'',path:''};"
                    + "try{payload.title=(win.document&&win.document.title)||'';}catch(e){}"
                    + "try{payload.reportNumber=reportNumber();}catch(e){}"
                    + "try{payload.path=(win.location&&win.location.pathname)||'';}catch(e){}"
                    + "try{if(win.__tspPrintTimer){win.clearInterval(win.__tspPrintTimer);win.__tspPrintTimer=0;}}catch(e){}"
                    + "var body=JSON.stringify(payload);"
                    + "try{if(win.tspNative&&win.tspNative.postMessage){win.tspNative.postMessage(JSON.stringify({m:'printPage',title:payload.title,reportNumber:payload.reportNumber,path:payload.path}));return;}}catch(e){}"
                    + "try{if(win.TSPPrint&&win.TSPPrint.printPage)win.TSPPrint.printPage(body);}catch(e){}"
                    + "};}catch(e){}"
                    + "}"
                    + "function arm(win){"
                    + "hookPrint(win);"
                    + "try{"
                    + "if(win.__tspPrintTimer)return;"
                    + "var tries=0;"
                    + "win.__tspPrintTimer=win.setInterval(function(){"
                    + "tries++;hookPrint(win);"
                    + "if(tries>25){try{win.clearInterval(win.__tspPrintTimer);}catch(e){}win.__tspPrintTimer=0;}"
                    + "},100);"
                    + "}catch(e){}"
                    + "}"
                    + "arm(window);"
                    + "if(window.__tspOpenWrapped)return;"
                    + "window.__tspOpenWrapped=true;"
                    + "var nativeOpen=window.open;"
                    + "if(typeof nativeOpen!=='function')return;"
                    + "window.open=function(url,target,features){"
                    + "var child;try{child=nativeOpen.call(window,url,target,features);}catch(e){return null;}"
                    + "var blank=(url==null||url===''||String(url)==='about:blank');"
                    + "if(!child||!blank)return child;"
                    + "function rearm(){"
                    + "try{if(child.__tspPrintTimer)child.clearInterval(child.__tspPrintTimer);}catch(e){}"
                    + "try{child.__tspPrintTimer=0;}catch(e){}"
                    + "arm(child);"
                    + "}"
                    + "rearm();"
                    + "try{"
                    + "var doc=child.document;"
                    + "if(doc&&!doc.__tspWriteWrapped){"
                    + "doc.__tspWriteWrapped=true;"
                    + "var origWrite=doc.write&&doc.write.bind(doc);"
                    + "var origWriteln=doc.writeln&&doc.writeln.bind(doc);"
                    + "var origClose=doc.close&&doc.close.bind(doc);"
                    + "var origOpen=doc.open&&doc.open.bind(doc);"
                    + "if(origWrite)doc.write=function(){var r;try{r=origWrite.apply(null,arguments);}finally{rearm();}return r;};"
                    + "if(origWriteln)doc.writeln=function(){var r;try{r=origWriteln.apply(null,arguments);}finally{rearm();}return r;};"
                    + "if(origClose)doc.close=function(){var r;try{r=origClose.apply(null,arguments);}finally{rearm();}return r;};"
                    + "if(origOpen)doc.open=function(){var r;try{r=origOpen.apply(null,arguments);}finally{rearm();}return r;};"
                    + "}"
                    + "}catch(e){}"
                    + "return child;"
                    + "};"
                    + "})();";

    private void injectPrintHook(WebView view) {
        if (view == null) return;
        view.evaluateJavascript(PRINT_HOOK_JS, null);
    }

    /**
     * target=_blank links carry the URL on the hit test. Script window.open('')
     * does not, so those become a child WebView that can be printed.
     * Returning false makes window.open return null ("Pop-up blocked").
     */
    private boolean openPopupWindow(WebView opener, Message resultMsg) {
        if (resultMsg == null) return false;
        WebView.HitTestResult hit = opener == null ? null : opener.getHitTestResult();
        String extra = hit == null ? null : hit.getExtra();
        if (isDirectNavigationUrl(extra)) {
            navigateInWebView(extra);
            return false;
        }
        WebView child = createPrintPopupWebView();
        Object transportObj = resultMsg.obj;
        if (!(transportObj instanceof WebView.WebViewTransport)) {
            disposePrintPopup(child);
            return false;
        }
        ((WebView.WebViewTransport) transportObj).setWebView(child);
        resultMsg.sendToTarget();
        return true;
    }

    private boolean isDirectNavigationUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.startsWith("https://") || lower.startsWith("http://")
                || lower.startsWith("mailto:") || lower.startsWith("tel:")
                || lower.startsWith("geo:") || lower.startsWith("intent:")
                || lower.startsWith("market:");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createPrintPopupWebView() {
        WebView child = new WebView(this);
        WebSettings settings = child.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        if (webView != null) {
            settings.setUserAgentString(webView.getSettings().getUserAgentString());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(child, true);
        child.setBackgroundColor(Color.WHITE);
        child.addJavascriptInterface(new PrintBridge(child, true), "TSPPrint");
        installOriginLockedListener(child);
        installDocumentStartShim(child);
        child.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                String url = request.getUrl().toString();
                if (!request.isForMainFrame()) {
                    if (isGeoUrl(url)) {
                        openGeoOrMaps(url);
                        return true;
                    }
                    return !TrustedOrigins.subframeMayLoad(url);
                }
                return handlePopupNavigation(view, request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handlePopupNavigation(view, url == null ? null : Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (url == null) return;
                String shown = view.getUrl();
                if (shown != null && (TrustedOrigins.isSessionPage(shown) || isInlineDocumentUrl(shown))
                        && !shown.equals(url)
                        && !TrustedOrigins.isSessionPage(url)
                        && !isInlineDocumentUrl(url)) {
                    return;
                }
                if (TrustedOrigins.isSessionPage(url) || isInlineDocumentUrl(url)) return;
                view.stopLoading();
                runOnUiThread(() -> {
                    navigateInWebView(url);
                    disposePrintPopup(view);
                });
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                String main = view.getUrl();
                if (url != null && main != null && !url.equals(main)) return;
                String page = main != null ? main : url;
                if (TrustedOrigins.isSessionPage(page) || isInlineDocumentUrl(page)) {
                    injectPrintHook(view);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> disposePrintPopup(view));
                return true;
            }
        });
        child.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return openPopupWindow(view, resultMsg);
            }

            @Override
            public void onCloseWindow(WebView window) {
                disposePrintPopup(window);
            }
        });
        attachPrintPopup(child);
        return child;
    }

    private boolean handlePopupNavigation(WebView popup, Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        String lower = scheme.toLowerCase(Locale.US);
        if ("about".equals(lower) || "data".equals(lower) || "blob".equals(lower) || "javascript".equals(lower)) {
            return false;
        }
        String url = uri.toString();
        runOnUiThread(() -> {
            navigateInWebView(url);
            disposePrintPopup(popup);
        });
        return true;
    }

    /**
     * The child stays attached at full size so createPrintDocumentAdapter has
     * a laid-out document, but behind the main page until we know it is a
     * preview. Print runs at ~400ms; previews never call print, so they are
     * brought forward after that window. Invoice and estimate previews use
     * the same window.open + document.write path and must stay visible.
     */
    private void attachPrintPopup(WebView child) {
        ConstraintLayout root = findViewById(R.id.main);
        if (root == null) return;
        child.setTag(new PopupState());
        int id = View.generateViewId();
        child.setId(id);
        child.setFocusable(false);
        child.setFocusableInTouchMode(false);
        child.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        root.addView(child, 0, new ConstraintLayout.LayoutParams(0, 0));
        ConstraintSet set = new ConstraintSet();
        set.clone(root);
        set.connect(id, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP);
        set.connect(id, ConstraintSet.BOTTOM, ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM);
        set.connect(id, ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
        set.connect(id, ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
        set.applyTo(root);
        printPopups.add(child);
        restackPrintPopups();
        child.postDelayed(() -> revealPrintPopupIfPreview(child), 1500);
    }

    private void revealPrintPopupIfPreview(WebView child) {
        if (isDestroyed() || child.getParent() == null) return;
        if (!(child.getTag() instanceof PopupState)) return;
        PopupState state = (PopupState) child.getTag();
        if (state.printRequested || state.revealed) return;
        state.revealed = true;
        child.setFocusable(true);
        child.setFocusableInTouchMode(true);
        child.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        restackPrintPopups();
    }

    private void restackPrintPopups() {
        if (webView != null) webView.bringToFront();
        for (int i = 0; i < printPopups.size(); i++) {
            WebView child = printPopups.get(i);
            if (child.getTag() instanceof PopupState && ((PopupState) child.getTag()).revealed) {
                child.bringToFront();
            }
        }
        if (bottomNav != null && bottomNav.getVisibility() == View.VISIBLE) {
            bottomNav.bringToFront();
        }
    }

    private boolean closeTopPrintPreview() {
        for (int i = printPopups.size() - 1; i >= 0; i--) {
            WebView child = printPopups.get(i);
            if (!(child.getTag() instanceof PopupState)) continue;
            PopupState state = (PopupState) child.getTag();
            if (state.revealed && !state.printRequested) {
                disposePrintPopup(child);
                return true;
            }
        }
        return false;
    }

    private static final Object POPUP_DESTROYED = new Object();

    private void disposePrintPopup(WebView child) {
        if (child == null || child.getTag() == POPUP_DESTROYED) return;
        child.setTag(POPUP_DESTROYED);
        printPopups.remove(child);
        if (child.getParent() instanceof ViewGroup) {
            ((ViewGroup) child.getParent()).removeView(child);
        }
        try {
            child.stopLoading();
            child.setWebChromeClient(null);
            child.setWebViewClient(null);
            child.destroy();
        } catch (RuntimeException ignored) {
        }
    }

    private void printWebView(WebView target, String jobName, boolean disposeAfterPrint) {
        if (target == null || target.getTag() == POPUP_DESTROYED || isFinishing() || isDestroyed()) return;
        if (target.getTag() instanceof PopupState) {
            PopupState state = (PopupState) target.getTag();
            if (state.printRequested) return;
            state.printRequested = true;
        }
        String title = jobName;
        String reportNumber = null;
        String path = null;
        if (jobName != null && jobName.startsWith("{")) {
            try {
                org.json.JSONObject payload = new org.json.JSONObject(jobName);
                if (payload.has("m") && payload.has("title")) {
                    title = payload.optString("title", "");
                    reportNumber = payload.optString("reportNumber", "");
                    path = payload.optString("path", "");
                } else if (payload.has("title") || payload.has("reportNumber") || payload.has("path")) {
                    title = payload.optString("title", "");
                    reportNumber = payload.optString("reportNumber", "");
                    path = payload.optString("path", "");
                }
            } catch (Exception ignored) {
            }
        }
        String name = PrintJobs.jobName(title, reportNumber, path, System.currentTimeMillis(), TimeZone.getDefault());
        PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
        if (printManager == null) {
            Toast.makeText(this, "Printing is not available on this device.", Toast.LENGTH_LONG).show();
            if (disposeAfterPrint) disposePrintPopup(target);
            return;
        }
        PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
        PrintDocumentAdapter adapter = target.createPrintDocumentAdapter(name);
        if (disposeAfterPrint) {
            adapter = new FinishingPrintAdapter(adapter, () -> runOnUiThread(() -> {
                if (!isDestroyed()) disposePrintPopup(target);
            }));
        }
        try {
            printManager.print(name, adapter, attributes);
        } catch (RuntimeException e) {
            Log.e(TAG, "Print failed", e);
            Toast.makeText(this, "Print failed.", Toast.LENGTH_LONG).show();
            if (disposeAfterPrint) disposePrintPopup(target);
        }
    }

    private static final class PopupState {
        boolean printRequested;
        boolean revealed;
    }

    /**
     * Bound as TSPPrint. Returns nothing. The popup needs it for about:blank
     * documents that are not an allowed WebMessageListener origin. On the main
     * WebView it runs only for bundled file pages; https pages print through tspNative.
     */
    private final class PrintBridge {
        private final WebView target;
        private final boolean disposeAfterPrint;

        PrintBridge(WebView target, boolean disposeAfterPrint) {
            this.target = target;
            this.disposeAfterPrint = disposeAfterPrint;
        }

        @JavascriptInterface
        public void printPage(String jobName) {
            if (disposeAfterPrint) {
                if (!originAllowsPrint(target)) return;
            } else if (!TrustedOrigins.isBundledAsset(urlOnUiThread(webView))) {
                return;
            }
            runOnUiThread(() -> printWebView(target, jobName, disposeAfterPrint));
        }
    }

    /** Holds the child WebView until the spooler finishes, then drops it. */
    private static final class FinishingPrintAdapter extends PrintDocumentAdapter {
        private final PrintDocumentAdapter delegate;
        private final Runnable onFinish;

        FinishingPrintAdapter(PrintDocumentAdapter delegate, Runnable onFinish) {
            this.delegate = delegate;
            this.onFinish = onFinish;
        }

        @Override
        public void onStart() {
            delegate.onStart();
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             CancellationSignal cancellationSignal, LayoutResultCallback callback,
                             Bundle extras) {
            delegate.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            CancellationSignal cancellationSignal, WriteResultCallback callback) {
            delegate.onWrite(pages, destination, cancellationSignal, callback);
        }

        @Override
        public void onFinish() {
            try {
                delegate.onFinish();
            } finally {
                if (onFinish != null) onFinish.run();
            }
        }
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
        for (int i = printPopups.size() - 1; i >= 0; i--) {
            disposePrintPopup(printPopups.get(i));
        }
        sessionHandler.removeCallbacks(sessionRefreshTask);
        sessionHandler.removeCallbacks(biometricGateTask);
        sessionHandler.removeCallbacks(lockForBackgroundTask);
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
