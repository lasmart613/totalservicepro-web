# Total Service Pro — Google Play launch checklist

Android package `com.photometrytools`. This build is `versionName` **0.5.2-beta**, `versionCode` **44**, `targetSdk` **36**. Web `APP_VERSION` stays **0.5.0-beta**. Nothing in this file is a Play Console upload.

Policy pages checked 11 Oct 2026:

- Target API: [Meet Google Play's target API level requirement](https://developer.android.com/google/play/requirements/target-sdk) and [Play Console Help](https://support.google.com/googleplay/android-developer/answer/11926878). From 31 Aug 2026, a new phone/tablet app must target Android 16 (API 36) to be submitted.
- Store listing: [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)
- Privacy policy: [User data / privacy policy](https://support.google.com/googleplay/android-developer/answer/9859455)
- Data safety: [Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)
- Content rating: [Content ratings](https://support.google.com/googleplay/android-developer/answer/9893335)
- New personal accounts: [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)

## Store listing

| Field | Text |
| --- | --- |
| App name (18 / 30) | Total Service Pro |
| Short description (79 / 80) | Field service tools for biomedical equipment — lasers, lithotriptors, and C-arms. |
| Category | Business |
| Contact email | contact@medicalrepairnetwork.com |
| Website | https://repairplanet.net |

Full description (use as-is; it only names features that exist in the app and on repairplanet.net):

```
Total Service Pro is the field-service app for shops that repair biomedical equipment.

Sign in with the same account you use on repairplanet.net. The app opens the live site, and the bundled pages are there when the phone is offline.

What you can do:
- Service tickets and the schedule
- Service manuals in the in-app viewer, including chapter files when the manual is split
- Manuals-grounded AI assistant, with citation chips that open the cited page
- Estimates and invoices
- Team invites for your organization
- Laser calculators: fluence, irradiance, wavelength, duty cycle, average power, and density
- Voice readout of an assistant answer (device voice, or Grok voice through our server)
- Google Play Billing for the subscription plans the site already sells

Google sign-in opens in the browser, then returns to the app. Maps links open the Maps app. The microphone is used only when you start voice mode.

This is a beta (0.5.2-beta).
```

Do not paste the old README claims about AdMob or bundled Candela manuals. The current manifest has no ads SDK, and the manual library is the live catalog.

## Privacy policy

There is no privacy policy in this repo, and these URLs returned **404** on 11 Oct 2026:

- https://repairplanet.net/privacy
- https://repairplanet.net/privacy-policy
- https://repairplanet.net/legal/privacy
- https://repairplanet.net/terms

Play requires a public privacy-policy URL before the listing can go out. Larry has to publish one (the site is the right host) and paste that URL into Play Console. Do not ship a placeholder URL.

## Data safety (from this code)

Answer the form from what the app actually does. "Collected" means it leaves the device. "Shared" means it is sent to a third party for their own use; sending it to our own Supabase/Next server is collection by the developer, not sharing, unless Play's form asks for processors separately. Declare processors when the form asks.

| Data | Collected | Shared / processed by | Why | Optional? |
| --- | --- | --- | --- | --- |
| Name, email, phone, job title | Yes | Supabase (account and profile) | Account and team | Required to use the signed-in product |
| Organization, customers, tickets, estimates, invoices, reports | Yes | Supabase | The service workflow | Created by the user |
| Auth session (access and refresh token) | Yes, stored on device | Sent back to Supabase and repairplanet.net as Bearer | Stay signed in | Required |
| Photos / files picked in the page | Yes, when the user submits one | Supabase Storage (logos and similar uploads) | Company logo and page file inputs. A picture taken with the system camera stays on the device until that submit | User chooses the file |
| Camera | Not a declared permission. Do not declare `CAMERA` or business-card OCR | The system camera app (`ACTION_IMAGE_CAPTURE`) is offered beside the gallery when a file input accepts images. This app has no camera API and no OCR | Attach a photo the user chose to take | User initiated |
| Microphone / voice | Yes when voice mode is on | On-device speech recognition. The transcript is sent to the assistant. Grok voice sends the answer **text** to Supabase `grok-tts`, which calls xAI. The raw mic audio is not uploaded for Grok. | Read an answer aloud and dictate a question | User starts voice mode |
| Audio playback | The spoken answer is fetched as audio from `grok-tts` | xAI generates that audio on the server | Playback | Only in Grok voice mode |
| Approximate or precise location | No location permission | A typed address can open `geo:` or Google Maps. The app does not read GPS. | Open a ticket address | User taps the address |
| Purchase history | Yes | Google Play Billing. The purchase token is posted to Supabase `verify-subscription` | Subscriptions | Only if the user buys |
| Crash / diagnostics | No analytics or crash SDK in this project | — | — | — |
| Advertising ID | No | — | Ads SDK is not in the app | — |

Account deletion: the bundled profile page only marks `user_profiles.is_active` false from the client, and that write is no longer a supported path. The live site must offer a real deletion path before production, because Play requires account deletion for apps that allow account creation ([policy](https://support.google.com/googleplay/android-developer/answer/13327111)).

## Content rating

Use the IARC questionnaire in Play Console. Guidance from the product, not a pre-filled certificate:

- Category: utility / business tool. No violence, sexual content, or gambling.
- Users can sign in and create business records.
- The marketplace and directory let users post listings and contact details. Treat that as user-generated content if the questionnaire asks. There is no in-app chat moderation tool in the Android shell.
- No unrestricted web browser. The WebView stays on `https://repairplanet.net` and `https://www.repairplanet.net`, plus bundled `file:///android_asset/` pages. Hosts are compared with `Uri` exactly, https only. `totalservicepro.netlify.app` is not embedded. Google sign-in and every other main-frame link open in a Custom Tab or the external browser. `yljztfajyvjzqikxdddf.supabase.co` may load only as a subframe for this project's files. Session tokens and the JS bridge are not injected into that host or into any other-origin frame.
- Online interaction exists (team invites, marketplace). Answer those questions yes.
- Target audience is working technicians, not children.

Larry submits the questionnaire. The console returns the rating.

## Permissions

From the source manifest, plus permissions the Play Billing library merges:

| Permission | Sensitive? | Why it is there |
| --- | --- | --- |
| `android.permission.INTERNET` | No | Load repairplanet.net, Supabase, and billing verification |
| `android.permission.ACCESS_NETWORK_STATE` | No | Choose the live site vs the offline pages |
| `android.permission.RECORD_AUDIO` | Yes | Voice mode. Requested at runtime when the user starts the mic |
| `android.permission.USE_BIOMETRIC` | Yes | Merged from AndroidX Biometric. Unlocks a session already stored on the device. Fingerprint data is not collected |
| `android.permission.USE_FINGERPRINT` | Yes | Older alias of biometric, merged by the same library |
| `com.android.vending.BILLING` | Yes (financial) | Merged from the Billing library. Subscriptions |
| `com.photometrytools.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | No | AndroidX library signature permission |

`CAMERA` is not declared. Photo capture uses the system camera app through `ACTION_IMAGE_CAPTURE` and `FileProvider`. The image leaves the device only when the user submits the form. There is no business-card OCR in this app. Do not declare OCR or `CAMERA` on the Data safety form.

`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` are not declared. Biometric login uses the system biometric prompt and does not add a permission of its own.

## Target API

`compileSdk` 36 and `targetSdk` 36. That meets the 31 Aug 2026 submission rule for a new phone app (API 36). `minSdk` is 24.

Android 15+ draws edge to edge for this target. The shell turns off decor fitting and pads the root with system-bar insets so the WebView is not under the status bar or the gesture bar. The theme is NoActionBar so a second title bar is not drawn over the site.

## Screenshots and graphics

Play listing assets ([preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)):

- Phone screenshots: at least 2, at most 8. Each side 320–3840 px. Aspect ratio no wider or taller than 2:1. PNG or JPEG, no alpha.
- 7-inch and 10-inch tablet screenshots if you ship tablet layouts. Not required for a phone-only listing, but the WebView layout does run on tablets.
- Feature graphic: **1024 × 500** PNG or JPEG, required for the store listing.
- App icon: already in the project (`mipmap`). Play's high-res icon is **512 × 512** PNG, 32-bit.

A headless emulator capture is a candidate only. Larry should replace it with real device shots of sign-in, the schedule, manuals, and the assistant before production.

## New personal developer accounts

[Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) apply to **personal** Play Console accounts created after 13 Nov 2023:

- Closed testing with at least **12 testers opted in**
- Those testers stay opted in for **14 continuous days**
- Then apply for production access

**Organization** accounts are exempt. If Repair Planet's Play account is an organization, skip the 12-tester wait. If it is Larry's personal account created after Nov 2023, the wait applies before production. Closed testing can still receive this AAB immediately.

## Signing

No upload key, `keystore.properties`, or Play listing was in this repo. This launch uses a **new** upload key (alias `upload`, RSA 4096). The keystore and password are not in git. Larry must back up both and enroll the app in **Play App Signing** when he creates the listing. Losing the upload key means a new Play app id if App Signing was never enrolled.

The upload certificate SHA-256 is `51:F4:F1:B9:A7:7D:7E:CD:AB:6B:34:B0:4D:1A:06:B2:0B:9F:C6:91:4E:83:51:5F:22:40:AB:51:A2:A3:43:E9`. Play App Signing uses a different certificate. That SHA-256 exists only after Larry enrolls, so it is not in this build.

## App Links statement for Web Dev

`https://repairplanet.net/.well-known/assetlinks.json` returned **404** on 11 Oct 2026, so the https auth return does not verify as an App Link yet. Publish this file at that URL (and the same file on `https://www.repairplanet.net/.well-known/assetlinks.json` if www is a separate host). The source copy is `docs/android/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.photometrytools",
      "sha256_cert_fingerprints": [
        "51:F4:F1:B9:A7:7D:7E:CD:AB:6B:34:B0:4D:1A:06:B2:0B:9F:C6:91:4E:83:51:5F:22:40:AB:51:A2:A3:43:E9",
        "REPLACE_WITH_PLAY_APP_SIGNING_CERT_SHA256"
      ]
    }
  }
]
```

`REPLACE_WITH_PLAY_APP_SIGNING_CERT_SHA256` is a placeholder, not a certificate. Replace it with the Play App Signing cert SHA-256 from Play Console after enrollment, before publishing the file. Until then, publish only the upload fingerprint above. A non-fingerprint string in the live file can make the statement fail to verify.

## Steps only Larry can do in Play Console

1. Create the app `com.photometrytools` (or open it, if a listing already exists outside this repo).
2. Enroll in Play App Signing and upload the first AAB, or register the existing upload certificate if a listing already exists. Do not generate a second upload key if Play already has one.
3. Publish a privacy policy on repairplanet.net and paste the URL.
4. Complete Data safety, content rating, ads declaration (this app has no ads), and target audience.
5. Add the store listing text above, the 512 icon, the 1024×500 feature graphic, and screenshots.
6. If the account is a personal account created after 13 Nov 2023, run the 12-tester / 14-day closed test, then apply for production.
7. Add the release notes and roll out. Merging this branch does not upload anything.
