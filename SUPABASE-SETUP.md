# Turning on accounts and event uploads

Profiles, sign-in, synced saved events and brand uploads use **Supabase** (free plan). Until these steps are done, the app and website work as before. The menu, preferences and settings still work, and the sign-in screen says accounts are coming soon.

Takes about 30 minutes. Steps 1 to 6 are easiest on a laptop.

## 1. Create the Supabase project

1. Go to supabase.com and sign up with GitHub.
2. Click **New project**. Name: `wheres-the-vibe`. Region: **West EU (London)**. Make a strong database password and save it somewhere safe.
3. Wait about two minutes for it to finish setting up.

## 2. Create the tables

1. In the left menu, open **SQL Editor**, then **New query**.
2. Open `supabase/setup.sql` from the repo on GitHub, copy all of it, paste it in, and click **Run**. It should say "Success. No rows returned".

## 3. Make sign-in emails send a code

The app asks for a 6-digit code, so the emails need to include it.

1. Go to **Authentication**, then **Emails** (or Email Templates).
2. Open the **Magic Link** template. Set the subject to `Your Where's The Vibe code` and replace the body with:

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in Where's The Vibe:</p>
   <h1 style="letter-spacing:6px">{{ .Token }}</h1>
   <p>It expires in one hour. If you didn't ask for it, ignore this email.</p>
   ```
3. Do the same for the **Confirm signup** template, which new users get the first time.
4. Under **Authentication**, then **Sign In / Providers**, then **Email**: keep Email turned on, and set the OTP length to 6 if there's an option for it.

## 4. Use your own email sender

Supabase's built-in sender only allows a few emails an hour, which is fine for testing but not for launch. The quickest fix without a domain is your Gmail:

1. In your Google account, turn on 2-Step Verification, then create an **App password** (search "App passwords" in your Google account settings).
2. In Supabase, go to **Authentication**, then **Emails**, then **SMTP Settings**, and turn on custom SMTP:
   - Host `smtp.gmail.com`, port `465`
   - Username: your Gmail address. Password: the app password
   - Sender name: `Where's The Vibe`
3. When you move to wheresthevibe.app, switch this to a service like Resend so emails come from your own domain.

## 5. Turn on Sign in with Apple

1. **Apple side:** at developer.apple.com, go to **Identifiers**, then open **Wheres The Vibe**, tick **Sign In with Apple**, then **Save** and confirm.
2. Your provisioning profile now needs refreshing. Go to **Profiles**, open **Wheres The Vibe App Store**, click **Edit**, then **Save**. In Codemagic, open **Settings**, then **Code signing identities**, then **iOS provisioning profiles**. Delete the old one, then use **Fetch profiles** to add it again with the same reference name.
3. **Supabase side:** go to **Authentication**, then **Sign In / Providers**, then **Apple**. Turn it on and put `com.vibeconnoisseur.wheresthevibe` in **Client IDs**. Leave the secret key blank, since the iPhone app signs in natively. Save.

## 6. Connect Netlify

1. In Supabase, go to **Project Settings**, then **API Keys**. Copy:
   - the **Project URL** (Project Settings, then Data API)
   - the **publishable** key (or the legacy **anon** key)
   - the **secret** key (or the legacy **service_role** key). Keep this one private.
2. In Netlify, go to **Site configuration**, then **Environment variables**, and add:

   | Key | Value |
   | --- | --- |
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_ANON_KEY` | the publishable / anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the secret / service_role key |
   | `ADMIN_EMAILS` | the email you'll sign in with, e.g. `henrychukwu98@yahoo.co.uk`. Separate several with commas |

3. Go to **Deploys**, then **Trigger deploy**, then **Deploy site**.

## 7. Check it

1. On the website, open the menu, sign in with your admin email and enter the code.
2. **Approvals** should appear in the menu. That's your queue.
3. Submit a test event under **Submit an event**, approve it, and it should appear on the map within about five minutes.

## How approvals work

- Brands submit in the app or website. Their event waits in **Approvals** and doesn't show on the map until you approve it.
- Approved events show alongside your sheet events, with their flyer and description.
- To take one down later: in Supabase, go to **Table Editor**, then **event_submissions**, and change its `status` to `rejected`.
