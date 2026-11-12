#!/bin/bash
# lo_impress_ui.sh: make headless LibreOffice able to open slide decks (.pptx/.ppt/.odp) on this computer.
# Ubuntu's libreoffice-impress-nogui leaves out Impress's UI files, but Impress 7.3 builds its tab bar from
# modules/simpress/ui/tabviewbar.ui even with --headless, so without it every deck conversion aborts (signal 6,
# "Unspecified Application Error") while Word and Excel files convert fine. This writes that one file (LibreOffice 7.3,
# MPL-2.0, unchanged) when it's missing. Safe to run any number of times; prints nothing; exit 0 unless it can't write it.
# Called by render_docx.sh and by the app's file preview job (1HC src/file-preview.js). The computer image installs the
# full set from libreoffice-impress (image/skills-layer.sh), after which this does nothing.
case "${1:-}" in -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; esac
L=${LO_ROOT:-/usr/lib/libreoffice}; U=$L/share/config/soffice.cfg/modules/simpress/ui
[ -d "$L" ] || exit 0
[ -s "$U/tabviewbar.ui" ] && exit 0
mkdir -p "$U" && cat > "$U/tabviewbar.ui.tmp" <<'TABVIEWBAR_UI' && mv -f "$U/tabviewbar.ui.tmp" "$U/tabviewbar.ui"
<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated with glade 3.36.0 -->
<interface domain="sd">
  <requires lib="gtk+" version="3.20"/>
  <object class="GtkBox" id="TabViewBar">
    <property name="visible">True</property>
    <property name="can_focus">False</property>
    <property name="orientation">vertical</property>
    <child>
      <object class="GtkNotebook" id="tabcontrol">
        <property name="visible">True</property>
        <property name="can_focus">True</property>
        <property name="margin-start">5</property>
        <property name="margin_top">3</property>
        <property name="hexpand">True</property>
        <property name="vexpand">True</property>
        <property name="scrollable">True</property>
        <property name="enable_popup">True</property>
        <child>
          <!-- n-columns=1 n-rows=1 -->
          <object class="GtkGrid">
            <property name="visible">True</property>
            <property name="can_focus">False</property>
            <child>
              <placeholder/>
            </child>
          </object>
        </child>
        <child type="tab">
          <object class="GtkLabel" id="1">
            <property name="visible">True</property>
            <property name="can_focus">False</property>
            <property name="label">placeholder</property>
          </object>
          <packing>
            <property name="tab_fill">False</property>
          </packing>
        </child>
      </object>
      <packing>
        <property name="expand">False</property>
        <property name="fill">True</property>
        <property name="position">0</property>
      </packing>
    </child>
  </object>
</interface>
TABVIEWBAR_UI
