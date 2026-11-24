import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'sheet_excel.dart' show xlsxPickerProvider;

/// The words of Purchase indents (as the staff website's and the admin's page, in English and Hindi).
extension PurchaseIndentWords on S {
  String _pi(String en, String hi) => hindi ? hi : en;

  // the list
  String get piTitle => _pi('Purchase indents', 'क्रय इंडेंट');
  String get piIntro => _pi(
    'Ask for what your department needs. The department’s approvers decide in turn — nobody approves their own — and an approved indent goes to the purchase office’s requisition, or straight to the order when a rule allows it.',
    'अपने विभाग की ज़रूरत की वस्तुएँ माँगें। विभाग के अनुमोदक बारी-बारी से निर्णय लेते हैं — कोई अपना इंडेंट स्वयं स्वीकृत नहीं करता — और स्वीकृत इंडेंट क्रय कार्यालय की माँग (PR) में, या नियम होने पर सीधे आदेश (PO) में जाता है।',
  );
  String piWaitingTab(int n) => _pi('Waiting for me ($n)', 'मेरी प्रतीक्षा में ($n)');
  String get piMineTab => _pi('Raised by me', 'मेरे द्वारा बनाए गए');
  String get piAllTab => _pi('All I can see', 'जो मैं देख सकता हूँ');
  String get piToPrTab => _pi('Waiting for the PR', 'PR की प्रतीक्षा में');
  String get piToPoTab => _pi('PR skipped: for the PO', 'PR छोड़ा गया: PO हेतु');
  String get piRaise => _pi('Raise an indent', 'इंडेंट बनाएँ');
  String piFilters(int n) => n == 0 ? _pi('Filters', 'छाँटें') : _pi('Filters ($n)', 'छाँटें ($n)');
  String get piDepartment => _pi('Department', 'विभाग');
  String get piAny => _pi('Any', 'कोई भी');
  String get piFrom => _pi('From', 'से');
  String get piTo => _pi('To', 'तक');
  String get piStatus => _pi('Status', 'स्थिति');
  String get piSearch => _pi('Search', 'खोजें');
  String get piSearchHint => _pi('Number or purpose', 'संख्या या उद्देश्य');
  String get piShow => _pi('Show', 'दिखाएँ');
  String get piClear => _pi('Clear', 'साफ़ करें');
  String get piPickDate => _pi('Pick a date', 'तिथि चुनें');
  String get piExcelTitle => _pi('Purchase indents (Excel)', 'क्रय इंडेंट (Excel)');
  String get piPdfTitle => _pi('Purchase indents (PDF)', 'क्रय इंडेंट (PDF)');
  String get piNothingWaits => _pi(
    'Nothing is waiting for your approval.',
    'आपकी स्वीकृति के लिए कुछ प्रतीक्षा में नहीं है।',
  );
  String get piNone => _pi('No indents here yet.', 'यहाँ अभी कोई इंडेंट नहीं है।');
  String get piDraft => _pi('Draft', 'ड्राफ़्ट');
  String get piUrgent => _pi('Urgent', 'अत्यावश्यक');
  String piLines(int n) => n == 1 ? _pi('1 line', '1 पंक्ति') : _pi('$n lines', '$n पंक्तियाँ');
  String get piRaisedBy => _pi('Raised by', 'किसने बनाया');
  String piFor(String who) => _pi('for $who', '$who के लिए');
  String get piNeededBy => _pi('Needed by', 'कब तक चाहिए');
  String get piEstimate => _pi('Estimate', 'अनुमान');
  String piStatusWord(String st) => switch (st) {
    'draft' => _pi('Draft', 'ड्राफ़्ट'),
    'submitted' => _pi('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'approved' => _pi('Approved', 'स्वीकृत'),
    'rejected' => _pi('Rejected', 'अस्वीकृत'),
    'sent_back' => _pi('Sent back for changes', 'बदलाव हेतु वापस भेजा गया'),
    _ => _pi('Withdrawn', 'वापस लिया गया'),
  };
  String piRouteWord(String r) => switch (r) {
    'to_requisition' => _pi('Waiting for the PR', 'PR की प्रतीक्षा में'),
    'to_order' => _pi('PR skipped: waiting for the PO', 'PR छोड़ा गया: PO की प्रतीक्षा'),
    'in_requisition' => _pi('On a PR', 'PR पर'),
    'ordered' => _pi('Ordered', 'आदेशित'),
    'closed' => _pi('Closed', 'बंद'),
    _ => _pi('From the store', 'भंडार से'),
  };
  String piWith(String who) => _pi('With $who', 'प्रतीक्षा में: $who');
  String get piPartClosed => _pi('part closed', 'आंशिक रूप से बंद');
  String piStarted(String d) => _pi('Started $d', '$d को शुरू किया');
  String piPage(int p, int of) => _pi('Page $p of $of', 'पृष्ठ $p / $of');
  String get piPrev => _pi('Previous', 'पिछला');
  String get piNext => _pi('Next', 'अगला');
  String get piHandOverLink =>
      _pi('Away? Hand over your purchase approvals', 'बाहर हैं? अपनी क्रय स्वीकृतियाँ सौंपें');

  // one indent in full
  String piKicker(String dept) => _pi('Purchase · Indent · $dept', 'क्रय · इंडेंट · $dept');
  String get piDraftIndent => _pi('Draft indent', 'ड्राफ़्ट इंडेंट');
  String get piPrint => _pi('Print', 'प्रिंट');
  String get piChange => _pi('Change', 'बदलें');
  String piWaitingWith(String who) => _pi('Waiting with $who.', '$who के पास प्रतीक्षा में।');
  String piNoteTitle(String st) => switch (st) {
    'rejected' => _pi('Why it was rejected', 'अस्वीकार करने का कारण'),
    'sent_back' => _pi('What to change', 'क्या बदलना है'),
    _ => _pi('Why it was withdrawn', 'वापस लेने का कारण'),
  };
  String piApprovedOn(String d) => _pi('approved $d', '$d को स्वीकृत');
  String get piBySystem => _pi('(approved by the system)', '(प्रणाली द्वारा स्वीकृत)');
  String get piApprove => _pi('Approve', 'स्वीकृत करें');
  String get piSendBack => _pi('Send back', 'वापस भेजें');
  String get piReject => _pi('Reject', 'अस्वीकार करें');
  String get piSendForApproval => _pi('Send for approval', 'स्वीकृति हेतु भेजें');
  String get piSend => _pi('Send', 'भेजें');
  String get piWithdraw => _pi('Withdraw', 'वापस लें');
  String piApproveAsk(String name) => _pi('Approve $name?', '$name स्वीकृत करें?');
  String piApproveSays(String? amount, String dept) => _pi(
    '${amount != null ? '$amount for ' : 'For '}$dept. It moves to the next level, or, at the last, to the purchase office.',
    '$dept${amount != null ? ' · $amount' : ''}। यह अगले स्तर पर, या अंतिम स्तर के बाद क्रय कार्यालय को जाता है।',
  );
  String piSendBackAsk(String name) =>
      _pi('Send $name back for changes?', '$name बदलाव हेतु वापस भेजें?');
  String get piSendBackReason =>
      _pi('What to change (the raiser sees it)', 'क्या बदलना है (बनाने वाला इसे देखता है)');
  String get piSendBackSays => _pi(
    'The raiser changes it and sends it again; it goes through every level again.',
    'बनाने वाला इसे बदलकर फिर भेजता है; यह फिर हर स्तर से गुज़रता है।',
  );
  String piRejectAsk(String name) => _pi('Reject $name?', '$name अस्वीकार करें?');
  String get piRejectReason => _pi(
    'Why it is rejected (the raiser sees it)',
    'अस्वीकार करने का कारण (बनाने वाला इसे देखता है)',
  );
  String get piRejectSays => _pi(
    'The indent closes. The raiser can raise a new one.',
    'इंडेंट बंद हो जाता है। बनाने वाला नया इंडेंट बना सकता है।',
  );
  String piSubmitAsk(String name) => _pi('Send $name for approval?', '$name स्वीकृति हेतु भेजें?');
  String piSubmitSays(String dept) => _pi(
    'It goes to $dept’s approvers in turn; you cannot change it while they decide.',
    'यह $dept के अनुमोदकों के पास बारी-बारी से जाता है; उनके निर्णय तक आप इसे बदल नहीं सकते।',
  );
  String piWithdrawAsk(String name) => _pi('Withdraw $name?', '$name वापस लें?');
  String get piWithdrawReason => _pi('Why it is withdrawn', 'वापस लेने का कारण');
  String get piWithdrawSays => _pi(
    'The indent closes and its approvers are told nothing more is needed.',
    'इंडेंट बंद हो जाता है और अनुमोदकों को बताया जाता है कि अब कुछ नहीं चाहिए।',
  );
  String get piNeedReason =>
      _pi('Give a reason of at least 3 characters.', 'कम से कम 3 अक्षरों का कारण लिखें।');
  String piDone(String what) => switch (what) {
    'approve' => _pi('Approved', 'स्वीकृत'),
    'reject' => _pi('Rejected: the raiser sees the reason', 'अस्वीकृत: बनाने वाला कारण देखता है'),
    'send_back' => _pi('Sent back to the raiser for changes', 'बदलाव हेतु बनाने वाले को वापस भेजा'),
    'submit' => _pi('Sent for approval', 'स्वीकृति हेतु भेजा गया'),
    _ => _pi('Indent withdrawn', 'इंडेंट वापस लिया गया'),
  };
  String get piTheIndent => _pi('The indent', 'इंडेंट');
  String get piNotGiven => _pi('Not given', 'नहीं दिया');
  String piDeptSpend(String dept) =>
      _pi('$dept’s approved indents this year', '$dept: इस वर्ष के स्वीकृत इंडेंट');
  String get piItems => _pi('Items', 'वस्तुएँ');
  String get piQuantity => _pi('Quantity', 'मात्रा');
  String get piInStore => _pi('In store when raised', 'बनाते समय भंडार में');
  String piFree(String q, String unit) => _pi('$q $unit free', '$q $unit उपलब्ध');
  String get piNoneFree => _pi('None free', 'कुछ उपलब्ध नहीं');
  String get piRate => _pi('Rate', 'दर');
  String get piAmount => _pi('Amount', 'राशि');
  String get piRateFrom => _pi('Rate from', 'दर का स्रोत');
  String piRateSource(String s) => switch (s) {
    'contract' => _pi('Rate contract', 'दर अनुबंध'),
    'last' => _pi('Last purchase', 'पिछली ख़रीद'),
    _ => _pi('Typed', 'लिखी गई'),
  };
  String get piNotInList => _pi('Not in the item list', 'वस्तु सूची में नहीं');
  String piBoughtAnyway(String why) =>
      _pi('Bought though the store has it: $why', 'भंडार में होते हुए भी ख़रीदी: $why');
  String get piIssueSlips => _pi('Issue slips', 'निर्गम पर्चियाँ');
  String piSlip(String n) => _pi('Issue slip $n', 'निर्गम पर्ची $n');
  String get piDocument => _pi('Document', 'दस्तावेज़');
  String piLineDoc(int n) => _pi('The document of line $n', 'पंक्ति $n का दस्तावेज़');
  String get piApprovals => _pi('Approvals', 'स्वीकृतियाँ');
  String piStepWord(String st) => switch (st) {
    'pending' => _pi('Waiting', 'प्रतीक्षा में'),
    'approved' => _pi('Approved', 'स्वीकृत'),
    'rejected' => _pi('Rejected', 'अस्वीकृत'),
    'skipped' => _pi('Passed on', 'आगे बढ़ाया गया'),
    'later' => _pi('Later', 'बाद में'),
    _ => _pi('Not reached', 'नहीं पहुँचा'),
  };
  String piAllMust(int done, int of) => _pi(
    'All of them must approve · $done of $of have',
    'सभी को स्वीकृत करना होगा · $of में से $done ने किया',
  );
  String get piNobody => _pi('Nobody', 'कोई नहीं');
  String piDue(String d, bool overdue) =>
      overdue ? _pi('Overdue since $d', '$d से विलंबित') : _pi('Due $d', 'नियत $d');
  String get piHistory => _pi('History', 'इतिहास');
  String piEvent(String k) => switch (k) {
    'started' => _pi('Sent for approval', 'स्वीकृति हेतु भेजा गया'),
    'approved' => _pi('Approved', 'स्वीकृत'),
    'rejected' => _pi('Rejected', 'अस्वीकृत'),
    'skipped' => _pi('Passed on', 'आगे बढ़ाया गया'),
    'delegated' => _pi('Decided on someone’s behalf', 'किसी की ओर से निर्णय'),
    'cancelled' => _pi('Closed', 'बंद'),
    'reassigned' => _pi('Approvers changed', 'अनुमोदक बदले गए'),
    'escalated' => _pi('Moved on: no decision in time', 'आगे बढ़ा: समय पर निर्णय नहीं'),
    'reminded' => _pi('Reminder sent', 'स्मरण भेजा गया'),
    'comment' => _pi('Comment', 'टिप्पणी'),
    _ => k,
  };

  // raise or change
  String piChangeTitle(String name) => _pi('Change $name', '$name बदलें');
  String get piFormHelp => _pi(
    'Save it as a draft to finish later, or send it to your department’s approvers. It gets its number when sent.',
    'बाद में पूरा करने के लिए ड्राफ़्ट सहेजें, या अपने विभाग के अनुमोदकों को भेजें। भेजने पर इसे संख्या मिलती है।',
  );
  String get piPickDept => _pi('Pick the department', 'विभाग चुनें');
  String get piNoDept => _pi(
    'Your employee record has no department: ask the office to set it.',
    'आपके कर्मचारी रिकॉर्ड में कोई विभाग नहीं है: कार्यालय से जुड़वाएँ।',
  );
  String get piForColleague => _pi('For a colleague (optional)', 'किसी सहकर्मी के लिए (वैकल्पिक)');
  String get piMyself => _pi('Myself', 'स्वयं');
  String get piPurpose => _pi('Purpose', 'उद्देश्य');
  String get piPurposeHint => _pi(
    'What it is for, e.g. Class IX chemistry practicals, term 2',
    'किसके लिए, जैसे कक्षा IX रसायन प्रयोग, सत्र 2',
  );
  String get piPriority => _pi('Priority', 'प्राथमिकता');
  String get piNormal => _pi('Normal', 'सामान्य');
  String get piUrgentFirst =>
      _pi('Urgent (shown first to approvers)', 'अत्यावश्यक (अनुमोदकों को पहले दिखता है)');
  String piItemsHelp(bool rates) => rates
      ? _pi(
          'Pick from the item list (its rate comes from the rate contract, else the last purchase; you may type your own estimate); what the stores hold free shows under it. Not in the list? Pick “Not in the list” and describe it: the purchase office matches it on the PR.',
          'वस्तु सूची से चुनें (दर, दर अनुबंध से, नहीं तो पिछली ख़रीद से आती है; आप अपना अनुमान लिख सकते हैं); भंडार में उपलब्ध मात्रा नीचे दिखती है। सूची में नहीं? “सूची में नहीं” चुनकर लिखें: क्रय कार्यालय PR पर मिलान करता है।',
        )
      : _pi(
          'Pick from the item list; what the stores hold free shows under it. Not in the list? Pick “Not in the list” and describe it: the purchase office matches it on the PR and prices the indent.',
          'वस्तु सूची से चुनें; भंडार में उपलब्ध मात्रा नीचे दिखती है। सूची में नहीं? “सूची में नहीं” चुनकर लिखें: क्रय कार्यालय PR पर मिलान करके मूल्य लगाता है।',
        );
  String get piDownloadSheet => _pi('Download item sheet', 'वस्तु शीट डाउनलोड करें');
  String get piSheetTitle => _pi('Indent item sheet', 'इंडेंट वस्तु शीट');
  String get piUploadSheet =>
      _pi('Upload the filled sheet (Excel)', 'भरी हुई शीट अपलोड करें (Excel)');
  String get piUploadSheetHelp => _pi(
    'Its rows are added to the lines below, to check before saving.',
    'इसकी पंक्तियाँ नीचे जुड़ जाती हैं, सहेजने से पहले जाँचें।',
  );
  String get piReadingSheet => _pi('Reading the sheet…', 'शीट पढ़ी जा रही है…');
  String get piSheetTooLarge =>
      _pi('The sheet is too large (up to 200 lines).', 'शीट बहुत बड़ी है (200 पंक्तियों तक)।');
  String piSheetAdded(int n) => _pi(
    '$n ${n == 1 ? 'line' : 'lines'} added from the sheet: check them before saving.',
    'शीट से $n पंक्तियाँ जोड़ी गईं: सहेजने से पहले जाँचें।',
  );
  String get piRowsNotAdded => _pi('Rows not added:', 'ये पंक्तियाँ नहीं जुड़ीं:');
  String get piSheetNotRead => _pi('The sheet was not read:', 'शीट नहीं पढ़ी जा सकी:');
  String piRow(int n) => _pi('Row $n', 'पंक्ति $n');
  String piItemN(int n) => _pi('Item $n', 'वस्तु $n');
  String get piPickItem => _pi('Pick the item', 'वस्तु चुनें');
  String get piNotListed => _pi('Not in the list: describe it', 'सूची में नहीं: लिखें');
  String piInStores(String free, String unit, String stores) =>
      _pi('In the stores: $free $unit free ($stores)', 'भंडार में: $free $unit उपलब्ध ($stores)');
  String get piInStoresNone => _pi('In the stores: none free', 'भंडार में: कुछ उपलब्ध नहीं');
  String get piDescribe => _pi('Describe it', 'वस्तु का विवरण');
  String piQuantityOf(String? uom) =>
      uom == null || uom.isEmpty ? piQuantity : '$piQuantity ($uom)';
  String get piWhole => _pi('A whole number', 'पूर्ण संख्या');
  String get piUnit => _pi('Unit', 'इकाई');
  String get piEstRate => _pi('Estimated rate (₹)', 'अनुमानित दर (₹)');
  String piUseRate(String r) => _pi('Use $r', '$r लें');
  String get piNote => _pi('Note', 'टिप्पणी');
  String get piNoteHint => _pi('Size, make, colour…', 'आकार, कंपनी, रंग…');
  String get piDocOptional => _pi('Document (optional)', 'दस्तावेज़ (वैकल्पिक)');
  String get piDocHelp => _pi(
    'A spec sheet, photo or quotation: PDF, JPEG or PNG up to 5 MB',
    'विवरण पत्र, फ़ोटो या कोटेशन: PDF, JPEG या PNG, 5 MB तक',
  );
  String get piAttach => _pi('Attach a document', 'दस्तावेज़ जोड़ें');
  String get piUploading => _pi('Uploading…', 'अपलोड हो रहा है…');
  String get piAttached => _pi('Attached', 'जुड़ा हुआ');
  String piRemoveDoc(int n) =>
      _pi('Remove the document of line $n', 'पंक्ति $n का दस्तावेज़ हटाएँ');
  String get piDocWrong =>
      _pi('A PDF or a photo (JPEG, PNG) up to 5 MB.', 'PDF या फ़ोटो (JPEG, PNG), 5 MB तक।');
  String get piBuyNew => _pi('Buy new instead? (optional)', 'इसके बजाय नया ख़रीदें? (वैकल्पिक)');
  String get piBuyNewHint =>
      _pi('e.g. another size or make is needed', 'जैसे दूसरा आकार या कंपनी चाहिए');
  String piBuyNewHelp(bool covers, String free, String unit) => covers
      ? _pi(
          'The stores have $free $unit free: once the indent is approved the store issues it to you. To have it bought new instead, say why (the approvers see it).',
          'भंडार में $free $unit उपलब्ध है: इंडेंट स्वीकृत होने पर भंडार आपको देगा। नया ख़रीदवाना हो तो कारण लिखें (अनुमोदक देखते हैं)।',
        )
      : _pi(
          'The stores have $free $unit free: once the indent is approved the store issues that much and the rest is bought. To have all of it bought new, say why.',
          'भंडार में $free $unit उपलब्ध है: स्वीकृति पर भंडार उतना देगा और बाकी ख़रीदा जाएगा। पूरा नया ख़रीदवाना हो तो कारण लिखें।',
        );
  String piRemoveLine(int n) => _pi('Remove line $n', 'पंक्ति $n हटाएँ');
  String get piAddLine => _pi('Add a line', 'पंक्ति जोड़ें');
  String piTotal(String amount) => _pi('Estimate: $amount', 'अनुमान: $amount');
  String get piSaveDraft => _pi('Save as draft', 'ड्राफ़्ट सहेजें');
  String get piSaveSend => _pi('Save and send for approval', 'सहेजें और स्वीकृति हेतु भेजें');
  String piSent(String? number) => _pi(
    '${number ?? 'The indent'} sent to the department’s approvers',
    '${number ?? 'इंडेंट'} विभाग के अनुमोदकों को भेजा गया',
  );
  String get piSavedDraft => _pi('Saved as a draft', 'ड्राफ़्ट सहेजा गया');
  String piNotSent(String why) =>
      _pi('Saved as a draft, not sent: $why', 'ड्राफ़्ट सहेजा गया, भेजा नहीं गया: $why');
  String get piNeedDept => _pi('Pick the department.', 'विभाग चुनें।');
  String get piNeedPurpose =>
      _pi('Write the purpose (at least 3 letters).', 'उद्देश्य लिखें (कम से कम 3 अक्षर)।');
  String get piNeedLine => _pi('Add at least one line.', 'कम से कम एक पंक्ति जोड़ें।');
  String piNeedItem(int n) => _pi(
    'Line $n: pick the item, or describe one not in the list.',
    'पंक्ति $n: वस्तु चुनें, या सूची में न होने पर उसका विवरण लिखें।',
  );
  String piNeedText(int n) => _pi(
    'Line $n: describe the item (at least 2 letters).',
    'पंक्ति $n: वस्तु का विवरण लिखें (कम से कम 2 अक्षर)।',
  );
  String piNeedQty(int n) =>
      _pi('Line $n: give a quantity more than 0.', 'पंक्ति $n: 0 से अधिक मात्रा लिखें।');
  String piNeedWhole(int n) =>
      _pi('Line $n: the quantity must be a whole number.', 'पंक्ति $n: मात्रा पूर्ण संख्या हो।');
  String piNeedUnit(int n) => _pi('Line $n: pick the unit.', 'पंक्ति $n: इकाई चुनें।');
  String piNeedRate(int n) =>
      _pi('Line $n: the rate must be a number.', 'पंक्ति $n: दर एक संख्या हो।');

  // hand over
  String get piHandOver => _pi('Hand over my approvals', 'मेरी स्वीकृतियाँ सौंपें');
  String get piHandOverHelp => _pi(
    'Away for some days? A colleague approves your purchase indents, requisitions and orders in your place for those days. Other approvals stay with you.',
    'कुछ दिन बाहर हैं? उन दिनों एक सहकर्मी आपकी जगह क्रय इंडेंट, माँग और आदेश स्वीकृत करता है। बाकी स्वीकृतियाँ आपके पास रहती हैं।',
  );
  String get piColleague => _pi('To', 'किसे');
  String get piPickColleague => _pi('Pick the colleague', 'सहकर्मी चुनें');
  String get piToWholeDay => _pi('To (the whole day)', 'तक (पूरा दिन)');
  String get piReason => _pi('Reason', 'कारण');
  String get piHandOverBtn => _pi('Hand over', 'सौंपें');
  String get piHandedOver =>
      _pi('Approvals handed over for those days', 'उन दिनों के लिए स्वीकृतियाँ सौंपी गईं');
  String get piEndNow => _pi('End now', 'अभी समाप्त करें');
  String get piEnded => _pi('Hand-over ended', 'सौंपना समाप्त');
  String piDelegState(String st) => switch (st) {
    'revoked' => _pi('Ended early', 'पहले समाप्त'),
    'active' => _pi('In force', 'लागू'),
    'later' => _pi('Starts later', 'बाद में शुरू'),
    _ => _pi('Over', 'समाप्त'),
  };
  String get piNeedColleague => _pi('Pick the colleague.', 'सहकर्मी चुनें।');
  String get piNeedDates => _pi(
    'Pick the days: the end on or after the start.',
    'दिन चुनें: अंत, शुरुआत के दिन या उसके बाद।',
  );
}

const _free = 'free';
final _okDoc = RegExp(r'^(application/pdf|image/(png|jpeg))$');

String _qty(num n) {
  final r = (n * 1000).round() / 1000;
  return r == r.roundToDouble() ? '${r.toInt()}' : '$r';
}

String? _str(Object? v) => v == null || '$v'.isEmpty ? null : '$v';

/// My rights for purchase (from who I am): raise an indent, see every indent (the purchase office).
final purchaseRightsProvider = FutureProvider.autoDispose<Set<String>>((ref) async {
  final me = asJson(await ref.read(apiProvider).meMe());
  return {for (final p in (me['permissions'] as List? ?? const [])) '$p'};
});

/// What the list shows: the tab (view and, for the purchase office, the route), the filters and the page.
typedef IndentQuery = ({
  String who,
  String view,
  String? status,
  String? route,
  String? departmentId,
  String? from,
  String? to,
  String? q,
  int page,
});

/// The indents as the list asks for them (50 a page), with how many wait for me.
final indentListProvider = FutureProvider.autoDispose.family<Loaded<Json>, IndentQuery>((
  ref,
  f,
) async {
  final r = await cached(
    'indents:${f.who}:${f.view}:${f.status}:${f.route}:${f.departmentId}:${f.from}:${f.to}:${f.q}:${f.page}',
    () => ref
        .read(apiProvider)
        .purchaseListIndents(
          view: f.view,
          status: f.status,
          route: f.route,
          departmentId: f.departmentId,
          from: f.from,
          to: f.to,
          q: f.q,
          page: f.page,
          size: 50,
        ),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The departments the list filters by.
final purchaseListFiltersProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).purchaseListFilters()),
);

/// One indent in full.
final indentProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).purchaseIndent(id: id)),
);

/// The raise form's lists: departments, colleagues, items with their stock and rates, units.
final indentFormListsProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).purchaseIndentForm()),
);

/// My purchase hand-overs and the colleagues I may hand over to.
final purchaseDelegationsProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).purchaseDelegations()),
);

/// Opens one indent in full.
/// [said]: a note to show as it opens (what was just saved).
void openIndent(BuildContext context, Profile profile, String id, String title, {String? said}) =>
    pushPage(context, title, IndentDetailScreen(profile: profile, id: id, said: said));

/// A heading and its content on a card (a section of the admin's page).
Widget _card(BuildContext context, String title, List<Widget> children, {Key? key}) => Card(
  key: key,
  margin: const EdgeInsets.only(top: Tokens.sp3),
  child: Padding(
    padding: const EdgeInsets.all(Tokens.sp4),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
        ...children,
      ],
    ),
  ),
);

Color _muted(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? Tokens.mobGray300 : Tokens.textMuted;

Tone _statusTone(String st) => switch (st) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'submitted' || 'sent_back' => Tone.warning,
  _ => Tone.neutral,
};

/// A day the API gives (YYYY-MM-DD) or a moment, as the app shows dates.
String _day(S s, Object? v) => v == null ? '—' : s.date(v);

/// Purchase indents as on the staff website and the admin's page (docs/design/83, part 2): Waiting for me, Raised by
/// me and All I can see (and, for the purchase office, those waiting for the PR or, the PR skipped, for the PO); the
/// department, dates, status and a search; the list as Excel or PDF; Raise an indent; each indent in full. No web page.
class PurchaseIndentsScreen extends ConsumerStatefulWidget {
  const PurchaseIndentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<PurchaseIndentsScreen> createState() => _PurchaseIndentsScreenState();
}

class _PurchaseIndentsScreenState extends ConsumerState<PurchaseIndentsScreen> {
  String _view = 'all';
  String? _route;
  String? _status;
  String? _dept;
  String? _from;
  String? _to;
  final _q = TextEditingController();
  String? _search;
  int _page = 1;
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  IndentQuery get _query => (
    who: widget.profile.id,
    view: _view,
    status: _status,
    route: _route,
    departmentId: _dept,
    from: _from,
    to: _to,
    q: _search,
    page: _page,
  );

  int get _filtersOn =>
      [_dept, _from, _to, _search].where((x) => x != null).length +
      (_status != null && _route == null ? 1 : 0);

  Future<void> _raise() async {
    final s = ref.read(stringsProvider);
    final r = await Navigator.of(context).push<IndentSaved>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.piRaise,
          child: IndentFormScreen(profile: widget.profile),
        ),
      ),
    );
    if (r == null || !mounted) return;
    ref.invalidate(indentListProvider);
    openIndent(context, widget.profile, r.id, r.number ?? s.piDraftIndent, said: r.said);
  }

  Future<void> _file(String format) async {
    final s = ref.read(stringsProvider);
    final api = ref.read(apiProvider);
    final q = _query;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(
          title: format == 'pdf' ? s.piPdfTitle : s.piExcelTitle,
          load: () => api.purchaseExportIndents(
            view: q.view,
            status: q.status,
            route: q.route,
            departmentId: q.departmentId,
            from: q.from,
            to: q.to,
            q: q.q,
            format: format,
          ),
        ),
      ),
    );
  }

  Future<void> _pickDate(bool from) async {
    final now = DateTime.now();
    final cur = DateTime.tryParse((from ? _from : _to) ?? '');
    final d = await showDatePicker(
      context: context,
      initialDate: cur ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 2),
    );
    if (d != null) setState(() => from ? _from = ymd(d) : _to = ymd(d));
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final rights = ref.watch(purchaseRightsProvider).value ?? const <String>{};
    final canRaise = rights.contains('purchase.indent.raise');
    final seeAll = rights.contains('purchase.indent.view');
    final list = ref.watch(indentListProvider(_query));
    final waiting = (list.value?.data['waitingForMe'] as num?)?.toInt() ?? 0;
    final tabs = <(String, String, String?)>[
      (s.piWaitingTab(waiting), 'waiting', null),
      (s.piMineTab, 'mine', null),
      (s.piAllTab, 'all', null),
      if (seeAll) ...[(s.piToPrTab, 'all', 'to_requisition'), (s.piToPoTab, 'all', 'to_order')],
    ];
    final at = tabs.indexWhere((t) => t.$2 == _view && t.$3 == _route).clamp(0, tabs.length - 1);
    final departments = asList(ref.watch(purchaseListFiltersProvider).value?['departments']);
    return ScaffoldMessenger(
      key: _messenger,
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: Colors.transparent,
          floatingActionButton: canRaise
              ? FloatingActionButton.extended(
                  key: const Key('piRaise'),
                  icon: const Icon(Icons.add),
                  label: Text(s.piRaise),
                  onPressed: _raise,
                )
              : null,
          body: Column(
            children: [
              Material(
                color: Theme.of(context).colorScheme.surface,
                child: DefaultTabController(
                  key: ValueKey('tabs-${tabs.length}'),
                  length: tabs.length,
                  initialIndex: at,
                  child: TabBar(
                    key: const Key('piTabs'),
                    isScrollable: true,
                    tabAlignment: TabAlignment.start,
                    onTap: (i) => setState(() {
                      _view = tabs[i].$2;
                      _route = tabs[i].$3;
                      _status = _route != null ? 'approved' : null;
                      _page = 1;
                    }),
                    tabs: [for (final t in tabs) Tab(text: t.$1)],
                  ),
                ),
              ),
              Expanded(
                child: LoadedList<Json>(
                  value: list,
                  refresh: () => ref.refresh(indentListProvider(_query).future),
                  children: (d) {
                    final rows = asList(d['data']);
                    final total = (d['total'] as num?)?.toInt() ?? rows.length;
                    final pages = (total / 50).ceil();
                    return [
                      Text(s.piIntro, style: TextStyle(color: _muted(context), fontSize: 14)),
                      const SizedBox(height: Tokens.sp3),
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp2,
                        children: [
                          OutlinedButton.icon(
                            key: const Key('piExcel'),
                            icon: const Icon(Icons.table_view_outlined),
                            label: const Text('Excel'),
                            onPressed: () => _file('xlsx'),
                          ),
                          OutlinedButton.icon(
                            key: const Key('piPdf'),
                            icon: const Icon(Icons.picture_as_pdf_outlined),
                            label: const Text('PDF'),
                            onPressed: () => _file('pdf'),
                          ),
                        ],
                      ),
                      const SizedBox(height: Tokens.sp2),
                      Card(
                        margin: EdgeInsets.zero,
                        child: ExpansionTile(
                          key: const Key('piFilters'),
                          title: Text(s.piFilters(_filtersOn)),
                          leading: const Icon(Icons.filter_list),
                          childrenPadding: const EdgeInsets.fromLTRB(
                            Tokens.sp3,
                            Tokens.sp2,
                            Tokens.sp3,
                            Tokens.sp3,
                          ),
                          children: [
                            if (departments.length > 1) ...[
                              DropdownMenu<String>(
                                key: const Key('piDept'),
                                label: Text(s.piDepartment),
                                trailingIcon: dropArrow(s.piDepartment),
                                selectedTrailingIcon: dropArrow(s.piDepartment, open: true),
                                expandedInsets: EdgeInsets.zero,
                                enableFilter: true,
                                enableSearch: true,
                                requestFocusOnTap: true,
                                initialSelection: _dept ?? '',
                                onSelected: (v) =>
                                    setState(() => _dept = v == null || v.isEmpty ? null : v),
                                dropdownMenuEntries: [
                                  DropdownMenuEntry(value: '', label: s.piAny),
                                  for (final x in departments)
                                    DropdownMenuEntry(value: '${x['id']}', label: '${x['name']}'),
                                ],
                              ),
                              const SizedBox(height: Tokens.sp3),
                            ],
                            Row(
                              children: [
                                Expanded(
                                  child: _PickField(
                                    key: const Key('piFrom'),
                                    label: s.piFrom,
                                    value: _from == null ? null : s.date(_from!),
                                    hint: s.piPickDate,
                                    icon: Icons.event,
                                    onTap: () => _pickDate(true),
                                  ),
                                ),
                                const SizedBox(width: Tokens.sp2),
                                Expanded(
                                  child: _PickField(
                                    key: const Key('piTo'),
                                    label: s.piTo,
                                    value: _to == null ? null : s.date(_to!),
                                    hint: s.piPickDate,
                                    icon: Icons.event,
                                    onTap: () => _pickDate(false),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: Tokens.sp3),
                            if (_route == null) ...[
                              DropdownMenu<String>(
                                key: const Key('piStatus'),
                                label: Text(s.piStatus),
                                trailingIcon: dropArrow(s.piStatus),
                                selectedTrailingIcon: dropArrow(s.piStatus, open: true),
                                expandedInsets: EdgeInsets.zero,
                                enableFilter: true,
                                enableSearch: true,
                                requestFocusOnTap: true,
                                initialSelection: _status ?? '',
                                onSelected: (v) =>
                                    setState(() => _status = v == null || v.isEmpty ? null : v),
                                dropdownMenuEntries: [
                                  DropdownMenuEntry(value: '', label: s.piAny),
                                  for (final st in const [
                                    'draft',
                                    'submitted',
                                    'approved',
                                    'rejected',
                                    'sent_back',
                                    'cancelled',
                                  ])
                                    DropdownMenuEntry(value: st, label: s.piStatusWord(st)),
                                ],
                              ),
                              const SizedBox(height: Tokens.sp3),
                            ],
                            TextField(
                              key: const Key('piQ'),
                              controller: _q,
                              maxLength: 80,
                              textInputAction: TextInputAction.search,
                              onSubmitted: (_) => setState(() {
                                _search = _q.text.trim().isEmpty ? null : _q.text.trim();
                                _page = 1;
                              }),
                              decoration: InputDecoration(
                                labelText: s.piSearch,
                                hintText: s.piSearchHint,
                                border: const OutlineInputBorder(),
                                counterText: '',
                              ),
                            ),
                            const SizedBox(height: Tokens.sp3),
                            Wrap(
                              spacing: Tokens.sp2,
                              runSpacing: Tokens.sp2,
                              children: [
                                FilledButton(
                                  key: const Key('piShow'),
                                  onPressed: () => setState(() {
                                    _search = _q.text.trim().isEmpty ? null : _q.text.trim();
                                    _page = 1;
                                  }),
                                  child: Text(s.piShow),
                                ),
                                OutlinedButton(
                                  key: const Key('piClear'),
                                  onPressed: () => setState(() {
                                    _dept = null;
                                    _from = null;
                                    _to = null;
                                    if (_route == null) _status = null;
                                    _q.clear();
                                    _search = null;
                                    _page = 1;
                                  }),
                                  child: Text(s.piClear),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: Tokens.sp3),
                      if (rows.isEmpty)
                        Notice(text: _view == 'waiting' ? s.piNothingWaits : s.piNone),
                      for (final x in rows) _IndentCard(profile: widget.profile, row: x),
                      if (pages > 1)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            TextButton(
                              key: const Key('piPrev'),
                              onPressed: _page > 1 ? () => setState(() => _page -= 1) : null,
                              child: Text(s.piPrev),
                            ),
                            Flexible(child: Text(s.piPage(_page, pages))),
                            TextButton(
                              key: const Key('piNext'),
                              onPressed: _page < pages ? () => setState(() => _page += 1) : null,
                              child: Text(s.piNext),
                            ),
                          ],
                        ),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton.icon(
                          key: const Key('piHandOver'),
                          icon: const Icon(Icons.swap_horiz),
                          label: Text(s.piHandOverLink),
                          onPressed: () => pushPage(
                            context,
                            s.piHandOver,
                            PurchaseHandOverScreen(profile: widget.profile),
                          ),
                        ),
                      ),
                      // room for the floating Raise button
                      const SizedBox(height: 88),
                    ];
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One indent on the list, as a row of the admin's table: the number (urgent marked), purpose and lines; the
/// department; who raised it (and for whom); when it is needed; the estimate (for those who see rates); its status.
class _IndentCard extends ConsumerWidget {
  const _IndentCard({required this.profile, required this.row});
  final Profile profile;
  final Json row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final x = row;
    final id = '${x['id']}';
    final st = '${x['status']}';
    final purpose = '${x['purpose'] ?? ''}';
    final lines = (x['lines'] as num?)?.toInt() ?? 0;
    final name = _str(x['number']) ?? s.piDraft;
    final sub = st == 'submitted' && x['waitingWith'] != null
        ? s.piWith('${x['waitingWith']}')
        : st == 'approved' && x['route'] != null
        ? '${s.piRouteWord('${x['route']}')}${x['partClosed'] == true ? ' · ${s.piPartClosed}' : ''}'
        : x['decidedAt'] != null
        ? _day(s, x['decidedAt'])
        : x['submittedAt'] != null
        ? _day(s, x['submittedAt'])
        : s.piStarted(_day(s, x['createdAt']));
    return Card(
      key: Key('piRow-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: InkWell(
        onTap: () => openIndent(context, profile, id, name),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      name,
                      style: TextStyle(
                        fontWeight: Tokens.fwBold,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                  if (x['priority'] == 'urgent') ...[
                    const SizedBox(width: Tokens.sp2),
                    StatusChip(s.piUrgent, Tone.danger),
                  ],
                ],
              ),
              const SizedBox(height: Tokens.sp1),
              Text(
                '${purpose.length > 80 ? '${purpose.substring(0, 80)}…' : purpose} · ${s.piLines(lines)}',
                style: TextStyle(color: _muted(context), fontSize: 14),
              ),
              const SizedBox(height: Tokens.sp2),
              FactLine(s.piDepartment, '${x['department'] ?? ''}'),
              FactLine(
                s.piRaisedBy,
                '${x['raisedBy'] ?? ''}${x['onBehalf'] != null ? ' (${s.piFor('${x['onBehalf']}')})' : ''}',
              ),
              FactLine(s.piNeededBy, x['requiredBy'] == null ? '—' : s.date(x['requiredBy'])),
              if (x['estimate'] != null) FactLine(s.piEstimate, s.money(x['estimate'])),
              const SizedBox(height: Tokens.sp2),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp1,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  StatusChip(s.piStatusWord(st), _statusTone(st)),
                  Text(sub, style: TextStyle(color: _muted(context), fontSize: 13)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One Purchase Indent with everything on it, as the admin's page: the status with what I may do (change, send or
/// withdraw mine; approve, send back or reject one at my level — each asks first), the indent's facts, its lines
/// with what the stores held free when raised (rates for those who see them), the line documents and issue slips,
/// the approval levels and who acted, and its history. Printed once sent.
class IndentDetailScreen extends ConsumerStatefulWidget {
  const IndentDetailScreen({super.key, required this.profile, required this.id, this.said});
  final Profile profile;
  final String id;

  /// a note to show as it opens (what was just saved)
  final String? said;

  @override
  ConsumerState<IndentDetailScreen> createState() => _IndentDetailScreenState();
}

class _IndentDetailScreenState extends ConsumerState<IndentDetailScreen> {
  bool _busy = false;
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    final said = widget.said;
    if (said != null) WidgetsBinding.instance.addPostFrameCallback((_) => _say(said));
  }

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  void _reload() {
    ref.invalidate(indentProvider(widget.id));
    ref.invalidate(indentListProvider);
    // the header's Approvals count reads again
    ref.invalidate(approvalsProvider);
  }

  /// Asks before acting (as the website's dialog); a reason when [reasonLabel] is given. Null: not confirmed.
  Future<String?> _ask(
    BuildContext context, {
    required String title,
    required String says,
    required String confirm,
    String? reasonLabel,
    bool danger = false,
  }) => showDialog<String>(
    context: context,
    builder: (_) => _AskDialog(
      title: title,
      says: says,
      confirm: confirm,
      reasonLabel: reasonLabel,
      danger: danger,
    ),
  );

  Future<void> _act(BuildContext context, Json pi, String what) async {
    final s = ref.read(stringsProvider);
    final name = _str(pi['number']) ?? s.piDraftIndent;
    final dept = '${pi['department'] ?? ''}';
    final estimate = pi['estimate'] != null ? s.money(pi['estimate']) : null;
    final (title, says, confirm, reason, danger) = switch (what) {
      'approve' => (
        s.piApproveAsk(name),
        s.piApproveSays(estimate, dept),
        s.piApprove,
        null as String?,
        false,
      ),
      'send_back' => (
        s.piSendBackAsk(name),
        s.piSendBackSays,
        s.piSendBack,
        s.piSendBackReason,
        false,
      ),
      'reject' => (s.piRejectAsk(name), s.piRejectSays, s.piReject, s.piRejectReason, true),
      'submit' => (s.piSubmitAsk(name), s.piSubmitSays(dept), s.piSend, null, false),
      _ => (s.piWithdrawAsk(name), s.piWithdrawSays, s.piWithdraw, s.piWithdrawReason, true),
    };
    final note = await _ask(
      context,
      title: title,
      says: says,
      confirm: confirm,
      reasonLabel: reason,
      danger: danger,
    );
    if (note == null || !mounted) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      switch (what) {
        case 'submit':
          await api.purchaseSubmitIndent(id: widget.id);
        case 'cancel':
          await api.purchaseCancelIndent(
            id: widget.id,
            body: IndentCancelDto(reason: note),
          );
        default:
          await api.purchaseDecideIndent(
            id: widget.id,
            body: IndentDecisionDto(action: what, note: note.isEmpty ? null : note),
          );
      }
      _reload();
      if (mounted) _say(s.piDone(what));
    } catch (e) {
      if (mounted) _say(errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _change(BuildContext context, Json pi) async {
    final s = ref.read(stringsProvider);
    final r = await Navigator.of(context).push<IndentSaved>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.piChangeTitle(_str(pi['number']) ?? s.piDraftIndent),
          child: IndentFormScreen(profile: widget.profile, indent: pi),
        ),
      ),
    );
    if (r == null || !mounted) return;
    _reload();
    if (mounted) _say(r.said);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: Colors.transparent,
          body: AsyncBody<Json>(
            value: ref.watch(indentProvider(widget.id)),
            retry: () => ref.invalidate(indentProvider(widget.id)),
            data: (pi) {
              final muted = _muted(context);
              final st = '${pi['status']}';
              final can = asJson(pi['can']);
              final name = _str(pi['number']) ?? s.piDraftIndent;
              final steps = asList(pi['steps']);
              final pending = st == 'submitted'
                  ? steps.where((x) => x['status'] == 'pending').firstOrNull
                  : null;
              final nowLevel = pending == null ? null : pending['level'];
              final showRates = pi['showRates'] == true;
              final lines = asList(pi['lineItems']);
              final history = asList(pi['history']);
              final requisitions = asList(pi['requisitions']);
              final dept = '${pi['department'] ?? ''}';
              Widget action(String what, String label, {bool primary = false}) => primary
                  ? FilledButton(
                      key: Key('piDo-$what'),
                      onPressed: _busy ? null : () => _act(context, pi, what),
                      child: Text(label),
                    )
                  : OutlinedButton(
                      key: Key('piDo-$what'),
                      onPressed: _busy ? null : () => _act(context, pi, what),
                      child: Text(label),
                    );
              return RefreshIndicator(
                onRefresh: () => ref.refresh(indentProvider(widget.id).future),
                child: ListView(
                  key: const Key('piDetail'),
                  padding: const EdgeInsets.all(Tokens.sp4),
                  children: [
                    Text(s.piKicker(dept), style: TextStyle(color: muted, fontSize: 14)),
                    const SizedBox(height: Tokens.sp1),
                    Text(
                      name,
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: Tokens.fwBold),
                    ),
                    const SizedBox(height: Tokens.sp1),
                    Text('${pi['purpose'] ?? ''}'),
                    if (can['print'] == true || can['edit'] == true) ...[
                      const SizedBox(height: Tokens.sp2),
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (can['print'] == true)
                            Wrap(
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                Text(s.piPrint),
                                FileIcons(
                                  label: name,
                                  name: 'piPdf-${widget.id}',
                                  load: () => api.purchaseIndentPdf(id: widget.id),
                                ),
                              ],
                            ),
                          if (can['edit'] == true)
                            OutlinedButton.icon(
                              key: const Key('piChange'),
                              icon: const Icon(Icons.edit_outlined),
                              label: Text(s.piChange),
                              onPressed: () => _change(context, pi),
                            ),
                        ],
                      ),
                    ],
                    _card(context, s.piStatus, key: const Key('piStatusCard'), [
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        children: [
                          StatusChip(s.piStatusWord(st), _statusTone(st)),
                          if (pi['priority'] == 'urgent') StatusChip(s.piUrgent, Tone.danger),
                        ],
                      ),
                      if (st == 'submitted' && pi['waitingWith'] != null) ...[
                        const SizedBox(height: Tokens.sp2),
                        Text(s.piWaitingWith('${pi['waitingWith']}')),
                      ],
                      if ((st == 'sent_back' || st == 'rejected' || st == 'cancelled') &&
                          pi['decisionNote'] != null) ...[
                        const SizedBox(height: Tokens.sp2),
                        Container(
                          padding: const EdgeInsets.all(Tokens.sp3),
                          decoration: BoxDecoration(
                            color: st == 'rejected'
                                ? Tokens.statusDangerBg
                                : Tokens.statusWarningBg,
                            borderRadius: BorderRadius.circular(Tokens.radiusSm),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                s.piNoteTitle(st),
                                style: const TextStyle(
                                  fontWeight: Tokens.fwBold,
                                  color: Tokens.textBody,
                                ),
                              ),
                              Text(
                                '${pi['decisionNote']}',
                                style: const TextStyle(color: Tokens.textBody),
                              ),
                            ],
                          ),
                        ),
                      ],
                      if (st == 'approved' && pi['route'] != null) ...[
                        const SizedBox(height: Tokens.sp2),
                        Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(
                                text: s.piRouteWord('${pi['route']}'),
                                style: const TextStyle(fontWeight: Tokens.fwBold),
                              ),
                              if (pi['decidedAt'] != null)
                                TextSpan(text: ' · ${s.piApprovedOn(_day(s, pi['decidedAt']))}'),
                            ],
                          ),
                        ),
                        if (pi['bypassNote'] != null)
                          Text('${pi['bypassNote']}', style: TextStyle(color: muted, fontSize: 13)),
                        for (final r in requisitions)
                          Text(
                            'PR ${r['number']}${r['autoRule'] != null ? ' ${s.piBySystem}' : ''}',
                          ),
                      ],
                      if (can['decide'] == true ||
                          can['submit'] == true ||
                          can['cancel'] == true) ...[
                        const SizedBox(height: Tokens.sp3),
                        Wrap(
                          spacing: Tokens.sp2,
                          runSpacing: Tokens.sp2,
                          children: [
                            if (can['decide'] == true) ...[
                              action('approve', s.piApprove, primary: true),
                              action('send_back', s.piSendBack),
                              action('reject', s.piReject),
                            ],
                            if (can['submit'] == true)
                              action('submit', s.piSendForApproval, primary: true),
                            if (can['cancel'] == true) action('cancel', s.piWithdraw),
                          ],
                        ),
                      ],
                    ]),
                    _card(context, s.piTheIndent, [
                      FactLine(s.piDepartment, dept),
                      FactLine(
                        s.piRaisedBy,
                        '${pi['raisedBy'] ?? ''}${pi['onBehalf'] != null ? ' (${s.piFor('${pi['onBehalf']}')})' : ''} · ${_day(s, pi['createdAt'])}',
                      ),
                      FactLine(
                        s.piNeededBy,
                        pi['requiredBy'] == null ? s.piNotGiven : s.date(pi['requiredBy']),
                      ),
                      if (pi['estimate'] != null)
                        FactLine(s.piEstimate, s.money(pi['estimate']), strong: true),
                      if (pi['departmentSpendThisYear'] != null)
                        FactLine(s.piDeptSpend(dept), s.money(pi['departmentSpendThisYear'])),
                    ]),
                    _card(context, s.piItems, [
                      for (final l in lines) ...[
                        _LineTile(indentId: widget.id, line: l, showRates: showRates),
                        if (l != lines.last) const Divider(height: Tokens.sp5),
                      ],
                      if (showRates && pi['estimate'] != null) ...[
                        const Divider(height: Tokens.sp5),
                        FactLine(s.piEstimate, s.money(pi['estimate']), strong: true),
                      ],
                    ]),
                    if (steps.isNotEmpty)
                      _card(context, s.piApprovals, [
                        for (final x in steps)
                          _StepTile(
                            step: x,
                            now: x['level'] == nowLevel,
                            submitted: st == 'submitted',
                          ),
                      ]),
                    if (history.isNotEmpty)
                      _card(context, s.piHistory, [
                        for (var i = 0; i < history.length; i++)
                          Padding(
                            padding: const EdgeInsets.only(bottom: Tokens.sp2),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text.rich(
                                  TextSpan(
                                    children: [
                                      TextSpan(text: '${i + 1}. '),
                                      TextSpan(
                                        text: s.piEvent('${history[i]['kind']}'),
                                        style: const TextStyle(fontWeight: Tokens.fwBold),
                                      ),
                                      TextSpan(
                                        text: [
                                          if (history[i]['actor'] != null) '${history[i]['actor']}',
                                          if (DateTime.tryParse('${history[i]['at']}') != null)
                                            s.dateTime(DateTime.parse('${history[i]['at']}')),
                                        ].map((x) => ' · $x').join(),
                                      ),
                                    ],
                                  ),
                                ),
                                if (history[i]['note'] != null)
                                  Text(
                                    '${history[i]['note']}',
                                    style: TextStyle(color: muted, fontSize: 13),
                                  ),
                              ],
                            ),
                          ),
                      ]),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Asks before acting, as the website's dialog: what will happen, and a reason when one is needed (at least 3
/// letters). Pops with the reason ('' when none is asked), or nothing when cancelled.
class _AskDialog extends ConsumerStatefulWidget {
  const _AskDialog({
    required this.title,
    required this.says,
    required this.confirm,
    required this.reasonLabel,
    required this.danger,
  });
  final String title;
  final String says;
  final String confirm;
  final String? reasonLabel;
  final bool danger;

  @override
  ConsumerState<_AskDialog> createState() => _AskDialogState();
}

class _AskDialogState extends ConsumerState<_AskDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final label = widget.reasonLabel;
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.says),
            if (label != null) ...[
              const SizedBox(height: Tokens.sp3),
              TextField(
                key: const Key('piReason'),
                controller: _reason,
                maxLength: 500,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(
                  labelText: '$label *',
                  border: const OutlineInputBorder(),
                  errorText: _error,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('piAskNo'),
          onPressed: () => Navigator.of(context).pop(),
          child: Text(s.cancel),
        ),
        FilledButton(
          key: const Key('piAskYes'),
          style: widget.danger
              ? FilledButton.styleFrom(
                  backgroundColor: Tokens.statusDanger,
                  foregroundColor: Tokens.textInverse,
                )
              : null,
          onPressed: () {
            if (label != null && _reason.text.trim().length < 3) {
              setState(() => _error = s.piNeedReason);
              return;
            }
            Navigator.of(context).pop(_reason.text.trim());
          },
          child: Text(widget.confirm),
        ),
      ],
    );
  }
}

/// One line of the indent: the item, its note, the store's free stock when raised, what became of it, its issue
/// slips and document, and (for those who see rates) the rate, amount and where the rate came from.
class _LineTile extends ConsumerWidget {
  const _LineTile({required this.indentId, required this.line, required this.showRates});
  final String indentId;
  final Json line;
  final bool showRates;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    final muted = _muted(context);
    final l = line;
    final seq = (l['seq'] as num?)?.toInt() ?? 0;
    final free = l['stockFree'] as num?;
    final stores = asList(l['stockStores']);
    final issues = asList(l['issues']);
    final small = TextStyle(color: muted, fontSize: 13);
    return Column(
      key: Key('piLine-${l['id']}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '$seq. ${l['item']}${l['itemCode'] != null ? ' (${l['itemCode']})' : ''}',
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        if (l['inCatalogue'] == false) Text(s.piNotInList, style: small),
        if (l['note'] != null) Text('${l['note']}', style: small),
        if (l['stockReason'] != null) Text(s.piBoughtAnyway('${l['stockReason']}'), style: small),
        if (l['ordered'] != null)
          Text('${l['ordered']}', style: small.copyWith(fontWeight: Tokens.fwBold)),
        const SizedBox(height: Tokens.sp1),
        FactLine(s.piQuantity, '${l['quantity']} ${l['uom'] ?? ''}'),
        FactLine(
          s.piInStore,
          free == null
              ? '—'
              : free > 0
              ? [
                  s.piFree(_qty(free), '${l['stockUom'] ?? ''}'),
                  if (stores.isNotEmpty)
                    stores.map((x) => '${x['store']} ${_qty(x['free'] as num? ?? 0)}').join(' · '),
                ].join('\n')
              : s.piNoneFree,
        ),
        if (showRates) ...[
          FactLine(s.piRate, s.money(l['estRate'] ?? 0)),
          FactLine(s.piAmount, s.money(l['amount'] ?? 0)),
          if (l['rateSource'] != null)
            FactLine(
              s.piRateFrom,
              '${s.piRateSource('${l['rateSource']}')}${l['contractVendor'] != null && l['rateSource'] == 'contract' ? '\n${l['contractVendor']}' : ''}',
            ),
        ],
        if (issues.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp1),
          Text(s.piIssueSlips, style: small),
          Wrap(
            spacing: Tokens.sp2,
            children: [
              for (final x in issues)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('${x['number']}'),
                    FileIcons(
                      label: s.piSlip('${x['number']}'),
                      name: 'piSlip-${x['id']}',
                      load: () => api.purchaseStockIssuePdf(id: '${x['id']}'),
                    ),
                  ],
                ),
            ],
          ),
        ],
        if (l['fileId'] != null)
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(s.piDocument, style: small),
              FileIcons(
                label: s.piLineDoc(seq),
                name: 'piDoc-${l['id']}',
                load: () => api.purchaseIndentLineFile(id: indentId, lineId: '${l['id']}'),
              ),
            ],
          ),
      ],
    );
  }
}

/// One approval level: its name, who it waits with or who decided (a level that needs all shows each, ticked once
/// they approved), its status with when, and the note.
class _StepTile extends ConsumerWidget {
  const _StepTile({required this.step, required this.now, required this.submitted});
  final Json step;
  final bool now;
  final bool submitted;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = _muted(context);
    final x = step;
    final status = '${x['status']}';
    final word = status != 'pending'
        ? status
        : now
        ? 'pending'
        : submitted
        ? 'later'
        : 'not_reached';
    final tone = switch (word) {
      'approved' => Tone.success,
      'rejected' => Tone.danger,
      'pending' => Tone.warning,
      _ => Tone.neutral,
    };
    final assignees = asList(x['assignees']);
    final done = {for (final a in asList(x['approvedBy'])) '${a['id']}'};
    final who = x['need'] == 'all' && status == 'pending'
        ? assignees.map((a) => '${done.contains('${a['id']}') ? '✓ ' : ''}${a['name']}').join(', ')
        : x['actedBy'] != null
        ? '${x['actedBy']}'
        : assignees.isNotEmpty
        ? assignees.map((a) => '${a['name']}').join(', ')
        : s.piNobody;
    final acted = DateTime.tryParse('${x['actedAt']}');
    final due = DateTime.tryParse('${x['dueAt']}');
    final when = acted != null
        ? s.dateTime(acted)
        : now && due != null
        ? s.piDue(s.dateTime(due), x['overdue'] == true)
        : '';
    return Container(
      key: Key('piStep-${x['id']}'),
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        border: Border.all(
          color: now ? Theme.of(context).colorScheme.primary : Theme.of(context).dividerColor,
          width: now ? 2 : 1,
        ),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${x['level']}. ${x['name']}',
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          Text(who),
          if (x['need'] == 'all' && status == 'pending')
            Text(
              s.piAllMust(done.length, assignees.length),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusChip(s.piStepWord(word), tone),
              if (when.isNotEmpty) Text(when, style: TextStyle(color: muted, fontSize: 13)),
            ],
          ),
          if (x['note'] != null) ...[const SizedBox(height: Tokens.sp1), Text('${x['note']}')],
        ],
      ),
    );
  }
}

/// What the form gives back once saved: the indent, its number once sent, and what to say.
typedef IndentSaved = ({String id, String? number, String said});

/// One line of the form, as typed.
class _Line {
  _Line({
    String item = '',
    String freeText = '',
    String quantity = '',
    this.uomId = '',
    String estRate = '',
    this.typed = false,
    String note = '',
    String stockReason = '',
    this.fileId = '',
    this.fileName = '',
  }) : itemId = item,
       freeText = TextEditingController(text: freeText),
       quantity = TextEditingController(text: quantity),
       estRate = TextEditingController(text: estRate),
       note = TextEditingController(text: note),
       stockReason = TextEditingController(text: stockReason);

  static int _seq = 0;
  final key = _seq++;
  String itemId;
  final TextEditingController freeText;
  final TextEditingController quantity;
  String uomId;
  final TextEditingController estRate;
  bool typed;
  final TextEditingController note;
  final TextEditingController stockReason;
  String fileId;
  String fileName;
  bool uploading = false;
  String? fileError;

  bool get used => itemId.isNotEmpty || freeText.text.trim().isNotEmpty || quantity.text.isNotEmpty;

  void dispose() {
    for (final c in [freeText, quantity, estRate, note, stockReason]) {
      c.dispose();
    }
  }
}

/// Raise or change a Purchase Indent, as the websites' form (docs/design/83, part 2): the department (mine unless I
/// may raise for any), for a colleague, when it is needed, the purpose and priority; the lines — an item from the
/// list (with what the stores hold free) or one described in words, the quantity, the unit, the estimated rate for
/// those who see rates, a note, a document, and why it is bought though the stores have it; the item sheet by Excel.
/// Saved as a draft, or saved and sent for approval. Pops with what was saved.
class IndentFormScreen extends ConsumerStatefulWidget {
  const IndentFormScreen({super.key, required this.profile, this.indent});
  final Profile profile;

  /// the indent being changed (its detail as the API gives it); none: a new one
  final Json? indent;

  @override
  ConsumerState<IndentFormScreen> createState() => _IndentFormScreenState();
}

class _IndentFormScreenState extends ConsumerState<IndentFormScreen> {
  String _dept = '';
  String _onBehalf = '';
  String? _requiredBy;
  late final _purpose = TextEditingController(text: '${widget.indent?['purpose'] ?? ''}');
  String _priority = 'normal';
  final _lines = <_Line>[];
  bool _ready = false;
  bool _busy = false;
  String? _error;
  bool _sheetBusy = false;
  String? _sheetSaid;
  List<Json> _sheetErrors = const [];

  @override
  void initState() {
    super.initState();
    final pi = widget.indent;
    if (pi != null) {
      _dept = '${pi['departmentId'] ?? ''}';
      _onBehalf = '${pi['onBehalfEmployeeId'] ?? ''}';
      _requiredBy = _str(pi['requiredBy']);
      _priority = '${pi['priority'] ?? 'normal'}';
      for (final l in asList(pi['lineItems'])) {
        _lines.add(
          _Line(
            item: l['itemId'] != null ? '${l['itemId']}' : _free,
            freeText: l['itemId'] != null ? '' : '${l['item'] ?? ''}',
            quantity: '${l['quantity'] ?? ''}',
            uomId: '${l['uomId'] ?? ''}',
            estRate: l['estRate'] == null ? '' : '${l['estRate']}',
            typed: l['rateSource'] == 'typed',
            note: '${l['note'] ?? ''}',
            stockReason: '${l['stockReason'] ?? ''}',
            fileId: '${l['fileId'] ?? ''}',
            fileName: '${l['fileName'] ?? ''}',
          ),
        );
      }
    }
    if (_lines.isEmpty) _lines.add(_Line());
  }

  @override
  void dispose() {
    _purpose.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  Map<String, Json> _items(Json lists) => {for (final i in asList(lists['items'])) '${i['id']}': i};

  /// What the main store and the chosen department's stores hold free of the line's item, and whether that
  /// covers the quantity (in the store unit).
  ({List<Json> stores, num free, String unit, bool covers})? _stockOf(Json? it, _Line l) {
    if (it == null || it['stockTracked'] != true) return null;
    final stores = asList(it['stock'])
        .where((x) => x['main'] == true || (_dept.isNotEmpty && '${x['departmentId']}' == _dept))
        .toList();
    final free = stores.fold<num>(0, (t, x) => t + ((x['free'] as num?) ?? 0));
    final q = num.tryParse(l.quantity.text.trim()) ?? 0;
    final need = q > 0 ? q * ((it['perUnit'] as num?) ?? 1) : 0;
    return (
      stores: stores,
      free: (free * 1000).round() / 1000,
      unit: '${it['stockUom'] ?? ''}',
      covers: need > 0 && free >= need,
    );
  }

  void _pickItem(Map<String, Json> items, _Line l, String itemId) {
    final it = items[itemId];
    final rate = it == null ? null : (it['contractRate'] ?? it['lastRate']) as num?;
    setState(() {
      l.itemId = itemId;
      l.uomId = it == null ? (itemId == _free ? l.uomId : '') : '${it['uomId']}';
      l.estRate.text = rate == null ? '' : '$rate';
      l.typed = it == null || rate == null;
      if (itemId != _free) l.freeText.clear();
    });
  }

  Future<void> _attach(_Line l) async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    if (picked.isEmpty) return;
    final f = picked.first;
    if (!_okDoc.hasMatch(f.contentType) || f.bytes.length > 5 * 1024 * 1024) {
      setState(() => l.fileError = s.piDocWrong);
      return;
    }
    setState(() {
      l.uploading = true;
      l.fileError = null;
    });
    try {
      final id = await uploadFile(ref.read(apiProvider), ref.read(transportProvider), f);
      if (mounted) {
        setState(() {
          l.fileId = id;
          l.fileName = f.name;
        });
      }
    } catch (e) {
      if (mounted) setState(() => l.fileError = errorText(s, e));
    } finally {
      if (mounted) setState(() => l.uploading = false);
    }
  }

  Future<void> _readSheet(Map<String, Json> items) async {
    final s = ref.read(stringsProvider);
    final f = await ref.read(xlsxPickerProvider)();
    if (f == null) return;
    if (f.bytes.length > 700000) {
      return setState(() {
        _sheetSaid = null;
        _sheetErrors = [
          {'row': 0, 'message': s.piSheetTooLarge},
        ];
      });
    }
    setState(() {
      _sheetBusy = true;
      _sheetSaid = null;
      _sheetErrors = const [];
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .purchaseReadIndentSheet(body: IndentSheetDto(file: base64Encode(f.bytes))),
      );
      final fresh = [
        for (final x in asList(r['lines']))
          () {
            final it = x['itemId'] != null ? items['${x['itemId']}'] : null;
            final rate = it == null ? null : (it['contractRate'] ?? it['lastRate']) as num?;
            return _Line(
              item: it != null ? '${it['id']}' : _free,
              freeText: it != null ? '' : '${x['freeText'] ?? ''}',
              uomId: it != null ? '${it['uomId']}' : '${x['uomId'] ?? ''}',
              quantity: '${x['quantity'] ?? ''}',
              note: '${x['note'] ?? ''}',
              estRate: rate == null ? '' : '$rate',
              typed: it == null || rate == null,
            );
          }(),
      ];
      if (!mounted) return;
      setState(() {
        final empty = _lines.where((l) => !l.used).toList();
        for (final l in empty) {
          _lines.remove(l);
          l.dispose();
        }
        _lines.addAll(fresh.take(200 - _lines.length));
        if (_lines.isEmpty) _lines.add(_Line());
        _sheetSaid = s.piSheetAdded(fresh.length);
        _sheetErrors = asList(r['errors']);
      });
    } catch (e) {
      if (mounted) {
        setState(
          () => _sheetErrors = [
            {'row': 0, 'message': errorText(s, e)},
          ],
        );
      }
    } finally {
      if (mounted) setState(() => _sheetBusy = false);
    }
  }

  /// The form's own checks (the API checks again); the first problem, or null.
  String? _check(S s, Json lists, Map<String, Json> items) {
    final departments = asList(lists['departments']);
    if (_dept.isEmpty && departments.isNotEmpty) return s.piNeedDept;
    if (_purpose.text.trim().length < 3) return s.piNeedPurpose;
    final used = _lines.where((l) => l.used).toList();
    if (used.isEmpty) return s.piNeedLine;
    final uoms = {for (final u in asList(lists['uoms'])) '${u['id']}': u};
    for (var i = 0; i < _lines.length; i++) {
      final l = _lines[i];
      if (!l.used) continue;
      final n = i + 1;
      if (l.itemId.isEmpty) return s.piNeedItem(n);
      if (l.itemId == _free && l.freeText.text.trim().length < 2) return s.piNeedText(n);
      final q = num.tryParse(l.quantity.text.trim());
      if (q == null || q <= 0 || q > 999999) return s.piNeedQty(n);
      if (l.itemId == _free && l.uomId.isEmpty) return s.piNeedUnit(n);
      final unit = l.itemId == _free ? uoms[l.uomId] : items[l.itemId];
      final decimals = unit != null && unit['decimals'] == true;
      if (!decimals && q != q.roundToDouble()) return s.piNeedWhole(n);
      if (lists['showRates'] == true &&
          l.estRate.text.trim().isNotEmpty &&
          num.tryParse(l.estRate.text.trim()) == null) {
        return s.piNeedRate(n);
      }
    }
    return null;
  }

  Future<void> _send(Json lists, bool submit) async {
    final s = ref.read(stringsProvider);
    final items = _items(lists);
    final problem = _check(s, lists, items);
    if (problem != null) return setState(() => _error = problem);
    final showRates = lists['showRates'] == true;
    final body = IndentDto(
      departmentId: _dept.isEmpty ? null : _dept,
      onBehalfEmployeeId: _onBehalf.isEmpty ? null : _onBehalf,
      purpose: _purpose.text.trim(),
      requiredBy: _requiredBy,
      priority: _priority,
      lines: [
        for (final l in _lines.where((l) => l.used))
          () {
            final note = l.note.text.trim();
            final rate = num.tryParse(l.estRate.text.trim());
            if (l.itemId != _free) {
              final stock = _stockOf(items[l.itemId], l);
              final why = l.stockReason.text.trim();
              return IndentDtoLinesItem(
                itemId: l.itemId,
                quantity: num.parse(l.quantity.text.trim()),
                estRate: showRates && l.typed ? rate : null,
                note: note.isEmpty ? null : note,
                fileId: l.fileId.isEmpty ? null : l.fileId,
                stockReason: (stock?.free ?? 0) > 0 && why.isNotEmpty ? why : null,
              );
            }
            return IndentDtoLinesItem(
              freeText: l.freeText.text.trim(),
              quantity: num.parse(l.quantity.text.trim()),
              uomId: l.uomId.isEmpty ? null : l.uomId,
              estRate: showRates ? rate : null,
              note: note.isEmpty ? null : note,
              fileId: l.fileId.isEmpty ? null : l.fileId,
            );
          }(),
      ],
    );
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    final old = widget.indent == null ? null : '${widget.indent!['id']}';
    String? saved = old;
    try {
      final r = asJson(
        old == null
            ? await api.purchaseCreateIndent(body: body)
            : await api.purchaseUpdateIndent(id: old, body: body),
      );
      saved = '${r['id']}';
      if (!submit) {
        if (mounted) {
          Navigator.of(context).pop<IndentSaved>((id: saved, number: null, said: s.piSavedDraft));
        }
        return;
      }
      final x = asJson(await api.purchaseSubmitIndent(id: saved));
      final number = _str(x['number']);
      if (mounted) {
        Navigator.of(context).pop<IndentSaved>((id: saved, number: number, said: s.piSent(number)));
      }
    } catch (e) {
      if (!mounted) return;
      // a new one saved as a draft though sending it failed: open it, saying why
      if (saved != null && old == null) {
        Navigator.of(context)
            .pop<IndentSaved>((id: saved, number: null, said: s.piNotSent(errorText(s, e))));
        return;
      }
      setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return AsyncBody<Json>(
      value: ref.watch(indentFormListsProvider),
      retry: () => ref.invalidate(indentFormListsProvider),
      data: (lists) {
        final departments = asList(lists['departments']);
        if (!_ready) {
          _ready = true;
          if (_dept.isEmpty && departments.length == 1) _dept = '${departments.first['id']}';
        }
        final items = _items(lists);
        final staffList = asList(lists['staff']);
        final uoms = asList(lists['uoms']);
        final showRates = lists['showRates'] == true;
        final muted = _muted(context);
        final small = TextStyle(color: muted, fontSize: 13);
        final today = DateTime.now();
        num amountOf(_Line l) {
          final q = num.tryParse(l.quantity.text.trim());
          final r = num.tryParse(l.estRate.text.trim());
          return q == null || r == null ? 0 : (q * r * 100).round() / 100;
        }

        final total = _lines.fold<num>(0, (t, l) => t + amountOf(l));
        return ListView(
          key: const Key('piForm'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(s.piFormHelp, style: TextStyle(color: muted, fontSize: 14)),
            if (widget.indent?['status'] == 'sent_back' &&
                widget.indent?['decisionNote'] != null) ...[
              const SizedBox(height: Tokens.sp3),
              Container(
                padding: const EdgeInsets.all(Tokens.sp3),
                decoration: BoxDecoration(
                  color: Tokens.statusWarningBg,
                  borderRadius: BorderRadius.circular(Tokens.radiusSm),
                ),
                child: Text(
                  '${s.piNoteTitle('sent_back')}: ${widget.indent!['decisionNote']}',
                  style: const TextStyle(color: Tokens.textBody),
                ),
              ),
            ],
            _card(context, s.piTheIndent, [
              DropdownMenu<String>(
                key: const Key('piFormDept'),
                label: Text('${s.piDepartment} *'),
                trailingIcon: dropArrow(s.piDepartment),
                selectedTrailingIcon: dropArrow(s.piDepartment, open: true),
                expandedInsets: EdgeInsets.zero,
                enableFilter: true,
                enableSearch: true,
                requestFocusOnTap: true,
                enabled: lists['anyDepartment'] == true || departments.length > 1,
                hintText: s.piPickDept,
                initialSelection: _dept.isEmpty ? null : _dept,
                onSelected: (v) => setState(() => _dept = v ?? ''),
                dropdownMenuEntries: [
                  for (final d in departments)
                    DropdownMenuEntry(value: '${d['id']}', label: '${d['name']}'),
                ],
              ),
              if (departments.isEmpty) Text(s.piNoDept, style: small),
              const SizedBox(height: Tokens.sp3),
              DropdownMenu<String>(
                key: const Key('piFormFor'),
                label: Text(s.piForColleague),
                trailingIcon: dropArrow(s.piForColleague),
                selectedTrailingIcon: dropArrow(s.piForColleague, open: true),
                expandedInsets: EdgeInsets.zero,
                enableFilter: true,
                enableSearch: true,
                requestFocusOnTap: true,
                initialSelection: _onBehalf,
                onSelected: (v) => setState(() => _onBehalf = v ?? ''),
                dropdownMenuEntries: [
                  DropdownMenuEntry(value: '', label: s.piMyself),
                  for (final x in staffList)
                    DropdownMenuEntry(value: '${x['id']}', label: '${x['name']} (${x['code']})'),
                ],
              ),
              const SizedBox(height: Tokens.sp3),
              _PickField(
                key: const Key('piFormBy'),
                label: s.piNeededBy,
                value: _requiredBy == null ? null : s.date(_requiredBy!),
                hint: s.piPickDate,
                icon: Icons.event,
                onTap: () async {
                  final first = DateTime(today.year, today.month, today.day);
                  final cur = DateTime.tryParse(_requiredBy ?? '');
                  final d = await showDatePicker(
                    context: context,
                    initialDate: cur != null && !cur.isBefore(first) ? cur : first,
                    firstDate: first,
                    lastDate: first.add(const Duration(days: 730)),
                  );
                  if (d != null) setState(() => _requiredBy = ymd(d));
                },
              ),
              if (_requiredBy != null)
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton(
                    onPressed: () => setState(() => _requiredBy = null),
                    child: Text(s.piClear),
                  ),
                ),
              const SizedBox(height: Tokens.sp3),
              TextField(
                key: const Key('piFormPurpose'),
                controller: _purpose,
                maxLength: 500,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(
                  labelText: '${s.piPurpose} *',
                  hintText: s.piPurposeHint,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: Tokens.sp2),
              Text(s.piPriority, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              const SizedBox(height: Tokens.sp1),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  ChoiceChip(
                    key: const Key('piFormNormal'),
                    label: Text(s.piNormal),
                    selected: _priority == 'normal',
                    onSelected: (_) => setState(() => _priority = 'normal'),
                  ),
                  ChoiceChip(
                    key: const Key('piFormUrgent'),
                    label: Text(s.piUrgentFirst),
                    selected: _priority == 'urgent',
                    onSelected: (_) => setState(() => _priority = 'urgent'),
                  ),
                ],
              ),
            ]),
            _card(context, s.piItems, [
              Text(s.piItemsHelp(showRates), style: small),
              const SizedBox(height: Tokens.sp3),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  OutlinedButton.icon(
                    key: const Key('piSheetGet'),
                    icon: const Icon(Icons.download_outlined),
                    label: Text(s.piDownloadSheet),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => FileScreen(
                          title: s.piSheetTitle,
                          load: () => ref.read(apiProvider).purchaseIndentSheet(),
                        ),
                      ),
                    ),
                  ),
                  OutlinedButton.icon(
                    key: const Key('piSheetPut'),
                    icon: const Icon(Icons.upload_file),
                    label: Text(s.piUploadSheet),
                    onPressed: _sheetBusy ? null : () => _readSheet(items),
                  ),
                ],
              ),
              const SizedBox(height: Tokens.sp1),
              Text(_sheetBusy ? s.piReadingSheet : s.piUploadSheetHelp, style: small),
              if (_sheetSaid != null) Text(_sheetSaid!, key: const Key('piSheetSaid')),
              if (_sheetErrors.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(top: Tokens.sp2),
                  padding: const EdgeInsets.all(Tokens.sp3),
                  decoration: BoxDecoration(
                    color: Tokens.statusWarningBg,
                    borderRadius: BorderRadius.circular(Tokens.radiusSm),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _sheetErrors.any((e) => ((e['row'] as num?) ?? 0) > 0)
                            ? s.piRowsNotAdded
                            : s.piSheetNotRead,
                        style: const TextStyle(fontWeight: Tokens.fwBold, color: Tokens.textBody),
                      ),
                      for (final e in _sheetErrors)
                        Text(
                          '${((e['row'] as num?) ?? 0) > 0 ? '${s.piRow((e['row'] as num).toInt())}: ' : ''}${e['message']}',
                          style: const TextStyle(color: Tokens.textBody),
                        ),
                    ],
                  ),
                ),
              for (var i = 0; i < _lines.length; i++)
                _lineForm(context, s, lists, items, uoms, _lines[i], i + 1),
              const SizedBox(height: Tokens.sp3),
              Wrap(
                spacing: Tokens.sp3,
                runSpacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (_lines.length < 200)
                    OutlinedButton.icon(
                      key: const Key('piAddLine'),
                      icon: const Icon(Icons.add),
                      label: Text(s.piAddLine),
                      onPressed: () => setState(() => _lines.add(_Line())),
                    ),
                  if (showRates)
                    Text(
                      s.piTotal(s.money(total)),
                      key: const Key('piFormTotal'),
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                ],
              ),
            ]),
            if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
            const SizedBox(height: Tokens.sp4),
            FilledButton(
              key: const Key('piFormSend'),
              onPressed: _busy ? null : () => _send(lists, true),
              child: Text(s.piSaveSend),
            ),
            const SizedBox(height: Tokens.sp2),
            OutlinedButton(
              key: const Key('piFormDraft'),
              onPressed: _busy ? null : () => _send(lists, false),
              child: Text(s.piSaveDraft),
            ),
            const SizedBox(height: Tokens.sp2),
            TextButton(
              onPressed: _busy ? null : () => Navigator.of(context).pop(),
              child: Text(s.cancel),
            ),
          ],
        );
      },
    );
  }

  Widget _lineForm(
    BuildContext context,
    S s,
    Json lists,
    Map<String, Json> items,
    List<Json> uoms,
    _Line l,
    int n,
  ) {
    final it = items[l.itemId];
    final free = l.itemId == _free;
    final stock = _stockOf(it, l);
    final showRates = lists['showRates'] == true;
    final small = TextStyle(color: _muted(context), fontSize: 13);
    final rate = it == null ? null : (it['contractRate'] ?? it['lastRate']) as num?;
    final source = it == null || l.typed
        ? s.piRateSource('typed')
        : it['contractRate'] != null
        ? '${s.piRateSource('contract')}${it['contractVendor'] != null ? ': ${it['contractVendor']}' : ''}'
        : it['lastRate'] != null
        ? s.piRateSource('last')
        : s.piRateSource('typed');
    final q = num.tryParse(l.quantity.text.trim());
    final r = num.tryParse(l.estRate.text.trim());
    final amount = q == null || r == null ? 0 : (q * r * 100).round() / 100;
    return Container(
      key: ValueKey('piLineForm-${l.key}'),
      margin: const EdgeInsets.only(top: Tokens.sp3),
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownMenu<String>(
            key: Key('piItem-$n'),
            label: Text('${s.piItemN(n)} *'),
            trailingIcon: dropArrow(s.piItemN(n)),
            selectedTrailingIcon: dropArrow(s.piItemN(n), open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            hintText: s.piPickItem,
            initialSelection: l.itemId.isEmpty ? null : l.itemId,
            onSelected: (v) => _pickItem(items, l, v ?? ''),
            dropdownMenuEntries: [
              for (final x in items.values)
                DropdownMenuEntry(
                  value: '${x['id']}',
                  label: '${x['name']} (${x['code']}) · ${x['category']}',
                ),
              DropdownMenuEntry(value: _free, label: s.piNotListed),
            ],
          ),
          if (stock != null)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Text(
                stock.stores.isEmpty
                    ? s.piInStoresNone
                    : s.piInStores(
                        _qty(stock.free),
                        stock.unit,
                        stock.stores
                            .map((x) => '${x['store']} ${_qty(x['free'] as num? ?? 0)}')
                            .join(' · '),
                      ),
                style: small,
              ),
            ),
          if (free) ...[
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: Key('piText-$n'),
              controller: l.freeText,
              maxLength: 300,
              decoration: InputDecoration(
                labelText: '${s.piDescribe} *',
                border: const OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: Key('piQty-$n'),
            controller: l.quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: '${s.piQuantityOf(it == null ? null : '${it['uom']}')} *',
              helperText: it != null && it['decimals'] != true ? s.piWhole : null,
              border: const OutlineInputBorder(),
            ),
          ),
          if (free) ...[
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: Key('piUnit-$n'),
              label: Text('${s.piUnit} *'),
              trailingIcon: dropArrow(s.piUnit),
              selectedTrailingIcon: dropArrow(s.piUnit, open: true),
              expandedInsets: EdgeInsets.zero,
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              initialSelection: l.uomId.isEmpty ? null : l.uomId,
              onSelected: (v) => setState(() => l.uomId = v ?? ''),
              dropdownMenuEntries: [
                for (final u in uoms)
                  DropdownMenuEntry(value: '${u['id']}', label: '${u['name']} (${u['code']})'),
              ],
            ),
          ],
          if (showRates) ...[
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: Key('piRate-$n'),
              controller: l.estRate,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() => l.typed = true),
              decoration: InputDecoration(
                labelText: s.piEstRate,
                helperText: l.itemId.isEmpty ? null : source,
                border: const OutlineInputBorder(),
              ),
            ),
            if (it != null && l.typed && rate != null)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(
                  onPressed: () => _pickItem(items, l, l.itemId),
                  child: Text(s.piUseRate(s.money(rate))),
                ),
              ),
          ],
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: Key('piNote-$n'),
            controller: l.note,
            maxLength: 300,
            decoration: InputDecoration(
              labelText: s.piNote,
              hintText: s.piNoteHint,
              border: const OutlineInputBorder(),
            ),
          ),
          if (l.fileId.isNotEmpty)
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: Tokens.sp2,
              children: [
                const Icon(Icons.attach_file, size: 18),
                Text('${s.piDocument}: ${l.fileName.isEmpty ? s.piAttached : l.fileName}'),
                TextButton(
                  key: Key('piDocOff-$n'),
                  onPressed: () => setState(() {
                    l.fileId = '';
                    l.fileName = '';
                  }),
                  child: Text(s.piRemoveDoc(n)),
                ),
              ],
            )
          else ...[
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: OutlinedButton.icon(
                key: Key('piDoc-$n'),
                icon: const Icon(Icons.attach_file),
                label: Text(l.uploading ? s.piUploading : s.piAttach),
                onPressed: l.uploading ? null : () => _attach(l),
              ),
            ),
            Text('${s.piDocOptional}: ${s.piDocHelp}', style: small),
          ],
          if (l.fileError != null) ErrorText(l.fileError!),
          if (stock != null && stock.free > 0) ...[
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: Key('piWhy-$n'),
              controller: l.stockReason,
              maxLength: 300,
              decoration: InputDecoration(
                labelText: s.piBuyNew,
                hintText: s.piBuyNewHint,
                helperText: s.piBuyNewHelp(stock.covers, _qty(stock.free), stock.unit),
                helperMaxLines: 5,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: Tokens.sp2),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: Tokens.sp2,
            children: [
              if (showRates) Text('${s.piAmount}: ${s.money(amount)}'),
              if (_lines.length > 1)
                TextButton.icon(
                  key: Key('piRemove-$n'),
                  icon: const Icon(Icons.delete_outline),
                  label: Text(s.piRemoveLine(n)),
                  onPressed: () => setState(() {
                    _lines.remove(l);
                    l.dispose();
                  }),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Hand my purchase approvals (indents, requisitions, orders) to a colleague for some days, as the staff website's
/// page: the colleague, the days and why; my hand-overs, in force or not, with End now.
class PurchaseHandOverScreen extends ConsumerStatefulWidget {
  const PurchaseHandOverScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<PurchaseHandOverScreen> createState() => _PurchaseHandOverScreenState();
}

class _PurchaseHandOverScreenState extends ConsumerState<PurchaseHandOverScreen> {
  String _to = '';
  late String _from = ymd(DateTime.now());
  String? _until;
  final _reason = TextEditingController();
  bool _busy = false;
  String? _error;
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _hand(BuildContext context) async {
    final s = ref.read(stringsProvider);
    if (_to.isEmpty) return setState(() => _error = s.piNeedColleague);
    if (_until == null || _until!.compareTo(_from) < 0) {
      return setState(() => _error = s.piNeedDates);
    }
    if (_reason.text.trim().length < 3) return setState(() => _error = s.piNeedReason);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .purchaseDelegate(
            body: PurchaseDelegationDto(
              toEmployeeId: _to,
              startsOn: _from,
              endsOn: _until!,
              reason: _reason.text.trim(),
            ),
          );
      ref.invalidate(purchaseDelegationsProvider);
      setState(() {
        _until = null;
        _reason.clear();
      });
      if (mounted) _say(s.piHandedOver);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _end(BuildContext context, String id) async {
    final s = ref.read(stringsProvider);
    try {
      await ref.read(apiProvider).purchaseRevokeDelegation(id: id);
      ref.invalidate(purchaseDelegationsProvider);
      if (mounted) _say(s.piEnded);
    } catch (e) {
      if (mounted) _say(errorText(s, e));
    }
  }

  Future<String?> _pick(BuildContext context, String? cur) async {
    final now = DateTime.now();
    final first = DateTime(now.year, now.month, now.day);
    final c = DateTime.tryParse(cur ?? '');
    final d = await showDatePicker(
      context: context,
      initialDate: c != null && !c.isBefore(first) ? c : first,
      firstDate: first,
      lastDate: first.add(const Duration(days: 365)),
    );
    return d == null ? null : ymd(d);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: Colors.transparent,
          body: AsyncBody<Json>(
            value: ref.watch(purchaseDelegationsProvider),
            retry: () => ref.invalidate(purchaseDelegationsProvider),
            data: (d) {
              final staffList = asList(d['staff']);
              final rows = asList(d['data']);
              final muted = _muted(context);
              final now = DateTime.now();
              return ListView(
                key: const Key('piHandOverScreen'),
                padding: const EdgeInsets.all(Tokens.sp4),
                children: [
                  Text(s.piHandOverHelp, style: TextStyle(color: muted, fontSize: 14)),
                  _card(context, s.piHandOver, [
                    DropdownMenu<String>(
                      key: const Key('piHoTo'),
                      label: Text('${s.piColleague} *'),
                      trailingIcon: dropArrow(s.piColleague),
                      selectedTrailingIcon: dropArrow(s.piColleague, open: true),
                      expandedInsets: EdgeInsets.zero,
                      enableFilter: true,
                      enableSearch: true,
                      requestFocusOnTap: true,
                      hintText: s.piPickColleague,
                      initialSelection: _to.isEmpty ? null : _to,
                      onSelected: (v) => setState(() => _to = v ?? ''),
                      dropdownMenuEntries: [
                        for (final x in staffList)
                          DropdownMenuEntry(
                            value: '${x['id']}',
                            label:
                                '${x['name']} (${x['code']})${x['designation'] != null ? ' · ${x['designation']}' : ''}',
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp3),
                    _PickField(
                      key: const Key('piHoFrom'),
                      label: '${s.piFrom} *',
                      value: s.date(_from),
                      icon: Icons.event,
                      onTap: () async {
                        final v = await _pick(context, _from);
                        if (v != null) setState(() => _from = v);
                      },
                    ),
                    const SizedBox(height: Tokens.sp3),
                    _PickField(
                      key: const Key('piHoUntil'),
                      label: '${s.piToWholeDay} *',
                      value: _until == null ? null : s.date(_until!),
                      hint: s.piPickDate,
                      icon: Icons.event,
                      onTap: () async {
                        final v = await _pick(context, _until ?? _from);
                        if (v != null) setState(() => _until = v);
                      },
                    ),
                    const SizedBox(height: Tokens.sp3),
                    TextField(
                      key: const Key('piHoReason'),
                      controller: _reason,
                      maxLength: 300,
                      decoration: InputDecoration(
                        labelText: '${s.piReason} *',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    if (_error != null) ErrorText(_error!),
                    const SizedBox(height: Tokens.sp2),
                    FilledButton(
                      key: const Key('piHoSend'),
                      onPressed: _busy ? null : () => _hand(context),
                      child: Text(s.piHandOverBtn),
                    ),
                  ]),
                  for (final x in rows)
                    () {
                      final starts = DateTime.tryParse('${x['startsAt']}');
                      final ends = DateTime.tryParse('${x['endsAt']}');
                      final state = x['revoked'] == true
                          ? 'revoked'
                          : x['active'] == true
                          ? 'active'
                          : starts != null && starts.isAfter(now)
                          ? 'later'
                          : 'over';
                      return _card(
                        context,
                        '${x['from']} → ${x['to']}',
                        key: Key('piHo-${x['id']}'),
                        [
                          Text(
                            '${_day(s, x['startsAt'])} – ${_day(s, x['endsAt'])} · ${x['reason'] ?? ''}',
                          ),
                          const SizedBox(height: Tokens.sp1),
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: StatusChip(s.piDelegState(state), switch (state) {
                              'active' => Tone.success,
                              'later' => Tone.info,
                              _ => Tone.neutral,
                            }),
                          ),
                          if (x['mine'] == true &&
                              x['revoked'] != true &&
                              ends != null &&
                              ends.isAfter(now))
                            Align(
                              alignment: AlignmentDirectional.centerStart,
                              child: TextButton(
                                key: Key('piHoEnd-${x['id']}'),
                                onPressed: () => _end(context, '${x['id']}'),
                                child: Text(s.piEndNow),
                              ),
                            ),
                        ],
                      );
                    }(),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// A field that opens a picker (a date): the label and the value as a field, read out as one button.
class _PickField extends StatelessWidget {
  const _PickField({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
    this.hint,
  });
  final String label;
  final String? value;
  final String? hint;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$label: ${value ?? hint ?? ''}',
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: Icon(icon),
        ),
        child: Text(value ?? hint ?? ''),
      ),
    ),
  );
}
