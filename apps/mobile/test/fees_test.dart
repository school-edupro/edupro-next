import 'package:edupro/family/fee_pay.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:flutter_test/flutter_test.dart';

/// The fee payment's rules in the app, as the web app's pay panel has them (made-up figures).
void main() {
  PayRow row(
    String due,
    String status, {
    String balance = '1000',
    String late = '0',
    bool online = true,
  }) => PayRow.of({
    'dueOn': due,
    'label': due,
    'net': balance,
    'paid': '0',
    'balance': balance,
    'lateFee': {'outstanding': late},
    'status': status,
    'feePay': online,
  });

  test(
    'ticked the oldest first: what is due today to start with; all ticked pays the ledger figure',
    () {
      final rows = [
        row('2026-04-10', 'paid', balance: '0'),
        row('2026-07-10', 'overdue', late: '50'),
        row('2026-10-10', 'due'),
        row('2027-01-10', 'upcoming'),
        row('2027-02-10', 'upcoming', online: false),
      ];
      final open = openRows(rows);
      expect(open.map((r) => r.dueOn), ['2026-07-10', '2026-10-10', '2027-01-10']);
      expect(firstUpTo(open), 1);
      expect(feeFor(open, 1, 3050), 2050);
      expect(feeFor(open, 0, 3050), 1050);
      expect(feeFor(open, -1, 3050), 0);
      // every open row: exactly the ledger's own payable figure
      expect(feeFor(open, 2, 3050), 3050);
      expect(firstUpTo(openRows([row('2027-01-10', 'upcoming')])), -1);
    },
  );

  test('the convenience charge as the API works it out', () {
    expect(chargeOn(12650, {'chargePercent': '1.50', 'chargeFlat': '0'}), 189.75);
    expect(chargeOn(12650, {'chargePercent': '0', 'chargeFlat': '10.00'}), 10);
    expect(chargeOn(1000, {'chargePercent': '1.18', 'chargeFlat': '5'}), 16.8);
    const s = S(false);
    expect(chargeText(s, {'chargePercent': '1.50', 'chargeFlat': '10'}), '₹10 + 1.50%');
    expect(chargeText(s, {'chargePercent': '0', 'chargeFlat': '0'}), '');
  });

  test("the app's end of a payment, and where the gateway's page is opened from", () {
    expect(
      paymentEnd(Uri.parse('https://p.example.test/api/payments/mobile-done?paid=1&student=41')),
      '1',
    );
    expect(
      paymentEnd(Uri.parse('https://p.example.test/api/payments/mobile-done?paid=failed')),
      'failed',
    );
    expect(paymentEnd(Uri.parse('https://p.example.test/fees?paid=1')), isNull);
    expect(paymentEnd(null), isNull);
    expect(
      checkoutBase({'returnUrl': 'https://p.example.test/api/payments/mobile-done?student=41'}),
      'https://p.example.test/fees/pay',
    );
    expect(checkoutBase({'returnUrl': null}), 'about:blank');
  });

  test(
    "the gateway hand-over: a posted form, Razorpay's checkout, Atom's script only from Atom",
    () {
      final intent = {'amount': '100.00', 'txnId': 'TXN1'};
      final form = checkoutHtml(intent, {
        'kind': 'form',
        'provider': 'payu',
        'action': 'https://test.payu.example/_payment',
        'fields': {'txnid': 'TXN1', 'productinfo': '<b>"x"</b>'},
      });
      expect(form, contains('action="https://test.payu.example/_payment"'));
      expect(form, contains('name="productinfo" value="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"'));
      expect(form, contains('document.getElementById("gw").submit()'));
      final rp = checkoutHtml(intent, {
        'kind': 'razorpay',
        'keyId': 'rzp_test',
        'orderId': 'order_1',
        'amount': 10000,
        'currency': 'INR',
        'name': 'School fees',
        'description': 'x</script><script>alert(1)',
        'prefill': {},
        'notes': {},
        'callbackUrl': 'https://p.example.test/api/payments/return?provider=razorpay',
      });
      expect(rp, contains('https://checkout.razorpay.com/v1/checkout.js'));
      expect(
        rp,
        contains('"callback_url":"https://p.example.test/api/payments/return?provider=razorpay"'),
      );
      // a value cannot close the script
      expect(rp, isNot(contains('</script><script>alert(1)')));
      final atom = checkoutHtml(intent, {
        'kind': 'atom',
        'scriptUrl': 'https://evil.example/atomcheckout.js',
        'atomTokenId': 't',
        'merchId': 'm',
        'env': 'uat',
      });
      expect(atom, isNot(contains('evil.example')));
      final atomOk = checkoutHtml(intent, {
        'kind': 'atom',
        'scriptUrl': 'https://pgtest.atomtech.in/staticdata/ots/js/atomcheckout.js',
        'env': 'uat',
      });
      expect(
        atomOk,
        contains('src="https://pgtest.atomtech.in/staticdata/ots/js/atomcheckout.js"'),
      );
    },
  );
}
