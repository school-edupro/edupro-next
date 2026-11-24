import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'office_parts.dart';

/// The words of My tax (as the staff website's, in English and Hindi).
extension MyTaxWords on S {
  String _tx(String en, String hi) => hindi ? hi : en;

  String get txNotLinked => _tx(
    'Your sign-in is not linked to an employee record, so you have no tax here.',
    'आपका साइन-इन किसी कर्मचारी रिकॉर्ड से नहीं जुड़ा है, इसलिए यहाँ कोई कर नहीं है।',
  );
  String txTitle(String fy) => _tx('My tax · $fy', 'मेरा कर · $fy');
  String txIntro(String from, String to, String due) => _tx(
    'Declarations are taken from $from to $to. They count in your monthly tax until $due; after that, only what payroll verified from your proofs.',
    'घोषणाएँ $from से $to तक ली जाती हैं। $due तक ये आपके मासिक कर में गिनी जाती हैं; उसके बाद केवल वही जो पेरोल ने प्रमाणों से सत्यापित किया।',
  );
  String get txYear => _tx('Financial year', 'वित्तीय वर्ष');
  String txCannot(String why) => _tx(
    'The year’s tax cannot be worked out yet: $why',
    'वर्ष का कर अभी नहीं निकाला जा सकता: $why',
  );
  String get txNoSheet =>
      _tx('No tax is worked out for this year.', 'इस वर्ष का कोई कर नहीं निकला।');
  String txRegime(String? r) =>
      r == 'OLD' ? _tx('old regime', 'पुरानी व्यवस्था') : _tx('new regime', 'नई व्यवस्था');
  String txForYear(String r) => _tx('Tax for the year ($r)', 'वर्ष का कर ($r)');
  String get txSoFar => _tx('Deducted so far', 'अब तक कटा');
  String get txPaid => _tx('The year is paid', 'वर्ष का कर चुका');
  String txFromMonth(String m) => _tx('From $m, a month', '$m से, हर महीने');
  String txInOther(String r) => _tx('In the $r', '$r में');
  String get txOther => _tx('The other regime', 'दूसरी व्यवस्था');
  String txFinal(String amount, String reason, int? months, String? computed) => _tx(
    'The school’s final figure is used: $amount ($reason${months != null ? '; collected by month $months of the year' : ''}).${computed != null ? ' Worked out: $computed.' : ''}',
    'विद्यालय का अंतिम आँकड़ा लिया गया: $amount ($reason${months != null ? '; वर्ष के महीने $months तक वसूला' : ''})।${computed != null ? ' गणना: $computed।' : ''}',
  );
  String get txNoPan => _tx(
    'No PAN on record: tax is at least 20 % of the taxable income.',
    'रिकॉर्ड में PAN नहीं: कर करयोग्य आय का कम से कम 20 % है।',
  );
  String txWorking(String r) => _tx('The year’s working ($r)', 'वर्ष की गणना ($r)');
  String txLine(String k) => switch (k) {
    'gross' => _tx(
      'Salary for the year (paid, this month, the months left)',
      'वर्ष का वेतन (मिला, इस महीने, बाकी महीने)',
    ),
    'perquisites' => _tx(
      'of which perquisites and the employer’s NPS',
      'इसमें अनुलाभ और नियोक्ता का NPS',
    ),
    'prevSalary' => _tx('of which the earlier employer’s salary', 'इसमें पिछले नियोक्ता का वेतन'),
    'exemptions' => _tx('Less: HRA exempt', 'घटाएँ: HRA छूट'),
    'standardDeduction' => _tx('Less: standard deduction', 'घटाएँ: मानक कटौती'),
    'pt' => _tx('Less: profession tax', 'घटाएँ: व्यवसाय कर'),
    'otherIncome' => _tx('Add: other income', 'जोड़ें: अन्य आय'),
    'houseLoss' => _tx(
      'Less: a house’s loss (housing-loan interest)',
      'घटाएँ: मकान की हानि (गृह-ऋण ब्याज)',
    ),
    'deductions' => _tx('Less: deductions', 'घटाएँ: कटौतियाँ'),
    'taxable' => _tx('Taxable income', 'करयोग्य आय'),
    'slabTax' => _tx('Tax on it', 'उस पर कर'),
    'rebate' => _tx('Less: rebate', 'घटाएँ: छूट'),
    'surcharge' => _tx('Surcharge', 'अधिभार'),
    'cess' => _tx('Cess', 'उपकर'),
    _ => _tx('Tax for the year', 'वर्ष का कर'),
  };
  String txHra(String received, String rent, String salary, String exempt) => _tx(
    'HRA: received $received, rent $rent, basic and DA $salary — exempt $exempt (the least of the three legs).',
    'HRA: मिला $received, किराया $rent, मूल और DA $salary — छूट $exempt (तीनों में सबसे कम)।',
  );
  String txNps(String annual, String allowed) => _tx(
    'Employer’s NPS $annual is income; $allowed of it is deducted.',
    'नियोक्ता का NPS $annual आय है; इसमें से $allowed घटाया गया।',
  );
  String txClaimed(String label, String declared, String allowed, String? cut) => _tx(
    '$label: claimed $declared, counted $allowed${cut != null ? ' ($cut)' : ''}',
    '$label: दावा $declared, गिना $allowed${cut != null ? ' ($cut)' : ''}',
  );
  String txCut(String c) => switch (c) {
    'cap' => _tx('over its limit', 'सीमा से अधिक'),
    'group' => _tx('over the shared limit', 'साझा सीमा से अधिक'),
    'regime' => _tx('not in this regime', 'इस व्यवस्था में नहीं'),
    _ => c,
  };
  String get txPlan => _tx('Month by month', 'महीने दर महीने');
  String txPlanState(String st) => switch (st) {
    'deducted' => _tx('Deducted', 'कटा'),
    'typed' => _tx('Typed by payroll', 'पेरोल ने लिखा'),
    'planned' => _tx('Planned', 'योजना'),
    _ => '—',
  };
  String get txDeclarations => _tx('My declarations', 'मेरी घोषणाएँ');
  String txDeclared(String label, String declared, String? verified) => _tx(
    '$label: declared $declared${verified != null ? ', verified $verified' : ''}',
    '$label: घोषित $declared${verified != null ? ', सत्यापित $verified' : ''}',
  );
  String txDeclStatus(String st) => switch (st) {
    'VERIFIED' => _tx('Verified', 'सत्यापित'),
    'REJECTED' => _tx('Rejected', 'अस्वीकृत'),
    _ => _tx('Declared', 'घोषित'),
  };
  String txNothingDeclared(String fy) =>
      _tx('Nothing declared for $fy.', '$fy के लिए कुछ घोषित नहीं।');
  String get txDeclHelp => _tx(
    'Declaring a section again replaces it (until it is verified). Do not declare the PF payroll deducts: it is added to 80C by itself.',
    'किसी धारा को फिर घोषित करने पर वह बदल जाती है (सत्यापन तक)। पेरोल जो PF काटता है उसे घोषित न करें: वह अपने आप 80C में जुड़ता है।',
  );
  String get txDeclForm => _tx('My declaration form (PDF)', 'मेरा घोषणा पत्र (PDF)');
  String get txDeclare => _tx('Declare', 'घोषित करें');
  String get txClosed => _tx(
    'The declaration window is closed: ask the payroll office.',
    'घोषणा की अवधि बंद है: पेरोल कार्यालय से पूछें।',
  );
  String get txSection => _tx('Section', 'धारा');
  String get txOldOnly => _tx('(old regime)', '(पुरानी व्यवस्था)');
  String txCap(String cap) => _tx('Up to $cap a year counts.', 'वर्ष में $cap तक गिना जाता है।');
  String get txRentHelp => _tx(
    'Rent paid each month (₹; leave a month blank if none)',
    'हर महीने दिया किराया (₹; जिस महीने नहीं दिया उसे खाली छोड़ें)',
  );
  String get txCity => _tx('City where the house is', 'मकान का शहर');
  String get txLandlord => _tx('Landlord’s name', 'मकान मालिक का नाम');
  String get txLandlordAddress => _tx('Landlord’s address', 'मकान मालिक का पता');
  String get txRelation => _tx(
    'Your relationship with the landlord (None if none)',
    'मकान मालिक से आपका संबंध (न हो तो None)',
  );
  String get txLandlordPan => _tx(
    'Landlord’s PAN (needed above ₹1,00,000 rent a year)',
    'मकान मालिक का PAN (वर्ष में ₹1,00,000 से अधिक किराये पर)',
  );
  String get txAmount => _tx('Amount for the year (₹)', 'वर्ष की राशि (₹)');
  String get txProofs => _tx(
    'Proofs (PDF or photo, 10 MB each; can be added later)',
    'प्रमाण (PDF या फ़ोटो, हर एक 10 MB तक; बाद में भी जोड़ सकते हैं)',
  );
  String get txAddProof => _tx('Add a proof', 'प्रमाण जोड़ें');
  String txRemoveProof(String name) => _tx('Remove $name', '$name हटाएँ');
  String get txProofWrong => _tx(
    'A PDF or a photo (JPEG, PNG) up to 10 MB; up to 5.',
    'PDF या फ़ोटो (JPEG, PNG), 10 MB तक; अधिकतम 5।',
  );
  String get txPrevTitle =>
      _tx('Salary from an earlier employer this year', 'इस वर्ष पिछले नियोक्ता से वेतन');
  String txPrev(String name, String gross, String tds) =>
      _tx('$name: salary $gross, tax $tds', '$name: वेतन $gross, कर $tds');
  String txPrevStatus(String st) => switch (st) {
    'VERIFIED' => _tx('Verified', 'सत्यापित'),
    'REJECTED' => _tx('Rejected', 'अस्वीकृत'),
    _ => _tx('Waiting for payroll', 'पेरोल की प्रतीक्षा में'),
  };
  String get txNoPrev => _tx('None entered.', 'कुछ नहीं लिखा।');
  String get txChangePrev => _tx('Change it', 'बदलें');
  String get txEnterPrev => _tx('Enter an earlier employer', 'पिछला नियोक्ता लिखें');
  String get txEmployer => _tx('Employer', 'नियोक्ता');
  String get txTan => _tx('Employer’s TAN', 'नियोक्ता का TAN');
  String get txGross => _tx('Gross salary (₹)', 'सकल वेतन (₹)');
  String get txExempt => _tx('Exempt allowances (₹)', 'छूट वाले भत्ते (₹)');
  String get txPf => _tx('PF deducted (₹)', 'कटा PF (₹)');
  String get txPtCut => _tx('Profession tax deducted (₹)', 'कटा व्यवसाय कर (₹)');
  String get txTds => _tx('Tax deducted (₹)', 'कटा कर (₹)');
  String get txProof1 => _tx('Proof (PDF or photo)', 'प्रमाण (PDF या फ़ोटो)');
  String get txSave => _tx('Save', 'सहेजें');
  String get txPrevSaved => _tx('Saved: payroll verifies it.', 'सहेजा गया: पेरोल सत्यापित करेगा।');
  String txMyRegime(String r) => _tx('My regime: $r', 'मेरी व्यवस्था: $r');
  String get txChangeTo => _tx('Change to', 'बदलकर');
  String get txNewRegime => _tx('New regime', 'नई व्यवस्था');
  String get txOldRegime => _tx('Old regime', 'पुरानी व्यवस्था');
  String get txChangeRegime => _tx('Change my regime', 'मेरी व्यवस्था बदलें');
  String txRegimeUntil(String m) =>
      _tx('You can change it until the end of $m.', 'आप इसे $m के अंत तक बदल सकते हैं।');
  String get txRegimeShut => _tx(
    'The regime can no longer be changed this year: ask the payroll office.',
    'इस वर्ष व्यवस्था अब नहीं बदली जा सकती: पेरोल कार्यालय से पूछें।',
  );
  String get txCertTitle => _tx('My tax certificate', 'मेरा कर प्रमाणपत्र');
  String txCert(String fy) => _tx('Form 16 / 130 for $fy', '$fy का फ़ॉर्म 16 / 130');
  String get txCertPassword =>
      _tx('(opens with your payslip password)', '(आपकी वेतन पर्ची के पासवर्ड से खुलता है)');
  String get txCertLater => _tx(
    'It appears here once payroll issues it after the year closes.',
    'वर्ष बंद होने के बाद पेरोल के जारी करने पर यह यहाँ दिखेगा।',
  );
  String get txWithdrawn => _tx('Withdrawn.', 'वापस लिया गया।');
  String get txNeedAmount => _tx('Give the amount in rupees.', 'राशि रुपयों में लिखें।');
  String get txNeedRent =>
      _tx('Give the rent of at least one month.', 'कम से कम एक महीने का किराया लिखें।');
  String get txNeedLandlord => _tx(
    'Give the city, the landlord’s name, address and your relationship.',
    'शहर, मकान मालिक का नाम, पता और आपका संबंध लिखें।',
  );
  String get txNeedPan =>
      _tx('The PAN looks wrong (ABCDE1234F).', 'PAN सही नहीं लगता (ABCDE1234F)।');
  String get txNeedTan =>
      _tx('The TAN looks wrong (ABCD12345E).', 'TAN सही नहीं लगता (ABCD12345E)।');
  String get txNeedEmployer =>
      _tx('Give the employer and the gross salary.', 'नियोक्ता और सकल वेतन लिखें।');
}

const _monthsEn = [
  'January', 'February', 'March', 'April', 'May', 'June', //
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _monthsHi = [
  'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', //
  'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर',
];

final _money = RegExp(r'^\d{1,11}(\.\d{1,2})?$');
final _okProof = RegExp(r'^(application/pdf|image/(png|jpeg))$');
final _panRe = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$');
final _tanRe = RegExp(r'^[A-Z]{4}[0-9]{5}[A-Z]$');

String _clean(String v) => v.replaceAll(',', '').trim();

/// My tax of a year (null: my sign-in has no employee record).
final myTaxProvider = FutureProvider.autoDispose.family<Json?, (Profile, String?)>((ref, a) async {
  try {
    return asJson(await ref.read(apiProvider).payrollTaxMine(fy: a.$2));
  } on ApiException catch (e) {
    if (e.status == 404 || e.status == 403) return null;
    rethrow;
  }
});

/// My tax as on the staff website (docs/design/86, phase D): the year's tax as payroll works it out (the figures, the
/// working, month by month), my declarations with their proofs (withdraw; declare a section — HRA by month), my
/// declaration form, the salary from an earlier employer, my regime until the cut-off, and my tax certificate.
class MyTaxScreen extends ConsumerStatefulWidget {
  const MyTaxScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<MyTaxScreen> createState() => _MyTaxScreenState();
}

class _MyTaxScreenState extends ConsumerState<MyTaxScreen> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  String? _fy;
  String? _regime;

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  void _reload() => ref.invalidate(myTaxProvider((widget.profile, _fy)));

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    try {
      await ref.read(apiProvider).payrollTaxWithdraw(id: id);
      _reload();
      _say(s.txWithdrawn);
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  Future<void> _changeRegime(String fy, String to) async {
    final s = ref.read(stringsProvider);
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .payrollTaxRegimeMine(
              body: MyRegimeDto(fy: fy, regime: to),
            ),
      );
      _reload();
      _say('${r['message'] ?? ''}');
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: AsyncBody<Json?>(
          value: ref.watch(myTaxProvider((widget.profile, _fy))),
          retry: _reload,
          data: (d) {
            if (d == null) {
              return ListView(
                padding: const EdgeInsets.all(Tokens.sp4),
                children: [Notice(text: s.txNotLinked)],
              );
            }
            final muted = officeMuted(context);
            final fy = '${d['fy']}';
            final year = asJson(d['year']);
            final years = [for (final y in (d['years'] as List? ?? const [])) '$y'];
            final labels = asList(d['labels']);
            final labelOf = {for (final l in labels) '${l['code']}': '${l['label']}'};
            final decls = asList(d['declarations']);
            final prev = d['prev'] == null ? null : asJson(d['prev']);
            final regime = asJson(d['regime']);
            final cert = d['certificate'] == null ? null : asJson(d['certificate']);
            final open = year['open'] == true;
            final cutoff = ((regime['cutoffMonth'] as num?) ?? 0).toInt();
            final monthWord = cutoff >= 1 && cutoff <= 12
                ? (s.hindi ? _monthsHi : _monthsEn)[cutoff - 1]
                : '';
            final current = '${regime['current'] ?? 'NEW'}';
            return ListView(
              key: const Key('txScreen'),
              padding: const EdgeInsets.all(Tokens.sp4),
              children: [
                Text(
                  s.txTitle(fy),
                  style: Theme.of(context).textTheme.titleLarge
                      ?.copyWith(fontWeight: Tokens.fwBold),
                ),
                const SizedBox(height: Tokens.sp1),
                Text(
                  s.txIntro(
                    s.date(year['declareFrom'] ?? ''),
                    s.date(year['declareTo'] ?? ''),
                    s.date(year['proofDue'] ?? ''),
                  ),
                  style: TextStyle(color: muted, fontSize: 14),
                ),
                if (years.length > 1) ...[
                  const SizedBox(height: Tokens.sp2),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    children: [
                      for (final y in years)
                        ChoiceChip(
                          key: Key('txFy-$y'),
                          label: Text(y),
                          selected: y == fy,
                          onSelected: (_) => setState(() => _fy = y),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: Tokens.sp3),
                _TaxSheet(sheet: asJson(d['tax']), labels: labelOf),
                officeCard(context, s.txDeclarations, key: const Key('txDecls'), [
                  if (decls.isEmpty) Text(s.txNothingDeclared(fy)),
                  for (final x in decls)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Tokens.sp2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.txDeclared(
                              labelOf['${x['lineCode']}'] ?? '${x['lineCode']}',
                              s.money(x['declared']),
                              x['verified'] == null ? null : s.money(x['verified']),
                            ),
                          ),
                          Wrap(
                            spacing: Tokens.sp2,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              StatusChip(
                                s.txDeclStatus('${x['status']}'),
                                switch ('${x['status']}') {
                                  'VERIFIED' => Tone.success,
                                  'REJECTED' => Tone.danger,
                                  _ => Tone.neutral,
                                },
                              ),
                              if (x['status'] != 'VERIFIED' && open)
                                TextButton(
                                  key: Key('txWithdraw-${x['id']}'),
                                  onPressed: () => _withdraw('${x['id']}'),
                                  child: Text(s.withdraw),
                                ),
                            ],
                          ),
                          if (x['rejectReason'] != null)
                            Text(
                              '${x['rejectReason']}',
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                        ],
                      ),
                    ),
                  Text(s.txDeclHelp, style: TextStyle(color: muted, fontSize: 13)),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(s.txDeclForm),
                      FileIcons(
                        label: s.txDeclForm,
                        name: 'txForm-$fy',
                        load: () => api.payrollTaxDocsMyForm(fy: fy),
                      ),
                    ],
                  ),
                  if (open)
                    _DeclareForm(
                      key: ValueKey('txDeclare-$fy'),
                      fy: fy,
                      labels: labels,
                      onDone: (said) {
                        _reload();
                        _say(said);
                      },
                    )
                  else
                    Text(s.txClosed, style: TextStyle(color: muted, fontSize: 13)),
                ]),
                officeCard(context, s.txPrevTitle, key: const Key('txPrev'), [
                  if (prev == null)
                    Text(s.txNoPrev)
                  else
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          s.txPrev(
                            '${prev['employerName']}',
                            s.money(prev['gross']),
                            s.money(prev['tds']),
                          ),
                        ),
                        StatusChip(
                          s.txPrevStatus('${prev['status']}'),
                          switch ('${prev['status']}') {
                            'VERIFIED' => Tone.success,
                            'REJECTED' => Tone.danger,
                            _ => Tone.neutral,
                          },
                        ),
                      ],
                    ),
                  if (year['frozen'] != true && prev?['status'] != 'VERIFIED')
                    _PrevForm(
                      key: ValueKey('txPrevForm-$fy'),
                      fy: fy,
                      title: prev == null ? s.txEnterPrev : s.txChangePrev,
                      onDone: () {
                        _reload();
                        _say(s.txPrevSaved);
                      },
                    ),
                ]),
                officeCard(context, s.txMyRegime(s.txRegime(current)), key: const Key('txRegime'), [
                  if (regime['open'] == true) ...[
                    DropdownMenu<String>(
                      key: const Key('txRegimeTo'),
                      label: Text(s.txChangeTo),
                      trailingIcon: dropArrow(s.txChangeTo),
                      selectedTrailingIcon: dropArrow(s.txChangeTo, open: true),
                      expandedInsets: EdgeInsets.zero,
                      enableFilter: true,
                      enableSearch: true,
                      requestFocusOnTap: true,
                      initialSelection: _regime ?? (current == 'OLD' ? 'NEW' : 'OLD'),
                      onSelected: (v) => setState(() => _regime = v),
                      dropdownMenuEntries: [
                        DropdownMenuEntry(value: 'NEW', label: s.txNewRegime),
                        DropdownMenuEntry(value: 'OLD', label: s.txOldRegime),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    OutlinedButton(
                      key: const Key('txRegimeSave'),
                      onPressed: () =>
                          _changeRegime(fy, _regime ?? (current == 'OLD' ? 'NEW' : 'OLD')),
                      child: Text(s.txChangeRegime),
                    ),
                    const SizedBox(height: Tokens.sp1),
                  ],
                  Text(
                    regime['open'] == true ? s.txRegimeUntil(monthWord) : s.txRegimeShut,
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                ]),
                officeCard(context, s.txCertTitle, key: const Key('txCert'), [
                  if (cert?['released'] == true)
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(s.txCert(fy)),
                        FileIcons(
                          label: s.txCert(fy),
                          name: 'txCert-$fy',
                          load: () => api.payrollTaxDocsMine(fy: fy),
                        ),
                        Text(s.txCertPassword, style: TextStyle(color: muted, fontSize: 13)),
                      ],
                    )
                  else
                    Text(s.txCertLater),
                ]),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The year's tax as the next run would work it out: the figures, the school's final figure, a missing PAN, the
/// warnings, the working line by line (only the lines with an amount), HRA and NPS in words, the deductions claimed
/// and counted, and month by month.
class _TaxSheet extends ConsumerWidget {
  const _TaxSheet({required this.sheet, required this.labels});
  final Json sheet;
  final Map<String, String> labels;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = officeMuted(context);
    final d = sheet;
    if (d['error'] != null) return Notice(text: s.txCannot('${d['error']}'));
    if (d['sheet'] == null) return Notice(text: s.txNoSheet);
    final x = asJson(d['sheet']);
    final regime = s.txRegime(d['regime'] as String?);
    final other = d['otherRegime'] == null ? null : asJson(d['otherRegime']);
    final fin = asJson(asJson(d['annual'])['final']);
    final working = asJson(d['working']);
    final hra = working['hra'] == null ? null : asJson(working['hra']);
    final nps = working['npsEr'] == null ? null : asJson(working['npsEr']);
    final plan = asList(d['plan']);
    final month = DateTime.tryParse('${d['month']}-01');
    bool some(Object? v) => (num.tryParse('${v ?? ''}') ?? 0) != 0;
    const lines = [
      ('gross', true),
      ('perquisites', false),
      ('prevSalary', false),
      ('exemptions', false),
      ('standardDeduction', false),
      ('pt', false),
      ('otherIncome', false),
      ('houseLoss', false),
      ('deductions', false),
      ('taxable', true),
      ('slabTax', false),
      ('rebate', false),
      ('surcharge', false),
      ('cess', false),
      ('total', true),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FigureGrid(
          key: const Key('txFigures'),
          tiles: [
            FigureTile(
              label: s.txForYear(regime),
              value: s.money(x['total']),
              icon: Icons.account_balance_outlined,
            ),
            FigureTile(
              label: s.txSoFar,
              value: s.money(x['ytdTds']),
              icon: Icons.check_circle_outline,
            ),
            FigureTile(
              label: d['done'] == true
                  ? s.txPaid
                  : s.txFromMonth(month == null ? '' : s.month(month)),
              value: d['done'] == true ? '—' : s.money(x['monthly']),
              icon: Icons.calendar_month_outlined,
            ),
            FigureTile(
              label: other != null
                  ? s.txInOther(s.txRegime(other['regime'] as String?))
                  : s.txOther,
              value: other != null ? s.money(other['total']) : '—',
              icon: Icons.compare_arrows,
            ),
          ],
        ),
        if (fin.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp2),
          Notice(
            text: s.txFinal(
              s.money(fin['annual']),
              '${fin['reason'] ?? ''}',
              (fin['spreadMonths'] as num?)?.toInt(),
              asJson(d['annual'])['computed'] == null
                  ? null
                  : s.money(asJson(d['annual'])['computed']),
            ),
          ),
        ],
        if (x['panAbsent'] == true) ...[const SizedBox(height: Tokens.sp2), officeNote(s.txNoPan)],
        for (final w in (x['warnings'] as List? ?? const []))
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp1),
            child: Text('$w', style: TextStyle(color: muted, fontSize: 13)),
          ),
        officeCard(context, s.txWorking(regime), key: const Key('txWorking'), [
          for (final (k, strong) in lines)
            if (some(x[k])) FactLine(s.txLine(k), s.money(x[k]), strong: strong),
          if (hra != null)
            Text(
              s.txHra(
                s.money(hra['received']),
                s.money(hra['rent']),
                s.money(hra['salary']),
                s.money(hra['exempt']),
              ),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          if (nps != null)
            Text(
              s.txNps(s.money(nps['annual']), s.money(nps['allowed'])),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          for (final c in asList(working['deductions']))
            Text(
              s.txClaimed(
                labels['${c['code']}'] ?? '${c['code']}',
                s.money(c['declared']),
                s.money(c['allowed']),
                c['cut'] == null ? null : s.txCut('${c['cut']}'),
              ),
              style: TextStyle(color: muted, fontSize: 13),
            ),
        ]),
        if (plan.isNotEmpty)
          officeCard(context, s.txPlan, key: const Key('txPlan'), [
            for (final p in plan)
              Padding(
                padding: const EdgeInsets.only(bottom: Tokens.sp1),
                child: Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      DateTime.tryParse('${p['month']}-01') == null
                          ? '${p['month']}'
                          : s.month(DateTime.parse('${p['month']}-01')),
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    Text(p['amount'] == null ? '—' : s.money(p['amount'])),
                    if (const ['deducted', 'typed', 'planned'].contains(p['state']))
                      StatusChip(s.txPlanState('${p['state']}'), switch ('${p['state']}') {
                        'deducted' => Tone.success,
                        'typed' => Tone.info,
                        _ => Tone.neutral,
                      })
                    else
                      const Text('—'),
                  ],
                ),
              ),
          ]),
      ],
    );
  }
}

/// Proofs picked for a declaration (PDF or photo, 10 MB each, up to 5), uploaded on Save.
class _Proofs extends ConsumerWidget {
  const _Proofs({
    required this.files,
    required this.onChanged,
    required this.label,
    required this.keyName,
  });
  final List<PickedFile> files;
  final ValueChanged<List<PickedFile>> onChanged;
  final String label;
  final String keyName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        for (final f in files)
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: Tokens.sp1,
            children: [
              const Icon(Icons.attach_file, size: 18),
              Text(f.name),
              TextButton(
                onPressed: () => onChanged([...files]..remove(f)),
                child: Text(s.txRemoveProof(f.name)),
              ),
            ],
          ),
        if (files.length < 5)
          OutlinedButton.icon(
            key: Key('$keyName-add'),
            icon: const Icon(Icons.attach_file),
            label: Text(s.txAddProof),
            onPressed: () async {
              final picked = await ref.read(leaveFilePickerProvider)();
              final ok = picked
                  .where(
                    (f) => _okProof.hasMatch(f.contentType) && f.bytes.length <= 10 * 1024 * 1024,
                  )
                  .toList();
              if (ok.length < picked.length && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.txProofWrong)));
              }
              if (ok.isNotEmpty) onChanged([...files, ...ok].take(5).toList());
            },
          ),
      ],
    );
  }
}

Future<List<String>> _upload(WidgetRef ref, List<PickedFile> files) async => [
  for (final f in files) await uploadFile(ref.read(apiProvider), ref.read(transportProvider), f),
];

/// Declare a section: its amount, or — for HRA — the rent of each month of the year, the city and the landlord (the
/// landlord's PAN above ₹1 lakh a year); proofs. Folded until opened, as the website's "Declare".
class _DeclareForm extends ConsumerStatefulWidget {
  const _DeclareForm({super.key, required this.fy, required this.labels, required this.onDone});
  final String fy;
  final List<Json> labels;
  final ValueChanged<String> onDone;

  @override
  ConsumerState<_DeclareForm> createState() => _DeclareFormState();
}

class _DeclareFormState extends ConsumerState<_DeclareForm> {
  late String _code = widget.labels.isEmpty ? '' : '${widget.labels.first['code']}';
  final _amount = TextEditingController();
  late final _rents = {for (final m in _months) m: TextEditingController()};
  final _city = TextEditingController();
  final _landlord = TextEditingController();
  final _address = TextEditingController();
  final _relation = TextEditingController();
  final _pan = TextEditingController();
  List<PickedFile> _proofs = [];
  bool _busy = false;
  String? _error;

  List<String> get _months {
    final y = int.tryParse(widget.fy.substring(0, 4)) ?? DateTime.now().year;
    return [
      for (var k = 0; k < 12; k++)
        '${k < 9 ? y : y + 1}-${(((k + 3) % 12) + 1).toString().padLeft(2, '0')}',
    ];
  }

  @override
  void dispose() {
    for (final c in [_amount, _city, _landlord, _address, _relation, _pan, ..._rents.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final hra = _code == 'HRA_RENT';
    String? problem;
    final months = <DeclareDtoHraMonthsItem>[];
    if (hra) {
      for (final e in _rents.entries) {
        final v = _clean(e.value.text);
        if (v.isEmpty) continue;
        if (!_money.hasMatch(v)) {
          problem = s.txNeedAmount;
          break;
        }
        if ((num.tryParse(v) ?? 0) > 0) months.add(DeclareDtoHraMonthsItem(month: e.key, rent: v));
      }
      if (problem == null && months.isEmpty) problem = s.txNeedRent;
      if (problem == null &&
          (_city.text.trim().length < 2 ||
              _landlord.text.trim().length < 2 ||
              _address.text.trim().length < 5 ||
              _relation.text.trim().length < 2)) {
        problem = s.txNeedLandlord;
      }
      final pan = _pan.text.trim().toUpperCase();
      if (problem == null && pan.isNotEmpty && !_panRe.hasMatch(pan)) problem = s.txNeedPan;
    } else if (!_money.hasMatch(_clean(_amount.text))) {
      problem = s.txNeedAmount;
    }
    if (problem != null) return setState(() => _error = problem);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final proofs = await _upload(ref, _proofs);
      final pan = _pan.text.trim().toUpperCase();
      final r = asJson(
        await ref
            .read(apiProvider)
            .payrollTaxDeclareMine(
              body: DeclareDto(
                fy: widget.fy,
                lineCode: _code,
                amount: hra ? null : _clean(_amount.text),
                hra: hra
                    ? DeclareDtoHra(
                        months: months,
                        city: _city.text.trim(),
                        landlord: DeclareDtoHraLandlord(
                          name: _landlord.text.trim(),
                          address: _address.text.trim(),
                          relation: _relation.text.trim(),
                          pan: pan.isEmpty ? null : pan,
                        ),
                      )
                    : null,
                proofFileIds: proofs,
              ),
            ),
      );
      if (!mounted) return;
      setState(() {
        _amount.clear();
        for (final c in _rents.values) {
          c.clear();
        }
        _proofs = [];
      });
      widget.onDone('${r['message'] ?? ''}');
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = officeMuted(context);
    final label = widget.labels.where((l) => '${l['code']}' == _code).firstOrNull;
    final cap = label?['cap'];
    Widget field(
      TextEditingController c,
      String l, {
      Key? key,
      int max = 100,
      bool money = false,
    }) => Padding(
      padding: const EdgeInsets.only(top: Tokens.sp2),
      child: TextField(
        key: key,
        controller: c,
        maxLength: max,
        keyboardType: money ? const TextInputType.numberWithOptions(decimal: true) : null,
        decoration: InputDecoration(
          labelText: l,
          border: const OutlineInputBorder(),
          counterText: '',
        ),
      ),
    );
    return Card(
      margin: const EdgeInsets.only(top: Tokens.sp2),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        key: const Key('txDeclare'),
        title: Text(s.txDeclare, style: const TextStyle(fontWeight: Tokens.fwBold)),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, Tokens.sp2, Tokens.sp3, Tokens.sp3),
        children: [
          DropdownMenu<String>(
            key: const Key('txSection'),
            label: Text(s.txSection),
            trailingIcon: dropArrow(s.txSection),
            selectedTrailingIcon: dropArrow(s.txSection, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            initialSelection: _code.isEmpty ? null : _code,
            onSelected: (v) => setState(() => _code = v ?? _code),
            dropdownMenuEntries: [
              for (final l in widget.labels)
                DropdownMenuEntry(
                  value: '${l['code']}',
                  label: '${l['label']}${l['appliesTo'] == 'OLD' ? ' ${s.txOldOnly}' : ''}',
                ),
            ],
          ),
          if (cap != null)
            Text(s.txCap(s.money(cap)), style: TextStyle(color: muted, fontSize: 13)),
          if (_code == 'HRA_RENT') ...[
            const SizedBox(height: Tokens.sp2),
            Text(s.txRentHelp, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
            Wrap(
              spacing: Tokens.sp2,
              children: [
                for (final m in _months)
                  SizedBox(
                    width: 140,
                    child: field(
                      _rents[m]!,
                      s.month(DateTime.parse('$m-01')),
                      key: Key('txRent-$m'),
                      max: 14,
                      money: true,
                    ),
                  ),
              ],
            ),
            field(_city, '${s.txCity} *', key: const Key('txCity'), max: 60),
            field(_landlord, '${s.txLandlord} *', key: const Key('txLandlord')),
            field(_address, '${s.txLandlordAddress} *', key: const Key('txAddress'), max: 250),
            field(_relation, '${s.txRelation} *', key: const Key('txRelation'), max: 60),
            field(_pan, s.txLandlordPan, key: const Key('txPan'), max: 10),
          ] else
            field(_amount, '${s.txAmount} *', key: const Key('txAmount'), max: 15, money: true),
          const SizedBox(height: Tokens.sp2),
          _Proofs(
            files: _proofs,
            label: s.txProofs,
            keyName: 'txProofs',
            onChanged: (f) => setState(() => _proofs = f),
          ),
          if (_error != null) ErrorText(_error!),
          const SizedBox(height: Tokens.sp2),
          FilledButton(
            key: const Key('txDeclareSend'),
            onPressed: _busy ? null : _send,
            child: Text(s.txDeclare),
          ),
        ],
      ),
    );
  }
}

/// The salary from an earlier employer this year: the employer and TAN, gross, exempt allowances, PF, profession tax
/// and tax deducted, and a proof. Folded until opened.
class _PrevForm extends ConsumerStatefulWidget {
  const _PrevForm({super.key, required this.fy, required this.title, required this.onDone});
  final String fy;
  final String title;
  final VoidCallback onDone;

  @override
  ConsumerState<_PrevForm> createState() => _PrevFormState();
}

class _PrevFormState extends ConsumerState<_PrevForm> {
  final _name = TextEditingController();
  final _tanC = TextEditingController();
  final _gross = TextEditingController();
  final _exempt = TextEditingController();
  final _pf = TextEditingController();
  final _pt = TextEditingController();
  final _tds = TextEditingController();
  List<PickedFile> _proofs = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _tanC, _gross, _exempt, _pf, _pt, _tds]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    final tan = _tanC.text.trim().toUpperCase();
    String? money(TextEditingController c) => _clean(c.text).isEmpty ? null : _clean(c.text);
    if (_name.text.trim().length < 2 || !_money.hasMatch(_clean(_gross.text))) {
      return setState(() => _error = s.txNeedEmployer);
    }
    if (tan.isNotEmpty && !_tanRe.hasMatch(tan)) return setState(() => _error = s.txNeedTan);
    for (final c in [_exempt, _pf, _pt, _tds]) {
      final v = money(c);
      if (v != null && !_money.hasMatch(v)) return setState(() => _error = s.txNeedAmount);
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final proofs = await _upload(ref, _proofs);
      await ref
          .read(apiProvider)
          .payrollTaxPrevMine(
            body: PrevDto(
              fy: widget.fy,
              employerName: _name.text.trim(),
              employerTan: tan.isEmpty ? null : tan,
              gross: _clean(_gross.text),
              exempt: money(_exempt) ?? '0',
              pf: money(_pf) ?? '0',
              pt: money(_pt) ?? '0',
              tds: money(_tds) ?? '0',
              proofFileIds: proofs,
            ),
          );
      if (!mounted) return;
      setState(() => _proofs = []);
      widget.onDone();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    Widget field(TextEditingController c, String l, Key key, {int max = 15, bool money = true}) =>
        Padding(
          padding: const EdgeInsets.only(top: Tokens.sp2),
          child: TextField(
            key: key,
            controller: c,
            maxLength: max,
            keyboardType: money ? const TextInputType.numberWithOptions(decimal: true) : null,
            decoration: InputDecoration(
              labelText: l,
              border: const OutlineInputBorder(),
              counterText: '',
            ),
          ),
        );
    return Card(
      margin: const EdgeInsets.only(top: Tokens.sp2),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        key: const Key('txPrevOpen'),
        title: Text(widget.title, style: const TextStyle(fontWeight: Tokens.fwBold)),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, 0, Tokens.sp3, Tokens.sp3),
        children: [
          field(_name, '${s.txEmployer} *', const Key('txEmployer'), max: 150, money: false),
          field(_tanC, s.txTan, const Key('txTan'), max: 10, money: false),
          field(_gross, '${s.txGross} *', const Key('txGross')),
          field(_exempt, s.txExempt, const Key('txExempt')),
          field(_pf, s.txPf, const Key('txPf')),
          field(_pt, s.txPtCut, const Key('txPtCut')),
          field(_tds, s.txTds, const Key('txTds')),
          const SizedBox(height: Tokens.sp2),
          _Proofs(
            files: _proofs,
            label: s.txProof1,
            keyName: 'txPrevProofs',
            onChanged: (f) => setState(() => _proofs = f),
          ),
          if (_error != null) ErrorText(_error!),
          const SizedBox(height: Tokens.sp2),
          FilledButton(
            key: const Key('txPrevSave'),
            onPressed: _busy ? null : _save,
            child: Text(s.txSave),
          ),
        ],
      ),
    );
  }
}
