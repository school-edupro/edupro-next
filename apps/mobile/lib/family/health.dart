import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

Tone _outcomeTone(String o) => switch (o) {
  'back_to_class' => Tone.success,
  'rest' => Tone.info,
  'sent_home' => Tone.warning,
  _ => Tone.danger,
};

/// The local time of an ISO stamp: 09:42
String _clock(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String _num(Object? v) {
  final n = num.tryParse('${v ?? ''}');
  if (n == null) return '';
  return n == n.roundToDouble() ? '${n.round()}' : '$n';
}

/// The child's health as the website shows it (apps/parent/app/(app)/health): clinic visits and health check-up
/// cards in one list, latest first, ten a page, with the type, the dates and a search; each opens in full, and a
/// card's PDF opens or saves on the phone.
class HealthScreen extends ConsumerStatefulWidget {
  const HealthScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends ConsumerState<HealthScreen> {
  String _kind = '';
  DateTime? _from;
  DateTime? _to;
  String _q = '';
  int _page = 1;
  final _search = TextEditingController();

  static const _size = 10;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _filtered => _kind.isNotEmpty || _from != null || _to != null || _q.isNotEmpty;

  (Profile, String, String, String, String, int) get _key => (
    widget.profile,
    _kind,
    _from == null ? '' : ymd(_from!),
    _to == null ? '' : ymd(_to!),
    _q,
    _page,
  );

  Future<void> _pickDate(bool from) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
      } else {
        _to = d;
      }
      _page = 1;
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return LoadedList<Json>(
      value: ref.watch(healthListProvider(_key)),
      refresh: () => ref.refresh(healthListProvider(_key).future),
      children: (list) {
        final items = asList(list['data']);
        final total = ((asJson(list['page'])['total'] as num?) ?? 0).toInt();
        final pages = (total / _size).ceil();
        return [
          Text(
            s.healthTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(
            s.healthCount(total, _filtered),
            key: const Key('healthCount'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp3),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    label: s.healthTitle,
                    container: true,
                    explicitChildNodes: true,
                    child: Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp2,
                      children: [
                        for (final (v, label) in [
                          ('', s.allKinds),
                          ('visit', s.clinicVisits),
                          ('card', s.healthCards),
                        ])
                          ChoiceChip(
                            key: Key('healthKind-${v.isEmpty ? 'all' : v}'),
                            label: Text(label),
                            selected: _kind == v,
                            showCheckmark: false,
                            onSelected: (_) => setState(() {
                              _kind = v;
                              _page = 1;
                            }),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Tokens.sp2),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp2,
                    children: [
                      OutlinedButton.icon(
                        key: const Key('healthFrom'),
                        icon: const Icon(Icons.event),
                        label: Text('${s.fromWord}: ${_from == null ? '—' : s.date(_from!)}'),
                        onPressed: () => _pickDate(true),
                      ),
                      OutlinedButton.icon(
                        key: const Key('healthTo'),
                        icon: const Icon(Icons.event),
                        label: Text('${s.givenTo}: ${_to == null ? '—' : s.date(_to!)}'),
                        onPressed: () => _pickDate(false),
                      ),
                    ],
                  ),
                  const SizedBox(height: Tokens.sp2),
                  TextField(
                    key: const Key('healthSearch'),
                    controller: _search,
                    maxLength: 80,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      labelText: s.healthSearch,
                      prefixIcon: const Icon(Icons.search),
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                    onSubmitted: (v) => setState(() {
                      _q = v.trim();
                      _page = 1;
                    }),
                  ),
                  if (_filtered)
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton(
                        key: const Key('healthClear'),
                        onPressed: () => setState(() {
                          _kind = '';
                          _from = null;
                          _to = null;
                          _q = '';
                          _search.clear();
                          _page = 1;
                        }),
                        child: Text(s.clearDates),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          if (items.isEmpty) EmptyLine(_filtered ? s.nothingMatches : s.healthNothingYet),
          for (final it in items)
            it['kind'] == 'visit'
                ? _VisitCard(profile: widget.profile, visit: asJson(it['visit']))
                : _HealthCardCard(profile: widget.profile, card: asJson(it['card'])),
          if (total > _size)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  key: const Key('healthPrev'),
                  tooltip: s.previous,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: _page > 1 ? () => setState(() => _page -= 1) : null,
                ),
                Flexible(child: Text(s.pageOf(_page, pages), textAlign: TextAlign.center)),
                IconButton(
                  key: const Key('healthNext'),
                  tooltip: s.next,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _page < pages ? () => setState(() => _page += 1) : null,
                ),
              ],
            ),
        ];
      },
    );
  }
}

/// The date block of a list entry: the day, the month and year, and the time when there is one.
class _DateBlock extends StatelessWidget {
  const _DateBlock({required this.at, this.time});
  final DateTime at;
  final String? time;

  @override
  Widget build(BuildContext context) => Consumer(
    builder: (context, ref, _) {
      final s = ref.watch(stringsProvider);
      final dark = Theme.of(context).brightness == Brightness.dark;
      return Container(
        width: 64,
        padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
        decoration: BoxDecoration(
          color: dark ? Tokens.mobNavy700 : Tokens.mobNavy50,
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
        ),
        child: Column(
          children: [
            Text(
              at.day.toString().padLeft(2, '0'),
              style: const TextStyle(fontSize: 20, fontWeight: Tokens.fwBold),
            ),
            Text(
              "${s.monthShort(at)} '${(at.year % 100).toString().padLeft(2, '0')}",
              style: const TextStyle(fontSize: 12),
            ),
            if (time != null) Text(time!, style: const TextStyle(fontSize: 12)),
          ],
        ),
      );
    },
  );
}

class _VisitCard extends ConsumerWidget {
  const _VisitCard({required this.profile, required this.visit});
  final Profile profile;
  final Json visit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final v = visit;
    final inAt = DateTime.tryParse('${v['inAt']}')?.toLocal() ?? DateTime.now();
    final meds = asList(v['medicines']);
    final line = [
      if ('${v['treatment'] ?? ''}'.isNotEmpty) '${v['treatment']}',
      if (meds.isNotEmpty) s.medicineGiven(meds.map(_medName).join(', ')),
    ].join(' · ');
    void open() => pushPage(context, s.clinicVisit, VisitDetail(id: '${v['id']}'));
    return Card(
      key: Key('visit-${v['id']}'),
      child: InkWell(
        onTap: open,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _DateBlock(at: inAt, time: _clock(inAt)),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          '${v['complaint'] ?? ''}',
                          style: const TextStyle(fontWeight: Tokens.fwBold),
                        ),
                        StatusChip(s.outcome('${v['outcome']}'), _outcomeTone('${v['outcome']}')),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp1),
                    Text(line.isEmpty ? s.clinicVisit : line),
                    Text(
                      [
                        s.clinicVisit,
                        '${v['number'] ?? ''}',
                        if (v['student'] != null) '${v['student']}',
                        if (v['doctor'] != null) '${v['doctor']}',
                      ].where((x) => x.isNotEmpty).join(' · '),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: Key('visitDetails-${v['id']}'),
                        onPressed: open,
                        child: Text(s.details),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _medName(Json m) => '${m['name']}${m['strength'] != null ? ' ${m['strength']}' : ''}';

class _HealthCardCard extends ConsumerWidget {
  const _HealthCardCard({required this.profile, required this.card});
  final Profile profile;
  final Json card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final c = card;
    final id = '${c['id']}';
    final at = DateTime.tryParse('${c['examDate']}') ?? DateTime.now();
    final attention = c['needsAttention'] == true;
    void open() => pushPage(context, s.healthCheckUpCard, HealthCardDetail(id: id));
    return Card(
      key: Key('hcard-$id'),
      child: InkWell(
        onTap: open,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _DateBlock(at: at),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          '${c['camp'] ?? ''}',
                          style: const TextStyle(fontWeight: Tokens.fwBold),
                        ),
                        StatusChip(
                          attention ? s.seeDoctor : s.healthCardWord,
                          attention ? Tone.warning : Tone.success,
                        ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp1),
                    Text(
                      [
                        if (_num(c['heightCm']).isNotEmpty) s.heightCm(_num(c['heightCm'])),
                        if (_num(c['weightKg']).isNotEmpty) s.weightKg(_num(c['weightKg'])),
                        if (_num(c['bmi']).isNotEmpty) 'BMI ${_num(c['bmi'])}',
                        if (c['bloodGroup'] != null) s.bloodGroupIs('${c['bloodGroup']}'),
                      ].join(' · '),
                    ),
                    Text(
                      [
                        s.healthCheckUp,
                        if (c['student'] != null) '${c['student']}',
                        if (c['doctor'] != null) '${c['doctor']}',
                      ].join(' · '),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        TextButton(
                          key: Key('cardDetails-$id'),
                          onPressed: open,
                          child: Text(s.details),
                        ),
                        FileIcons(
                          name: 'hcard-$id',
                          label: s.healthCardPdf,
                          load: () => ref.read(apiProvider).clinicMineCard(id: id),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A record in full, as the website's record sheet: the school, what it is, the child with a status, the facts,
/// the sections of label and value (empty ones left out), more below, the remarks, who signed it and a note.
class _RecordSheet extends ConsumerWidget {
  const _RecordSheet({
    required this.school,
    required this.doc,
    required this.name,
    this.badge,
    required this.facts,
    required this.sections,
    this.extra,
    required this.remarksTitle,
    this.remarks,
    this.attention = false,
    this.attentionText,
    this.signedBy,
    required this.signLabel,
    required this.note,
    this.actions,
  });
  final String school;
  final String doc;
  final String name;
  final Widget? badge;
  final List<(String, String?)> facts;
  final List<(String, List<(String, String?)>)> sections;
  final Widget? extra;
  final String remarksTitle;
  final String? remarks;
  final bool attention;
  final String? attentionText;
  final String? signedBy;
  final String signLabel;
  final String note;
  final Widget? actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    Widget rows(List<(String, String?)> list) => Card(
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          children: [
            for (final (k, v) in list)
              if ((v ?? '').trim().isNotEmpty) FactLine(k, v!),
          ],
        ),
      ),
    );
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(school, style: TextStyle(color: muted, fontSize: 14)),
        Text(doc, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              name,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            ?badge,
          ],
        ),
        if (actions != null) ...[const SizedBox(height: Tokens.sp2), actions!],
        const SizedBox(height: Tokens.sp3),
        rows(facts),
        for (final (title, list) in sections)
          if (list.any((r) => (r.$2 ?? '').trim().isNotEmpty)) ...[SectionTitle(title), rows(list)],
        ?extra,
        if ((remarks ?? '').trim().isNotEmpty || (attention && attentionText != null)) ...[
          SectionTitle(remarksTitle),
          Container(
            padding: const EdgeInsets.all(Tokens.sp3),
            decoration: BoxDecoration(
              color: attention ? Tokens.statusWarningBg : Tokens.statusInfoBg,
              borderRadius: BorderRadius.circular(Tokens.radiusSm),
            ),
            child: Text(
              [
                if ((remarks ?? '').trim().isNotEmpty) remarks!.trim(),
                if (attention && attentionText != null) attentionText!,
              ].join('\n'),
              style: const TextStyle(color: Tokens.textBody),
            ),
          ),
        ],
        const SizedBox(height: Tokens.sp4),
        if ((signedBy ?? '').isNotEmpty) FactLine(signLabel, signedBy!),
        const SizedBox(height: Tokens.sp2),
        Text(note, style: TextStyle(color: muted, fontSize: 13)),
      ],
    );
  }
}

/// One clinic visit with everything the clinic recorded.
class VisitDetail extends ConsumerWidget {
  const VisitDetail({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final value = ref.watch(healthVisitProvider(id));
    return AsyncBody<Json>(
      value: value,
      retry: () => ref.invalidate(healthVisitProvider(id)),
      data: (v) {
        final outcome = '${v['outcome']}';
        final away = outcome == 'sent_home' || outcome == 'referred';
        final inAt = DateTime.tryParse('${v['inAt']}')?.toLocal();
        final outAt = DateTime.tryParse('${v['outAt'] ?? ''}')?.toLocal();
        final meds = asList(v['medicines']);
        String? n(Object? x, String unit) => _num(x).isEmpty ? null : '${_num(x)}$unit';
        return _RecordSheet(
          school: '${v['school'] ?? ''}',
          doc: '${s.clinicVisit} · ${v['number'] ?? ''}',
          name: '${v['student'] ?? ''}',
          badge: StatusChip(s.outcome(outcome), _outcomeTone(outcome)),
          facts: [
            (s.classLabel, v['section'] as String?),
            (s.admissionNoLabel, v['admissionNo'] as String?),
            (s.timeIn, inAt == null ? null : s.dateTime(inAt)),
            (s.timeOut, outAt == null ? s.stillInClinic : s.dateTime(outAt)),
            (s.clinicLabel, v['clinic'] as String?),
            (s.nurse, v['nurse'] as String?),
          ],
          sections: [
            (
              s.complaintExam,
              [
                (s.complaint, v['complaint'] as String?),
                (s.disease, (v['diseases'] as List? ?? const []).join(', ')),
                (s.temperature, n(v['temperatureC'], ' °C')),
                (s.pulse, n(v['pulse'], ' / min')),
                (s.bloodPressure, v['bp'] as String?),
                ('SpO2', n(v['spo2'], '%')),
                (s.weightLabel, n(v['weightKg'], ' kg')),
                (s.doctorFound, v['diagnosis'] as String?),
              ],
            ),
            (
              s.treatmentTitle,
              [
                (s.treatmentGiven, v['treatment'] as String?),
                (s.prescription, v['prescription'] as String?),
                (s.referredTo, v['referredTo'] as String?),
              ],
            ),
          ],
          extra: meds.isEmpty
              ? null
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SectionTitle(s.medicinesGiven),
                    Card(
                      child: Column(
                        children: [
                          for (final m in meds)
                            ListTile(
                              title: Text(_medName(m)),
                              subtitle: Text(
                                '${s.quantity}: ${_num(m['qty'])} ${m['unit'] ?? ''} · ${s.dosage}: ${m['dosage'] ?? '—'}',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
          remarksTitle: away ? s.schoolAsks : s.advice,
          remarks: away
              ? [
                  outcome == 'referred'
                      ? s.referredText('${v['referredTo'] ?? ''}')
                      : s.sentHomeText,
                  if ('${v['remark'] ?? ''}'.isNotEmpty) '${v['remark']}',
                ].join('\n')
              : v['remark'] as String?,
          attention: away,
          signedBy: v['doctor'] as String?,
          signLabel: s.doctorLabel,
          note: s.recordedByClinic,
        );
      },
    );
  }
}

/// One health check-up card, every finding section by section, as on its PDF (which opens or saves here too).
class HealthCardDetail extends ConsumerWidget {
  const HealthCardDetail({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final value = ref.watch(healthCardProvider(id));
    return AsyncBody<Json>(
      value: value,
      retry: () => ref.invalidate(healthCardProvider(id)),
      data: (c) {
        final attention = c['needsAttention'] == true;
        return _RecordSheet(
          school: '${c['school'] ?? ''}',
          doc: '${s.healthCheckUpCard} · ${c['camp'] ?? ''}',
          name: '${c['student'] ?? ''}',
          badge: attention ? StatusChip(s.seeDoctor, Tone.warning) : null,
          actions: Row(
            children: [
              Text(s.healthCardPdf, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              FileIcons(
                name: 'hcardPdf',
                label: s.healthCardPdf,
                load: () => ref.read(apiProvider).clinicMineCard(id: id),
              ),
            ],
          ),
          facts: [
            (s.classLabel, c['section'] as String?),
            (s.admissionNoLabel, c['admissionNo'] as String?),
            (s.dateOfBirth, c['dob'] == null ? null : s.date(c['dob'])),
            (s.examinedOn, c['examDate'] == null ? null : s.date(c['examDate'])),
            (s.place, c['place'] as String?),
            (s.doctorLabel, c['doctor'] as String?),
          ],
          sections: [
            for (final g in asList(c['groups']))
              (
                '${g['title']}',
                [
                  for (final r in (g['rows'] as List? ?? const []))
                    if (r is List && r.length >= 2) ('${r[0]}', '${r[1]}'),
                ],
              ),
          ],
          remarksTitle: s.remarksForParents,
          remarks: c['remarks'] as String?,
          attention: attention,
          attentionText: s.seeDoctorAbout,
          signedBy: (c['doctor'] as String?) ?? s.schoolDoctor,
          signLabel: s.signatureLabel,
          note: (c['note'] as String?) ?? s.notCertificate,
        );
      },
    );
  }
}
