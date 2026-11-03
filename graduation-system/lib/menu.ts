// Staff back office menu, in the order of the build specification (section 11.2).
// Every page also checks its permission on the server; hiding a menu item is never the only protection.

export type NavItem = { path: string; label: string; perms: string[] };
export type NavGroup = { head: string | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    head: null,
    items: [
      { path: '/admin', label: 'Dashboard', perms: ['view_dashboard'] },
      { path: '/admin/master-list', label: 'Master List', perms: ['master_list'] },
    ],
  },
  {
    head: 'Finance',
    items: [
      { path: '/admin/finance', label: 'Finance Entry', perms: ['finance_entry'] },
      { path: '/admin/finance/holds', label: 'Financial Hold', perms: ['financial_hold'] },
      { path: '/admin/finance/reconciliation', label: 'Reconciliation', perms: ['reconciliation'] },
      { path: '/admin/finance/graduation-day', label: 'Graduation Day Payments', perms: ['graduation_day_payments'] },
    ],
  },
  {
    head: 'Marketing',
    items: [
      { path: '/admin/tickets', label: 'E-Tickets and Seating', perms: ['tickets_seating'] },
      { path: '/admin/live', label: 'Live Seating', perms: ['live_seating'] },
      { path: '/admin/checkin', label: 'Entry Check-In', perms: ['entry_checkin'] },
      { path: '/admin/packages', label: 'Package Collection', perms: ['package_collection'] },
      { path: '/admin/merchandise', label: 'Merchandise', perms: ['merchandise'] },
      { path: '/admin/extra-tickets', label: 'Extra Tickets', perms: ['extra_tickets', 'extra_tickets_approve'] },
    ],
  },
  {
    head: 'DAR and Campus Central',
    items: [
      { path: '/admin/dar/allocation', label: 'Financial Hold and Allocation', perms: ['ceremony_allocation'] },
      { path: '/admin/dar/potential', label: 'Potential Graduates', perms: ['potential_graduates'] },
    ],
  },
  {
    head: 'Door',
    items: [{ path: '/admin/scanner', label: 'Scanner', perms: ['scanner'] }],
  },
  {
    head: 'Administration',
    items: [
      { path: '/admin/technical', label: 'Technical Settings', perms: ['tech_admin'] },
      { path: '/admin/access', label: 'Admin Access', perms: ['user_access', 'seasons', 'prices', 'layout_edit', 'programme_map'] },
      { path: '/admin/versions', label: 'Version Changes', perms: ['version_changes'] },
    ],
  },
];

export function firstAllowedPath(perms: Set<string>): string | null {
  for (const g of NAV) for (const i of g.items) if (i.perms.some((p) => perms.has(p))) return i.path;
  return null;
}

// Version Changes tabs: [key, label, audit categories]
export const VERSION_TABS: [string, string, string[]][] = [
  ['ALL', 'All changes', []],
  ['finance', 'Finance and payments', ['finance', 'payments']],
  ['tickets', 'Tickets and transfers', ['tickets', 'transfers', 'extra_tickets']],
  ['allocation', 'Allocation and Master List', ['allocation', 'master_list', 'limits']],
  ['checkin', 'Check-in and packages', ['checkin', 'packages']],
  ['merch', 'Merchandise', ['merchandise']],
  ['setup', 'Seasons, prices and hall', ['seasons', 'prices', 'hall_layout']],
  ['access', 'User access', ['access']],
  ['technical', 'Technical', ['technical']],
];
