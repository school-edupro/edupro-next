import 'package:material_ui/material_ui.dart';

import 'tokens.g.dart';

/// EduPro's look on the phone (look B, "navy band", chosen 19 Nov 2026): the design system's navy and cyan,
/// Poppins headings and Source Sans 3 text (the same tokens as the web apps), light and dark. Screens sit on a navy
/// band with a light sheet over it (BandScaffold, FamilyPage, the home tabs); buttons are cyan with navy words
/// (4.8:1; white on cyan is too light at 3.1:1); the bottom bar is navy with a cyan pill on the open tab.
ThemeData eduproTheme({required Brightness brightness, bool webFonts = true}) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Tokens.mobNavy800,
    brightness: brightness,
    primary: dark ? Tokens.mobCyan500 : Tokens.mobNavy800,
    onPrimary: dark ? Tokens.mobNavy900 : Tokens.mobWhite,
    secondary: Tokens.mobCyan600,
    error: Tokens.mobRed600,
    surface: dark ? Tokens.mobGray900 : Tokens.mobWhite,
  );
  final base = ThemeData(brightness: brightness).textTheme;
  // Poppins and Source Sans 3 as on the web, shipped in the app (assets/fonts); tests use the platform font
  final body = base.apply(
    fontFamily: webFonts ? 'SourceSans3' : null,
    bodyColor: dark ? Tokens.mobGray100 : Tokens.mobGray700,
    displayColor: dark ? Tokens.mobWhite : Tokens.mobNavy800,
  );
  final headings = webFonts ? body.apply(fontFamily: 'Poppins') : body;
  final heading = webFonts ? 'Poppins' : null;
  final radius = BorderRadius.circular(12);
  final ink = (dark ? Tokens.mobWhite : Tokens.mobNavy800);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? Tokens.mobNavy900 : Tokens.mobGray50,
    // headings in Poppins and in navy (white in dark mode), set on each style: apply()'s display colour does not
    // reach the headline styles
    textTheme: body.copyWith(
      headlineLarge: headings.headlineLarge?.copyWith(color: ink, fontWeight: Tokens.fwSemibold),
      headlineMedium: headings.headlineMedium?.copyWith(color: ink, fontWeight: Tokens.fwSemibold),
      headlineSmall: headings.headlineSmall?.copyWith(color: ink, fontWeight: Tokens.fwSemibold),
      titleLarge: headings.titleLarge?.copyWith(color: ink, fontWeight: Tokens.fwSemibold),
      titleMedium: headings.titleMedium?.copyWith(color: ink),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Tokens.mobNavy800,
      foregroundColor: Tokens.mobWhite,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        fontFamily: heading,
        fontWeight: Tokens.fwSemibold,
        fontSize: 18,
        color: Tokens.mobWhite,
      ),
    ),
    // dialogs on the cards' surface (white; dark grey in dark mode): on the default lilac grey the cyan words of
    // a Cancel fall to 4.0:1 (docs/design/98)
    dialogTheme: DialogThemeData(
      backgroundColor: dark ? Tokens.mobGray900 : Tokens.mobWhite,
      surfaceTintColor: Colors.transparent,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      // the rows' ink (tap, hover) keeps to the card's round corners
      clipBehavior: Clip.antiAlias,
      color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
      margin: const EdgeInsets.symmetric(vertical: Tokens.sp1),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusLg),
        side: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray200),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? Tokens.mobGray900 : Tokens.mobGray50,
      contentPadding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: dark ? Tokens.mobGray500 : Tokens.mobGray300, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: Tokens.mobCyan600, width: 2),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        // navy words on cyan (4.8:1 light, 5.6:1 dark); white on cyan is too light (3.1:1)
        backgroundColor: Tokens.mobCyan600,
        foregroundColor: dark ? Tokens.mobNavy900 : Tokens.mobNavy800,
        textStyle: TextStyle(fontFamily: heading, fontWeight: Tokens.fwSemibold, fontSize: 16),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        foregroundColor: ink,
        side: BorderSide(color: dark ? Tokens.mobCyan500 : Tokens.mobNavy800, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 44),
        // the link colour: 4.9:1 on white, 4.7:1 on the light grey sheet
        foregroundColor: dark ? Tokens.mobCyan500 : Tokens.mobCyan700,
        // the size stays Material's (14): rows of text and a text button keep their room with large text
        textStyle: const TextStyle(fontWeight: Tokens.fwSemibold),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        selectedBackgroundColor: dark ? Tokens.mobCyan600 : Tokens.mobNavy800,
        selectedForegroundColor: dark ? Tokens.mobNavy900 : Tokens.mobWhite,
        foregroundColor: ink,
        side: BorderSide(color: dark ? Tokens.mobGray500 : Tokens.mobGray300),
        shape: const StadiumBorder(),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: const StadiumBorder(),
      side: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray200),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    dividerTheme: DividerThemeData(color: dark ? Tokens.mobGray700 : Tokens.mobGray100, space: 1),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Tokens.mobNavy800,
      indicatorColor: Tokens.mobCyan600,
      surfaceTintColor: Colors.transparent,
      height: 72,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith(
        (st) => IconThemeData(
          color: st.contains(WidgetState.selected) ? Tokens.mobNavy800 : Tokens.mobNavy100,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (st) => TextStyle(
          fontSize: 12,
          color: st.contains(WidgetState.selected) ? Tokens.mobWhite : Tokens.mobNavy100,
          fontWeight: st.contains(WidgetState.selected) ? Tokens.fwBold : Tokens.fwSemibold,
        ),
      ),
    ),
  );
}

/// The icon of a menu item (the web apps' icon names).
IconData menuIcon(String name) => switch (name) {
  'home' => Icons.home_outlined,
  'book' => Icons.menu_book_outlined,
  'calendar' => Icons.calendar_month_outlined,
  'check' => Icons.check_circle_outline,
  'clipboard' => Icons.assignment_outlined,
  'chart' => Icons.insert_chart_outlined,
  'file' => Icons.description_outlined,
  'message' => Icons.chat_bubble_outline,
  'inbox' => Icons.inbox_outlined,
  'wallet' => Icons.account_balance_wallet_outlined,
  'user' => Icons.person_outline,
  'users' => Icons.people_outline,
  'userPlus' => Icons.person_add_alt_outlined,
  'bus' => Icons.directions_bus_outlined,
  'bed' => Icons.bed_outlined,
  'heart' => Icons.favorite_border,
  'key' => Icons.vpn_key_outlined,
  'cart' => Icons.shopping_cart_outlined,
  'clock' => Icons.schedule,
  'bell' => Icons.notifications_none,
  'settings' => Icons.settings_outlined,
  'search' => Icons.search,
  'grid' => Icons.grid_view_outlined,
  _ => Icons.chevron_right,
};
