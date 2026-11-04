# Accounts and sync: user guide

**Last verified:** 0150-web-accounts (2026-10-12)

For people who use the web app. Operators can copy and adapt it for their help pages. The words match the app's Account screens; if your site translates them differently, follow the screen.

## What an account does

An account keeps your notes, highlights, bookmarks and memory progress in step across your devices (other browsers and the desktop app). It is optional: without an account everything stays on this device only.

Your data is encrypted on your device before it is sent. The server stores the scrambled version and cannot read it.

## Creating an account

1. Open Settings, Account, "Create account".
2. Enter your email address and a strong password. Use one you use nowhere else.
3. Tick that you accept the terms and meet the age limit.
4. Check your email and open the verification link (valid 24 hours).

## The recovery code

When you sign up you get a recovery code: 8 groups of 4 letters and digits. It is the only way back in if you forget your password.

- Write it on paper or store it in a password manager. Do it now: it is shown once.
- The app asks you to type a few of its characters to prove you saved it.
- Whoever has the code can open your data, so keep it private.
- If you lose it but are still signed in, make a new one under Account ("New recovery code"). The old one stops working.
- Nobody can look it up for you, including the site operator.

## Signing in on another device

Choose "Sign in", enter your email and password. The app downloads your data and decrypts it on the device.

### Remember this device ("Keep me signed in on this device")

Unchecked by default. If you check this box, the app keeps a key in this browser so you do not retype the password after closing it. That is convenient on your own computer. Do not use it on a shared or public computer: anyone who opens the browser can then read your synced data. Leave it unchecked and you sign in again each visit.

## Your devices

Account lists every device that is signed in, with the last time each synced. Remove a device ("Sign out this device") you lost or no longer use: it is signed out and cannot sync again until it signs in with the password. Changing your password also signs out the other devices.

## Forgotten password

1. Choose "Forgot your password?".
2. If you have the recovery code, enter it with your email and choose a new password. Your data is kept.
3. If you do not have the code, choose "Email me a link to start over". We email you a link (valid 1 hour). Opening it and choosing a new password gives you a fresh, empty account under the same email address. The old encrypted data on the server is deleted because nobody can unlock it. Devices that are still signed in keep their local copy and upload it again; a device that is signed out and wiped has nothing to upload. You get a new recovery code.

## Signing out

You choose whether to keep this device's local data or wipe it. Wipe on devices that are not yours. Wiping removes the local copy only; your data is still on the server and your other devices.

## Download or delete

Account, "Privacy": download everything the server holds about you as a file, or delete the account permanently (asks for your password). Deleting cannot be undone.

## What the web app cannot promise

The web page's code comes from the server you visit each time. End-to-end encryption here protects your data from the server's database and from anyone who steals a backup or watches the connection. It cannot protect you if the site itself were to serve you altered code. If that matters to you, use the desktop app, which you install once from a signed download. Choose a site and operator you trust.

Also remember:

- Email addresses and sync times are visible to the operator.
- A weak password weakens everything: the server could try guesses against a stolen database.
- If you lose both the password and the recovery code, your synced data is gone for good.
