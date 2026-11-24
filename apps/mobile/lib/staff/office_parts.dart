import 'package:material_ui/material_ui.dart';

import '../theme/tokens.g.dart';

/// A heading and its content on a card, as a section of the staff website's page.
Widget officeCard(BuildContext context, String title, List<Widget> children, {Key? key}) => Card(
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

/// The colour of secondary text in the current theme.
Color officeMuted(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? Tokens.mobGray300 : Tokens.textMuted;

/// A tinted note box (what to change, why it was refused): readable on both themes.
Widget officeNote(String text, {bool danger = false, String? title, Key? key}) => Container(
  key: key,
  padding: const EdgeInsets.all(Tokens.sp3),
  decoration: BoxDecoration(
    color: danger ? Tokens.statusDangerBg : Tokens.statusWarningBg,
    borderRadius: BorderRadius.circular(Tokens.radiusSm),
  ),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (title != null)
        Text(
          title,
          style: const TextStyle(fontWeight: Tokens.fwBold, color: Tokens.textBody),
        ),
      Text(text, style: const TextStyle(color: Tokens.textBody)),
    ],
  ),
);

/// A field that opens a picker (a date): the label and the value as a field, read out as one button.
class OfficePickField extends StatelessWidget {
  const OfficePickField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.hint,
    this.icon = Icons.event,
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
