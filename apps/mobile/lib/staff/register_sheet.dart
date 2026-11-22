import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// The leaf columns of a sheet's heading rows (each column's cells from top to bottom), laid out as a browser lays
/// out `colspan` / `rowspan`: a column's label joins the distinct texts over it ("English · Term exam (80)").
List<String> sheetColumns(Json sheet) {
  final head = [for (final r in (sheet['head'] as List?) ?? const []) asList(r)];
  final widths = (sheet['widths'] as List?) ?? const [];
  var count = widths.length;
  for (final r in head) {
    var n = 0;
    for (final c in r) {
      n += (c['span'] as num?)?.toInt() ?? 1;
    }
    if (n > count) count = n;
  }
  final labels = List<List<String>>.generate(count, (_) => <String>[]);
  final taken = <(int, int)>{};
  for (var r = 0; r < head.length; r++) {
    var col = 0;
    for (final c in head[r]) {
      while (taken.contains((r, col))) {
        col++;
      }
      final span = (c['span'] as num?)?.toInt() ?? 1;
      final rows = (c['rows'] as num?)?.toInt() ?? 1;
      final text = '${c['t'] ?? ''}'.trim();
      for (var x = col; x < col + span && x < count; x++) {
        for (var y = r; y < r + rows; y++) {
          taken.add((y, x));
        }
        if (text.isNotEmpty && (labels[x].isEmpty || labels[x].last != text)) labels[x].add(text);
      }
      col += span;
    }
  }
  return [for (final l in labels) l.join(' · ')];
}

/// A register's sheet on a phone (docs/design/97), as the website's: a row naming each column, a row a student, the
/// class average at the foot; cells spanning columns keep their width; worked-out cells tinted green, the final
/// amber, codes in red; a report's count opens the students it stands for. Wider than a phone: it slides sideways.
class RegisterSheetView extends ConsumerWidget {
  const RegisterSheetView({super.key, required this.sheet, required this.label});
  final Json sheet;
  final String label;

  static const double _unit = 14;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final line = (dark ? Tokens.mobGray700 : Tokens.mobGray200);
    final columns = sheetColumns(sheet);
    final shares = [for (final w in (sheet['widths'] as List?) ?? const []) (w as num?) ?? 1];
    // each column wide enough to read: its share of the width, at least a short word's
    final widths = [
      for (var i = 0; i < columns.length; i++)
        (i < shares.length ? shares[i] * _unit : 6 * _unit).clamp(64.0, 260.0).toDouble(),
    ];
    double widthOf(int from, int span) {
      var w = 0.0;
      for (var i = from; i < from + span && i < widths.length; i++) {
        w += widths[i];
      }
      return w;
    }

    Widget row(List<Json> cells, {bool head = false, bool foot = false}) {
      final out = <Widget>[];
      var col = 0;
      for (final c in cells) {
        final span = (c['span'] as num?)?.toInt() ?? 1;
        out.add(
          SizedBox(
            width: widthOf(col, span),
            child: _Cell(cell: c, head: head, foot: foot, line: line, dark: dark),
          ),
        );
        col += span;
      }
      return IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: out),
      );
    }

    final body = [for (final r in (sheet['body'] as List?) ?? const []) asJson(r)];
    final foot = sheet['foot'] is List ? asList(sheet['foot']) : null;
    return Semantics(
      label: label,
      container: true,
      explicitChildNodes: true,
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: line),
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
        ),
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              row([
                for (final c in columns) {'t': c, 'text': true},
              ], head: true),
              for (final r in body) row(asList(r['cells'])),
              if (foot != null) row(foot, foot: true),
              if (body.isEmpty)
                Padding(padding: const EdgeInsets.all(Tokens.sp3), child: Text(s.rgNothing)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Cell extends ConsumerWidget {
  const _Cell({
    required this.cell,
    required this.head,
    required this.foot,
    required this.line,
    required this.dark,
  });
  final Json cell;
  final bool head;
  final bool foot;
  final Color line;
  final bool dark;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final tone = '${cell['tone'] ?? ''}';
    final tint = switch (tone) {
      'calc' => Tokens.statusSuccessBg,
      'final' => Tokens.statusWarningBg,
      'none' => dark ? Tokens.mobGray700 : Tokens.mobGray50,
      _ => head ? (dark ? Tokens.mobGray700 : Tokens.mobGray50) : null,
    };
    // on a light tint the words stay dark, in either theme
    final onTint = tint == Tokens.statusSuccessBg || tint == Tokens.statusWarningBg;
    final color = tone == 'code' || tone == 'warn'
        ? (dark && !onTint ? Theme.of(context).colorScheme.error : Tokens.statusDanger)
        : onTint
        ? Tokens.textBody
        : null;
    final lines = cell['lines'] is List ? [for (final l in cell['lines'] as List) '$l'] : null;
    final text = lines?.join('\n') ?? '${cell['t'] ?? ''}';
    final strong = head || foot || cell['strong'] == true;
    final drill = cell['drill'] is Map ? asJson(cell['drill']) : null;
    final badge = cell['badge'] is Map ? asJson(cell['badge']) : null;
    final align = cell['text'] == true || head ? TextAlign.start : TextAlign.end;
    Widget words = Text(
      text,
      textAlign: cell['center'] == true ? TextAlign.center : align,
      softWrap: true,
      style: TextStyle(color: color, fontSize: 13, fontWeight: strong ? Tokens.fwSemibold : null),
    );
    if (cell['ratio'] == true) {
      final m = RegExp(r'^(.+) / (.+)$').firstMatch(text);
      if (m != null) {
        words = Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: m.group(1),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              TextSpan(text: ' / ${m.group(2)}'),
            ],
          ),
          textAlign: TextAlign.end,
          style: TextStyle(color: color, fontSize: 13),
        );
      }
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: Tokens.sp1),
      decoration: BoxDecoration(
        color: tint,
        border: Border(
          right: BorderSide(color: line),
          bottom: BorderSide(color: line),
        ),
      ),
      alignment: cell['text'] == true || head ? Alignment.centerLeft : Alignment.centerRight,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: cell['text'] == true || head
            ? CrossAxisAlignment.start
            : CrossAxisAlignment.end,
        children: [
          if (drill != null && badge == null)
            _drillLink(context, s, '${cell['drillLabel'] ?? text}', drill)
          else
            words,
          if (badge != null)
            Text(
              '${badge['label']}',
              style: TextStyle(fontSize: 12, fontWeight: Tokens.fwSemibold, color: color),
            ),
          if (drill != null && badge != null)
            _drillLink(context, s, '${cell['drillLabel'] ?? text}', drill),
        ],
      ),
    );
  }

  /// A report's count: tapped, the students it stands for in a window.
  Widget _drillLink(BuildContext context, S s, String label, Json drill) => Semantics(
    button: true,
    hint: s.rgOpenStudents,
    child: InkWell(
      onTap: () => showDialog<void>(
        context: context,
        builder: (c) {
          final cols = [for (final x in (drill['cols'] as List?) ?? const []) '$x'];
          final rows = [
            for (final r in (drill['rows'] as List?) ?? const []) [for (final x in r as List) '$x'],
          ];
          return AlertDialog(
            title: Text('${drill['title'] ?? ''}'),
            content: SizedBox(
              width: double.maxFinite,
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final r in rows)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Tokens.sp2),
                      child: Text(
                        [
                          for (var i = 0; i < r.length; i++)
                            i < cols.length && cols[i].isNotEmpty ? '${cols[i]}: ${r[i]}' : r[i],
                        ].join(' · '),
                      ),
                    ),
                ],
              ),
            ),
            actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(s.close))],
          );
        },
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
        child: Text(
          '↗ $label',
          style: TextStyle(
            fontSize: 13,
            decoration: TextDecoration.underline,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
      ),
    ),
  );
}
