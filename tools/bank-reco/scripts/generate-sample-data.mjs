/**
 * Generate synthetic sample data for the Bank Reconciliation tool.
 * Produces:
 *   sample-data/sample-bank-statement.xlsx
 *   sample-data/sample-bc-ledger.xlsx
 *
 * Run: node scripts/generate-sample-data.mjs
 */
import * as XLSX from "xlsx";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "sample-data");

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

const startDate = new Date(2026, 3, 1); // Apr 1
const days = 5;
const bankRows = [];
const bcRows = [];

let balance = 50000;
let bcAmtRunning = 50000;

for (let d = 0; d < days; d++) {
  const date = new Date(startDate.getTime() + d * 86400000);

  // Card settlement (1:1 match)
  const card1 = +(Math.random() * 18000 + 3000).toFixed(2);
  balance += card1; bcAmtRunning += card1;
  bankRows.push([fmtDate(date), `${60000000 + d}TERMINAL 1 CARDS SETTL. ${fmtDate(date)}`, "0000000", fmtDate(date), null, card1, balance]);
  bcRows.push({ date, doc: `BR-DEMO/26-27/06-${100 + d * 10}`, desc: "Card Group (HDFC)", amount: card1, dir: "Credit" });

  const card2 = +(Math.random() * 12000 + 2000).toFixed(2);
  balance += card2; bcAmtRunning += card2;
  bankRows.push([fmtDate(date), `${60000010 + d}TERMINAL 1 CARDS SETTL. ${fmtDate(date)}`, "0000000", fmtDate(date), null, card2, balance]);
  bcRows.push({ date, doc: `BR-DEMO/26-27/06-${101 + d * 10}`, desc: "Card Group (HDFC)", amount: card2, dir: "Credit" });

  // Swiggy NEFT (sum of N small BC entries)
  const swiggyParts = 3 + Math.floor(Math.random() * 4); // 3-6 parts
  let swiggyTotal = 0;
  for (let i = 0; i < swiggyParts; i++) {
    const part = +(Math.random() * 800 + 200).toFixed(2);
    swiggyTotal += part;
    bcRows.push({ date, doc: `BR-DEMO/26-27/07-${200 + d * 10 + i}`, desc: "Dineout Group", amount: part, dir: "Credit" });
  }
  swiggyTotal = +swiggyTotal.toFixed(2);
  balance += swiggyTotal;
  bankRows.push([fmtDate(date), `NEFT CR-YESB0000001-SWIGGY LIMITED-DEMO RESTAURANT-YES${260000000 + d}`, `YES${260000000 + d}`, fmtDate(date), null, swiggyTotal, balance]);

  // Inter-account credit (1:1 match)
  if (d % 2 === 0) {
    const intrn = 100000 + d * 25000;
    balance += intrn;
    bankRows.push([fmtDate(date), `IB FUNDS TRANSFER CR-50200044492574-DEMO RESTAURANTS PVT LTD`, `NB${Math.floor(Math.random() * 999999999999)}`, fmtDate(date), null, intrn, balance]);
    bcRows.push({ date, doc: `PCV-26-27/DEMO/00000${d + 1}`, desc: "HDFC 50200044492574 (Internal)", amount: intrn, dir: "Credit" });
  }

  // Inter-account debit
  if (d % 3 === 1) {
    const debit = 30000 + d * 10000;
    balance -= debit;
    bankRows.push([fmtDate(date), `IB FUNDS TRANSFER DR-50200044492574-DEMO RESTAURANTS PVT LTD`, `NB${Math.floor(Math.random() * 999999999999)}`, fmtDate(date), debit, null, balance]);
    bcRows.push({ date, doc: `PCV-26-27/DEMO/0000${10 + d}`, desc: "HDFC 50200044492574 (Internal)", amount: -debit, dir: "Debit" });
  }

  // Individual invoice receipts (these stay unmatched — represent cash sales pending deposit)
  for (let i = 0; i < 8 + Math.floor(Math.random() * 4); i++) {
    const inv = +(Math.random() * 1500 + 100).toFixed(2);
    bcRows.push({ date, doc: `PP/26-27/0${1000 + d * 100 + i}`, desc: `Invoice PP/26-27/23-${i + 1}`, amount: inv, dir: "Credit" });
  }
}

// ---- Bank statement workbook ----
const bankSheet = XLSX.utils.aoa_to_sheet([
  ["HDFC BANK Ltd.", null, null, null, null, null, null],
  [], [], [], [],
  ["M/S. DEMO RESTAURANTS PVT LTD", null, null, null, null, null, null],
  [], [], [], [], [], [], [],
  ["Nomination : Not Registered", null, null, null, "Account No : 50209999999999", null, null],
  ["Statement From : 01/04/2026  To : 05/04/2026", null, null, null, null, null, null],
  [], [], [], [], [],
  ["Date", "Narration", "Chq/Ref Number", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  ["********", "**********", "********", "********", "**********", "**********", "**********"],
  ...bankRows,
]);
const bankWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(bankWb, bankSheet, "Account Statement");

// ---- BC ledger workbook ----
const bcSheetData = bcRows.map(r => ({
  "Posting Date": r.date,
  "Document Type": "Payment",
  "Document No.": r.doc,
  "Description": r.desc,
  "Branch Code": "DEMO",
  "Amount": r.amount,
}));
const bcWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(bcWb, XLSX.utils.json_to_sheet(bcSheetData), "Ledger");

// Write
await mkdir(OUT_DIR, { recursive: true });
const bankBuf = XLSX.write(bankWb, { type: "buffer", bookType: "xlsx" });
const bcBuf = XLSX.write(bcWb, { type: "buffer", bookType: "xlsx" });
await writeFile(path.join(OUT_DIR, "sample-bank-statement.xlsx"), bankBuf);
await writeFile(path.join(OUT_DIR, "sample-bc-ledger.xlsx"), bcBuf);

console.log(`Generated:`);
console.log(`  ${path.join(OUT_DIR, "sample-bank-statement.xlsx")} (${bankRows.length} bank rows)`);
console.log(`  ${path.join(OUT_DIR, "sample-bc-ledger.xlsx")} (${bcRows.length} BC rows)`);
