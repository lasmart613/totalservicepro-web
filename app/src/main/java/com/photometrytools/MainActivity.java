package com.photometrytools;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.MenuItem;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
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

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private AdView adView;
    private BottomNavigationView bottomNav;
    private TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private boolean ttsReady = false;
    private boolean isListening = false;
    private static final int RECORD_AUDIO_PERMISSION_CODE = 200;
    private static final String TAG = "PhotometryTools";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Initialize Mobile Ads
        MobileAds.initialize(this, initializationStatus -> {});

        // Setup AdMob banner
        adView = findViewById(R.id.adView);
        AdRequest adRequest = new AdRequest.Builder().build();
        adView.loadAd(adRequest);

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

                    // Set up utterance progress listener for hands-free mode
                    textToSpeech.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {
                            Log.d(TAG, "TTS started speaking");
                        }

                        @Override
                        public void onDone(String utteranceId) {
                            Log.d(TAG, "TTS finished speaking");
                            // Notify JavaScript that TTS is complete
                            runOnUiThread(() -> {
                                webView.evaluateJavascript("if(window.onTTSComplete) window.onTTSComplete();", null);
                            });
                        }

                        @Override
                        public void onError(String utteranceId) {
                            Log.e(TAG, "TTS error");
                        }
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
                runOnUiThread(() -> {
                    webView.evaluateJavascript("if(window.onSpeechReady) window.onSpeechReady();", null);
                });
            }

            @Override
            public void onBeginningOfSpeech() {
                Log.d(TAG, "Speech started");
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                // Audio level changed
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
                // Partial audio buffer
            }

            @Override
            public void onEndOfSpeech() {
                Log.d(TAG, "Speech ended");
                isListening = false;
            }

            @Override
            public void onError(int error) {
                Log.e(TAG, "Speech recognition error: " + error);
                isListening = false;
                String errorMessage = "";
                switch (error) {
                    case SpeechRecognizer.ERROR_AUDIO:
                        errorMessage = "Audio recording error";
                        break;
                    case SpeechRecognizer.ERROR_CLIENT:
                        errorMessage = "Client side error";
                        break;
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                        errorMessage = "Insufficient permissions";
                        break;
                    case SpeechRecognizer.ERROR_NETWORK:
                        errorMessage = "Network error";
                        break;
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                        errorMessage = "Network timeout";
                        break;
                    case SpeechRecognizer.ERROR_NO_MATCH:
                        errorMessage = "No speech match";
                        break;
                    case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                        errorMessage = "Recognition service busy";
                        break;
                    case SpeechRecognizer.ERROR_SERVER:
                        errorMessage = "Server error";
                        break;
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                        errorMessage = "No speech input";
                        break;
                }
                final String finalError = errorMessage;
                runOnUiThread(() -> {
                    webView.evaluateJavascript("if(window.onSpeechError) window.onSpeechError('" + finalError + "');", null);
                });
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && matches.size() > 0) {
                    String text = matches.get(0);
                    Log.d(TAG, "Speech recognized: " + text);
                    runOnUiThread(() -> {
                        // Escape quotes for JavaScript
                        String escapedText = text.replace("'", "\\'").replace("\"", "\\\"");
                        webView.evaluateJavascript("if(window.onSpeechResult) window.onSpeechResult('" + escapedText + "');", null);
                    });
                }
                isListening = false;
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                // Partial results
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
                // Other events
            }
        });

        // Setup WebView
        webView = findViewById(R.id.webView);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);

        // Enable debugging
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // Add JavaScript interface for TTS, speech recognition, and debugging
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        // Setup WebChromeClient for console logging and microphone permission
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, "WebView Console: " + consoleMessage.message() +
                        " -- From line " + consoleMessage.lineNumber() +
                        " of " + consoleMessage.sourceId());
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                Log.d(TAG, "Permission requested: " + request.getResources()[0]);

                runOnUiThread(() -> {
                    String[] requestedResources = request.getResources();
                    for (String r : requestedResources) {
                        if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            // Check if we have permission
                            if (ContextCompat.checkSelfPermission(MainActivity.this,
                                    Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                                Log.d(TAG, "Audio capture permission granted");
                            } else {
                                request.deny();
                                requestMicrophonePermission();
                                Log.d(TAG, "Audio capture permission denied - requesting Android permission");
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "Page loaded: " + url);
            }
        });

        // Setup Bottom Navigation
        bottomNav = findViewById(R.id.bottom_navigation);
        bottomNav.setOnNavigationItemSelectedListener(navListener);

        // Handle window insets for navigation bar
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            int bottomInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            bottomNav.setPadding(0, 0, 0, bottomInset);
            return insets;
        });

        // Load default screen (index)
        webView.loadUrl("file:///android_asset/index.html");

        // Request microphone permission if not already granted
        if (!checkMicrophonePermission()) {
            requestMicrophonePermission();
        }
    }

    // JavaScript Interface for TTS, speech recognition, and debugging
    public class WebAppInterface {
        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                Log.d(TAG, "Toast from JS: " + message);
            });
        }

        @JavascriptInterface
        public void logMessage(String message) {
            Log.d(TAG, "JS Log: " + message);
        }

        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> {
                if (ttsReady) {
                    Log.d(TAG, "Speaking: " + text.substring(0, Math.min(50, text.length())) + "...");

                    // Use a unique utterance ID to track completion
                    Bundle params = new Bundle();
                    String utteranceId = "grok_response_" + System.currentTimeMillis();

                    textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
                } else {
                    Log.e(TAG, "TTS not ready yet");
                    Toast.makeText(MainActivity.this, "Text-to-speech not ready", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (textToSpeech != null && textToSpeech.isSpeaking()) {
                    Log.d(TAG, "Stopping speech");
                    textToSpeech.stop();
                }
            });
        }

        @JavascriptInterface
        public boolean isTTSReady() {
            return ttsReady;
        }

        @JavascriptInterface
        public void startVoiceRecognition() {
            runOnUiThread(() -> {
                if (!checkMicrophonePermission()) {
                    Toast.makeText(MainActivity.this, "Microphone permission required", Toast.LENGTH_SHORT).show();
                    requestMicrophonePermission();
                    return;
                }

                if (isListening) {
                    Log.d(TAG, "Already listening");
                    return;
                }

                isListening = true;
                Log.d(TAG, "Starting voice recognition");

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

                try {
                    speechRecognizer.startListening(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Error starting speech recognition", e);
                    isListening = false;
                    webView.evaluateJavascript("if(window.onSpeechError) window.onSpeechError('Failed to start');", null);
                }
            });
        }

        @JavascriptInterface
        public void stopVoiceRecognition() {
            runOnUiThread(() -> {
                if (isListening) {
                    Log.d(TAG, "Stopping voice recognition");
                    speechRecognizer.stopListening();
                    isListening = false;
                }
            });
        }

        @JavascriptInterface
        public boolean isVoiceRecognitionAvailable() {
            return SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
        }
    }

    private boolean checkMicrophonePermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestMicrophonePermission() {
        if (!checkMicrophonePermission()) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    RECORD_AUDIO_PERMISSION_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == RECORD_AUDIO_PERMISSION_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Microphone permission granted");
                Toast.makeText(this, "Microphone permission granted", Toast.LENGTH_SHORT).show();
            } else {
                Log.d(TAG, "Microphone permission denied");
                Toast.makeText(this, "Microphone permission required for voice input",
                        Toast.LENGTH_LONG).show();
            }
        }
    }

    private BottomNavigationView.OnNavigationItemSelectedListener navListener =
            new BottomNavigationView.OnNavigationItemSelectedListener() {
                @Override
                public boolean onNavigationItemSelected(@NonNull MenuItem item) {
                    int itemId = item.getItemId();

                    if (itemId == R.id.nav_fluence) {
                        webView.loadUrl("file:///android_asset/fluence.html");
                        return true;
                    } else if (itemId == R.id.nav_irradiance) {
                        webView.loadUrl("file:///android_asset/irradiance.html");
                        return true;
                    } else if (itemId == R.id.nav_wavelength) {
                        webView.loadUrl("file:///android_asset/wavelength.html");
                        return true;
                    } else if (itemId == R.id.nav_duty_cycle) {
                        webView.loadUrl("file:///android_asset/duty_cycle.html");
                        return true;
                    } else if (itemId == R.id.nav_service) {
                        webView.loadUrl("file:///android_asset/service_hub.html");
                        return true;
                    }
                    return false;
                }
            };

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            new AlertDialog.Builder(this)
                    .setMessage("Are you sure you want to exit?")
                    .setCancelable(false)
                    .setPositiveButton("Yes", (dialog, id) -> MainActivity.super.onBackPressed())
                    .setNegativeButton("No", null)
                    .show();
        }
    }

    @Override
    protected void onPause() {
        if (adView != null) {
            adView.pause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (adView != null) {
            adView.resume();
        }
    }

    @Override
    protected void onDestroy() {
        // Shutdown TTS when activity is destroyed
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
        }

        // Destroy speech recognizer
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
        }

        if (adView != null) {
            adView.destroy();
        }
        super.onDestroy();
    }
}