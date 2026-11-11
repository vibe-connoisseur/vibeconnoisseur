# Turning on Vibe News

Vibe News shows posts from **@thevibeconnoisseurr** at the top of the Discover tab. It reads them through Instagram's official API, which needs a one-off setup of about 20 minutes. Until it's done, the section stays hidden.

## 1. Make the Instagram account professional

In the Instagram app on @thevibeconnoisseurr, go to **Settings**, then **Account type and tools**, then **Switch to professional account**. Choose **Creator** or **Business**; either works and it's free. Skip this if it's already professional.

## 2. Create a Meta app

1. Go to **developers.facebook.com** and log in with Facebook. If asked, register as a developer (free).
2. Click **My Apps**, then **Create App**.
3. App name: `Wheres The Vibe News`. Contact email: your email.
4. Use case: choose **Manage messaging & content on Instagram**. If you're asked for an app type instead, pick **Business**.
5. Finish creating the app. You don't need to submit it for review, because it only reads your own account.

## 3. Connect a business portfolio

New Meta apps use "Unified login", which needs a free business portfolio.

1. In the app, go to **Use cases**, then **Customize** on the Instagram use case, then **API setup with Unified login**.
2. Click **+ Business portfolio**, then **Create a business portfolio**. Name: `The Vibe Connoisseur`. Add your name and business email, then confirm the email.
3. Back on the API setup page, select the new portfolio.

## 4. Add the Instagram account and get a token

1. On the same page, add **@thevibeconnoisseurr**: log in to Instagram when asked and allow access.
   - If it asks for a role first: go to **App roles**, then **Roles**, then **Add People**, choose **Instagram Tester** and enter `thevibeconnoisseurr`. Accept it in Instagram under **Settings**, then **Apps and websites**, then **Tester invites**.
2. Copy the **Instagram account ID** shown next to the account. It's a long number, often starting `1784`.
3. Click **Generate token**. If you're offered a choice of how long it lasts, pick **Never**. Copy the token.

## 5. Add both to Netlify

In Netlify, go to **Project configuration**, then **Environment variables**, then **Add a variable**:

| Key | Value |
| --- | --- |
| `IG_ACCESS_TOKEN` | the token (tick **Contains secret values**) |
| `IG_USER_ID` | the Instagram account ID |

Then go to **Deploys**, then **Trigger deploy**, then **Deploy project**.

If the token you got expires (Meta shows an expiry date next to it), generate a new one before then and replace `IG_ACCESS_TOKEN`. A never-expiring token avoids this. Older "Instagram Login" tokens (starting `IG`) also still work without `IG_USER_ID`, and refresh themselves.

## 6. Tag your posts

Add one of these hashtags to an Instagram post's caption to put it in Vibe News:

| Hashtag | Shows under |
| --- | --- |
| `#vibenews` or `#hottopics` | Hot topics |
| `#eventnews` | Event news |
| `#concertnews` | Concert news |

The first line of the caption becomes the headline. New posts appear within about 20 minutes. Until you've tagged anything, Vibe News shows your latest posts instead.
