import GLib from "gi://GLib";

const domain = "gtkrypt";

imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);

export const _ = imports.gettext.gettext;
export const ngettext = imports.gettext.ngettext;
