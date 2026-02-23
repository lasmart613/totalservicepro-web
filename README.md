# Photometry Tools - Version 1.1

Professional Android app for photometry calculations with integrated service manual viewer.

## What's New in v1.1
- ✨ **NEW: Service Manuals Feature** - Browse and view laser service manuals
- 📚 Included: Lumenis AcuPulse service manual (FREE)
- 🔐 Framework ready for premium Candela manuals
- 📄 PDF viewer with page navigation

## Features

### Calculators
1. **Fluence Calculator** - Energy density (J/cm²)
2. **Irradiance Calculator** - Power density (W/cm²)
3. **VBeam Wavelength Calculator** - Candela VBeam wavelength with filter correction
4. **Duty Cycle Calculator** - Pulsed laser characterization

### Service Manuals (NEW!)
- **Manufacturer dropdown** - Lumenis, Candela
- **Model selection** - Organized by manufacturer
- **FREE Lumenis manuals:**
  - AcuPulse (INCLUDED in this release)
  - AcuPulse Duo (Coming soon)
  - AcuPulse WG (Coming soon)
  - PowerSuite Ho:YAG/Nd:YAG (Coming soon)
- **Premium Candela manuals** (Coming soon):
  - GentleLASE, Mini GentleLASE
  - GentleYAG, Mini GentleYAG
  - AlexLAZR, Smoothbeam
  - VBeam, VBeam 2 (Aesthetica/Platinum/Perfecta)
  - CBeam

### Monetization
- Google AdMob banner ads integrated
- App ID: `ca-app-pub-5353320292042327~4023073625`
- Ad Unit ID: `ca-app-pub-5353320292042327/1955313486`

## Technical Details

### Requirements
- Android Studio Hedgehog or later
- Min SDK: 24 (Android 7.0)
- Target SDK: 34 (Android 14)
- Gradle: 8.2.0

### Architecture
- **WebView-based** calculators and PDF viewer
- **PDF.js** for service manual viewing (CDN-hosted)
- **Bottom Navigation** with 5 tabs
- **AdMob** integration for monetization

### Project Structure
```
PhotometryTools/
├── app/
│   ├── src/main/
│   │   ├── assets/
│   │   │   ├── fluence.html
│   │   │   ├── irradiance.html
│   │   │   ├── wavelength.html
│   │   │   ├── duty_cycle.html
│   │   │   ├── service_manuals.html
│   │   │   ├── pdf_viewer.html
│   │   │   └── manuals/
│   │   │       └── lumenis_acupulse.pdf
│   │   ├── java/com/photometrytools/
│   │   │   └── MainActivity.java
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml
│   │   │   ├── menu/bottom_nav_menu.xml
│   │   │   ├── drawable/ (icons)
│   │   │   └── values/ (strings, colors, themes)
│   │   └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
├── settings.gradle
└── gradle.properties
```

## Adding More Service Manuals

### To add a FREE manual:
1. Place PDF in `app/src/main/assets/manuals/`
2. Name it descriptively (e.g., `lumenis_powersuite.pdf`)
3. Edit `service_manuals.html`:
   - Change the appropriate "COMING SOON" button to active
   - Update `onclick` to call `openManual('filename_without_extension')`
4. Edit `pdf_viewer.html`:
   - Add entry to the `manuals` object with title and file path

### To add a PREMIUM manual:
1. Follow steps 1-4 above
2. Keep the lock icon and PREMIUM badge initially
3. Implement in-app billing (future update)
4. Change button to unlock after purchase

## Build Instructions

1. Open project in Android Studio
2. Sync Gradle files
3. Connect device or start emulator
4. Click Run (Shift+F10)

## Release Build

```bash
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk`

## Design
- **Color scheme:** Gold (#FFD700) on dark gray gradient
- **Professional aesthetic** for medical/industrial users
- **Mobile-optimized** with navigation bar clearance
- **Responsive design** for all Android screen sizes

## Future Enhancements
- [ ] In-app billing for premium manuals
- [ ] User file import for custom manuals
- [ ] Search functionality in PDF viewer
- [ ] Bookmarks and annotations
- [ ] Additional manufacturers (Cynosure, Syneron, etc.)
- [ ] Cloud sync for user preferences

## Version History
- **v1.1** (Current) - Added Service Manuals feature with Lumenis AcuPulse
- **v1.0** - Initial release with 4 photometry calculators

## License
Proprietary - All rights reserved

## Support
For questions or manual additions, contact the development team.
