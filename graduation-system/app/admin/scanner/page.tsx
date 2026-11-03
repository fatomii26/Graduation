import { requireStaff } from '@/lib/auth/staff';
import { getCeremonies, getZones } from '@/lib/settings';
import Scanner from '@/components/Scanner';
import { Empty } from '@/components/ui';

export default async function ScannerPage() {
  const staff = await requireStaff('scanner');
  const [ceremonies, zones] = await Promise.all([getCeremonies(staff.season.id), getZones(staff.season.id, true)]);
  const doors = Array.from(new Set(zones.map((z) => z.door)));
  if (!ceremonies.length) return <Empty>No ceremonies in this season.</Empty>;
  return (
    <>
      <h1>Scanner</h1>
      <p className="page-sub">Works on any phone, tablet or laptop with a camera. No app to install.</p>
      <Scanner options={ceremonies.map((c) => ({ id: c.id, name: c.name, doors }))} staff={staff.email} />
    </>
  );
}
