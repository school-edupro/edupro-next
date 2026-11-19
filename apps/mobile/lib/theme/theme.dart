import 'package:google_fonts/google_fonts.dart';
import 'package:material_ui/material_ui.dart';

import 'tokens.g.dart';

/// EduPro's look on the phone: the design system's navy and cyan, Poppins headings and Source Sans 3 text (the
/// same tokens as the web apps), light and dark.
ThemeData eduproTheme({required Brightness brightness, bool webFonts = true}) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Tokens.mobNavy800,
    brightness: brightness,
    primary: dark ? Tokens.mobCyan500 : Tokens.mobNavy800,
    secondary: Tokens.mobCyan600,
    error: Tokens.mobRed600,
    surface: dark ? Tokens.mobGray900 : Tokens.mobWhite,
  );
  final base = ThemeData(brightness: brightness).textTheme;
  // Poppins and Source Sans 3 as on the web (fetched once and kept); tests use the platform font
  final body = (webFonts ? GoogleFonts.sourceSans3TextTheme(base) : base).apply(
    bodyColor: dark ? Tokens.mobGray100 : Tokens.mobGray700,
    displayColor: dark ? Tokens.mobWhite : Tokens.mobNavy800,
  );
  final headings = webFonts ? GoogleFonts.poppinsTextTheme(body) : body;
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? Tokens.mobNavy900 : Tokens.mobGray50,
    textTheme: body.copyWith(
      headlineLarge: headings.headlineLarge,
      headlineMedium: headings.headlineMedium,
      headlineSmall: headings.headlineSmall,
      titleLarge: headings.titleLarge,
      titleMedium: headings.titleMedium,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? Tokens.mobNavy900 : Tokens.mobNavy800,
      foregroundColor: Tokens.mobWhite,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusMd),
        side: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray200),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(Tokens.radiusSm)),
      filled: true,
      fillColor: dark ? Tokens.mobGray900 : Tokens.mobWhite,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        backgroundColor: dark ? Tokens.mobCyan600 : Tokens.mobNavy800,
        foregroundColor: Tokens.mobWhite,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Tokens.radiusSm)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      indicatorColor: dark ? Tokens.mobNavy700 : Tokens.mobCyan100,
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
