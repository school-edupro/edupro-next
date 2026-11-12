/** An amount in words, the Indian way ("Rupees One Lakh Twenty Thousand Five Hundred and Paise Fifty Only"). */
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function upTo99(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]!}${n % 10 ? ` ${ONES[n % 10]!}` : ''}`;
}
function upTo999(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]!} Hundred` : '', rest ? upTo99(rest) : ''].filter(Boolean).join(' ');
}
function whole(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${whole(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (rest) parts.push(upTo999(rest));
  return parts.join(' ');
}

/** "52015.50" → "Rupees Fifty Two Thousand Fifteen and Paise Fifty Only" */
export function amountInWords(rupees: string): string {
  const [r, p = '0'] = rupees.replace(/^-/, '').split('.');
  const paise = Number(p.padEnd(2, '0').slice(0, 2));
  return `Rupees ${whole(Number(r))}${paise ? ` and Paise ${upTo99(paise)}` : ''} Only`;
}
