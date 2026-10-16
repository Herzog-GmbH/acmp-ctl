// ACMP CTL – Bereiche für die Startseite (Software, Betriebssystem, Active Directory, Kiosk ...).
// Ein Eintrag kann in mehreren Bereichen stehen. Zugeordnet wird beim Bauen über Kategorie, Tags,
// Anwendungen und feste Listen, die Vorlagen selbst brauchen dafür kein eigenes Feld.
// Reihenfolge der Liste = Reihenfolge der Kacheln. „vorrang“ bestimmt das Symbol einer Karte,
// wenn sie in mehreren Bereichen steht (kleinere Zahl gewinnt).

export const BEREICHE = [
  { id: 'software', name: 'Software', text: 'Installieren, aktualisieren, entfernen', icon: 'package', hue: 200, vorrang: 5,
    kategorien: ['Software'], tags: ['Softwareverteilung', 'Deinstallation', 'winget', 'Appx', 'MSIX', 'Bloatware'],
    ohne: ['citrix-prelaunch-abschalten', 'outlook-archiv-taste-abschalten'] },
  { id: 'betriebssystem', name: 'Betriebssystem', text: 'Windows-Einstellungen, Updates, Neustart, Speicher', icon: 'monitor', hue: 235, vorrang: 9,
    kategorien: ['Windows-Einstellungen', 'Wartung', 'Baukasten'], nichtMit: ['office-browser', 'software'], anwendungen: ['Windows 11', 'Windows 10'],
    tags: ['Neustart', 'Windows Update', 'Speicherplatz', 'Windows 11', 'Windows 10', 'Inplace', 'Upgrade', 'Uhrzeit'],
    ohne: ['druckwarteschlange-leeren'] },
  { id: 'sicherheit', name: 'Sicherheit', text: 'BitLocker, Defender, Secure Boot, Rechte', icon: 'shield', hue: 150, vorrang: 2,
    kategorien: ['Sicherheit'], tags: ['BitLocker', 'Secure Boot', 'Administratoren', 'Firewall', 'Härtung', 'CVE', 'NTFS'] },
  { id: 'active-directory', name: 'Active Directory', text: 'Computergruppen, Gruppenrichtlinien, Schlüssel im AD', icon: 'tree', hue: 265, vorrang: 3,
    tags: ['Active Directory', 'LDAP'] },
  { id: 'office-browser', name: 'Office & Browser', text: 'Edge, Outlook, Teams, Citrix einstellen', icon: 'browser', hue: 25, vorrang: 1,
    anwendungen: ['Edge', 'Outlook', 'Teams', 'Citrix', 'Microsoft 365', 'Office', 'Firefox', 'OneDrive'] },
  { id: 'netzwerk', name: 'Netzwerk & Drucker', text: 'DNS, Winsock, Zeit, Firewall, Spooler', icon: 'network', hue: 185, vorrang: 4,
    tags: ['Netzwerk', 'DNS', 'Drucker', 'Spooler', 'WLAN', 'Firewall', 'NTP', 'Zeitsynchronisation'] },
  { id: 'inventar', name: 'Inventar & Assets', text: 'Werte auslesen und in ACMP-Feldern speichern', icon: 'clipboard', hue: 95, vorrang: 7,
    kategorien: ['Inventar', 'Assets'], tags: ['individuelles Feld', 'Asset'], mitFeldern: true },
  { id: 'benutzer', name: 'Benutzer informieren', text: 'Hinweise, Dialoge, Benachrichtigungen', icon: 'bell', hue: 55, vorrang: 6,
    kategorien: ['Benutzerhinweise'], tags: ['Benutzerhinweis', 'Benachrichtigung', 'Toast'] },
  { id: 'kiosk', name: 'ACMP Kiosk', text: 'Benutzer starten es selbst im Kiosk', icon: 'kiosk', hue: 320, vorrang: 10,
    tags: ['Kiosk'], anwendungen: ['ACMP Kiosk'] },
  { id: 'rollout', name: 'Rollout & Werkzeuge', text: 'OS-Rollout, WinPE, Agent, Formulare', icon: 'rocket', hue: 290, vorrang: 8,
    kategorien: ['Rollout', 'Werkzeuge'] },
];

const low = s => String(s || '').toLowerCase();

/* item: { key, category, tags, applications, requires } – Vorlage oder Filebase-Eintrag */
export function bereicheFor(item) {
  const tags = (item.tags || []).map(low);
  const apps = (item.applications || []).map(a => low(a.name));
  const treffer = new Set();
  const pass = (b, mitVorbehalt) => {
    if ((b.ohne || []).includes(item.key)) return false;
    // „nichtMit“ sperrt nur die Zuordnung über die Kategorie, Tags und Anwendungen zählen weiter
    const gesperrt = mitVorbehalt && (b.nichtMit || []).some(id => treffer.has(id));
    if (!gesperrt && (b.kategorien || []).includes(item.category)) return true;
    if ((b.tags || []).some(t => tags.includes(low(t)))) return true;
    if ((b.anwendungen || []).some(a => apps.some(x => x.includes(low(a))))) return true;
    if (b.mitFeldern && item.requires?.customFields?.length) return true;
    return false;
  };
  // zuerst alle ohne Vorbehalt, dann die mit „nichtMit“ (z. B. Betriebssystem nicht, wenn schon Office & Browser)
  for (const b of BEREICHE) if (!b.nichtMit && pass(b, false)) treffer.add(b.id);
  for (const b of BEREICHE) if (b.nichtMit && pass(b, true)) treffer.add(b.id);
  const order = BEREICHE.map(b => b.id);
  return [...treffer].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/* Bereich, dessen Symbol die Karte zeigt */
export function hauptbereich(ids) {
  const by = Object.fromEntries(BEREICHE.map(b => [b.id, b]));
  return [...ids].sort((a, b) => by[a].vorrang - by[b].vorrang)[0] || null;
}
