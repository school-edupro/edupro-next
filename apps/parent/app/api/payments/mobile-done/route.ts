/**
 * The phone app's end of a family payment (docs/design/89): the gateway returns to /api/payments/return, which
 * sends the browser here with ?paid=. The app's checkout view watches for this address and closes before
 * anything shows; if it ever loads, a plain line says to go back to the app. No page of the web app is used.
 */
export function GET(req: Request) {
  const paid = new URL(req.url).searchParams.get('paid') === '1';
  const text = paid
    ? 'Payment received. Go back to the EduPro app.'
    : 'The payment did not go through. Go back to the EduPro app.';
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
