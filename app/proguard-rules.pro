# WebView JavascriptInterface method names are part of the page contract.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.photometrytools.MainActivity$WebAppInterface { *; }
-keepclassmembers class com.photometrytools.MainActivity {
    public void showToast(java.lang.String);
    public java.lang.String getAccessToken();
}
