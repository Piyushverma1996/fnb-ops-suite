/**
 * Static Rest-ID ↔ Outlet mapping for Sandoz Restaurants Pvt. Ltd.
 *
 * Source: 00 Source Data/Aggregator settlement reports/Rest ID Details.xlsx
 * Updated: 2026-06-19 (23 outlets).
 *
 * When a settlement carries a Swiggy/Zomato RID we use this table to label
 * the match with the outlet name in the report. Pure presentation — does
 * not affect matching decisions.
 */
export type OutletRow = {
  outletName: string;
  swiggyRid: string;
  petpoojaRid: string;
  zomatoRid: string;
};

export const OUTLET_TABLE: OutletRow[] = [
  { outletName: "Cafe Sandoz - N Block, CP",     swiggyRid: "808733",  petpoojaRid: "104801", zomatoRid: "20535525" },
  { outletName: "Cafe Sandoz - NSP",             swiggyRid: "435624",  petpoojaRid: "107277", zomatoRid: "19827588" },
  { outletName: "Cafe Sandoz - Satya niketan",   swiggyRid: "678513",  petpoojaRid: "111333", zomatoRid: "20599724" },
  { outletName: "Cafe Sandoz - SDA Market",      swiggyRid: "401756",  petpoojaRid: "78909",  zomatoRid: "19694962" },
  { outletName: "Cafe Sandoz Gurgaon 51",        swiggyRid: "1046869", petpoojaRid: "366730", zomatoRid: "21701549" },
  { outletName: "Sandoz - Amritsar",             swiggyRid: "503642",  petpoojaRid: "151401", zomatoRid: "20977817" },
  { outletName: "Sandoz - Arya Samaj Road",      swiggyRid: "21528",   petpoojaRid: "148386", zomatoRid: "1906" },
  { outletName: "Sandoz - Ashok Vihar",          swiggyRid: "89445",   petpoojaRid: "106298", zomatoRid: "18899245" },
  { outletName: "Sandoz - Jail Road",            swiggyRid: "200806",  petpoojaRid: "106302", zomatoRid: "19177622" },
  { outletName: "Sandoz - L Block CP",           swiggyRid: "292513",  petpoojaRid: "336278", zomatoRid: "19362000" },
  { outletName: "Sandoz - Lajpat Nagar",         swiggyRid: "192755",  petpoojaRid: "99162",  zomatoRid: "19123592" },
  { outletName: "Sandoz - Paschim vihar",        swiggyRid: "156822",  petpoojaRid: "106300", zomatoRid: "19070941" },
  { outletName: "Sandoz CP P Block",             swiggyRid: "21526",   petpoojaRid: "374587", zomatoRid: "18273629" },
  { outletName: "Sandoz DB Gupta Road",          swiggyRid: "55440",   petpoojaRid: "111947", zomatoRid: "1908" },
  { outletName: "Sandoz Dwarka",                 swiggyRid: "893099",  petpoojaRid: "329922", zomatoRid: "" },
  { outletName: "Sandoz gurgaon 54",             swiggyRid: "798381",  petpoojaRid: "147493", zomatoRid: "20885208" },
  { outletName: "Sandoz Mathura Road",           swiggyRid: "647311",  petpoojaRid: "99835",  zomatoRid: "20507636" },
  { outletName: "Sandoz Nehru Place",            swiggyRid: "238934",  petpoojaRid: "374590", zomatoRid: "19280557" },
  { outletName: "Sandoz Rajouri Garden",         swiggyRid: "52290",   petpoojaRid: "374589", zomatoRid: "18662571" },
  { outletName: "Sandoz - Moti Nagar",           swiggyRid: "308835",  petpoojaRid: "104845", zomatoRid: "19530532" },
  { outletName: "Sandoz - Shahpur Jat",          swiggyRid: "436465",  petpoojaRid: "104846", zomatoRid: "20014351" },
  { outletName: "Sandoz NSP",                    swiggyRid: "436057",  petpoojaRid: "107277", zomatoRid: "19827559" },
  { outletName: "Sandoz BBQ",                    swiggyRid: "637714",  petpoojaRid: "374591", zomatoRid: "" },
];

const SWIGGY_BY_RID = new Map<string, OutletRow>(OUTLET_TABLE.filter(o => o.swiggyRid).map(o => [o.swiggyRid, o]));
const ZOMATO_BY_RID = new Map<string, OutletRow>(OUTLET_TABLE.filter(o => o.zomatoRid).map(o => [o.zomatoRid, o]));
const PETPOOJA_BY_RID = new Map<string, OutletRow>(OUTLET_TABLE.filter(o => o.petpoojaRid).map(o => [o.petpoojaRid, o]));

export function outletForSwiggy(rid: string): OutletRow | undefined { return SWIGGY_BY_RID.get(String(rid).trim()); }
export function outletForZomato(rid: string): OutletRow | undefined { return ZOMATO_BY_RID.get(String(rid).trim()); }
export function outletForPetpooja(rid: string): OutletRow | undefined { return PETPOOJA_BY_RID.get(String(rid).trim()); }

/** Best-effort outlet lookup across all three platforms. */
export function outletForAnyRid(rid: string): OutletRow | undefined {
  return outletForSwiggy(rid) ?? outletForZomato(rid) ?? outletForPetpooja(rid);
}
