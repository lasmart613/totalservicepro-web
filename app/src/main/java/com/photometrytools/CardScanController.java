package com.photometrytools;

import android.app.Activity;
import android.graphics.Rect;
import android.net.Uri;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * System-camera card scan. ML Kit's bundled Latin model reads the photo on the
 * device. The image is deleted after recognition and is never uploaded.
 */
public final class CardScanController {
    public interface Host {
        Activity activity();

        boolean online();

        String sessionJson();

        String readDrafts();

        void writeDrafts(String json);

        void reloadPage();

        void complete(String requestId, boolean ok, String valueJson, String error);

        /** @return false when the system camera app is not available */
        boolean launchCamera();

        void alert(String title, String message);
    }

    private final Host host;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final CustomerCardClient.Transport transport = CustomerCardClient.httpTransport();
    private boolean busy;
    private String requestId = "";
    private CardScanContract.Request request = new CardScanContract.Request("create", null);
    private AlertDialog dialog;

    public CardScanController(Host host) {
        this.host = host;
    }

    public void start(String requestId, JSONObject payload, String pageUrl) {
        if (busy) {
            host.complete(requestId, false, null, CardScanContract.ERR_BUSY);
            return;
        }
        busy = true;
        this.requestId = requestId == null ? "" : requestId;
        this.request = CardScanContract.requestFrom(payload, pageUrl);
        if (!host.launchCamera()) {
            busy = false;
            host.alert("Camera needed", CardScanContract.ERR_CAMERA);
            host.complete(this.requestId, false, null, CardScanContract.ERR_CAMERA);
        }
    }

    public void onCameraResult(boolean ok, Uri uri, File photo) {
        if (!busy) {
            deletePhoto(photo);
            return;
        }
        if (!ok || uri == null) {
            deletePhoto(photo);
            finishCancelled();
            return;
        }
        recognize(uri, photo);
    }

    private void recognize(Uri uri, File photo) {
        Activity activity = host.activity();
        if (activity == null || activity.isFinishing()) {
            deletePhoto(photo);
            finishCancelled();
            return;
        }
        final InputImage image;
        try {
            image = InputImage.fromFilePath(activity, uri);
        } catch (Exception e) {
            deletePhoto(photo);
            showConfirm(new BusinessCardFields(), true);
            return;
        }
        final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(image)
                .addOnSuccessListener(text -> {
                    deletePhoto(photo);
                    close(recognizer);
                    BusinessCardFields scanned = fieldsFromText(text, image.getHeight());
                    prepareConfirm(scanned, !scanned.hasAnyValue());
                })
                .addOnFailureListener(e -> {
                    deletePhoto(photo);
                    close(recognizer);
                    prepareConfirm(new BusinessCardFields(), true);
                });
    }

    private void prepareConfirm(BusinessCardFields scanned, boolean ocrFailed) {
        final BusinessCardFields recognized = scanned == null ? new BusinessCardFields() : scanned;
        executor.execute(() -> {
            BusinessCardFields existing = null;
            if ("update".equals(request.mode) && request.organizationId != null && host.online()) {
                existing = CustomerCardClient.fetchFields(request.organizationId, host.sessionJson(), transport);
            }
            final BusinessCardFields prefill = BusinessCardFields.prefill(existing, recognized);
            Activity activity = host.activity();
            if (activity == null) return;
            activity.runOnUiThread(() -> showConfirm(prefill, ocrFailed));
        });
    }

    static BusinessCardFields fieldsFromText(Text text, int imageHeight) {
        if (text == null) return new BusinessCardFields();
        List<CardScanContract.Glyph> glyphs = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                for (Text.Element element : line.getElements()) {
                    Rect box = element.getBoundingBox();
                    if (box == null || element.getText() == null) continue;
                    float midY = (box.top + box.bottom) / 2f;
                    glyphs.add(new CardScanContract.Glyph(element.getText(), midY, box.left));
                }
            }
        }
        if (!glyphs.isEmpty() && imageHeight > 0) {
            return BusinessCardParser.parseLines(CardScanContract.groupLines(glyphs, imageHeight));
        }
        return BusinessCardParser.parse(text.getText());
    }

    private void showConfirm(BusinessCardFields fields, boolean ocrFailed) {
        Activity activity = host.activity();
        if (activity == null || activity.isFinishing()) {
            finishCancelled();
            return;
        }
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        String notice = ocrFailed
                ? "No text was recognized on this device. Type the customer details or retake the photo. Nothing is saved until you tap Save."
                : "Review the fields read on this device. Nothing is saved until you tap Save.";
        String footer = "update".equals(request.mode)
                ? "Empty fields on an existing customer are left as they are. Nothing is saved until you tap Save."
                : "Company is the customer name in your directory. Nothing is saved until you tap Save.";
        LinearLayout form = new LinearLayout(activity);
        form.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(activity, 16);
        form.setPadding(pad, pad, pad, pad);
        TextView noticeView = new TextView(activity);
        noticeView.setText(notice);
        form.addView(noticeView);
        String[] labels = {"Name", "Title", "Company", "Phone", "Email", "Address", "City", "State", "ZIP", "Website"};
        String[] values = {
                fields.name, fields.title, fields.company, fields.phone, fields.email,
                fields.address, fields.city, fields.state, fields.zip, fields.website
        };
        final EditText[] inputs = new EditText[labels.length];
        for (int i = 0; i < labels.length; i++) {
            TextView label = new TextView(activity);
            label.setText(labels[i]);
            label.setPadding(0, dp(activity, 8), 0, 0);
            form.addView(label);
            EditText input = new EditText(activity);
            input.setText(values[i] == null ? "" : values[i]);
            input.setSingleLine(true);
            if (i == 3) input.setInputType(InputType.TYPE_CLASS_PHONE);
            else if (i == 4) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
            else if (i == 9) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            inputs[i] = input;
            form.addView(input);
        }
        TextView footerView = new TextView(activity);
        footerView.setText(footer);
        footerView.setPadding(0, dp(activity, 12), 0, 0);
        form.addView(footerView);
        final TextView errorView = new TextView(activity);
        errorView.setPadding(0, dp(activity, 8), 0, 0);
        form.addView(errorView);
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(form);
        final boolean[] saving = new boolean[]{false};
        AlertDialog built = new AlertDialog.Builder(activity)
                .setTitle("update".equals(request.mode) ? "Update from card" : "Scan card")
                .setView(scroll)
                .setNegativeButton("Cancel", null)
                .setNeutralButton("Retake", null)
                .setPositiveButton("Save", null)
                .setCancelable(true)
                .create();
        dialog = built;
        built.setOnCancelListener(d -> {
            if (!saving[0]) finishCancelled();
        });
        built.setOnShowListener(d -> {
            android.widget.Button cancel = built.getButton(AlertDialog.BUTTON_NEGATIVE);
            android.widget.Button retake = built.getButton(AlertDialog.BUTTON_NEUTRAL);
            android.widget.Button save = built.getButton(AlertDialog.BUTTON_POSITIVE);
            cancel.setOnClickListener(v -> {
                if (saving[0]) return;
                built.dismiss();
                finishCancelled();
            });
            retake.setOnClickListener(v -> {
                if (saving[0]) return;
                built.dismiss();
                if (!host.launchCamera()) {
                    host.alert("Camera needed", CardScanContract.ERR_CAMERA);
                    host.complete(requestId, false, null, CardScanContract.ERR_CAMERA);
                    busy = false;
                }
            });
            save.setOnClickListener(v -> {
                if (saving[0]) return;
                BusinessCardFields edited = readFields(inputs);
                saving[0] = true;
                errorView.setText("");
                save.setEnabled(false);
                executor.execute(() -> {
                    CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft(
                            request.mode, request.organizationId, edited);
                    CustomerCardClient.SaveResult result = CustomerCardClient.save(
                            draft, host.sessionJson(), host.online(), host.readDrafts(), transport);
                    activity.runOnUiThread(() -> {
                        host.writeDrafts(result.draftsJson);
                        if (!result.done) {
                            saving[0] = false;
                            save.setEnabled(true);
                            errorView.setText(result.message == null ? "" : result.message);
                            return;
                        }
                        built.setOnCancelListener(null);
                        built.dismiss();
                        finishSaved(result);
                    });
                });
            });
        });
        built.show();
    }

    private static BusinessCardFields readFields(EditText[] inputs) {
        BusinessCardFields fields = new BusinessCardFields();
        fields.name = text(inputs, 0);
        fields.title = text(inputs, 1);
        fields.company = text(inputs, 2);
        fields.phone = text(inputs, 3);
        fields.email = text(inputs, 4);
        fields.address = text(inputs, 5);
        fields.city = text(inputs, 6);
        fields.state = text(inputs, 7);
        fields.zip = text(inputs, 8);
        fields.website = text(inputs, 9);
        return fields.trimmed();
    }

    private static String text(EditText[] inputs, int index) {
        if (inputs == null || index >= inputs.length || inputs[index] == null) return "";
        CharSequence value = inputs[index].getText();
        return value == null ? "" : value.toString();
    }

    private void finishSaved(CustomerCardClient.SaveResult result) {
        busy = false;
        dialog = null;
        if (result.title != null && result.message != null) host.alert(result.title, result.message);
        String value = null;
        try {
            value = CardScanContract.outcomeJson(result.saved, result.queued, result.organizationId, result.fields).toString();
        } catch (Exception ignored) {
        }
        host.complete(requestId, true, value, null);
        if (result.saved) host.reloadPage();
    }

    private void finishCancelled() {
        busy = false;
        dialog = null;
        host.complete(requestId, false, null, CardScanContract.ERR_CANCELLED);
    }

    private static void deletePhoto(File photo) {
        if (photo == null) return;
        try {
            if (photo.exists() && !photo.delete()) photo.deleteOnExit();
        } catch (RuntimeException ignored) {
        }
    }

    private static void close(TextRecognizer recognizer) {
        try {
            recognizer.close();
        } catch (RuntimeException ignored) {
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
