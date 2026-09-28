/**
 * Location matching. LinkedIn locations look like "Toronto, Ontario, Canada",
 * "Canada (Remote)", "Greater Vancouver Metropolitan Area" or "Montreal, QC".
 */

const CANADA_ALIASES = [
  "canada",
  // provinces & territories
  "ontario",
  "quebec",
  "québec",
  "british columbia",
  "alberta",
  "manitoba",
  "saskatchewan",
  "nova scotia",
  "new brunswick",
  "newfoundland",
  "prince edward island",
  "yukon",
  "northwest territories",
  "nunavut",
  // major metros (LinkedIn often omits the country for these)
  "toronto",
  "vancouver",
  "montreal",
  "montréal",
  "calgary",
  "edmonton",
  "ottawa",
  "winnipeg",
  "mississauga",
  "brampton",
  "hamilton",
  "kitchener",
  "waterloo",
  "halifax",
  "victoria, bc",
  "saskatoon",
  "regina",
  "markham",
  "burnaby",
  "surrey, bc",
  "gatineau",
  "laval",
  "oakville",
  "london, on",
];

/** Two-letter province codes, matched only as ", XX" to avoid false hits. */
const CANADA_PROVINCE_CODES = ["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

/** LinkedIn geo ids usable in search URLs. */
export const GEO_IDS: Record<string, string> = {
  canada: "101174742",
  "united states": "103644278",
  "united kingdom": "101165590",
  india: "102713980",
};

export function geoIdFor(place: string): string | undefined {
  return GEO_IDS[place.trim().toLowerCase()];
}

function aliasesFor(place: string): string[] {
  const p = place.trim().toLowerCase();
  return p === "canada" ? CANADA_ALIASES : [p];
}

/** True if `text` names a location inside any of `places`. */
export function inAnyLocation(text: string | null | undefined, places: string[]): boolean {
  if (!text || places.length === 0) return places.length === 0;
  const t = text.toLowerCase();
  for (const place of places) {
    if (aliasesFor(place).some((a) => t.includes(a))) return true;
    if (place.trim().toLowerCase() === "canada") {
      if (CANADA_PROVINCE_CODES.some((c) => new RegExp(`,\\s*${c}\\b`).test(text))) return true;
    }
  }
  return false;
}
