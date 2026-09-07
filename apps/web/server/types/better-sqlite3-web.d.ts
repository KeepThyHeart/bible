// Type declaration for the 'better-sqlite3-web' npm alias.
// This is an npm alias for better-sqlite3 (installed under a different name
// to avoid hoisting conflicts with the Electron-compiled copy in the desktop package).
declare module 'better-sqlite3-web' {
  import BetterSqlite3 from 'better-sqlite3';
  export = BetterSqlite3;
}
