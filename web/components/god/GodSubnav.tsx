'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  GOD_AUTH_PATH,
  GOD_EQUIPMENT_PATH,
  GOD_TABLES_PATH,
  GOD_USERS_PATH,
} from '@/lib/god-tables';
import { GOD_DASHBOARD_PATH } from '@/lib/god-client';

const LINKS = [
  { href: GOD_DASHBOARD_PATH, label: 'Invites', exact: true },
  { href: GOD_TABLES_PATH, label: 'Tables' },
  { href: GOD_EQUIPMENT_PATH, label: 'Equipment' },
  { href: GOD_USERS_PATH, label: 'Users' },
  { href: GOD_AUTH_PATH, label: 'Auth / Users' },
  { href: '/admin/god/manuals', label: 'Manuals' },
];

export function GodSubnav() {
  const pathname = usePathname() || '';
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {LINKS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'btn text-xs whitespace-nowrap ' + (active ? 'btn-primary' : 'btn-secondary')
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
