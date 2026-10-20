# Where's The Vibe on the App Store

The iPhone app is the same site, bundled inside a native app with extra features:

- **Near me**: sorts events by distance and shows you on the map
- **Saved events**: heart any event; saved events work offline
- **Reminders**: a notification at 6pm the day before and midday on the day
- **Share**: native share sheet for Instagram, WhatsApp and iMessage, with a link that opens the event
- **In-app ticket browser**, haptics, splash screen and app icon

Everything is built in the cloud by Codemagic, so no Mac is needed.

## One-time setup (about an hour, all doable on iPhone or a laptop)

1. **Apple Developer Program**: enrol at developer.apple.com/programs as an Individual (about $99 a year). Approval can take up to 48 hours.
2. **Create the app in App Store Connect** (appstoreconnect.apple.com): Apps, +, New App.
   - Platform: iOS. Name: Where's The Vibe
   - Bundle ID: register `com.vibeconnoisseur.wheresthevibe` first under Certificates, Identifiers & Profiles, Identifiers
   - SKU: `wheresthevibe`
3. **App Store Connect API key**: Users and Access, Integrations, App Store Connect API, generate a key with the **App Manager** role. Download the .p8 file (only downloadable once) and note the Issuer ID and Key ID.
4. **Codemagic** (codemagic.io): sign up with GitHub and add the `vibeconnoisseur` repo.
   - Team settings, Integrations, Developer Portal: add the API key and name it exactly `Wheres The Vibe`
   - Team settings, Code signing identities: under iOS certificates, generate a new Apple Distribution certificate; under iOS provisioning profiles, fetch the App Store profile for the bundle ID
5. **Run the build**: in Codemagic, start the `iPhone app to TestFlight` workflow on the `main` branch. About 15 minutes later the build appears in TestFlight.

## Testing and submitting

1. Install **TestFlight** from the App Store and test the build on your phone.
2. In App Store Connect, fill in the listing:
   - Privacy Policy URL: `https://vibeconnoisseur.netlify.app/privacy.html`
   - App Privacy: Data collected is **Email Address**, used for Developer Marketing, not linked to identity, not used for tracking. Location is used on device only, so it is not "collected".
   - Category: Entertainment (or Lifestyle). Age rating: answer the questionnaire (events are 18+ nightlife, so expect 17+).
   - Screenshots: 6.9 inch iPhone screenshots (take them from TestFlight on a recent iPhone)
   - Review notes: "Event discovery for London. Try Near me, save an event with the heart to get reminders, and share an event."
3. Submit for review. First reviews usually take 1 to 3 days.

## Shipping an update

Website changes go live as usual. To update the app, start the Codemagic workflow again; it builds from the latest code and bumps the build number automatically. Then submit the new build in App Store Connect.

## Notes

- Vibe Approved listings are sold to organisers through Stripe on the website, not inside the app, which keeps the app outside Apple's in-app purchase rules.
- The app icon is generated from `resources/icon-only.png` (1024 x 1024). Replace that file with a sharper 1024 px logo and run `npm run icons` for a crisper icon.
- Android uses the same code: run `npx cap add android` when ready for Google Play.
