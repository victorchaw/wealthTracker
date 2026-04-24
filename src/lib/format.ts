const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", AUD: "A$", CAD: "C$",
  CHF: "CHF", CNY: "¥", HKD: "HK$", SGD: "S$", INR: "₹", KRW: "₩",
  MXN: "Mex$", BRL: "R$", THB: "฿", PHP: "₱", IDR: "Rp", VND: "₫",
  TWD: "NT$", MYR: "RM", NZD: "NZ$", SEK: "kr", NOK: "kr", DKK: "kr",
  ZAR: "R", AED: "AED", SAR: "SAR",
};

export function currencySymbol(code: string) {
  return CURRENCY_SYMBOLS[code?.toUpperCase()] ?? code ?? "$";
}

export function formatMoney(amount: number, currency = "USD") {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currencySymbol(currency)}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelativeMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export const CURRENCY_OPTIONS = Object.keys(CURRENCY_SYMBOLS);