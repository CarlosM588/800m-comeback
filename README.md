# 800m Comeback

A phone-friendly app and a garage print sheet for a 16 week return-to-800m plan. Shows today's workout, takes the log (done, foot pain, pace, heart rate, notes), and flags when the plan needs adjusting.

Plain HTML, CSS and JavaScript. No build step. The whole plan lives in `plan.json`.

## Step 1: Look at it on your computer

```
cd Delilah-800m-Comeback
python3 -m http.server 8765
```

Open http://localhost:8765. To see it on a phone on the same Wi-Fi, open `http://<this-computer-ip>:8765`.

## Step 2: Put it online (GitHub Pages)

Already done if you are reading this on GitHub. The live link is the repo's Pages address. To change anything, edit the files, then:

```
git add -A && git commit -m "Update plan" && git push
```

The site refreshes in about a minute.

## Step 3: Put it on her phone

1. Open the link in Safari (iPhone) or Chrome (Android).
2. iPhone: Share button, then **Add to Home Screen**. Android: menu, then **Install app**.
3. Open it once with internet. After that it also works with no signal.

## Step 4: The garage sheet

Open `print.html` (the **Data** tab has a button). Pick a week and press Print. Choose **Landscape**. One week per page, big boxes to write in. "Show all 16 weeks" prints the whole plan, plus a blank TrueForm log.

## How the app works

- **Today**: this week's session for today, in large type, with gym and foot routines you can open. Log below it.
- **Week**: Monday to Sunday, dot color is the foot light.
- **Tests**: the week 4 checkpoint and the baseline versus retests on the TrueForm.
- **Guide**: paces, effort scale, foot light rules, gym routines.
- **Data**: copy a summary to text, back up or import the log, shift the plan, theme.

Logs are saved only on the phone she uses. Use **Data > Copy summary** to send them, or **Download JSON** as a backup.

## How the plan gets adjusted

The app watches the log and shows a card on Today. Rules come straight from the plan:

| What happens | What it says |
|---|---|
| Any red sign, or pain 5 or more | Stop running. Call the PT or doctor this week. |
| Yellow 2 days in a row | 2 days off running, tell the PT. |
| Missed 3 to 6 planned days | Repeat the last full week (button shifts the plan back 1 week). |
| Missed about 1 to 2 weeks | Go back two weeks (button shifts back 2 weeks). |
| Missed more than 2 weeks | Back to Phase 1 after the PT clears her. |

The shift moves the plan, not the calendar. Reset it under **Data > Plan shift**.

## Changing the plan

Edit `plan.json`. Each week has seven days with `where`, `session`, `run` (minutes), `hard` and `tags`. The generator that wrote it is not needed after that.

## Before anyone runs

This is a starting point, not medical advice. The physical therapist and school coach should see the plan before the first run. The foot sets the pace, not the calendar.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `plan.json` | All 16 weeks and the reference tables |
| `print.html` | Garage poster and blank logs |
| `sw.js`, `manifest.webmanifest`, `icon*` | Offline use and home screen icon |
