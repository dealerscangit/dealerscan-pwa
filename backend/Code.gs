// ============================================================
// DealerScan / Scan Docs — Apps Script
// Last updated: 2026-05-26 — PWA-era additions
//
// CHANGES IN THIS REVISION (from the version Brandon found in the editor):
//   1. NEW endpoint `hideCustomer`   — remove a customer from a salesperson's
//      history sheet row. Does NOT touch Drive folders. Used by PWA's
//      swipe-to-remove gesture on the recent-customers list.
//   2. NEW endpoint `unhideCustomer` — re-add a customer to the front of
//      a salesperson's history row. Used by the swipe undo toast.
//   3. FIX createCustomerFolder: saveToHistory now runs on EVERY scan, not
//      just `isNew === "true"`. Salespeople expect their most-recent
//      customer to float to the top of the list — that didn't happen
//      before because returning customers (isNew=false) were skipped.
//      saveToHistory already de-dupes and bumps-to-front, so it's safe
//      to call unconditionally.
//
// EARLIER CHANGES (from old → 2026-04-30):
//   1. VISION_API_KEY moved to PropertiesService (no longer hardcoded)
//   2. Q-A: getDashConfig HTTP path now wraps return in json()
//   3. Q-B: logScanComplete no-op col-8 write removed
//   4. Q-C: archiveDailyFolders renamed to archiveAllFoldersDangerous
//
// ARCHITECTURE NOTE: This file does NOT yet implement the service-account
// proxy (Phase 4B). Drive operations still happen via direct sharing to
// salesperson Gmail accounts as in v3.9.
// ============================================================

// ────────── CONSTANTS ──────────
const PARENT_FOLDER_ID  = "1YOL2kFo4PG5UCDcjGH5Z62ak5mN4Jtuk";   // DealerScan Customers
const ARCHIVE_FOLDER_ID = "18XJxzHYfslcacGv8_drPU67GGTzDS3Xq";   // DealerScan Archive
const SYSTEM_FOLDER_ID  = "1Zb8LUDFD_MA5yD_T3d34kBgCigJj6a7B";   // DealerScan Data
const HISTORY_SHEET_ID  = "1TYpQ_P1j1ShEwPpmFVjMxPiZ84uZ5eSitTUSfR3Tmrs";  // Customer History & Logs

const HISTORY_SHEET_NAME = "CustomerHistory";
const MAX_HISTORY = 5;
const CONFIG_FILE_NAME = "_DealerScan_Config.json";
const LOG_FILE_NAME    = "_DealerScan_Log.json";
const EVENTS_FILE_NAME = "_DealerScan_Events.json";

// Vision API key read from Script Properties (set in Project Settings)
function getVisionApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  if (!key) throw new Error("VISION_API_KEY not set in Script Properties. See Project Settings → Script Properties.");
  return key;
}

function getHistorySpreadsheet() {
  return SpreadsheetApp.openById(HISTORY_SHEET_ID);
}

// ────────── WEB APP ENTRY POINTS ──────────
function doGet(e) {
  var action = e.parameter.action;
  if (!action) {
    return ContentService.createTextOutput(
      "DealerScan Backend\n\n" +
      "This is an API endpoint, not a webpage.\n" +
      "Use ?action=getVersion, ?action=getConfig, ?action=getOverview, etc.\n"
    );
  }
  if (action === "createFolder")    return createCustomerFolder(e);
  if (action === "uploadPhoto")     return uploadPhoto(e);
  if (action === "getHistory")      return getHistory(e);
  if (action === "hideCustomer")    return hideCustomer(e);     // ← NEW (PWA swipe-to-remove)
  if (action === "unhideCustomer")  return unhideCustomer(e);   // ← NEW (PWA swipe undo)
  if (action === "getVersion")      return getVersion(e);
  if (action === "getConfig")       return getDashConfigHttp(e);
  if (action === "saveConfig")      return saveDashConfig(e);
  if (action === "getFolders")      return getDashFolders(e);
  if (action === "getScanLog")      return getDashScanLog(e);
  if (action === "getEventLog")     return getDashEventLog(e);
  if (action === "getOverview")     return getDashOverview(e);
  if (action === "archiveFolder")   return archiveSingleFolder(e);
  if (action === "archiveAll")      return archiveAllOld(e);
  if (action === "logUpload")       return json(logUpload(JSON.parse(e.parameter.payload || "{}")));
  if (action === "logEvent")        return json(logDealerScanEvent(JSON.parse(e.parameter.payload || "{}")));
  if (action === "getEvents")       return getDealerScanEvents(e);
  if (action === "getStats")        return getDealerScanStats(e);
  // ── Phase 4B proxy endpoints (auth-gated) ──
  if (action === "authPing")          return authPing(e);
  if (action === "proxyListFolders")  return proxyListFolders(e);
  if (action === "proxyListFiles")    return proxyListFiles(e);
  if (action === "proxyReadFile")     return proxyReadFile(e);
  if (action === "proxyGetFile")      return proxyGetFile(e);
  if (action === "proxyFindFolder")   return proxyFindFolder(e);
  if (action === "proxyReadJsonFile") return proxyReadJsonFile(e);
  return ContentService.createTextOutput("Unknown action");
}

function doPost(e) {
  var action = e.parameter.action;
  var data = {};
  try {
    if (e.parameter.payload) { data = JSON.parse(e.parameter.payload); }
    else if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
      if (!action && data.action) action = data.action;
    }
  } catch(err) {}
  if (action === "uploadPhoto") return uploadPhoto(e);
  if (action === "logUpload")   return json(logUpload(data));
  if (action === "saveConfig")  return saveDashConfigPost(e);
  return ContentService.createTextOutput("Unknown action");
}

// ────────── CONFIG ──────────
function getDashConfigHttp(e) {
  try { return json(getDashConfig()); }
  catch(err) { return jsonError(err); }
}

function getDashConfig() {
  var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
  var files = folder.getFilesByName(CONFIG_FILE_NAME);
  var config = { enabled: true, message: "", managers: [], itUsers: [], users: {} };
  if (files.hasNext()) {
    config = JSON.parse(files.next().getBlob().getDataAsString());
  }
  if (!config.managers) config.managers = [];
  if (!config.itUsers)  config.itUsers  = [];
  if (!config.users)    config.users    = {};
  var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var folders = pf.getFolders();
  while (folders.hasNext()) {
    var name = folders.next().getName();
    if (name.indexOf("_") === 0) continue;
    var parts = name.split("--");
    if (parts.length >= 2) {
      var sp = parts[1].trim();
      if (sp && !config.users[sp]) config.users[sp] = { enabled: true };
    }
  }
  return config;
}

function saveDashConfig(e) {
  try {
    var config = JSON.parse(decodeURIComponent(e.parameter.config || "{}"));
    writeConfigToSystem(config);
    return json({ success: true });
  } catch(err) { return jsonError(err); }
}

function saveDashConfigPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    writeConfigToSystem(data.config);
    return json({ success: true });
  } catch(err) { return jsonError(err); }
}

function writeConfigToSystem(config) {
  var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
  var files = folder.getFilesByName(CONFIG_FILE_NAME);
  var content = JSON.stringify(config);
  if (files.hasNext()) { files.next().setContent(content); }
  else { folder.createFile(CONFIG_FILE_NAME, content, "application/json"); }
}

// ────────── DASHBOARD READ-ONLY ENDPOINTS ──────────
function getDashFolders(e) {
  try {
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
    var folders = pf.getFolders();
    var result = [];
    while (folders.hasNext()) {
      var f = folders.next();
      var name = f.getName();
      if (name.indexOf("_") === 0) continue;
      var fi = f.getFiles(), fc = 0;
      while (fi.hasNext()) { fi.next(); fc++; }
      result.push({ id: f.getId(), name: name, created: f.getDateCreated().toISOString(), fileCount: fc });
    }
    result.sort(function(a, b) { return new Date(b.created) - new Date(a.created); });
    return json({ folders: result });
  } catch(err) { return jsonError(err); }
}

function getDashScanLog(e) {
  try {
    var ss = getHistorySpreadsheet();
    var sheet = ss.getSheetByName("ScanLog");
    if (!sheet) return json({ entries: [] });
    var data = sheet.getDataRange().getValues();
    var entries = data.map(function(row) {
      return {
        salesperson: row[0] || "", customer: row[1] || "", folderId: row[2] || "",
        timestamp: row[3] ? new Date(row[3]).toISOString() : "",
        date: row[4] || "", timeStart: row[5] || "", timeEnd: row[6] || "",
        photoCount: row[7] || 0, duration: row[8] || "", status: row[9] || row[8] || ""
      };
    }).filter(function(r) { return r.salesperson; });
    return json({ entries: entries.reverse() });
  } catch(err) { return jsonError(err); }
}

function getDashEventLog(e) {
  try {
    var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
    var files = folder.getFilesByName(EVENTS_FILE_NAME);
    if (!files.hasNext()) return json({ events: [] });
    var log = JSON.parse(files.next().getBlob().getDataAsString());
    return json({ events: (log.events || []).reverse().slice(0, 200) });
  } catch(err) { return jsonError(err); }
}

function getDashOverview(e) {
  try {
    var today = new Date().toDateString();
    var ss = getHistorySpreadsheet();
    var sheet = ss.getSheetByName("ScanLog");
    var scansToday = 0, activeSP = {}, recentScans = [];
    if (sheet) {
      sheet.getDataRange().getValues().forEach(function(row) {
        if (!row[0]) return;
        if (typeof row[3] !== 'number') return;
        var ts = new Date(row[3]);
        if (ts.toDateString() === today) { scansToday++; activeSP[row[0]] = true; }
        recentScans.push({
          salesperson: row[0], customer: row[1],
          status: row[9] || row[8] || "",
          timestamp: ts.toISOString()
        });
      });
    }
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
    var fi = pf.getFolders(), folderCount = 0, foldersToday = 0;
    while (fi.hasNext()) {
      var f = fi.next();
      if (f.getName().indexOf("_") === 0) continue;
      folderCount++;
      if (f.getDateCreated().toDateString() === today) foldersToday++;
    }
    var sysfolder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
    var recentErrors = [], uploadsToday = 0;
    var evFiles = sysfolder.getFilesByName(EVENTS_FILE_NAME);
    if (evFiles.hasNext()) {
      var evLog = JSON.parse(evFiles.next().getBlob().getDataAsString());
      recentErrors = (evLog.events || []).filter(function(ev) {
        return ["uploadFailed", "injectFailed", "authFailed"].indexOf(ev.type) > -1;
      }).reverse().slice(0, 5);
    }
    var logFiles = sysfolder.getFilesByName(LOG_FILE_NAME);
    if (logFiles.hasNext()) {
      var log = JSON.parse(logFiles.next().getBlob().getDataAsString());
      (log.entries || []).forEach(function(entry) {
        if (new Date(entry.timestamp).toDateString() === today) uploadsToday++;
      });
    }
    return json({
      scansToday: scansToday, uploadsToday: uploadsToday,
      activeSalespeopleToday: Object.keys(activeSP).length,
      foldersInDrive: folderCount, foldersCreatedToday: foldersToday,
      recentErrors: recentErrors, recentScans: recentScans.reverse().slice(0, 10)
    });
  } catch(err) { return jsonError(err); }
}

function archiveSingleFolder(e) {
  try {
    var folderId = e.parameter.folderId;
    if (!folderId) return json({ success: false, error: "No folderId" });
    var f = DriveApp.getFolderById(folderId);
    var af = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
    af.addFolder(f); pf.removeFolder(f);
    return json({ success: true });
  } catch(err) { return jsonError(err); }
}

function archiveAllOld(e) {
  try { archiveFoldersOlderThanOneDay(); return json({ success: true }); }
  catch(err) { return jsonError(err); }
}

// ────────── JSON HELPERS ──────────
function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function jsonError(err) {
  return ContentService.createTextOutput(JSON.stringify({ error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
}

// ────────── CUSTOMER FOLDER + VISION DETECTION ──────────
function createCustomerFolder(e) {
  var customerName = decodeURIComponent(e.parameter.customerName || "").trim();
  var salesName = decodeURIComponent(e.parameter.salesName || "").trim();
  var today = new Date();
  var dateStamp = (today.getMonth() + 1) + "-" + today.getDate() + "-" + today.getFullYear();
  var folderName = customerName + " -- " + salesName + " -- " + dateStamp;
  var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var existing = pf.getFoldersByName(folderName);
  var folder = existing.hasNext() ? existing.next() : pf.createFolder(folderName);
  // FIX (2026-05-26): saveToHistory now runs on EVERY scan, not just isNew=true.
  // Returning customers (isNew=false from PWA) should still bump to the top of
  // history. saveToHistory already de-dupes and bumps-to-front, so unconditional
  // call is safe.
  saveToHistory(customerName, salesName);
  logScanStart(customerName, salesName, folder.getId());
  return ContentService.createTextOutput(folder.getId());
}

function detectDocumentType(base64Image, docNumber) {
  var url = "https://vision.googleapis.com/v1/images:annotate?key=" + getVisionApiKey();
  var payload = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: "TEXT_DETECTION" }, { type: "LABEL_DETECTION", maxResults: 10 }]
    }]
  };
  var result = JSON.parse(UrlFetchApp.fetch(url, {
    method: "POST", contentType: "application/json", payload: JSON.stringify(payload)
  }).getContentText());
  var text = result.responses[0].textAnnotations
    ? result.responses[0].textAnnotations[0].description.toLowerCase() : "";
  var labels = result.responses[0].labelAnnotations
    ? result.responses[0].labelAnnotations.map(function(l) { return l.description.toLowerCase(); }) : [];
  if (text.indexOf("driver") > -1 || text.indexOf("license") > -1 || text.indexOf("dl") > -1
      || labels.indexOf("driver's license") > -1) {
    var n = extractNameFromLicense(result);
    return n ? n + " -- DL" : "DL";
  }
  return "Doc " + docNumber;
}

function extractNameFromLicense(visionResult) {
  try {
    if (!visionResult.responses[0].textAnnotations) return null;
    var lines = visionResult.responses[0].textAnnotations[0].description.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim().match(/[A-Z]\d{3}-\d{3}/)) {
        var last = (lines[i + 1] || "").trim().replace(/\d/g, "").trim();
        var first = (lines[i + 2] || "").trim().replace(/\d/g, "").trim().split(" ")[0];
        if (last.length > 1 && first.length > 1) {
          return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
               + " " + last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
        }
      }
    }
    return null;
  } catch(e) { return null; }
}

function uploadPhoto(e) {
  try {
    var folderId = "", photoData = "", fileName = "scan.jpg";
    if (e.postData && e.postData.contents) {
      var p = JSON.parse(e.postData.contents);
      folderId = p.folderId || p.folderid || "";
      photoData = p.photodata || p.photoData || "";
      fileName = p.filename || p.fileName || "scan.jpg";
    }
    if (!folderId) return ContentService.createTextOutput("ERROR: no folderId");
    if (photoData.indexOf(",") > -1) photoData = photoData.split(",")[1];
    var folder = DriveApp.getFolderById(folderId);
    var decoded = Utilities.base64Decode(photoData);
    var ef = folder.getFiles(), dc = 0;
    while (ef.hasNext()) { ef.next(); dc++; }
    var sfn = fileName;
    try { sfn = detectDocumentType(photoData, dc + 1) + ".jpg"; }
    catch(err) { sfn = "Doc " + (dc + 1) + ".jpg"; }
    var bn = sfn.replace(/\.jpg$/i, ""), fn = sfn, cnt = 2;
    while (folder.getFilesByName(fn).hasNext()) { fn = bn + " " + cnt + ".jpg"; cnt++; }
    folder.createFile(Utilities.newBlob(decoded, "image/jpeg", fn));
    incrementPhotoCount(folderId);
    logScanComplete(folderId);
    return ContentService.createTextOutput("OK");
  } catch(err) { return ContentService.createTextOutput("ERROR: " + err.toString()); }
}

// ────────── HISTORY SHEET HELPERS ──────────
function saveToHistory(customerName, salesName) {
  customerName = customerName.trim();
  salesName = salesName.trim().replace(/[^\x20-\x7E]/g, "");
  var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(HISTORY_SHEET_NAME);
  var data = sheet.getDataRange().getValues(), salesRow = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === salesName) { salesRow = i; break; }
  }
  var customers = salesRow >= 0 ? data[salesRow].slice(1).filter(function(n) { return n !== ""; }) : [];
  customers = customers.filter(function(n) { return n !== customerName; });
  customers.unshift(customerName);
  if (customers.length > MAX_HISTORY) customers = customers.slice(0, MAX_HISTORY);
  if (salesRow >= 0) {
    for (var col = 1; col <= MAX_HISTORY; col++) {
      sheet.getRange(salesRow + 1, col + 1).setValue(customers[col - 1] || "");
    }
  } else {
    var nr = [salesName];
    for (var idx = 0; idx < MAX_HISTORY; idx++) nr.push(customers[idx] || "");
    sheet.appendRow(nr);
  }
}

function getHistory(e) {
  var salesName = decodeURIComponent(e.parameter.salesName || "").trim().replace(/[^\x20-\x7E]/g, "");
  var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) return ContentService.createTextOutput("New Customer");
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === salesName) {
      var c = data[i].slice(1).filter(function(n) { return n !== ""; });
      c.unshift("New Customer");
      return ContentService.createTextOutput(c.join("\n"));
    }
  }
  return ContentService.createTextOutput("New Customer");
}

// ────────── NEW: hide/unhide customer from history ──────────
// Used by the PWA's swipe-to-remove gesture. Does NOT touch Drive folders —
// only edits the salesperson's recent-customers row in the CustomerHistory
// sheet. The Drive folder, its files, and the ScanLog row all stay intact.
//
// Idempotent: hiding a customer that isn't in the row is a no-op success.
// Idempotent: unhiding a customer that's already at the top is a no-op success.
function hideCustomer(e) {
  try {
    var salesName = decodeURIComponent(e.parameter.salesName || "").trim().replace(/[^\x20-\x7E]/g, "");
    var customerName = decodeURIComponent(e.parameter.customerName || "").trim();
    if (!salesName || !customerName) {
      return ContentService.createTextOutput("ERROR: missing salesName or customerName");
    }
    var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    if (!sheet) return ContentService.createTextOutput("OK"); // nothing to hide
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0].toString().trim() === salesName) {
        var customers = data[i].slice(1).filter(function(n) { return n !== ""; });
        var filtered = customers.filter(function(n) { return n !== customerName; });
        // Rewrite the row with the customer removed (pad empties out to MAX_HISTORY)
        for (var col = 1; col <= MAX_HISTORY; col++) {
          sheet.getRange(i + 1, col + 1).setValue(filtered[col - 1] || "");
        }
        return ContentService.createTextOutput("OK");
      }
    }
    return ContentService.createTextOutput("OK"); // salesperson row didn't exist
  } catch(err) { return ContentService.createTextOutput("ERROR: " + err.toString()); }
}

// Re-add a customer to the front of a salesperson's history row.
// Reuses saveToHistory which already de-dupes and bumps-to-front.
function unhideCustomer(e) {
  try {
    var salesName = decodeURIComponent(e.parameter.salesName || "").trim().replace(/[^\x20-\x7E]/g, "");
    var customerName = decodeURIComponent(e.parameter.customerName || "").trim();
    if (!salesName || !customerName) {
      return ContentService.createTextOutput("ERROR: missing salesName or customerName");
    }
    saveToHistory(customerName, salesName);
    return ContentService.createTextOutput("OK");
  } catch(err) { return ContentService.createTextOutput("ERROR: " + err.toString()); }
}

function logScanStart(customerName, salesName, folderId) {
  var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("ScanLog");
  if (!sheet) return;
  var now = new Date();
  sheet.appendRow([
    salesName, customerName, folderId, now.getTime(),
    (now.getMonth() + 1) + "-" + now.getDate() + "-" + now.getFullYear(),
    now.toLocaleTimeString(), "", "", "In Progress"
  ]);
}

function logScanComplete(folderId) {
  var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("ScanLog");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i][2] === folderId) {
      var ms = new Date().getTime() - data[i][3], sec = Math.floor(ms / 1000);
      sheet.getRange(i + 1, 7).setValue(new Date().toLocaleTimeString());
      sheet.getRange(i + 1, 9).setValue(Math.floor(sec / 60) + "m " + (sec % 60) + "s");
      sheet.getRange(i + 1, 10).setValue("Complete");
      break;
    }
  }
}

function incrementPhotoCount(folderId) {
  var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("ScanLog");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i][2] === folderId) {
      sheet.getRange(i + 1, 8).setValue((sheet.getRange(i + 1, 8).getValue() || 0) + 1);
      break;
    }
  }
}

// ────────── EVENT LOG ──────────
function logDealerScanEvent(data) {
  try {
    var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("DealerScan Events");
    if (!sheet) {
      sheet = ss.insertSheet("DealerScan Events");
      sheet.appendRow(["Timestamp", "Type", "Salesperson", "Customer", "Folder", "Error", "Details"]);
      sheet.setFrozenRows(1);
      sheet.getRange("1:1").setFontWeight("bold");
      [140, 120, 100, 140, 200, 200, 200].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
    }
    sheet.appendRow([
      new Date(), data.type || "unknown", data.salesperson || "", data.customer || "",
      data.folderName || "", data.error || "", JSON.stringify(data)
    ]);
    var rc = sheet.getLastRow();
    if (rc > 1001) sheet.deleteRows(2, rc - 1001);
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function getDealerScanEvents(e) {
  try {
    var limit = parseInt(e.parameter.limit || "50"), type = e.parameter.type || "";
    var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("DealerScan Events");
    if (!sheet) return json({ events: [] });
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return json({ events: [] });
    var events = data.slice(1).reverse()
      .filter(function(r) { return !type || r[1] === type; })
      .slice(0, limit)
      .map(function(r) {
        return {
          timestamp: r[0] ? new Date(r[0]).toISOString() : "",
          type: r[1], salesperson: r[2], customer: r[3],
          folderName: r[4], error: r[5]
        };
      });
    return json({ events: events });
  } catch(err) { return jsonError(err); }
}

function getDealerScanStats(e) {
  try {
    var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("DealerScan Events");
    if (!sheet) return json({});
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return json({});
    var rows = data.slice(1), today = new Date().toDateString();
    var stats = { totalEvents: rows.length, byType: {}, bySalesperson: {}, todayCount: 0, errorCount: 0, lastEvent: null };
    rows.forEach(function(r) {
      var t = r[1] || "unknown", sp = r[2] || "Unknown", ts = r[0] ? new Date(r[0]) : null;
      stats.byType[t] = (stats.byType[t] || 0) + 1;
      stats.bySalesperson[sp] = (stats.bySalesperson[sp] || 0) + 1;
      if (ts && ts.toDateString() === today) stats.todayCount++;
      if (["uploadFailed", "injectFailed", "authFailed"].indexOf(t) > -1) stats.errorCount++;
    });
    var last = rows[rows.length - 1];
    if (last) stats.lastEvent = {
      type: last[1], salesperson: last[2],
      timestamp: last[0] ? new Date(last[0]).toISOString() : ""
    };
    return json(stats);
  } catch(err) { return jsonError(err); }
}

function getVersion(e) { return ContentService.createTextOutput("1.0"); }

// ────────── UPLOAD LOG ──────────
function logUpload(data) {
  var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
  var files = folder.getFilesByName(LOG_FILE_NAME);
  var log = { entries: [] }, file = null;
  if (files.hasNext()) { file = files.next(); log = JSON.parse(file.getBlob().getDataAsString()); }
  log.entries = log.entries || [];
  log.entries.push({
    id: data.id || new Date().getTime().toString(36),
    timestamp: data.timestamp || new Date().toISOString(),
    salesperson: data.salesperson || "Unknown",
    customer: data.customer || "",
    folderName: data.folderName || "",
    folderId: data.folderId || "",
    fileCount: data.fileCount || 0
  });
  if (log.entries.length > 200) log.entries = log.entries.slice(-200);
  var content = JSON.stringify(log);
  if (file) { file.setContent(content); }
  else { folder.createFile(LOG_FILE_NAME, content, "application/json"); }
  return { success: true };
}

// ────────── ARCHIVE / CLEANUP ──────────
function archiveAllFoldersDangerous() {
  var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var af = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  var folders = pf.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    if (!f.getFiles().hasNext()) { f.setTrashed(true); }
    else { af.addFolder(f); pf.removeFolder(f); }
  }
}

function purgeOldArchives() {
  var af = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  var folders = af.getFolders();
  var cut = new Date(); cut.setDate(cut.getDate() - 30);
  while (folders.hasNext()) {
    var f = folders.next();
    if (f.getDateCreated() < cut) f.setTrashed(true);
  }
  DriveApp.emptyTrash();
}

function archiveFoldersOlderThanOneDay() {
  var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var af = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  var cut = new Date(); cut.setDate(cut.getDate() - 1); cut.setHours(0, 0, 0, 0);
  var folders = pf.getFolders(), archived = 0, skipped = 0;
  while (folders.hasNext()) {
    var f = folders.next(), name = f.getName();
    if (name.indexOf("_") === 0) continue;
    if (f.getDateCreated() < cut) {
      if (f.getFiles().hasNext()) { af.addFolder(f); pf.removeFolder(f); Logger.log("Archived: " + name); }
      else { f.setTrashed(true); Logger.log("Trashed: " + name); }
      archived++;
    } else { skipped++; }
  }
  Logger.log("Done — archived:" + archived + ", skipped:" + skipped);
}

function setupArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "archiveFoldersOlderThanOneDay") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("archiveFoldersOlderThanOneDay").timeBased().everyDays(1).atHour(0).create();
  Logger.log("Archive trigger set");
}

function runArchiveNow() { archiveFoldersOlderThanOneDay(); }

// ────────── DASHBOARD SHEET BUILDER ──────────
function setupDashboard() {
  var ss = getHistorySpreadsheet();
  var ex = ss.getSheetByName("📊 Dashboard"); if (ex) ss.deleteSheet(ex);
  var dash = ss.insertSheet("📊 Dashboard"), scan = ss.getSheetByName("ScanLog");
  function hdr(r, l, bg) {
    r.setValue(l).setFontWeight("bold").setFontSize(11)
     .setBackground(bg || "#1a3a6b").setFontColor("#ffffff").setHorizontalAlignment("center");
  }
  function sub(r, l) {
    r.setValue(l).setFontWeight("bold").setFontSize(10)
     .setBackground("#e8edf5").setFontColor("#1a3a6b");
  }
  var data = scan ? scan.getDataRange().getValues() : [], today = new Date(); today.setHours(0, 0, 0, 0);
  var todayRows = [], allRows = [], spMap = {}, hourMap = {}, durSecs = [];
  data.forEach(function(row) {
    var sp = row[0] || "Unknown", ts = row[3] ? new Date(row[3]) : null;
    var dm = String(row[8]).match(/(\d+)m\s*(\d+)s/);
    if (dm) durSecs.push(parseInt(dm[1]) * 60 + parseInt(dm[2]));
    allRows.push(row); spMap[sp] = (spMap[sp] || 0) + 1;
    if (ts) {
      var rd = new Date(ts); rd.setHours(0, 0, 0, 0);
      if (rd.getTime() === today.getTime()) todayRows.push(row);
      hourMap[ts.getHours()] = (hourMap[ts.getHours()] || 0) + 1;
    }
  });
  var avgSec = durSecs.length > 0 ? Math.round(durSecs.reduce(function(a, b) { return a + b; }, 0) / durSecs.length) : 0;
  var avgStr = Math.floor(avgSec / 60) + "m " + (avgSec % 60) + "s";
  var ph = 0, pc = 0;
  Object.keys(hourMap).forEach(function(h) { if (hourMap[h] > pc) { pc = hourMap[h]; ph = parseInt(h); } });
  var ps = ph === 0 ? "12am" : ph < 12 ? ph + "am" : ph === 12 ? "12pm" : (ph - 12) + "pm";
  [160, 120, 120, 120, 40, 160, 120].forEach(function(w, i) { dash.setColumnWidth(i + 1, w); });

  dash.getRange("A1:D1").merge(); hdr(dash.getRange("A1"), "📊 DealerScan — ScanLog Dashboard", "#112f63");
  dash.getRange("A1").setFontSize(14).setHorizontalAlignment("left");
  dash.getRange("E1:G1").merge().setValue("Updated: " + new Date().toLocaleString())
      .setFontSize(9).setFontColor("#888888").setHorizontalAlignment("right");
  dash.getRange("A2:G2").merge().setValue("").setBackground("#e8edf5");
  dash.getRange("A3:D3").merge(); hdr(dash.getRange("A3"), "TODAY'S SUMMARY", "#1a5296");
  sub(dash.getRange("A4"), "Metric"); sub(dash.getRange("B4"), "Value");
  [
    ["Scans Today", todayRows.length],
    ["Active Salespeople", (function() { var s = {}; todayRows.forEach(function(r) { s[r[0]] = 1; }); return Object.keys(s).length; })()],
    ["Avg Scan Duration", avgStr],
    ["Peak Hour", ps + " (" + pc + " scans)"],
    ["Total All Time", allRows.length]
  ].forEach(function(r, i) {
    dash.getRange(5 + i, 1).setValue(r[0]).setFontSize(10);
    dash.getRange(5 + i, 2).setValue(r[1]).setFontSize(10).setFontWeight("bold").setFontColor("#1a5296");
  });
  dash.getRange("F3:G3").merge(); hdr(dash.getRange("F3"), "BY SALESPERSON", "#1a5296");
  sub(dash.getRange("F4"), "Name"); sub(dash.getRange("G4"), "Total Scans");
  Object.entries(spMap).sort(function(a, b) { return b[1] - a[1]; })
    .forEach(function(e, i) {
      dash.getRange(5 + i, 6).setValue(e[0]).setFontSize(10);
      dash.getRange(5 + i, 7).setValue(e[1]).setFontSize(10).setFontWeight("bold").setFontColor("#1a5296");
    });
  var hs = 11; dash.getRange("A" + hs + ":D" + hs).merge();
  hdr(dash.getRange("A" + hs), "HOURLY BREAKDOWN (ALL TIME)", "#1a5296");
  sub(dash.getRange("A" + (hs + 1)), "Hour");
  sub(dash.getRange("B" + (hs + 1)), "Scans");
  sub(dash.getRange("C" + (hs + 1)), "Bar");

  var mx = Math.max.apply(null, Object.values(hourMap).concat([1]));
  for (var h = 7; h <= 19; h++) {
    var cnt = hourMap[h] || 0;
    var lbl = h < 12 ? h + "am" : h === 12 ? "12pm" : (h - 12) + "pm";
    var hr = hs + 2 + (h - 7);
    dash.getRange(hr, 1).setValue(lbl).setFontSize(10);
    dash.getRange(hr, 2).setValue(cnt).setFontSize(10).setFontWeight("bold");
    dash.getRange(hr, 3).setValue("█".repeat(cnt > 0 ? Math.round((cnt / mx) * 20) : 0))
        .setFontColor(cnt === pc && cnt > 0 ? "#e94560" : "#1a7a4a").setFontSize(9);
  }
  var rs = hs + 16; dash.getRange("A" + rs + ":G" + rs).merge();
  hdr(dash.getRange("A" + rs), "RECENT 10 SCANS", "#1a5296");
  ["Salesperson", "Customer", "Folder ID", "Date", "Time", "Duration", "Status"]
    .forEach(function(h, i) { sub(dash.getRange(rs + 1, i + 1), h); });
  data.slice(-10).reverse().forEach(function(row, i) {
    var r = rs + 2 + i;
    [row[0], row[1], row[2], row[4], row[5], row[8], row[9] || row[8]]
      .forEach(function(v, j) {
        var cell = dash.getRange(r, j + 1).setValue(v).setFontSize(9);
        if (j === 6) cell.setFontColor(String(v).includes("Complete") ? "#1a7a4a" : "#e94560");
      });
  });
  dash.setFrozenRows(1); ss.setActiveSheet(dash); ss.moveActiveSheet(1);
  SpreadsheetApp.flush();
  Logger.log("Dashboard built");
}

function setupDashboardTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "setupDashboard") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("setupDashboard").timeBased().everyHours(1).create();
  Logger.log("Dashboard trigger set");
}

function testScanLog() { logScanStart("Test Customer", "Brandon", "testfolderid123"); }

// ────────── google.script.run WRAPPERS (used by HTML Dashboard) ──────────
function getDashOverviewData() {
  try {
    var today = new Date().toDateString();
    var ss = getHistorySpreadsheet();
    var sheet = ss.getSheetByName("ScanLog");
    var scansToday = 0, activeSP = {}, recentScans = [];
    if (sheet) {
      sheet.getDataRange().getValues().forEach(function(row) {
        if (!row[0]) return;
        if (typeof row[3] !== 'number') return;
        var ts = new Date(row[3]);
        if (ts.toDateString() === today) { scansToday++; activeSP[row[0]] = true; }
        recentScans.push({
          salesperson: row[0], customer: row[1],
          status: row[9] || row[8] || "",
          timestamp: ts.toISOString()
        });
      });
    }
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
    var fi = pf.getFolders(), folderCount = 0, foldersToday = 0;
    while (fi.hasNext()) {
      var f = fi.next();
      if (f.getName().indexOf("_") === 0) continue;
      folderCount++;
      if (f.getDateCreated().toDateString() === today) foldersToday++;
    }
    var sysfolder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
    var recentErrors = [], uploadsToday = 0;
    var evFiles = sysfolder.getFilesByName(EVENTS_FILE_NAME);
    if (evFiles.hasNext()) {
      var evLog = JSON.parse(evFiles.next().getBlob().getDataAsString());
      recentErrors = (evLog.events || []).filter(function(ev) {
        return ["uploadFailed", "injectFailed", "authFailed"].indexOf(ev.type) > -1;
      }).reverse().slice(0, 5);
    }
    var logFiles = sysfolder.getFilesByName(LOG_FILE_NAME);
    if (logFiles.hasNext()) {
      var log = JSON.parse(logFiles.next().getBlob().getDataAsString());
      (log.entries || []).forEach(function(e) {
        if (new Date(e.timestamp).toDateString() === today) uploadsToday++;
      });
    }
    return {
      scansToday: scansToday, uploadsToday: uploadsToday,
      activeSalespeopleToday: Object.keys(activeSP).length,
      foldersInDrive: folderCount, foldersCreatedToday: foldersToday,
      recentErrors: recentErrors, recentScans: recentScans.reverse().slice(0, 10)
    };
  } catch(err) {
    return {
      error: err.toString(),
      scansToday: 0, uploadsToday: 0, activeSalespeopleToday: 0,
      foldersInDrive: 0, foldersCreatedToday: 0,
      recentErrors: [], recentScans: []
    };
  }
}

function getDashFoldersData() {
  try {
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID), folders = pf.getFolders(), result = [];
    while (folders.hasNext()) {
      var f = folders.next(), name = f.getName();
      if (name.indexOf("_") === 0) continue;
      var fi = f.getFiles(), fc = 0;
      while (fi.hasNext()) { fi.next(); fc++; }
      result.push({ id: f.getId(), name: name, created: f.getDateCreated().toISOString(), fileCount: fc });
    }
    result.sort(function(a, b) { return new Date(b.created) - new Date(a.created); });
    return { folders: result };
  } catch(err) { return { folders: [], error: err.toString() }; }
}

function getDashScanLogData() {
  try {
    var ss = getHistorySpreadsheet(), sheet = ss.getSheetByName("ScanLog");
    if (!sheet) return { entries: [] };
    var entries = sheet.getDataRange().getValues().map(function(row) {
      return {
        salesperson: row[0] || "", customer: row[1] || "", folderId: row[2] || "",
        timestamp: row[3] ? new Date(row[3]).toISOString() : "",
        date: row[4] || "", timeStart: row[5] || "", timeEnd: row[6] || "",
        photoCount: row[7] || 0, duration: row[8] || "", status: row[9] || row[8] || ""
      };
    }).filter(function(r) { return r.salesperson; });
    return { entries: entries.reverse() };
  } catch(err) { return { entries: [], error: err.toString() }; }
}

function getDashEventLogData() {
  try {
    var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID), files = folder.getFilesByName(EVENTS_FILE_NAME);
    if (!files.hasNext()) return { events: [] };
    var log = JSON.parse(files.next().getBlob().getDataAsString());
    return { events: (log.events || []).reverse().slice(0, 200) };
  } catch(err) { return { events: [], error: err.toString() }; }
}

function archiveAllOldFolders() {
  try { archiveFoldersOlderThanOneDay(); return { success: true }; }
  catch(err) { return { success: false, error: err.toString() }; }
}

function saveDashConfigFromClient(configJson) {
  try {
    var config = JSON.parse(configJson);
    writeConfigToSystem(config);
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function archiveSingleFolderById(folderId) {
  try {
    var f = DriveApp.getFolderById(folderId);
    var af = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
    var pf = DriveApp.getFolderById(PARENT_FOLDER_ID);
    af.addFolder(f); pf.removeFolder(f);
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

// ────────── USER REGISTRY ──────────
function getDashUsers() {
  try {
    var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
    var files = folder.getFilesByName("_DealerScan_Users.json");
    if (!files.hasNext()) return {};
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch(err) { return {}; }
}

function removeUserFromRegistry(email) {
  try {
    var folder = DriveApp.getFolderById(SYSTEM_FOLDER_ID);
    var files = folder.getFilesByName("_DealerScan_Users.json");
    if (!files.hasNext()) return { success: false, error: "No users file" };
    var file = files.next();
    var users = JSON.parse(file.getBlob().getDataAsString());
    delete users[email];
    file.setContent(JSON.stringify(users));
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function getDashConfigWithUsers() {
  var config = getDashConfig();
  var users = getDashUsers();
  Object.entries(users).forEach(function(entry) {
    var email = entry[0], user = entry[1];
    var name = user.name || email;
    if (!config.users[name]) config.users[name] = { enabled: true, email: email, lastSeen: user.lastSeen };
    else { config.users[name].email = email; config.users[name].lastSeen = user.lastSeen; }
  });
  config.registeredUsers = users;
  return config;
}

// ────────── END OF FILE ──────────
