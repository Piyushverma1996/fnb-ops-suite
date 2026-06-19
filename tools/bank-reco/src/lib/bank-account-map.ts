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
type AccountRow = { code: string; name: string; account: string };

const BANK_ACCOUNTS: AccountRow[] = [
  { code: "HDFC005",  name: "TRADE",            account: "50200073808005" },
  { code: "HDFC035",  name: "L-10",             account: "50200105650035" },
  { code: "HDFC124",  name: "SN",               account: "50200078174124" },
  { code: "HDFC146",  name: "Dwarka",           account: "50200097599146" },
  { code: "HDFC160",  name: "TN",               account: "50200046932160" },
  { code: "HDFC189",  name: "RG",               account: "50200046834189" },
  { code: "HDFC190",  name: "NSP",              account: "50200062099190" },
  { code: "HDFC230",  name: "MUS",              account: "50200068440230" },
  { code: "HDFC321",  name: "CP",               account: "50200046912321" },
  { code: "HDFC340",  name: "GOA",              account: "50200088323340" },
  { code: "HDFC380",  name: "GGN51",            account: "5020106558380"  },
  { code: "HDFC412",  name: "BK Vendor Control",account: "50200070730412" },
  { code: "HDFC460",  name: "LN",               account: "50200043172460" },
  { code: "HDFC574",  name: "AV",               account: "50200044492574" },
  { code: "HDFC670",  name: "N Block CP",       account: "50200076461670" },
  { code: "HDFC699",  name: "DBG",              account: "50200046806699" },
  { code: "HDFC711",  name: "MN",               account: "50200047838711" },
  { code: "HDFC712",  name: "SDA",              account: "50200059468712" },
  { code: "HDFC723",  name: "DD",               account: "50200048672723" },
  { code: "HDFC739",  name: "Utility",          account: "50200067780739" },
  { code: "HDFC761",  name: "NP",               account: "50200046398761" },
  { code: "HDFC793",  name: "EQUIPMENT",        account: "50200046398761" },
  { code: "HDFC801",  name: "ASR",              account: "50200082329801" },
  { code: "HDFC802",  name: "MR",               account: "50200075737802" },
  { code: "HDFC810",  name: "KB",               account: "50200047521810" },
  { code: "HDFC891",  name: "PV",               account: "50200047521810" },
  { code: "HDFC8915", name: "HDFC-OD",          account: "50200084148915" },
  { code: "HDFC902",  name: "HK",               account: "50200063164902" },
  { code: "HDFC931",  name: "BBQ",              account: "50200075167931" },
  { code: "HDFC950",  name: "Vendor Payments",  account: "50200069648950" },
  { code: "HDFC962",  name: "RESERVE",          account: "50200073807962" },
  { code: "HDFC976",  name: "GGN54",            account: "99910003101976" },
];

/**
 * Look up an outlet name (or other account label) from a HDFC account number
 * embedded in a bank narration. Supports trailing/leading garbage by checking
 * substring containment from both directions.
 */
export function outletForAccountNo(accountNo: string): string | null {
  const trimmed = String(accountNo).replace(/\s+/g, "");
  if (trimmed.length < 10) return null;
  const exact = BANK_ACCOUNTS.find(a => a.account === trimmed);
  if (exact) return exact.name;
  // Fallback: longest-suffix or substring match (handles bank narrations that
  // truncate the leading 502 prefix or pad with extra digits)
  const found = BANK_ACCOUNTS.find(a => trimmed.includes(a.account) || a.account.includes(trimmed));
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
