// Client-safe phone formatter for the booth InfoForm. Auto-spaces US/NANP
// numbers as the user types and falls through to a generic international
// format (digits chunked in 3s after the +) when a country code is given.
//
// Server-side normalization to E.164 lives in lib/state.ts (`normalizePhone`).
// This file is just for what the input field shows; the wire format is still
// whatever the user typed, and the server canonicalizes on receipt.

// Format a NANP (10-digit US/Canada) number progressively. Examples:
//   ""           -> ""
//   "1"          -> "1"
//   "111"        -> "111"
//   "1112"       -> "111 2"
//   "111222"     -> "111 222"
//   "1112223"    -> "111 222 3"
//   "1112223333" -> "111 222 3333"
function formatNANP(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
}

// Insert a space after every 3 digits from the left. Used for international
// numbers where we don't try to guess country-specific grouping.
//   "447700900123" -> "447 700 900 123"
function spaceEvery3(digits: string): string {
  return digits.replace(/(.{3})(?=.)/g, '$1 ');
}

// Format the live input string. We keep the leading "+" if present (signals
// international) and otherwise treat input as NANP. Anything past 10 digits
// without a "+" gets the generic chunked format too.
export function formatPhoneInput(raw: string): string {
  if (!raw) return '';
  const trimmed = String(raw);
  const isIntl = trimmed.trimStart().startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 0) return isIntl ? '+' : '';

  if (isIntl) {
    // Special-case +1 (NANP) to show like "+1 (NANP-format)" so US users who
    // type "+1 5551234567" get the same readable grouping.
    if (digits.startsWith('1') && digits.length <= 11) {
      const rest = digits.slice(1);
      return rest.length === 0 ? '+1' : '+1 ' + formatNANP(rest);
    }
    return '+' + spaceEvery3(digits);
  }

  // No leading "+". Treat as NANP up to 10 digits, then fall back to the
  // generic format for over-long inputs (the server will reject 16+ digits).
  if (digits.length <= 10) return formatNANP(digits);
  return spaceEvery3(digits);
}
