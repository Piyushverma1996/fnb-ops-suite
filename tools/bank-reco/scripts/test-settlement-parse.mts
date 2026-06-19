/** Test settlement parsing on real files. */
import * as fs from "node:fs";
import { parseSwiggyText, parseZomatoBuffer } from "../src/lib/settlement.ts";

const SWIGGY_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Swiggy";
const ZOMATO_DIR = "C:/Users/HP/Downloads/Dynamic Sale working/00 Source Data/Aggregator settlement reports/Zomato";

const swiggyFiles = fs.readdirSync(SWIGGY_DIR).filter(f => f.endsWith(".csv"));
console.log("=== SWIGGY ===");
for (const f of swiggyFiles) {
  const text = fs.readFileSync(`${SWIGGY_DIR}/${f}`, "utf-8");
  const settlements = parseSwiggyText(text, f);
  console.log(`${f}: ${settlements.length} settlements`);
  settlements.slice(0, 3).forEach(s => {
    const dr = s.periodStart && s.periodEnd ? `${s.periodStart.toISOString().slice(0,10)}→${s.periodEnd.toISOString().slice(0,10)}` : "?";
    console.log(`  UTR=${s.utr.padEnd(20)} RID=${s.rid.padEnd(8)} ${s.orderCount} orders ${dr}  Net=₹${s.netPayout.toFixed(2)}  Gross=₹${s.grossSales.toFixed(2)}  Fee=₹${s.totalCommission.toFixed(2)}`);
  });
  // Sum
  const totalNet = settlements.reduce((t, s) => t + s.netPayout, 0);
  console.log(`  TOTAL NET PAYOUTS: ₹${totalNet.toFixed(2)} across ${new Set(settlements.map(s => s.utr)).size} unique UTRs`);
}

console.log("\n=== ZOMATO ===");
const zomatoFiles = fs.readdirSync(ZOMATO_DIR).filter(f => f.endsWith(".xlsx")).slice(0, 4);
for (const f of zomatoFiles) {
  const buf = fs.readFileSync(`${ZOMATO_DIR}/${f}`);
  const settlements = parseZomatoBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, f);
  console.log(`${f.slice(0, 70)}: ${settlements.length} settlements`);
  settlements.slice(0, 3).forEach(s => {
    const dr = s.periodStart && s.periodEnd ? `${s.periodStart.toISOString().slice(0,10)}→${s.periodEnd.toISOString().slice(0,10)}` : "?";
    console.log(`  UTR=${s.utr.padEnd(20)} RID=${s.rid.padEnd(8)} ${s.orderCount} orders ${dr}  Net=₹${s.netPayout.toFixed(2)}`);
  });
  const totalNet = settlements.reduce((t, s) => t + s.netPayout, 0);
  console.log(`  TOTAL NET PAYOUTS: ₹${totalNet.toFixed(2)} across ${new Set(settlements.map(s => s.utr)).size} unique UTRs`);
}
