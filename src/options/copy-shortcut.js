// Turns the "copy shortcut" option on for a page before enable.js runs. The
// worker registers this file ahead of enable.js for sites that have the option
// on (see OPTIONS in background.js): registered content scripts can only be
// files, so each option has a line like this one. Everywhere else the worker
// passes the options to the page directly.
Object.assign((globalThis.__letsCopyOptions ||= {}), { copyShortcut: true });
