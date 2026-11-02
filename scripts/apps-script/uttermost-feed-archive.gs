/***********************
 * uttermost-feed-archive
 * Add this file to the inv-uttermost-gmail Apps Script project (File → New → Script).
 *
 * Keeps one CSV per day of the Uttermost daily inventory feed in a Drive folder, so the
 * room-ideas app can compute sell-through over time. The existing importXLS() trashes
 * everything in its own folder each run, so the archive uses a separate folder.
 *
 * Setup (once):
 *   1. Project Settings → Script properties:
 *        FEED_ARCHIVE_FOLDER_ID = <id of a new, empty Drive folder>
 *        FEED_ARCHIVE_TOKEN     = <a long random string; the app sends it to read the archive>
 *   2. Run backfillFeedArchive() from the editor. It saves every feed email still in Gmail,
 *      including Trash. If it stops at the time limit, run it again; it skips days already saved.
 *   3. In at(), after `editSheet.getRange(1, 1, dataToInsert.length, 7).setValues(dataToInsert);`
 *      add:   archiveFeedSnapshot_(dataToInsert, msgDate);
 *   4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 *      Copy the /exec URL into the app's .env.local as UTTERMOST_FEED_URL, and the token as
 *      UTTERMOST_FEED_TOKEN. The token is required for every request.
 *
 * Uses the Advanced Drive Service (Drive API v2) that importXLS() already relies on.
 ***********************/

const FEED_SEARCH_ = 'from:noreply@uttermost.com subject:"Uttermost Item Availability" has:attachment in:anywhere';
const FEED_PREFIX_ = "uttermost-avail-";

function feedArchiveFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty("FEED_ARCHIVE_FOLDER_ID");
  if (!id) throw new Error("Script property FEED_ARCHIVE_FOLDER_ID is not set");
  return DriveApp.getFolderById(id);
}

function feedDateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function toCsv_(rows) {
  return rows
    .filter((r) => String(r[0] || "").trim() !== "")
    .map((r) => r.map((v) => {
      const s = v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(","))
    .join("\n");
}

/** Save one day's feed rows (A:G values, header first). Never throws: the inventory push must not fail because of the archive. */
function archiveFeedSnapshot_(rows, msgDate) {
  try {
    const folder = feedArchiveFolder_();
    const name = FEED_PREFIX_ + feedDateKey_(msgDate) + ".csv";
    if (folder.getFilesByName(name).hasNext()) return;
    folder.createFile(name, toCsv_(rows), MimeType.CSV);
    logInfo_("archiveFeedSnapshot_", "saved", { name, rows: rows.length });
  } catch (e) {
    logWarn_("archiveFeedSnapshot_", "archive failed: " + (e && e.message ? e.message : e), {});
  }
}

/** Convert an .xlsx/.xls attachment to rows via a temporary Google Sheet in the archive folder. */
function attachmentRows_(attachment, folder) {
  const temp = Drive.Files.insert(
    { title: "tmp-" + attachment.getName(), parents: [{ id: folder.getId() }] },
    attachment.copyBlob(),
    { convert: true }
  );
  try {
    const sheet = SpreadsheetApp.openById(temp.id).getSheets()[0];
    return sheet.getRange(1, 1, sheet.getLastRow(), 7).getValues();
  } finally {
    DriveApp.getFileById(temp.id).setTrashed(true);
  }
}

/** One-off (safe to re-run): archive every feed email still in Gmail, oldest first. */
function backfillFeedArchive() {
  const started = Date.now();
  const folder = feedArchiveFolder_();
  const have = new Set();
  const files = folder.getFiles();
  while (files.hasNext()) have.add(files.next().getName());

  let saved = 0, skipped = 0;
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(FEED_SEARCH_, start, 100);
    if (!threads.length) break;
    for (const msgs of GmailApp.getMessagesForThreads(threads)) {
      for (const msg of msgs) {
        if (Date.now() - started > 5 * 60 * 1000) {
          Logger.log(`Stopped near the time limit: ${saved} saved, ${skipped} already there. Run again to continue.`);
          return;
        }
        const name = FEED_PREFIX_ + feedDateKey_(msg.getDate()) + ".csv";
        if (have.has(name)) { skipped++; continue; }
        // Prefer the .xlsx; the email also carries an .xls copy of the same data
        const atts = msg.getAttachments().filter((a) => /\.xlsx?$/i.test(a.getName()));
        const att = atts.find((a) => /\.xlsx$/i.test(a.getName())) || atts[0];
        if (!att) continue;
        folder.createFile(name, toCsv_(attachmentRows_(att, folder)), MimeType.CSV);
        have.add(name);
        saved++;
      }
    }
  }
  Logger.log(`Backfill done: ${saved} saved, ${skipped} already there.`);
}

/**
 * Web app endpoint for the room-ideas app.
 *   ?token=…&action=list          → { snapshots: ["2026-09-25", …] }
 *   ?token=…&action=get&date=…    → that day's CSV text
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const json = (obj) => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  const expected = PropertiesService.getScriptProperties().getProperty("FEED_ARCHIVE_TOKEN");
  if (!expected || p.token !== expected) return json({ error: "unauthorized" });

  const folder = feedArchiveFolder_();
  if (p.action === "list") {
    const dates = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const m = files.next().getName().match(/^uttermost-avail-(\d{4}-\d{2}-\d{2})\.csv$/);
      if (m) dates.push(m[1]);
    }
    return json({ snapshots: dates.sort() });
  }
  if (p.action === "get" && /^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) {
    const it = folder.getFilesByName(FEED_PREFIX_ + p.date + ".csv");
    if (!it.hasNext()) return json({ error: "not found" });
    return ContentService.createTextOutput(it.next().getBlob().getDataAsString()).setMimeType(ContentService.MimeType.CSV);
  }
  return json({ error: "unknown action" });
}
