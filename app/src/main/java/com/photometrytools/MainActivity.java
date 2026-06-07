package com.photometrytools;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.media.MediaScannerConnection;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;

import java.io.File;
import java.io.FileOutputStream;

import androidx.annotation.NonNull;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.MobileAds;
import com.google.android.material.bottomnavigation.BottomNavigationView;

import java.util.Locale;
import java.util.concurrent.Executor;

import io.github.cdimascio.dotenv.Dotenv;
import io.github.jan.supabase.createSupabaseClient;
import io.github.jan.supabase.SupabaseClient;
import io.github.jan.supabase.postgrest.Postgrest;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private AdView adView;
    private BottomNavigationView bottomNav;

    private TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private boolean ttsReady = false;

    private String storedSession = null;

    private static final int RECORD_AUDIO_PERMISSION_CODE = 200;
    private boolean biometricEnabled = false;
    private BiometricPrompt biometricPrompt;
    private BiometricPrompt.PromptInfo promptInfo;
    private static final String TAG = "PhotometryTools";
    private static final String PREFS_NAME = "TSPPrefs";
    private static final String PREFS_SESSION_KEY = "storedSession";
    private static final String PREFS_LAST_URL = "last_url";
    private static final String PREFS_BIOMETRIC_KEY = "biometricEnabled";

    // ==================== SUPABASE ====================
    private SupabaseClient supabaseClient;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Initialize Supabase
        initializeSupabase();

        // Restore session immediately on create
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        storedSession = prefs.getString(PREFS_SESSION_KEY, null);
        biometricEnabled = prefs.getBoolean(PREFS_BIOMETRIC_KEY, false);
        if (biometricEnabled && !canAuthenticateWithBiometrics()) {
            biometricEnabled = false;
            prefs.edit().putBoolean(PREFS_BIOMETRIC_KEY, false).apply();
        }

        MobileAds.initialize(this, initializationStatus -> {});
        adView = findViewById(R.id.adView);
        if (adView != null) {
            adView.loadAd(new AdRequest.Builder().build());
        }

        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                textToSpeech.setLanguage(Locale.US);
                ttsReady = true;
            }
        });

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);

        if (biometricEnabled && canAuthenticateWithBiometrics() && storedSession != null && !storedSession.isEmpty()) {
            showBiometricPrompt(() -> loadApp());
        } else {
            loadApp();
        }
    }

    // ==================== SUPABASE SETUP (Java compatible) ====================
    private void initializeSupabase() {
        try {
            Dotenv dotenv = Dotenv.configure()
                    .directory(getApplicationContext().getFilesDir().getParent())
                    .load();

            String supabaseUrl = dotenv.get("SUPABASE_URL");
            String supabaseKey = dotenv.get("SUPABASE_ANON_KEY");

            if (supabaseUrl == null || supabaseKey == null) {
                Log.e(TAG, "Supabase URL or key missing from .env");
                return;
            }

            // Java-friendly initialization
            supabaseClient = createSupabaseClient(supabaseUrl, supabaseKey, builder -> {
                builder.install(Postgrest.INSTANCE);
                // builder.install(Auth.INSTANCE);      // uncomment when needed
                // builder.install(Storage.INSTANCE);   // uncomment when needed
                return null;
            });

            Log.d(TAG, "✅ Supabase client initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize Supabase", e);
        }
    }

    // ==================== SESSION HANDLING ====================
    @Override
    protected void onPause() {
        super.onPause();
        if (adView != null) adView.pause();

        if (webView != null && webView.getUrl() != null) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREFS_LAST_URL, webView.getUrl())
                    .apply();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (adView != null) adView.resume();
    }

    // ==================== BOTTOM NAV ====================
    private void updateBottomNavVisibilityAndSelection(String url) {
        if (bottomNav == null) return;

        String page = url.substring(url.lastIndexOf("/") + 1).replace(".html", "").toLowerCase();

        boolean show = page.contains("manual_library") || page.contains("reports_list") ||
                page.contains("settings") || page.contains("calculators_menu");

        bottomNav.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private final BottomNavigationView.OnItemSelectedListener navListener = item -> {
        int id = item.getItemId();
        String asset = null;
        if (id == R.id.nav_home) asset = "index.html";
        else if (id == R.id.nav_calc) asset = "calculators_menu.html";
        else if (id == R.id.nav_reports) asset = "reports_list.html";
        else if (id == R.id.nav_ai) asset = "ai_assistant.html";

        if (asset != null) {
            String base = "file:///android_asset/" + asset;
            String param = getSessionUrlParam();
            webView.loadUrl(param != null ? base + "?" + param : base);
        }
        return true;
    };

    // ==================== JAVASCRIPT INTERFACE ====================
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
        public void speak(String text) {
            if (ttsReady && textToSpeech != null) {
                textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tts");
            }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                showToast("Could not open link: " + e.getMessage());
            }
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
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                            generateAndSavePdfDirectly(view, jobName);
                        }, 300);
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

                Uri uri = Uri.fromFile(pdfFile);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/pdf");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);

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
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Fingerprint not recognized. Try again or use PIN.", Toast.LENGTH_SHORT).show());
            }
        });

        promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Photometry Tools")
                .setSubtitle("Use your fingerprint to sign in")
                .setNegativeButtonText("Use Password / PIN")
                .build();

        biometricPrompt.authenticate(promptInfo);
    }

    private void loadApp() {
        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

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

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                updateBottomNavVisibilityAndSelection(url);

                if (storedSession != null && !storedSession.isEmpty()) {
                    view.evaluateJavascript(
                            "(function(){" +
                                    "try{" +
                                    "if(typeof Android !== 'undefined' && typeof Android.getStoredSession === 'function'){" +
                                    "var sessStr = Android.getStoredSession();" +
                                    "if(sessStr){" +
                                    "try{localStorage.setItem('tsp-auth-token', sessStr);}catch(e){}" +
                                    "if(typeof restoreSession === 'function'){" +
                                    "restoreSession(sessStr);" +
                                    "}" +
                                    "}" +
                                    "}" +
                                    "}catch(e){}" +
                                    "})();",
                            null
                    );
                }
            }
        });

        bottomNav = findViewById(R.id.bottom_navigation);
        if (bottomNav != null) {
            bottomNav.setOnItemSelectedListener(navListener);
        }

        webView.loadUrl("file:///android_asset/index.html");
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