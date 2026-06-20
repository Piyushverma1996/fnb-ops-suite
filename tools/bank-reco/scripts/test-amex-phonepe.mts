/** Test AmEx + PhonePe parsers. */
import * as fs from "node:fs";
import { parseAmexText, parsePhonePeText } from "../src/lib/settlement.ts";

const AMEX1 = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Amex/Settlements06202026_061550.csv";
const AMEX2 = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Amex/Settlements06202026_061643.csv";
const PHONEPE = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Phonepe/SANDOZRESTAURANTSALL_FORWARD_TRANSACTION_17819611287384115513543601272619.csv";

const a1 = parseAmexText(fs.readFileSync(AMEX1, "utf-8"), "Amex1");
const a2 = parseAmexText(fs.readFileSync(AMEX2, "utf-8"), "Amex2");
console.log(`AmEx file 1: ${a1.length} settlements, total net ₹${a1.reduce((t, s) => t + s.netPayout, 0).toFixed(2)}`);
a1.slice(0, 5).forEach(s => console.log(`  ${s.periodStart?.toISOString().slice(0,10)}  num ${s.utr}  net ₹${s.netPayout.toFixed(2)}  fees ₹${s.totalCommission.toFixed(2)}`));
console.log(`AmEx file 2: ${a2.length} settlements, total net ₹${a2.reduce((t, s) => t + s.netPayout, 0).toFixed(2)}`);
a2.slice(0, 3).forEach(s => console.log(`  ${s.periodStart?.toISOString().slice(0,10)}  num ${s.utr}  net ₹${s.netPayout.toFixed(2)}`));

const pp = parsePhonePeText(fs.readFileSync(PHONEPE, "utf-8"), "PhonePe");
console.log(`\nPhonePe: ${pp.length} settlements grouped by UTR, total ₹${pp.reduce((t, s) => t + s.netPayout, 0).toFixed(2)}`);
const utrs = new Set(pp.map(s => s.utr));
console.log(`Unique UTRs: ${utrs.size}`);
pp.slice(0, 5).forEach(s => console.log(`  UTR ${s.utr.padEnd(15)}  RID ${s.rid.padEnd(20)}  ${s.orderCount} txns  ₹${s.netPayout.toFixed(2)}`));

// Sample UTR formats
console.log(`\nSample PhonePe UTRs: ${[...utrs].slice(0, 5).join(", ")}`);
console.log(`Sample AmEx settlement numbers: ${a1.slice(0, 5).map(s => s.utr).join(", ")}`);
