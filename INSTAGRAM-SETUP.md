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

## 3. Get an access token

1. In the app's left menu, open **Instagram**, then **API setup with Instagram login**.
2. Under **Generate access tokens**, click **Add account** and log in as @thevibeconnoisseurr. Allow the permissions it asks for.
   - If it says the account needs a role: go to **App roles**, then **Roles**, add @thevibeconnoisseurr as an **Instagram Tester**, then accept it in Instagram under **Settings**, then **Apps and websites**, then **Tester invites**.
3. Click **Generate token** next to the account and copy it. It's long and starts with `IG`.

## 4. Add it to Netlify

1. In Netlify, go to **Project configuration**, then **Environment variables**, then **Add a variable**.
2. Key: `IG_ACCESS_TOKEN`. Value: the token. Tick **Contains secret values**.
3. Go to **Deploys**, then **Trigger deploy**, then **Deploy project**.

Instagram tokens last 60 days, but the site swaps it for a fresh one every week automatically, so it keeps working as long as the site gets visits. If Vibe News ever disappears, generate a new token and replace the variable.

## 5. Tag your posts

Add one of these hashtags to an Instagram post's caption to put it in Vibe News:

| Hashtag | Shows under |
| --- | --- |
| `#vibenews` or `#hottopics` | Hot topics |
| `#eventnews` | Event news |
| `#concertnews` | Concert news |

The first line of the caption becomes the headline. New posts appear within about 20 minutes. Until you've tagged anything, Vibe News shows your latest posts instead.
