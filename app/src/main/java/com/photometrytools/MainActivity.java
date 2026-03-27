package com.photometrytools;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.MobileAds;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends AppCompatActivity implements BillingManager.BillingCallback {

    private WebView webView;
    private AdView adView;
    private BottomNavigationView bottomNav;
    private TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private boolean ttsReady = false;
    private boolean isListening = false;

    // ── Native session storage — survives page reloads within the app ──
    private String storedSession = null;

    // ── Billing ───────────────────────────────────────────────────────
    private BillingManager billingManager;

    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE  = 300;
    private static final int RECORD_AUDIO_PERMISSION_CODE = 200;
    private static final String TAG = "PhotometryTools";

    private static final String PREFS_NAME = "TSPPrefs";
    private static final String PREFS_SESSION_KEY = "storedSession";
    private static final String PREFS_EXIT_CONFIRM_ENABLED_KEY = "exitConfirmEnabled";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // ── Restore session from SharedPreferences on app launch ──────
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        storedSession = prefs.getString(PREFS_SESSION_KEY, null);
        if (storedSession != null) {
            Log.d(TAG, "TSP: session restored from SharedPreferences");
        }

        // Initialize Mobile Ads
        MobileAds.initialize(this, initializationStatus -> {});
        adView = findViewById(R.id.adView);
        if (adView != null) {
            AdRequest adRequest = new AdRequest.Builder().build();
            adView.loadAd(adRequest);
        }

        // ── Initialize BillingManager ─────────────────────────────────
        billingManager = new BillingManager(this, this);

        // Initialize TextToSpeech
        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int result = textToSpeech.setLanguage(Locale.US);
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    Log.e(TAG, "TTS Language not supported");
                    ttsReady = false;
                } else {
                    Log.d(TAG, "TTS initialized successfully");
                    ttsReady = true;
                    textToSpeech.setSpeechRate(0.9f);
                    textToSpeech.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) { Log.d(TAG, "TTS started"); }
                        @Override public void onDone(String utteranceId) {
                            Log.d(TAG, "TTS finished");
                            runOnUiThread(() -> webView.evaluateJavascript("if(window.onTTSComplete) window.onTTSComplete();", null));
                        }
                        @Override public void onError(String utteranceId) { Log.e(TAG, "TTS error"); }
                    });
                }
            } else {
                Log.e(TAG, "TTS initialization failed");
                ttsReady = false;
            }
        });

        // Initialize Speech Recognizer
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                Log.d(TAG, "Ready for speech");
                runOnUiThread(() -> webView.evaluateJavascript("if(window.onSpeechReady) window.onSpeechReady();", null));
            }
            @Override public void onBeginningOfSpeech() { Log.d(TAG, "Speech started"); }
            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { Log.d(TAG, "Speech ended"); isListening = false; }
            @Override
            public void onError(int error) {
                Log.e(TAG, "Speech error: " + error);
                isListening = false;
                String msg = "";
                switch (error) {
                    case SpeechRecognizer.ERROR_AUDIO: msg = "Audio error"; break;
                    case SpeechRecognizer.ERROR_CLIENT: msg = "Client error"; break;
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: msg = "Permission denied"; break;
                    case SpeechRecognizer.ERROR_NETWORK: msg = "Network error"; break;
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: msg = "Network timeout"; break;
                    case SpeechRecognizer.ERROR_NO_MATCH: msg = "No match"; break;
                    case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: msg = "Recognizer busy"; break;
                    case SpeechRecognizer.ERROR_SERVER: msg = "Server error"; break;
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: msg = "No speech"; break;
                }
                final String finalMsg = msg;
                runOnUiThread(() -> webView.evaluateJavascript("if(window.onSpeechError) window.onSpeechError('" + finalMsg + "');", null));
            }
            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String text = matches.get(0);
                    Log.d(TAG, "Recognized: " + text);
                    final String escaped = text.replace("'", "\\'").replace("\"", "\\\"");
                    runOnUiThread(() -> webView.evaluateJavascript("if(window.onSpeechResult) window.onSpeechResult('" + escaped + "');", null));
                }
                isListening = false;
            }
            @Override public void onPartialResults(Bundle partialResults) { }
            @Override public void onEvent(int eventType, Bundle params) { }
        });

        // WebView setup
        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        }

        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "WebView: " + cm.message() + " -- From line " + cm.lineNumber() + " of " + cm.sourceId());
                return true;
            }
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String r : request.getResources()) {
                        if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            } else {
                                request.deny();
                                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_AUDIO_PERMISSION_CODE);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                Intent galleryIntent = new Intent(Intent.ACTION_PICK);
                galleryIntent.setType("image/*");
                Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                Intent chooserIntent = Intent.createChooser(galleryIntent, "Select Photo");
                chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
                startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE);
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                updateBottomNavVisibilityAndSelection(url);

                // ── Restore Supabase session from native storage ──
                if (storedSession != null && !storedSession.isEmpty()) {
                    String escaped = storedSession.replace("\\", "\\\\").replace("'", "\\'");
                    // 1) Write to localStorage so Supabase persistence can find it
                    String jsLocalStorage = "try { " +
                            "localStorage.setItem('tsp-auth-token', '" + escaped + "'); " +
                            "console.log('TSP: session written to localStorage for ' + window.location.pathname); " +
                            "} catch(e) { console.log('TSP localStorage restore error: ' + e); }";
                    view.evaluateJavascript(jsLocalStorage, null);

                    // 2) Call restoreSession() to force Supabase.auth.setSession()
                    //    This is critical — localStorage alone won't work because
                    //    Supabase already initialized before onPageFinished fires.
                    String jsRestore = "try { " +
                            "if(typeof restoreSession === 'function') { " +
                            "  restoreSession('" + escaped + "'); " +
                            "} else { " +
                            "  console.log('TSP: restoreSession not available on this page'); " +
                            "} " +
                            "} catch(e) { console.log('TSP restoreSession call error: ' + e); }";
                    view.evaluateJavascript(jsRestore, null);
                }

                // Show/hide back button based on WebView history
                boolean canGoBack = webView.canGoBack();
                view.evaluateJavascript(
                        "if(document.getElementById('back-btn')) document.getElementById('back-btn').style.display='" + (canGoBack ? "block" : "none") + "';",
                        null
                );
            }
        });

        // Bottom Navigation
        bottomNav = findViewById(R.id.bottom_navigation);
        if (bottomNav != null) {
            bottomNav.setOnItemSelectedListener(navListener);
        }

        webView.loadUrl("file:///android_asset/index.html");

        if (!checkMicrophonePermission()) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_AUDIO_PERMISSION_CODE);
        }

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            int bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            if (bottomNav != null) bottomNav.setPadding(0, 0, 0, bottom);
            return insets;
        });
    }

    // ── BillingCallback implementation ────────────────────────────────
    @Override
    public void onPurchaseSuccess(String tier, String sku) {
        Log.d(TAG, "Purchase success: tier=" + tier + " sku=" + sku);
        runOnUiThread(() -> {
            // Notify the WebView so the paywall can dismiss and unlock the feature
            String js = "if(window.onPurchaseSuccess) window.onPurchaseSuccess('" + tier + "', '" + sku + "');";
            webView.evaluateJavascript(js, null);
            Toast.makeText(this, "Subscription activated! Welcome to " + tier + ".", Toast.LENGTH_LONG).show();
        });
    }

    @Override
    public void onPurchaseFailed(String message) {
        Log.e(TAG, "Purchase failed: " + message);
        runOnUiThread(() -> {
            String escaped = message.replace("'", "\\'");
            String js = "if(window.onPurchaseFailed) window.onPurchaseFailed('" + escaped + "');";
            webView.evaluateJavascript(js, null);
        });
    }

    @Override
    public void onBillingReady() {
        Log.d(TAG, "Billing ready — will check subscriptions after session load");
        // Delay check by 3 seconds to ensure session is restored before verifying
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            if (billingManager != null) {
                billingManager.checkExistingSubscription();
            }
        }, 3000);
    }

    // ── getAccessToken: called by BillingManager to get JWT ──────────
    public String getAccessToken() {
        if (storedSession == null || storedSession.isEmpty()) return "";
        try {
            org.json.JSONObject sessionObj = new org.json.JSONObject(storedSession);
            // storedSession is the full Supabase storage object:
            // { currentSession: { access_token: "...", ... } }
            if (sessionObj.has("currentSession")) {
                return sessionObj.getJSONObject("currentSession").optString("access_token", "");
            }
            // Fallback: session stored directly
            return sessionObj.optString("access_token", "");
        } catch (Exception e) {
            Log.e(TAG, "getAccessToken parse error: " + e.getMessage());
            return "";
        }
    }

    // ── WebAppInterface ───────────────────────────────────────────────
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    private final BottomNavigationView.OnItemSelectedListener navListener = item -> {
        int id = item.getItemId();
        if (id == R.id.nav_fluence) {
            webView.loadUrl("file:///android_asset/fluence.html");
        } else if (id == R.id.nav_irradiance) {
            webView.loadUrl("file:///android_asset/irradiance.html");
        } else if (id == R.id.nav_wavelength) {
            webView.loadUrl("file:///android_asset/wavelength.html");
        } else if (id == R.id.nav_duty_cycle) {
            webView.loadUrl("file:///android_asset/duty_cycle.html");
        } else if (id == R.id.nav_avg_power) {
            webView.loadUrl("file:///android_asset/avgpower.html");
        }
        return true;
    };

    private void updateBottomNavVisibilityAndSelection(String url) {
        if (bottomNav == null) return;
        String page = url.substring(url.lastIndexOf("/") + 1).replace(".html", "").toLowerCase();
        boolean isHomeOrHub = page.contains("index") ||
                page.contains("service_hub") ||
                page.contains("coming_soon") ||
                page.contains("service_report") ||
                page.contains("marketplace") ||
                page.contains("service_manuals") ||
                page.contains("manual_library") ||
                page.contains("pdf_viewer") ||
                page.contains("service_schedule") ||
                page.contains("user_profile") ||
                page.contains("company_profile") ||
                page.contains("customer_profile") ||
                page.contains("customer_directory") ||
                page.contains("parts_catalog") ||
                page.contains("paywall") ||
                page.contains("settings");

        bottomNav.setVisibility(isHomeOrHub ? View.GONE : View.VISIBLE);
        if (isHomeOrHub) return;

        // Ensure all items are visible and reflect the current page.
        for (int i = 0; i < bottomNav.getMenu().size(); i++) {
            bottomNav.getMenu().getItem(i).setVisible(true);
        }

        if (page.contains("fluence")) {
            bottomNav.getMenu().findItem(R.id.nav_fluence).setChecked(true);
        } else if (page.contains("irradiance")) {
            bottomNav.getMenu().findItem(R.id.nav_irradiance).setChecked(true);
        } else if (page.contains("wavelength")) {
            bottomNav.getMenu().findItem(R.id.nav_wavelength).setChecked(true);
        } else if (page.contains("duty_cycle") || page.contains("dutycycle")) {
            bottomNav.getMenu().findItem(R.id.nav_duty_cycle).setChecked(true);
        } else if (page.contains("avgpower") || page.contains("avg_power")) {
            bottomNav.getMenu().findItem(R.id.nav_avg_power).setChecked(true);
        }
    }

    public class WebAppInterface {

        @JavascriptInterface
        public void showToast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        // ── Session persistence ───────────────────────────────────────
        @JavascriptInterface
        public void saveSession(String sessionJson) {
            storedSession = sessionJson;
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString(PREFS_SESSION_KEY, sessionJson).apply();
            Log.d(TAG, "TSP: session saved to native storage");

            // Session is now available; retry subscription verification for existing purchases.
            try {
                if (billingManager != null) billingManager.checkExistingSubscription();
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void clearSession() {
            storedSession = null;
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().remove(PREFS_SESSION_KEY).apply();
            Log.d(TAG, "TSP: session cleared from native storage");
        }

        @JavascriptInterface
        public boolean getExitConfirmEnabled() {
            return getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .getBoolean(PREFS_EXIT_CONFIRM_ENABLED_KEY, true);
        }

        @JavascriptInterface
        public void setExitConfirmEnabled(boolean enabled) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putBoolean(PREFS_EXIT_CONFIRM_ENABLED_KEY, enabled)
                    .apply();
        }

        // ── Billing bridge ────────────────────────────────────────────
        // Called from paywall.html: Android.launchBillingFlow('premium_monthly')
        @JavascriptInterface
        public void launchBillingFlow(String sku) {
            runOnUiThread(() -> {
                if (billingManager != null) {
                    billingManager.launchBillingFlow(MainActivity.this, sku);
                } else {
                    Toast.makeText(MainActivity.this, "Billing not available. Please try again.", Toast.LENGTH_SHORT).show();
                }
            });
        }

        // Called from any page to check current tier
        @JavascriptInterface
        public void checkSubscription() {
            if (billingManager != null) {
                billingManager.checkExistingSubscription();
            }
        }

        // ── TTS / Voice ───────────────────────────────────────────────
        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> {
                if (ttsReady && textToSpeech != null) {
                    textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "grok_" + System.currentTimeMillis());
                }
            });
        }

        @JavascriptInterface
        public void startVoiceRecognition() {
            runOnUiThread(() -> {
                if (!checkMicrophonePermission()) {
                    ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_AUDIO_PERMISSION_CODE);
                    return;
                }
                if (isListening) return;
                isListening = true;
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                try {
                    speechRecognizer.startListening(intent);
                } catch (Exception e) {
                    isListening = false;
                    webView.evaluateJavascript("if(window.onSpeechError) window.onSpeechError('Failed to start');", null);
                }
            });
        }

        @JavascriptInterface
        public void stopVoiceRecognition() {
            runOnUiThread(() -> {
                if (isListening && speechRecognizer != null) {
                    speechRecognizer.stopListening();
                    isListening = false;
                }
            });
        }

        @JavascriptInterface
        public void goBack() {
            runOnUiThread(() -> {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    webView.loadUrl("file:///android_asset/index.html");
                }
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
            });
        }

        @JavascriptInterface
        public void showLoginPopup() {
            runOnUiThread(() -> webView.evaluateJavascript("showLoginPopup();", null));
        }
    }

    private boolean checkMicrophonePermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == RECORD_AUDIO_PERMISSION_CODE) {
            Toast.makeText(this,
                    (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED)
                            ? "Microphone permission granted" : "Microphone permission denied",
                    Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            boolean confirmExit = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .getBoolean(PREFS_EXIT_CONFIRM_ENABLED_KEY, true);
            if (!confirmExit) {
                super.onBackPressed();
                return;
            }

            new AlertDialog.Builder(this)
                    .setMessage("Are you sure you want to exit?")
                    .setCancelable(false)
                    .setPositiveButton("Yes", (dialog, id) -> super.onBackPressed())
                    .setNegativeButton("No", null)
                    .show();
        }
    }

    @Override protected void onPause() { if (adView != null) adView.pause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (adView != null) adView.resume(); }
    @Override
    protected void onDestroy() {
        if (textToSpeech != null) { textToSpeech.stop(); textToSpeech.shutdown(); }
        if (speechRecognizer != null) { speechRecognizer.destroy(); }
        if (adView != null) { adView.destroy(); }
        if (billingManager != null) { billingManager.destroy(); }
        super.onDestroy();
    }
}