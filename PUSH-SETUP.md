# Friends and push notifications: setup

Friends are people who follow each other. When someone saves an event, their
friends get a phone notification and see it under Following > Friends' activity.
Anyone can switch this off in Settings > Friends.

## 1. Supabase

In Supabase > SQL Editor > New query, run these in order (each is safe to run twice):

1. `supabase/3-reminders.sql` (if not already run)
2. `supabase/4-friends.sql`

## 2. Apple: turn on push for the app

1. developer.apple.com > Certificates, IDs & Profiles > Identifiers > Wheres The Vibe.
2. Tick **Push Notifications** and Save (ignore the certificate prompt).
3. Profiles > open `wtv_app_store` > Edit > Save, so it includes push.
4. In Codemagic > Teams > Integrations > Developer Portal, fetch the profiles again
   so the updated `wtv_app_store` is used.

## 3. Apple: create a push key

1. Certificates, IDs & Profiles > Keys > +.
2. Name it `WTV Push`, tick **Apple Push Notifications service (APNs)**, Continue, Register.
3. Download the `.p8` file (only possible once) and note the **Key ID**.

## 4. Netlify environment variables

Site configuration > Environment variables > Add:

| Key | Value |
| --- | --- |
| `APNS_KEY` | The whole contents of the .p8 file, including the BEGIN and END lines |
| `APNS_KEY_ID` | The Key ID from step 3 |
| `APNS_TEAM_ID` | `3GT7XZN5MY` |

Then Deploys > Trigger deploy.

## 5. Build

Merging the pull request starts a Codemagic build automatically. Once it is in
TestFlight, open the app, sign in and allow notifications.

## How to check it works

Two phones, two accounts, each with a username (Menu > Profile). Add each other
from Following > Add friends and accept. Save an event on one phone; the other
gets "Name saved an event" within a few seconds.

If nothing arrives, check Netlify > Logs > Functions > `push` for "Some pushes failed".
