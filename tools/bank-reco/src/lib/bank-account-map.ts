/**
 * HDFC account number → outlet name mapping (Sandoz Restaurants Pvt. Ltd.).
 *
 * Source: 00 Source Data/BC Clearing Ledgers/Bank Accounts (2).xlsx
 * Updated: 2026-06-19.
 *
 * Used to annotate inter-outlet IB FUNDS TRANSFER bank lines with the
 * counter-party outlet name, so the accountant can look up the matching
 * voucher on the other outlet's BC ledger.
 */
// Each row maps a BC bank-account code/label to one OR more raw HDFC account
// numbers — some accounts appear in bank narrations under more than one
// number (e.g. PV: bank-master row stored 50200047521810 but actual debits
// resolve as 50200045030891; GGN51: master truncates the leading zero).
type AccountRow = { code: string; name: string; accounts: string[] };

const BANK_ACCOUNTS: AccountRow[] = [
  { code: "HDFC005",  name: "TRADE",            accounts: ["50200073808005"] },
  { code: "HDFC035",  name: "L-10",             accounts: ["50200105650035"] },
  { code: "HDFC124",  name: "SN",               accounts: ["50200078174124"] },
  { code: "HDFC146",  name: "Dwarka",           accounts: ["50200097599146"] },
  { code: "HDFC160",  name: "TN",               accounts: ["50200046932160"] },
  { code: "HDFC189",  name: "RG",               accounts: ["50200046834189"] },
  { code: "HDFC190",  name: "NSP",              accounts: ["50200062099190"] },
  { code: "HDFC230",  name: "MUS",              accounts: ["50200068440230"] },
  { code: "HDFC321",  name: "CP",               accounts: ["50200046912321"] },
  { code: "HDFC340",  name: "GOA",              accounts: ["50200088323340"] },
  { code: "HDFC380",  name: "GGN51",            accounts: ["50200106558380", "5020106558380"] },
  { code: "HDFC412",  name: "BK Vendor Control",accounts: ["50200070730412"] },
  { code: "HDFC460",  name: "LN",               accounts: ["50200043172460"] },
  { code: "HDFC574",  name: "AV",               accounts: ["50200044492574"] },
  { code: "HDFC670",  name: "N Block CP",       accounts: ["50200076461670"] },
  { code: "HDFC699",  name: "DBG",              accounts: ["50200046806699"] },
  { code: "HDFC711",  name: "MN",               accounts: ["50200047838711"] },
  { code: "HDFC712",  name: "SDA",              accounts: ["50200059468712"] },
  { code: "HDFC723",  name: "DD",               accounts: ["50200048672723"] },
  { code: "HDFC739",  name: "Utility",          accounts: ["50200067780739"] },
  { code: "HDFC761",  name: "NP",               accounts: ["50200046398761"] },
  { code: "HDFC793",  name: "EQUIPMENT",        accounts: ["50200073745793"] },
  { code: "HDFC801",  name: "ASR",              accounts: ["50200082329801"] },
  { code: "HDFC802",  name: "MR",               accounts: ["50200075737802"] },
  { code: "HDFC810",  name: "KB",               accounts: ["50200047521810"] },
  { code: "HDFC891",  name: "PV",               accounts: ["50200045030891", "50200047521810"] },
  { code: "HDFC8915", name: "HDFC-OD",          accounts: ["50200084148915"] },
  { code: "HDFC902",  name: "HK",               accounts: ["50200063164902"] },
  { code: "HDFC931",  name: "BBQ",              accounts: ["50200075167931"] },
  { code: "HDFC950",  name: "Vendor Payments",  accounts: ["50200069648950"] },
  { code: "HDFC962",  name: "RESERVE",          accounts: ["50200073807962"] },
  { code: "HDFC976",  name: "GGN54",            accounts: ["99910003101976"] },
];

/**
 * Look up an outlet name (or other account label) from a HDFC account number
 * embedded in a bank narration. Supports trailing/leading garbage by checking
 * substring containment from both directions.
 */
/**
 * Reverse lookup: given the LAST N digits of an HDFC account number
 * (typically the 4 digits in a bank-filename like DWK_9146 → "9146"),
 * find the outlet whose account ends with those digits. Used by batch
 * mode to robustly pair bank files with BC ledgers.
 */
export function outletForAccountSuffix(suffix: string): string | null {
  const s = String(suffix).replace(/\D/g, "");
  if (s.length < 3) return null;
  for (const a of BANK_ACCOUNTS) {
    for (const acc of a.accounts) {
      if (acc.endsWith(s)) return a.name;
    }
  }
  return null;
}

export function outletForAccountNo(accountNo: string): string | null {
  const trimmed = String(accountNo).replace(/\s+/g, "");
  if (trimmed.length < 10) return null;
  const exact = BANK_ACCOUNTS.find(a => a.accounts.includes(trimmed));
  if (exact) return exact.name;
  // Fallback: substring match in either direction (handles narrations that
  // truncate or pad the number by one digit)
  const found = BANK_ACCOUNTS.find(a =>
    a.accounts.some(acc => trimmed.includes(acc) || acc.includes(trimmed)),
  );
  return found?.name ?? null;
}

/** Extract a HDFC 14-digit account number from a bank narration if present. */
export function extractAccountFromNarration(narration: string): string | null {
  // HDFC account numbers in narration look like 50200044492574 (14 digits
  // starting 50200) or 99910003101976 (14 digits starting 999100).
  const m = narration.match(/\b(5020\d{10}|99910\d{9})\b/);
  return m?.[1] ?? null;
}

export function outletFromNarration(narration: string): string | null {
  const acc = extractAccountFromNarration(narration);
  return acc ? outletForAccountNo(acc) : null;
}
