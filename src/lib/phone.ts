// Shared validation for every customer create/edit form. Phone is always
// collected as two parts -- country code and national number -- and only
// ever combined, never split back apart: country calling codes aren't
// fixed-length (1-3 digits), so recovering them from an already-combined
// string is unreliable. See customers.phone's comment in supabase-schema.sql.
export const DEFAULT_COUNTRY_CODE = "+91";

// Up to 4 digits: countries-list gives some codes with their area code included (e.g. Jamaica +1876).
export function isValidCountryCode(code: string): boolean {
  return /^\+[1-9]\d{0,3}$/.test(code);
}

// India (+91) mobile numbers are always exactly 10 digits. Everywhere else,
// just check it's plausible -- national numbers run anywhere from ~4 to 14
// digits once the country code is excluded (E.164's 15-digit total cap).
export function isValidPhoneNumber(countryCode: string, number: string): boolean {
  if (!/^\d+$/.test(number)) return false;
  if (countryCode === "+91") return number.length === 10;
  return number.length >= 4 && number.length <= 14;
}

// E.164 caps the full number (code + national number) at 15 digits.
export function isValidPhone(countryCode: string, number: string): boolean {
  return (
    isValidCountryCode(countryCode) &&
    isValidPhoneNumber(countryCode, number) &&
    countryCode.length - 1 + number.length <= 15
  );
}

export function combinePhone(countryCode: string, number: string): string {
  return `${countryCode}${number}`;
}

export function sanitizePhoneNumberInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}
